import type { BrowserContext, Page } from "playwright-core";
import type { D2LSchool } from "../types/schools.js";
import { answerStaySignedIn, harvestSession, onD2lHome, origins } from "./signin-browser.js";
import type { MintResult } from "./token-mint.js";
import type { SchoolSession } from "./session-vault.js";

// The part of a sign-in that is the same wherever the browser is shown: wait for the person to
// reach D2L's home on a school, harvest and verify (by minting a token) the session, then open the
// other tenant in the same browser so the Microsoft session signs them in there without asking
// again. The streamed (cloud) sign-in and the local-browser sign-in both run exactly this.

const SCHOOLS: D2LSchool[] = ["politemall", "nyp"];
const SECOND_TENANT_GRACE_MS = 60_000;
const POLL_MS = 500;
const MAX_KMSI_CLICKS = 3;

export interface CollectOptions {
  page: Page;
  context: BrowserContext;
  mint: (opts: { school: D2LSchool; cookieHeader: string; xsrfToken: string }) => Promise<MintResult>;
  overallMs: number;
  // True once the sign-in has been ended from outside (closed, timed out, abandoned).
  cancelled: () => boolean;
  status?: (message: string) => void;
}

const label = (school: D2LSchool) => (school === "nyp" ? "NYP" : "POLITEMall");

export async function collectSessions(opts: CollectOptions): Promise<Map<D2LSchool, SchoolSession>> {
  const { page, context } = opts;
  const found = new Map<D2LSchool, SchoolSession>();
  const deadline = Date.now() + opts.overallMs;
  let secondDeadline = 0;
  let secondStarted = false;

  let kmsiClicks = 0;
  while (!opts.cancelled() && Date.now() < deadline && !page.isClosed()) {
    // Microsoft's "Stay signed in?": answer Yes so the sign-in can be replayed later.
    if (kmsiClicks < MAX_KMSI_CLICKS && (await answerStaySignedIn(page))) kmsiClicks++;
    for (const school of SCHOOLS) {
      if (found.has(school) || !onD2lHome(page.url(), school)) continue;
      const session = await harvestSession(page, context, school);
      if (!session) continue;
      const minted = await opts.mint({ school, cookieHeader: session.cookieHeader, xsrfToken: session.xsrfToken });
      if (!minted.ok) continue;
      found.set(school, { ...session, accessToken: minted.accessToken, accessTokenExpiresAt: minted.expiresAt });
      opts.status?.(`Signed in to ${label(school)}.`);
    }
    if (found.size === SCHOOLS.length) break;
    if (found.size === 1 && !secondStarted) {
      secondStarted = true;
      secondDeadline = Date.now() + SECOND_TENANT_GRACE_MS;
      const other = SCHOOLS.find((s) => !found.has(s))!;
      opts.status?.(`Connecting ${label(other)}…`);
      await page.goto(`${origins[other]}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    }
    if (found.size === 1 && Date.now() > secondDeadline) break;
    await page.waitForTimeout(POLL_MS).catch(() => undefined);
  }
  return found;
}
