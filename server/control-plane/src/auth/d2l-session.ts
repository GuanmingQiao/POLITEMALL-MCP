import { SessionExpiredError, TokenRenewalError } from "../api/errors.js";
import type { D2LSchool } from "../types/schools.js";
import { auditLog } from "../utils/audit-log.js";
import { getSchoolSession, saveSchoolSession, clearSchoolSession, type SchoolSession } from "./session-vault.js";
import { mintAccessToken, type MintResult } from "./token-mint.js";

// The one place that decides what credential a D2L call carries, renewing it as cheaply as it can:
//   1. the cached Bearer token, while it is comfortably unexpired;
//   2. otherwise mint a new one from the stored D2L session (one HTTPS call, no browser);
//   3. otherwise, if D2L says the session itself is dead, a silent re-login in a background
//      browser replaying the saved Microsoft state, then mint again;
//   4. otherwise the session is marked lapsed and SessionExpiredError is thrown, which the tools
//      turn into "sign in again" with a fresh link. A lapsed session is not retried for a while and
//      is only cleared after repeated failures or when the Microsoft state is gone.
// Concurrent callers for the same person and school share one renewal. The same renewal is run
// every hour for every stored session by keep-alive.ts, and again when D2L rejects a token that
// looked valid (recoverD2lAuth).

// A token this close to expiry is renewed first, so it cannot lapse mid-request.
const REFRESH_BUFFER_MS = 2 * 60 * 1000;
// After a failed silent re-login the browser is not launched again for this long.
export const RELOGIN_PAUSE_MS = 10 * 60 * 1000;
// This many failed silent re-logins in a row end the session.
export const MAX_RELOGIN_FAILURES = 3;

// Why a silent re-login gave up. Only these words are ever logged about it.
export type ReloginReason = "no_state" | "state_expired" | "no_slot" | "microsoft_prompt" | "timeout" | "no_session" | "error";
export type ReloginResult = { ok: true; session: SchoolSession } | { ok: false; reason: ReloginReason };
export type SilentRelogin = (userId: string, school: D2LSchool) => Promise<ReloginResult>;

interface Deps {
  mint: (opts: { school: D2LSchool; cookieHeader: string; xsrfToken: string }) => Promise<MintResult>;
  silentRelogin: SilentRelogin;
  now: () => number;
}

const deps: Deps = {
  mint: (opts) => mintAccessToken(opts),
  silentRelogin: async () => ({ ok: false, reason: "no_state" }),
  now: () => Date.now(),
};

// Wired once at startup (the browser module) and replaced in tests.
export function configureD2lSession(overrides: Partial<Deps>): void {
  Object.assign(deps, overrides);
}

// The same mint renewal uses, for the sign-in that verifies a fresh session by minting its first token.
export const mintToken: Deps["mint"] = (opts) => deps.mint(opts);

const inFlight = new Map<string, Promise<SchoolSession>>();

const ended = (school: D2LSchool) => new SessionExpiredError(`Your ${school} session ended and could not be renewed silently.`);

// The session stays (marked lapsed) until it has failed MAX_RELOGIN_FAILURES times in a row.
async function lapse(userId: string, school: D2LSchool, session: SchoolSession): Promise<never> {
  const failures = (session.reloginFailures ?? 0) + 1;
  if (failures >= MAX_RELOGIN_FAILURES) {
    await clearSchoolSession(userId, school);
  } else {
    await saveSchoolSession(userId, school, {
      ...session,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      lapsedAt: deps.now(),
      reloginFailures: failures,
    });
  }
  throw ended(school);
}

