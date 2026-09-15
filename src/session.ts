import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

export interface SessionData {
  cookies: StoredCookie[];
  capturedAt: string;
}

const SESSION_DIR = join(homedir(), ".politemall-mcp");
const SESSION_FILE = join(SESSION_DIR, "session.json");

export function loadSession(): SessionData | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as SessionData;
  } catch {
    return null;
  }
}

export function saveSession(data: SessionData): void {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function cookieHeader(session: SessionData): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
