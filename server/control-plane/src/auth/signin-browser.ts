import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import type { D2LSchool } from "../types/schools.js";
import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import { decideRequest } from "./net-policy.js";
import { launchBrowserProcess } from "./browser-discovery.js";
import type { ReloginResult } from "./d2l-session.js";
import { hasNewerMicrosoftState, parseBrowserState } from "./microsoft-state.js";
import { browserStateStatus, getBrowserState, saveBrowserState, touchBrowserState, type SchoolSession } from "./session-vault.js";

// Everything that touches Chromium. A browser exists only while a sign-in or a silent re-login is
// running; it is closed as soon as that finishes, fails or times out. The viewport is fixed so the
// streamed view and the pointer coordinates the user sends line up exactly.

export const VIEWPORT = { width: 1024, height: 720 };
const D2L_COOKIES = ["d2lSessionVal", "d2lSecureSessionVal"];

// Per-school origins; tests point these at a local stub instead of the real tenants.
export const origins: Record<D2LSchool, string> = {
  politemall: `https://${SCHOOL_HOSTS.politemall}`,
  nyp: `https://${SCHOOL_HOSTS.nyp}`,
};

// ---- capacity: the host is small, so only a few Chromiums may exist at once ----

let active = 0;

// A release function, or null when the cap is reached.
export function acquireBrowserSlot(max = config.signinMaxConcurrent): (() => void) | null {
  if (active >= max) return null;
  active++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active--;
    }
  };
}

export function activeBrowserCount(): number {
  return active;
}

// ---- launching ----

export interface LaunchedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

// Chromium's own sandbox is on unless the operator opts out with CHROMIUM_NO_SANDBOX=1.
export function sandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CHROMIUM_NO_SANDBOX === "1";
}

export function chromiumArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args = ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--disable-extensions"];
  if (sandboxDisabled(env)) args.push("--no-sandbox");
  return args;
}

const MAX_NET_HOSTS = 20;
const CLOSE_TIMEOUT_MS = 10_000;

// Hosts the browser may navigate to: the school hosts (so tests and the real tenants share one
// source) plus, in the policy itself, Microsoft's sign-in hosts.
function schoolHosts(): string[] {
  const hosts: string[] = [];
  for (const o of Object.values(origins)) {
    try {
      hosts.push(new URL(o).hostname.toLowerCase());
    } catch {
      // not a URL; ignore
    }
  }
  return hosts;
}