async function renew(userId: string, school: D2LSchool, session: SchoolSession): Promise<SchoolSession> {
  if (session.lapsedAt !== undefined && deps.now() - session.lapsedAt < RELOGIN_PAUSE_MS) throw ended(school);

  let current = session;
  let result = await deps.mint({ school, cookieHeader: current.cookieHeader, xsrfToken: current.xsrfToken });

  if (!result.ok && result.reason === "sessionExpired") {
    const started = deps.now();
    const relogin = await deps.silentRelogin(userId, school);
    auditLog("silent_relogin", { school, ok: relogin.ok, ...(relogin.ok ? {} : { reason: relogin.reason }), elapsedMs: deps.now() - started });
    if (!relogin.ok) {
      // No browser was free: not the person's fault and not a failed attempt.
      if (relogin.reason === "no_slot") throw new TokenRenewalError("Too many sign-ins are running right now");
      // Nothing left to replay: end the session now.
      if (relogin.reason === "no_state" || relogin.reason === "state_expired") {
        await clearSchoolSession(userId, school);
        throw ended(school);
      }
      return lapse(userId, school, current);
    }
    current = relogin.session;
    result = await deps.mint({ school, cookieHeader: current.cookieHeader, xsrfToken: current.xsrfToken });
  }

  if (!result.ok) {
    if (result.reason === "sessionExpired") return lapse(userId, school, current);
    throw new TokenRenewalError(`Couldn't renew your ${school} access right now${result.detail ? ` (${result.detail})` : ""}.`);
  }

  const updated: SchoolSession = {
    ...current,
    ...(result.cookieHeader ? { cookieHeader: result.cookieHeader } : {}),
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.expiresAt,
    lapsedAt: undefined,
    reloginFailures: undefined,
  };
  await saveSchoolSession(userId, school, updated);
  return updated;
}

function renewShared(userId: string, school: D2LSchool, session: SchoolSession): Promise<SchoolSession> {
  const key = `${userId}:${school}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = renew(userId, school, session).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

// "Bearer <token>" ready for d2l-client, or null when this person has no session for that school.
export async function getD2lAuth(userId: string, school: D2LSchool): Promise<string | null> {
  const session = getSchoolSession(userId, school);
  if (!session) return null;
  if (session.accessToken && (session.accessTokenExpiresAt ?? 0) - REFRESH_BUFFER_MS > deps.now()) {
    return `Bearer ${session.accessToken}`;
  }
  return `Bearer ${(await renewShared(userId, school, session)).accessToken}`;
}

// Renews a stored session now, whether or not its token is close to expiring: what the hourly
// keep-alive does. Null when the person has no session for that school.
export async function refreshD2lSession(userId: string, school: D2LSchool): Promise<SchoolSession | null> {
  const session = getSchoolSession(userId, school);
  if (!session) return null;
  return renewShared(userId, school, session);
}

// D2L rejected the cached token before its stated expiry (revoked, clock skew): forget it so the
// next call mints a new one instead of retrying the same dead token.
export async function invalidateD2lAuth(userId: string, school: D2LSchool): Promise<void> {
  const session = getSchoolSession(userId, school);
  if (session?.accessToken) {
    await saveSchoolSession(userId, school, { ...session, accessToken: undefined, accessTokenExpiresAt: undefined });
  }
}

// D2L rejected `rejectedAuth`. A replacement credential to repeat the call with, or null when none
// better than the rejected one exists. Throws what renewal throws: SessionExpiredError when the
// session itself is gone, TokenRenewalError when D2L is only temporarily unreachable.
export async function recoverD2lAuth(userId: string, school: D2LSchool, rejectedAuth: string): Promise<string | null> {
  const session = getSchoolSession(userId, school);
  if (!session) return null;
  const rejected = rejectedAuth.replace(/^Bearer\s+/i, "");

  // Another call already renewed while this one was in flight.
  if (session.accessToken && session.accessToken !== rejected && (session.accessTokenExpiresAt ?? 0) - REFRESH_BUFFER_MS > deps.now()) {
    return `Bearer ${session.accessToken}`;
  }

  let target = session;
  if (session.accessToken) {
    target = { ...session, accessToken: undefined, accessTokenExpiresAt: undefined };
    await saveSchoolSession(userId, school, target);
  }
  try {
    const renewed = await renewShared(userId, school, target);
    if (renewed.accessToken === rejected) {
      auditLog("token_recovery_failed", { school, reason: "same_token" });
      return null;
    }
    auditLog("token_recovered", { school });
    return `Bearer ${renewed.accessToken}`;
  } catch (err) {
    auditLog("token_recovery_failed", { school, reason: err instanceof SessionExpiredError ? "session_expired" : "transient" });
    throw err;
  }
}
