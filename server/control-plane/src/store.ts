import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";

interface StoreRecord {
  encryptedCookieHeader: string;
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

export function saveUserCookieHeader(userId: string, cookieHeader: string): Promise<void> {
  writeChain = writeChain.then(() => {
    const store = readStore();
    store[userId] = {
      encryptedCookieHeader: encrypt(cookieHeader),
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  });
  return writeChain;
}

export function cookieHeaderFor(userId: string): string | null {
  const record = readStore()[userId];
  if (!record) return null;
  return decrypt(record.encryptedCookieHeader);
}
