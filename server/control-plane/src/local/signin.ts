import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import { launchBrowser, origins, type LaunchedBrowser } from "../auth/signin-browser.js";
import { collectSessions } from "../auth/signin-harvest.js";
import { mintToken } from "../auth/d2l-session.js";
import { ensureUser, saveBrowserState, saveSchoolSession } from "../auth/session-vault.js";
import { hasPersistentMicrosoftCookie, parseBrowserState } from "../auth/microsoft-state.js";
import type { MintResult } from "../auth/token-mint.js";
import type { D2LSchool } from "../types/schools.js";
import { NoBrowserError } from "../auth/browser-discovery.js";

// The local sign-in: a visible browser window on this computer, at the school's real Microsoft
// sign-in page. The person types their own credentials and completes MFA there; nothing they type
// passes through this program. When D2L's home is reached the session is harvested and verified
// with the same code the hosted sign-in uses, stored in the local vault, and the window is closed.

export const LOCAL_USER_ID = "local";

export type LocalSigninResult =
  | { ok: true; schools: D2LSchool[]; notice?: string }
  | { ok: false; reason: string; noBrowser?: boolean };

export interface LocalSigninDeps {
  launch: () => Promise<LaunchedBrowser>;
  mint: (opts: { school: D2LSchool; cookieHeader: string; xsrfToken: string }) => Promise<MintResult>;
  overallMs: number;
}

const defaultDeps = (): LocalSigninDeps => ({
  launch: () => launchBrowser(undefined, { headed: true }),
  mint: (o) => mintToken(o),
  overallMs: config.signinTimeoutMs,
});

async function run(deps: LocalSigninDeps): Promise<LocalSigninResult> {
  let launched: LaunchedBrowser | undefined;
  try {
    launched = await deps.launch();
    const { page, context } = launched;
    let closedByPerson = false;
    page.on("close", () => (closedByPerson = true));
    await page.goto(`${origins.politemall}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    const sessions = await collectSessions({ page, context, mint: deps.mint, overallMs: deps.overallMs, cancelled: () => closedByPerson });
    if (sessions.size === 0) {
      auditLog("signin_failed", { local: true });
      return { ok: false, reason: closedByPerson ? "The sign-in window was closed before the sign-in finished." : "The sign-in did not finish in time." };
    }
    // Captured before the window closes; nothing is written until a session has been verified.
    const stateJson = JSON.stringify(await context.storageState());
    await ensureUser(LOCAL_USER_ID);
    for (const [school, session] of sessions) await saveSchoolSession(LOCAL_USER_ID, school, session);
    await saveBrowserState(LOCAL_USER_ID, stateJson);
    const persistent = hasPersistentMicrosoftCookie(parseBrowserState(stateJson));
    auditLog("signin_ok", { local: true, schools: [...sessions.keys()], persistent });
    return {
      ok: true,
      schools: [...sessions.keys()],
      notice: persistent ? undefined : "Microsoft did not keep you signed in, so you may need to sign in again within about a day.",
    };
  } catch (err) {
    if (err instanceof NoBrowserError) return { ok: false, reason: err.message, noBrowser: true };
    auditLog("signin_failed", { local: true });
    return { ok: false, reason: err instanceof Error ? err.message : "The sign-in failed." };
  } finally {
    await launched?.close();
  }
}

let active: Promise<LocalSigninResult> | undefined;
let lastFailure: { reason: string; noBrowser?: boolean } | undefined;

// Starts a sign-in window, or returns the one already open: only one is ever shown at a time.
export function startLocalSignin(deps: LocalSigninDeps = defaultDeps()): Promise<LocalSigninResult> {
  if (active) return active;
  lastFailure = undefined;
  active = run(deps)
    .then((result) => {
      if (!result.ok) lastFailure = { reason: result.reason, noBrowser: result.noBrowser };
      return result;
    })
    .finally(() => {
      active = undefined;
    });
  return active;
}

export const signinInProgress = (): boolean => active !== undefined;
export const lastSigninFailure = () => lastFailure;

export function resetLocalSigninForTests(): void {
  active = undefined;
  lastFailure = undefined;
}
