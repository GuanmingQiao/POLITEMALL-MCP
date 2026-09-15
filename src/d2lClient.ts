import { ensureSession, login } from "./auth.js";
import { cookieHeader, type SessionData } from "./session.js";

const LMS_HOST = "lms.polite.edu.sg";
const BASE_URL = `https://${LMS_HOST}`;

async function requestJson<T>(path: string, session: SessionData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Cookie: cookieHeader(session),
      Accept: "application/json",
    },
    redirect: "manual",
  });

  if (res.status === 200) {
    return (await res.json()) as T;
  }
  // 302/401 means the session expired or was rejected — surface a distinct error
  // so the caller can trigger a fresh login instead of retrying blindly.
  throw new SessionExpiredError(`Request to ${path} failed with status ${res.status}`);
}

export class SessionExpiredError extends Error {}

export async function apiGet<T>(path: string): Promise<T> {
  let session = await ensureSession();
  try {
    return await requestJson<T>(path, session);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      session = await login();
      return await requestJson<T>(path, session);
    }
    throw err;
  }
}
