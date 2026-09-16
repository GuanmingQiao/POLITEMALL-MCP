import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import type { School } from "./d2l.js";

interface TokenRecord {
  createdAt: string;
  expiresAt: string;
  encryptedCookies: Partial<Record<School, string>>;
}

type TokenStoreFile = Record<string, TokenRecord>;

const TOKEN_VALID_DAYS = 90;

let writeChain: Promise<void> = Promise.resolve();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Short, non-reversible identifier safe to put in logs — never the token or its full hash.
export function tokenLogId(token: string): string {
  return hashToken(token).slice(0, 8);
}

function readStore(): TokenStoreFile {
  if (!existsSync(config.storeFile)) return {};
  try {
    return JSON.parse(readFileSync(config.storeFile, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data: TokenStoreFile): void {
  const dir = dirname(config.storeFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(config.storeFile, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function withWrite<T>(fn: (store: TokenStoreFile) => T): Promise<T> {
  const result = writeChain.then(() => {
    const store = readStore();
    const value = fn(store);
    writeStore(store);
    return value;
  });
  writeChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// No identity is ever attached to a token — it's purely a random key into a set of
// encrypted per-school cookie blobs. Losing it means generating a new one and
// reconnecting.
export function issueToken(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000);
  return withWrite((store) => {
    store[hashToken(token)] = {
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      encryptedCookies: {},
    };
    return token;
  });
}

function validRecord(token: string): TokenRecord | undefined {
  const record = readStore()[hashToken(token)];
  if (!record) return undefined;
  if (new Date(record.expiresAt).getTime() < Date.now()) return undefined;
  return record;
}

export function isValidToken(token: string): boolean {
  return validRecord(token) !== undefined;
}

export async function saveCookieHeader(token: string, school: School, cookieHeader: string): Promise<boolean> {
  return withWrite((store) => {
    const record = store[hashToken(token)];
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) return false;
    record.encryptedCookies[school] = encrypt(cookieHeader);
    return true;
  });
}

export function getCookieHeader(token: string, school: School): string | null {
  const record = validRecord(token);
  const encrypted = record?.encryptedCookies[school];
  if (!encrypted) return null;
  return decrypt(encrypted);
}

export function connectedSchools(token: string): School[] {
  const record = validRecord(token);
  if (!record) return [];
  return Object.keys(record.encryptedCookies) as School[];
}
