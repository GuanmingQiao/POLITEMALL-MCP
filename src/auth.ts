import { chromium } from "playwright";
import { loadSession, saveSession, type SessionData, type StoredCookie } from "./session.js";

const LMS_HOST = "lms.polite.edu.sg";
const HOME_URL = `https://${LMS_HOST}/d2l/home`;

async function captureCookiesFromBrowser(): Promise<SessionData> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });

  // Wait until the user has completed SSO and landed back on the LMS home page
  // with a valid session, indicated by the presence of the d2lSessionVal cookie.
  const deadline = Date.now() + 5 * 60 * 1000; // 5 minutes to complete login
  let cookies: StoredCookie[] = [];
  while (Date.now() < deadline) {
    const raw = await context.cookies(`https://${LMS_HOST}`);
    if (raw.some((c) => c.name === "d2lSessionVal")) {
      cookies = raw.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
      }));
      break;
    }
    await page.waitForTimeout(1000);
  }

  await browser.close();

  if (cookies.length === 0) {
    throw new Error("Login timed out after 5 minutes — no session cookie was captured.");
  }

  return { cookies, capturedAt: new Date().toISOString() };
}

export async function login(): Promise<SessionData> {
  const session = await captureCookiesFromBrowser();
  saveSession(session);
  return session;
}

async function isSessionValid(session: SessionData): Promise<boolean> {
  try {
    const res = await fetch(`https://${LMS_HOST}/d2l/api/lp/1.9/users/whoami`, {
      headers: { Cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
      redirect: "manual",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function ensureSession(): Promise<SessionData> {
  const existing = loadSession();
  if (existing && (await isSessionValid(existing))) {
    return existing;
  }
  return login();
}