// `headed` is the local sign-in: a visible window on the person's own computer, at its natural
// size, with none of the hosted protections that exist to guard the server from a remote user's
// page (the request allowlist) or to suit a browser nobody can touch (the WebAuthn shim).
export async function launchBrowser(storageState?: string, opts: { headed?: boolean } = {}): Promise<LaunchedBrowser> {
  const headed = opts.headed === true;
  const args = chromiumArgs();
  const browser = await launchBrowserProcess(chromium.launch.bind(chromium), { headless: !headed, args }, { local: config.local });
  try {
    const context = await browser.newContext({
      viewport: headed ? null : VIEWPORT,
      storageState: storageState ? JSON.parse(storageState) : undefined,
      locale: "en-SG",
      timezoneId: "Asia/Singapore",
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
    });
    // Network policy (see net-policy.ts). Only host names are counted, never URLs or content.
    const allowed = schoolHosts();
    const reportOnly = process.env.SIGNIN_NET_MODE === "report";
    const blocked = new Map<string, number>();
    const reported = new Map<string, number>();
    const count = (table: Map<string, number>, host: string) => {
      if (table.has(host) || table.size < MAX_NET_HOSTS) table.set(host, (table.get(host) ?? 0) + 1);
    };
    const hostOf = (url: string): string => {
      try {
        return new URL(url).hostname || new URL(url).protocol;
      } catch {
        return "invalid";
      }
    };
    // An empty 204 answer to a navigation is not committed, so the browser stays on the page it
    // was on; an aborted navigation would replace it with an error page.
    const refuse = async (route: Route, navigation: boolean) => {
      if (navigation) await route.fulfill({ status: 204 }).catch(() => undefined);
      else await route.abort("blockedbyclient").catch(() => undefined);
    };
    if (!headed)
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const navigation = request.isNavigationRequest();
      const decision = decideRequest(url, navigation, allowed);
      if (decision === "block" && !reportOnly) {
        count(blocked, hostOf(url));
        return void (await refuse(route, navigation));
      }
      if (decision !== "allow") count(reported, hostOf(url));
      if (!navigation) return void route.continue().catch(() => undefined);
      // Chromium follows redirects without asking again, so a navigation is fetched here one hop
      // at a time: the redirect target is judged before the browser is allowed to follow it.
      try {
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.status() >= 300 && response.status() < 400 ? response.headers()["location"] : undefined;
        if (location) {
          let target = "";
          try {
            target = new URL(location, url).href;
          } catch {
            // unusable Location; the browser will fail it
          }
          if (target) {
            const hop = decideRequest(target, true, allowed);
            if (hop === "block" && !reportOnly) {
              count(blocked, hostOf(target));
              return void (await refuse(route, true));
            }
            if (hop !== "allow") count(reported, hostOf(target));
          }
        }
        await route.fulfill({ response });
      } catch {
        await route.abort("failed").catch(() => undefined);
      }
    });
    // This browser has no authenticator, so a passkey / security-key prompt can never be answered
    // and Microsoft would wait on it forever. Present the browser as not supporting WebAuthn so
    // Microsoft offers a method the person can complete here (password, Authenticator approval or
    // code) instead of defaulting to a passkey.
    if (!headed)
    await context.addInitScript(() => {
      const g = globalThis as unknown as { PublicKeyCredential?: unknown; navigator?: { credentials?: { get?: unknown; create?: unknown } } };
      try {
        delete g.PublicKeyCredential;
      } catch {
        // already absent
      }
      const creds = g.navigator?.credentials;
      if (creds) {
        const refuse = () => Promise.reject(new DOMException("No authenticator is available in this browser.", "NotAllowedError"));
        creds.get = refuse;
        creds.create = refuse;
      }
    });
    const page = await context.newPage();
    let closed = false;
    return {
      browser,
      context,
      page,
      async close() {
        if (closed) return;
        closed = true;
        // A browser that does not exit when asked (seen with Microsoft Edge on Windows) must not
        // hold up the sign-in or a renewal, so the wait is bounded.
        await Promise.race([browser.close().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref())]);
        if (blocked.size > 0 || reported.size > 0) {
          auditLog("signin_net_summary", { blocked: Object.fromEntries(blocked), reported: Object.fromEntries(reported) });
        }
      },
    };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

// ---- recognising where the browser is ----

export function onD2lHome(url: string, school: D2LSchool): boolean {
  try {
    const u = new URL(url);
    return u.origin === origins[school] && /^\/d2l\/(home|lp\/ouHome)/i.test(u.pathname);
  } catch {
    return false;
  }
}

// ---- harvesting a signed-in session ----

// The page's XSRF token, which the token endpoint requires alongside the session cookies. It only
// exists once D2L's page script has run, so this retries briefly.
async function readXsrf(page: Page): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = await page
      .evaluate(() => {
        try {
          const d2l = (window as unknown as { D2L?: any }).D2L;
          const value = d2l?.LP?.Web?.Authentication?.Xsrf?.GetXsrfToken?.();
          return typeof value === "string" && value.length > 0 ? value : null;
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (token) return token;
    await page.waitForTimeout(500);
  }
  return null;
}

// The signed-in D2L session for a school, once the page is on its home. Null if cookies or the
// XSRF token are missing (the caller treats that as "not signed in yet").
export async function harvestSession(page: Page, context: BrowserContext, school: D2LSchool): Promise<SchoolSession | null> {
  const cookies = await context.cookies(origins[school]);
  const parts: string[] = [];
  for (const name of D2L_COOKIES) {
    const found = cookies.find((c) => c.name === name);
    if (found) parts.push(`${name}=${found.value}`);
  }
  if (parts.length !== D2L_COOKIES.length) return null;
  const xsrfToken = await readXsrf(page);
  if (!xsrfToken) return null;
  return { cookieHeader: parts.join("; "), xsrfToken };
}

// Waits for the browser to arrive on a school's D2L home. Returns false on timeout or when the
// page is closed.
export async function waitForD2lHome(page: Page, school: D2LSchool, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (onD2lHome(page.url(), school)) return true;
    await page.waitForTimeout(500).catch(() => undefined);
  }
  return false;
}

