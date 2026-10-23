import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

// The AES master key for a local run. It lives in the operating system's credential store (macOS
// Keychain, Windows Credential Manager, Linux Secret Service) when one works, and otherwise in an
// owner-only file beside the data. A key is created only when there is no encrypted data to lose:
// if sessions exist but no key can be found, starting would silently orphan them, so it refuses.

export const KEYRING_SERVICE = "politemall-mcp";
// One entry per data directory, so two stores on one computer (for example a custom
// POLITEMALL_DATA_DIR) never share or delete each other's key.
export const keyringAccount = (dataDir: string) => `master-key-${createHash("sha256").update(dataDir).digest("hex").slice(0, 12)}`;

export interface Keyring {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

export type KeyLocation = "keyring" | "file";

export class KeyMissingError extends Error {
  constructor(sessionsFile: string) {
    super(
      `Stored sign-in data exists at ${sessionsFile} but its encryption key cannot be found in the OS credential store or the key file. ` +
        "It cannot be read. Run `politemall-mcp auth --logout` to remove it (you will have to sign in again)."
    );
    this.name = "KeyMissingError";
  }
}

// The OS credential store through an optional native module; null when it cannot be loaded or used,
// or when POLITEMALL_KEYRING=off (tests and CI use the key file instead).
export async function loadOsKeyring(dataDir: string): Promise<Keyring | null> {
  if (process.env.POLITEMALL_KEYRING === "off") return null;
  try {
    const spec: string = "@napi-rs/keyring";
    const mod = (await import(spec)) as { Entry: new (service: string, account: string) => { getPassword(): string | null; setPassword(v: string): void; deletePassword(): boolean } };
    const entry = new mod.Entry(KEYRING_SERVICE, keyringAccount(dataDir));
    entry.getPassword(); // proves the store is reachable (a missing item is null, not an error)
    return {
      get: () => entry.getPassword() ?? null,
      set: (v) => entry.setPassword(v),
      remove: () => void entry.deletePassword(),
    };
  } catch {
    return null;
  }
}

export interface KeyStoreOptions {
  dataDir: string;
  sessionsFile: string;
  keyring: Keyring | null;
}

export const keyFilePath = (dataDir: string) => join(dataDir, "master.key");

export function loadOrCreateKey(o: KeyStoreOptions): { key: string; location: KeyLocation } {
  const keyFile = keyFilePath(o.dataDir);
  let fromRing: string | null = null;
  try {
    fromRing = o.keyring?.get() ?? null;
  } catch {
    fromRing = null;
  }
  if (fromRing) return { key: fromRing, location: "keyring" };
  if (existsSync(keyFile)) return { key: readFileSync(keyFile, "utf-8").trim(), location: "file" };
  if (existsSync(o.sessionsFile)) throw new KeyMissingError(o.sessionsFile);

  const key = randomBytes(32).toString("base64");
  if (o.keyring) {
    try {
      o.keyring.set(key);
      if (o.keyring.get() === key) return { key, location: "keyring" };
    } catch {
      // fall through to the key file
    }
  }
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, key, { mode: 0o600 });
  return { key, location: "file" };
}

// Sign-out removes the key too, so a later sign-in starts clean.
export function removeKey(o: KeyStoreOptions): void {
  try {
    o.keyring?.remove();
  } catch {
    // nothing to remove
  }
  try {
    if (existsSync(keyFilePath(o.dataDir))) unlinkSync(keyFilePath(o.dataDir));
  } catch {
    // best effort
  }
}
