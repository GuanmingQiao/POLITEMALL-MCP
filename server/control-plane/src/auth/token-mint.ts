import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import type { D2LSchool } from "../types/schools.js";

// Exchanges a signed-in D2L session (its two session cookies plus the page's XSRF token) for a
// Bearer access token at D2L's own OAuth token endpoint. This is the cheap renewal: one HTTPS
// request, no browser. Behaviour was observed from the public brightspace-mcp-server (MIT); the
// code here is our own.
//
// Classification matters more than the happy path. Only evidence that the *session* is dead
// (401, the login redirect, the expired-session stub) says "sign in again"; a network failure,
// 5xx or 429 is transient, and anything unrecognised is also transient so a changed endpoint can
// never be mistaken for an expired user session (which would trigger needless browser logins).

// An expired session answers 200 with a script that redirects here, not a 401.
const EXPIRED_MARKER = "/d2l/login?sessionExpired=1";
const DEFAULT_LIFETIME_S = 3600;
const TIMEOUT_MS = 15_000;

export type MintResult =
  | { ok: true; accessToken: string; expiresAt: number }
  | { ok: false; reason: "sessionExpired" | "transient"; detail?: string };

export interface MintOptions {
  school: D2LSchool;
  cookieHeader: string;
  xsrfToken: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function expiryOf(accessToken: string, expiresIn: unknown, now: number): number {
  if (typeof expiresIn === "number" && expiresIn > 0) return now + expiresIn * 1000;
  const parts = accessToken.split(".");
  if (parts.length === 3) {
    try {
      const exp = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")).exp;
      if (typeof exp === "number") return exp * 1000;
    } catch {
      // Not a JWT we can read; fall through to the default lifetime.
    }
  }
  return now + DEFAULT_LIFETIME_S * 1000;
}

function isLoginRedirect(location: string | null, origin: string): boolean {
  if (!location) return false;
  try {
    const target = new URL(location, origin);
    return target.origin === origin && target.pathname === "/d2l/login";
  } catch {
    return false;
  }
}

export async function mintAccessToken({ school, cookieHeader, xsrfToken, fetchImpl = fetch, now = Date.now }: MintOptions): Promise<MintResult> {
  const origin = `https://${SCHOOL_HOSTS[school]}`;
  let status: number;
  let body: string;
  let location: string | null;
  try {
    const res = await fetchImpl(`${origin}/d2l/lp/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader, "x-csrf-token": xsrfToken },
      body: "scope=*:*:*",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    body = await res.text();
    location = res.headers.get("location");
  } catch (err) {
    return { ok: false, reason: "transient", detail: err instanceof Error ? err.message : String(err) };
  }

  if (status >= 500 || status === 429) return { ok: false, reason: "transient", detail: `HTTP ${status}` };

  let payload: { access_token?: unknown; expires_in?: unknown } | null = null;
  try {
    payload = JSON.parse(body);
  } catch {
    // The known expired-session answer is an HTML/script stub, not JSON.
  }

  if (status === 401 || isLoginRedirect(location, origin) || (!payload && body.includes(EXPIRED_MARKER))) {
    return { ok: false, reason: "sessionExpired" };
  }
  if (status < 200 || status >= 300) return { ok: false, reason: "transient", detail: `HTTP ${status}` };
  if (!payload || typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    return { ok: false, reason: "transient", detail: "the token endpoint returned no access_token" };
  }
  return { ok: true, accessToken: payload.access_token, expiresAt: expiryOf(payload.access_token, payload.expires_in, now()) };
}
