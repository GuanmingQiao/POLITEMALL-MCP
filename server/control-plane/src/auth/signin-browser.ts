import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import { TokenRenewalError } from "../api/errors.js";
import type { D2LSchool } from "../types/schools.js";
import { config } from "../utils/config.js";
import { getBrowserState, saveBrowserState, type SchoolSession } from "./session-vault.js";

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

export async function launchBrowser(storageState?: string): Promise<LaunchedBrowser> {
  const args = ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--disable-extensions"];
  if (process.env.CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      storageState: storageState ? JSON.parse(storageState) : undefined,
      locale: "en-SG",
      timezoneId: "Asia/Singapore",
    });
    // This browser has no authenticator, so a passkey / security-key prompt can never be answered
    // and Microsoft would wait on it forever. Present the browser as not supporting WebAuthn so
    // Microsoft offers a method the person can complete here (password, Authenticator approval or
    // code) instead of defaulting to a passkey.
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
        await browser.close().catch(() => undefined);
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

// ---- silent re-login ----

const SILENT_TIMEOUT_MS = 30_000;
const MICROSOFT_HOSTS = new Set(["login.microsoftonline.com", "login.live.com"]);

// A fresh headless browser replays the saved Microsoft state. If Microsoft still recognises the
// person, D2L lands on its home without any input and the new session is returned (and the
// refreshed browser state saved). If Microsoft asks for anything, there is no one to answer, so
// this gives up (null) and the caller asks the person to sign in again.
export async function silentRelogin(userId: string, school: D2LSchool): Promise<SchoolSession | null> {
  const state = getBrowserState(userId);
  if (!state) return null;
  const release = acquireBrowserSlot();
  if (!release) throw new TokenRenewalError("Too many sign-ins are running right now");
  let launched: LaunchedBrowser | undefined;
  try {
    launched = await launchBrowser(state);
    const { page, context } = launched;
    await page.goto(`${origins[school]}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);

    const deadline = Date.now() + SILENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (onD2lHome(page.url(), school)) {
        const session = await harvestSession(page, context, school);
        if (!session) return null;
        await saveBrowserState(userId, JSON.stringify(await context.storageState()));
        return session;
      }
      // Stuck on a Microsoft page that is showing something to answer: no one is here to do it.
      let host = "";
      try {
        host = new URL(page.url()).hostname;
      } catch {
        // about:blank while redirecting
      }
      if (MICROSOFT_HOSTS.has(host) && Date.now() - (deadline - SILENT_TIMEOUT_MS) > 12_000) return null;
      await page.waitForTimeout(500);
    }
    return null;
  } catch {
    return null;
  } finally {
    await launched?.close();
    release();
  }
}