// ---- Microsoft's "Stay signed in?" page ----

// Exported so tests can point the Microsoft-only behaviour at a local stand-in.
export const MICROSOFT_HOSTS = new Set(["login.microsoftonline.com", "login.live.com"]);

// On Microsoft's "Stay signed in?" page, press Yes. Without it Microsoft issues only a short-lived
// session cookie and the saved state stops working within about a day. This presses a button; it
// reads nothing the person typed. Only a Microsoft host is touched, and any failure is ignored so
// it can never block a sign-in. True when Yes was pressed.
export async function answerStaySignedIn(page: Page): Promise<boolean> {
  try {
    if (!MICROSOFT_HOSTS.has(new URL(page.url()).hostname)) return false;
    const onPrompt = await page.evaluate(() => {
      const yes = document.getElementById("idSIButton9");
      const no = document.getElementById("idBtn_Back");
      return !!yes && !!no && /stay signed in/i.test(document.body?.innerText ?? "");
    });
    if (!onPrompt) return false;
    await page.click("#idSIButton9", { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ---- silent re-login ----

const SILENT_TIMEOUT_MS = 30_000;
const MAX_KMSI_CLICKS = 3;

// A fresh headless browser replays the saved Microsoft state. If Microsoft still recognises the
// person, D2L lands on its home without any input and the new session is returned (and the
// refreshed browser state saved, when it improves on what was saved). If Microsoft asks for
// anything, there is no one to answer, so this gives up and says why, in a fixed set of words that
// are safe to log. The caller asks the person to sign in again.
export async function silentRelogin(userId: string, school: D2LSchool): Promise<ReloginResult> {
  const status = browserStateStatus(userId);
  if (status !== "ok") return { ok: false, reason: status === "absent" ? "no_state" : "state_expired" };
  const state = getBrowserState(userId);
  if (!state) return { ok: false, reason: "no_state" };
  const release = acquireBrowserSlot();
  if (!release) return { ok: false, reason: "no_slot" };
  let launched: LaunchedBrowser | undefined;
  try {
    launched = await launchBrowser(state);
    const { page, context } = launched;
    await page.goto(`${origins[school]}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);

    const started = Date.now();
    let kmsiClicks = 0;
    while (Date.now() - started < SILENT_TIMEOUT_MS) {
      if (onD2lHome(page.url(), school)) {
        const session = await harvestSession(page, context, school);
        if (!session) return { ok: false, reason: "no_session" };
        const fresh = JSON.stringify(await context.storageState());
        if (hasNewerMicrosoftState(parseBrowserState(state), parseBrowserState(fresh))) await saveBrowserState(userId, fresh);
        else await touchBrowserState(userId);
        return { ok: true, session };
      }
      if (kmsiClicks < MAX_KMSI_CLICKS && (await answerStaySignedIn(page))) {
        kmsiClicks++;
        await page.waitForTimeout(500);
        continue;
      }
      // Stuck on a Microsoft page that is showing something to answer: no one is here to do it.
      let host = "";
      try {
        host = new URL(page.url()).hostname;
      } catch {
        // about:blank while redirecting
      }
      if (MICROSOFT_HOSTS.has(host) && Date.now() - started > 12_000) return { ok: false, reason: "microsoft_prompt" };
      await page.waitForTimeout(500);
    }
    return { ok: false, reason: "timeout" };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    await launched?.close();
    release();
  }
}
