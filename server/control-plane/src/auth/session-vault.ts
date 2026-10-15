import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../utils/config.js";
import { decrypt, encrypt } from "./crypto.js";
import type { School } from "../types/schools.js";

// One record per signed-in person. Everything sensitive is encrypted at rest with the master key:
// the Microsoft sign-in state of the streamed browser (what silent re-login replays) and, per
// school, the D2L session cookies, XSRF token and current Bearer token. A person is identified
// only by a random id; nothing here is ever written to a log.

// What the server needs to call D2L for one school and to mint a new Bearer token without a browser.
export interface SchoolSession {
  cookieHeader: string; // "d2lSessionVal=...; d2lSecureSessionVal=..."
  xsrfToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number; // epoch ms
}

interface UserRecord {
  createdAt: string;
  lastUsedAt: string;
  encryptedSchools: Partial<Record<School, string>>;
  encryptedBrowserState?: string;
  browserStateSavedAt?: string;
}

type VaultFile = Record<string, UserRecord>;

let writeChain: Promise<void> = Promise.resolve();

function readVault(): VaultFile {
  if (!existsSync(config.sessionFile)) return {};
  try {
    return JSON.parse(readFileSync(config.sessionFile, "utf-8"));
  } catch {
    return {};
  }
}

function writeVault(data: VaultFile): void {
  const dir = dirname(config.sessionFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(config.sessionFile, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function withWrite<T>(fn: (vault: VaultFile) => T): Promise<T> {
  const result = writeChain.then(() => {
    const vault = readVault();
    const value = fn(vault);
    writeVault(vault);
    return value;
  });
  writeChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function createUser(): Promise<string> {
  const userId = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  return withWrite((vault) => {
    vault[userId] = { createdAt: now, lastUsedAt: now, encryptedSchools: {} };
    return userId;
  });
}

export function userExists(userId: string): boolean {
  return readVault()[userId] !== undefined;
}

export function connectedSchools(userId: string): School[] {
  const record = readVault()[userId];
  return record ? (Object.keys(record.encryptedSchools) as School[]) : [];
}

export function getSchoolSession(userId: string, school: School): SchoolSession | null {
  const encrypted = readVault()[userId]?.encryptedSchools[school];
  if (!encrypted) return null;
  try {
    return JSON.parse(decrypt(encrypted)) as SchoolSession;
  } catch {
    return null;
  }
}

export function saveSchoolSession(userId: string, school: School, session: SchoolSession): Promise<boolean> {
  return withWrite((vault) => {
    const record = vault[userId];
    if (!record) return false;
    record.encryptedSchools[school] = encrypt(JSON.stringify(session));
    record.lastUsedAt = new Date().toISOString();
    return true;
  });
}

export function clearSchoolSession(userId: string, school: School): Promise<void> {
  return withWrite((vault) => {
    const record = vault[userId];
    if (record) delete record.encryptedSchools[school];
  });
}

// Microsoft's browser state is the most sensitive thing held, so it is only returned while within
// the retention window of its last successful use.
export function getBrowserState(userId: string, now = Date.now()): string | null {
  const record = readVault()[userId];
  if (!record?.encryptedBrowserState || !record.browserStateSavedAt) return null;
  const ageMs = now - new Date(record.browserStateSavedAt).getTime();
  if (ageMs > config.msStateRetentionDays * 24 * 60 * 60 * 1000) return null;
  try {
    return decrypt(record.encryptedBrowserState);
  } catch {
    return null;
  }
}

export function saveBrowserState(userId: string, stateJson: string): Promise<boolean> {
  return withWrite((vault) => {
    const record = vault[userId];
    if (!record) return false;
    record.encryptedBrowserState = encrypt(stateJson);
    record.browserStateSavedAt = new Date().toISOString();
    return true;
  });
}

// Sign-out: everything held for this person is deleted, not just marked unusable.
export function deleteUser(userId: string): Promise<boolean> {
  return withWrite((vault) => {
    const existed = vault[userId] !== undefined;
    delete vault[userId];
    return existed;
  });
}
