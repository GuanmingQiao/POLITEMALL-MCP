import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../utils/config.js";
import { decrypt, encrypt } from "./crypto.js";
import type { School } from "../types/schools.js";
import { parseBrowserState, persistentExpiry } from "./microsoft-state.js";

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
  // Set when the D2L session died and a silent re-login could not revive it. The session is kept
  // (so the person is told "expired", not "not connected") but not retried for a while.
  lapsedAt?: number; // epoch ms
  reloginFailures?: number; // consecutive failed silent re-logins
}

interface UserRecord {
  createdAt: string;
  lastUsedAt: string;
  encryptedSchools: Partial<Record<School, string>>;
  encryptedBrowserState?: string;
  browserStateSavedAt?: string; // last time the state was saved or successfully replayed
  // Microsoft's persistent sign-in cookie expiry (epoch seconds), when the saved state has one.
  msPersistentExpiresAt?: number;
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

// Creates the record for a fixed, known id (the one local user) if it is not there yet.
export function ensureUser(userId: string): Promise<void> {
  const now = new Date().toISOString();
  return withWrite((vault) => {
    if (!vault[userId]) vault[userId] = { createdAt: now, lastUsedAt: now, encryptedSchools: {} };
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

// Whether saved Microsoft state can be replayed: it exists, is inside the retention window of its
// last successful use, and (when Microsoft's persistent cookie expiry is known) that has not passed.
export type BrowserStateStatus = "ok" | "absent" | "expired";

export function browserStateStatus(userId: string, now = Date.now()): BrowserStateStatus {
  const record = readVault()[userId];
  if (!record?.encryptedBrowserState || !record.browserStateSavedAt) return "absent";
  const ageMs = now - new Date(record.browserStateSavedAt).getTime();
  if (ageMs > config.msStateRetentionDays * 24 * 60 * 60 * 1000) return "expired";
  if (record.msPersistentExpiresAt !== undefined && record.msPersistentExpiresAt * 1000 <= now) return "expired";
  return "ok";
}

// Microsoft's browser state is the most sensitive thing held, so it is only returned while it can
// still be replayed.
export function getBrowserState(userId: string, now = Date.now()): string | null {
  if (browserStateStatus(userId, now) !== "ok") return null;
  const record = readVault()[userId];
  try {
    return decrypt(record!.encryptedBrowserState!);
  } catch {
    return null;
  }
}

export function saveBrowserState(userId: string, stateJson: string): Promise<boolean> {
  const expiry = persistentExpiry(parseBrowserState(stateJson));
  return withWrite((vault) => {
    const record = vault[userId];
    if (!record) return false;
    record.encryptedBrowserState = encrypt(stateJson);
    record.browserStateSavedAt = new Date().toISOString();
    if (expiry !== undefined) record.msPersistentExpiresAt = expiry;
    else delete record.msPersistentExpiresAt;
    return true;
  });
}

// A silent re-login worked but produced nothing newer to keep: the saved state stays as it is and
// only its last-used time moves.
export function touchBrowserState(userId: string): Promise<boolean> {
  return withWrite((vault) => {
    const record = vault[userId];
    if (!record?.encryptedBrowserState) return false;
    record.browserStateSavedAt = new Date().toISOString();
    return true;
  });
}

// Every (person, school) with a stored session, for the periodic keep-alive.
export function listSessionTargets(): { userId: string; school: School }[] {
  const targets: { userId: string; school: School }[] = [];
  for (const [userId, record] of Object.entries(readVault())) {
    for (const school of Object.keys(record.encryptedSchools) as School[]) targets.push({ userId, school });
  }
  return targets;
}

// Sign-out: everything held for this person is deleted, not just marked unusable.
export function deleteUser(userId: string): Promise<boolean> {
  return withWrite((vault) => {
    const existed = vault[userId] !== undefined;
    delete vault[userId];
    return existed;
  });
}
