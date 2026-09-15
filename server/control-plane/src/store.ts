import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

interface StoreRecord {
  encryptedCookies: string;
  updatedAt: string;
}

type StoreFile = Record<string, StoreRecord>;

let writeChain: Promise<void> = Promise.resolve();

function readStore(): StoreFile {
  if (!existsSync(config.storeFile)) return {};
  try {
    return JSON.parse(readFileSync(config.storeFile, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data: StoreFile): void {
  const dir = dirname(config.storeFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(config.storeFile, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function saveUserCookies(userId: string, cookies: StoredCookie[]): Promise<void> {
  writeChain = writeChain.then(() => {
    const store = readStore();
    store[userId] = {
      encryptedCookies: encrypt(JSON.stringify(cookies)),
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  });
  return writeChain;
}

export function getUserCookies(userId: string): StoredCookie[] | null {
  const store = readStore();
  const record = store[userId];
  if (!record) return null;
  return JSON.parse(decrypt(record.encryptedCookies));
}

export function cookieHeaderFor(userId: string): string | null {
  const cookies = getUserCookies(userId);
  if (!cookies) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
