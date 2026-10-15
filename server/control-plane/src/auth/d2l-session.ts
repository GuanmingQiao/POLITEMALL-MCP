import { SessionExpiredError, TokenRenewalError } from "../api/errors.js";
import type { D2LSchool } from "../types/schools.js";
import { getSchoolSession, saveSchoolSession, clearSchoolSession, type SchoolSession } from "./session-vault.js";
import { mintAccessToken, type MintResult } from "./token-mint.js";

// The one place that decides what credential a D2L call carries, renewing it as cheaply as it can:
//   1. the cached Bearer token, while it is comfortably unexpired;
//   2. otherwise mint a new one from the stored D2L session (one HTTPS call, no browser);
//   3. otherwise, if D2L says the session itself is dead, a silent re-login in a background
//      browser replaying the saved Microsoft state, then mint again;
//   4. otherwise SessionExpiredError, which the tools turn into "sign in again" with a fresh link.
// Concurrent callers for the same person and school share one renewal.

// A token this close to expiry is renewed first, so it cannot lapse mid-request.
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

export type SilentRelogin = (userId: string, school: D2LSchool) => Promise<SchoolSession | null>;

interface Deps {
  mint: (opts: { school: D2LSchool; cookieHeader: string; xsrfToken: string }) => Promise<MintResult>;
  silentRelogin: SilentRelogin;
  now: () => number;
}

const deps: Deps = {
  mint: (opts) => mintAccessToken(opts),
  silentRelogin: async () => null,
  now: () => Date.now(),
};

// Wired once at startup (the browser module) and replaced in tests.
export function configureD2lSession(overrides: Partial<Deps>): void {
  Object.assign(deps, overrides);
}

// The same mint renewal uses, for the sign-in that verifies a fresh session by minting its first token.
export const mintToken: Deps["mint"] = (opts) => deps.mint(opts);

const inFlight = new Map<string, Promise<SchoolSession>>();

async function renew(userId: string, school: D2LSchool, session: SchoolSession): Promise<SchoolSession> {
  let current = session;
  let result = await deps.mint({ school, cookieHeader: current.cookieHeader, xsrfToken: current.xsrfToken });

  if (!result.ok && result.reason === "sessionExpired") {
    const fresh = await deps.silentRelogin(userId, school);
    if (!fresh) {
      await clearSchoolSession(userId, school);
      throw new SessionExpiredError(`Your ${school} session ended and could not be renewed silently.`);
    }
    current = fresh;
    result = await deps.mint({ school, cookieHeader: current.cookieHeader, xsrfToken: current.xsrfToken });
  }

  if (!result.ok) {
    if (result.reason === "sessionExpired") {
      await clearSchoolSession(userId, school);
      throw new SessionExpiredError(`Your ${school} session ended.`);
    }
    throw new TokenRenewalError(`Couldn't renew your ${school} access right now${result.detail ? ` (${result.detail})` : ""}.`);
  }

  const updated: SchoolSession = { ...current, accessToken: result.accessToken, accessTokenExpiresAt: result.expiresAt };
  await saveSchoolSession(userId, school, updated);
  return updated;
}

// "Bearer <token>" ready for d2l-client, or null when this person has no session for that school.
export async function getD2lAuth(userId: string, school: D2LSchool): Promise<string | null> {
  const session = getSchoolSession(userId, school);
  if (!session) return null;
  if (session.accessToken && (session.accessTokenExpiresAt ?? 0) - REFRESH_BUFFER_MS > deps.now()) {
    return `Bearer ${session.accessToken}`;
  }

  const key = `${userId}:${school}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = renew(userId, school, session).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return `Bearer ${(await pending).accessToken}`;
}

// D2L rejected the cached token before its stated expiry (revoked, clock skew): forget it so the
// next call mints a new one instead of retrying the same dead token.
export async function invalidateD2lAuth(userId: string, school: D2LSchool): Promise<void> {
  const session = getSchoolSession(userId, school);
  if (session?.accessToken) {
    await saveSchoolSession(userId, school, { ...session, accessToken: undefined, accessTokenExpiresAt: undefined });
  }
}
