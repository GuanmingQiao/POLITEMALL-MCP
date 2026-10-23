import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDataDir } from "../../src/local/paths.js";
import { KeyMissingError, loadOrCreateKey, removeKey, type Keyring } from "../../src/local/key-store.js";

// spec: local-npx-server — credentials are stored encrypted on the user's machine only.

test("data directory: per-platform defaults and the override", () => {
  assert.equal(localDataDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a"), join("C:\\Users\\a\\AppData\\Roaming", "politemall-mcp"));
  assert.equal(localDataDir({}, "darwin", "/Users/a"), join("/Users/a", "Library", "Application Support", "politemall-mcp"));
  assert.equal(localDataDir({}, "linux", "/home/a"), join("/home/a", ".local", "share", "politemall-mcp"));
  assert.equal(localDataDir({ XDG_DATA_HOME: "/x" }, "linux", "/home/a"), join("/x", "politemall-mcp"));
  assert.equal(localDataDir({ POLITEMALL_DATA_DIR: "/custom" }, "linux", "/home/a"), "/custom");
});

function memoryRing(): Keyring & { value: string | null } {
  const ring = { value: null as string | null, get: () => ring.value, set: (v: string) => void (ring.value = v), remove: () => void (ring.value = null) };
  return ring;
}
const broken: Keyring = {
  get: () => {
    throw new Error("no store");
  },
  set: () => {
    throw new Error("no store");
  },
  remove: () => undefined,
};
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-"));
  return { dataDir: dir, sessionsFile: join(dir, "sessions.json") };
};

test("first run puts the key in the OS credential store and writes no file", () => {
  const o = { ...fresh(), keyring: memoryRing() };
  const first = loadOrCreateKey(o);
  assert.equal(first.location, "keyring");
  assert.ok(!existsSync(join(o.dataDir, "master.key")));
  assert.equal(loadOrCreateKey(o).key, first.key, "restart reuses the same key");
});

test("no credential store: falls back to an owner-only key file, reused on restart", () => {
  const o = { ...fresh(), keyring: null };
  const first = loadOrCreateKey(o);
  assert.equal(first.location, "file");
  assert.equal(loadOrCreateKey(o).key, first.key);
  if (process.platform !== "win32") assert.equal(statSync(join(o.dataDir, "master.key")).mode & 0o077, 0);
  const viaBroken = loadOrCreateKey({ ...fresh(), keyring: broken });
  assert.equal(viaBroken.location, "file", "a credential store that throws also falls back");
});

test("stored data without a key is refused, never silently re-keyed", () => {
  const o = { ...fresh(), keyring: memoryRing() };
  writeFileSync(o.sessionsFile, "{}");
  assert.throws(() => loadOrCreateKey(o), KeyMissingError);
  assert.equal(o.keyring.value, null, "no key was created");
});

test("removeKey clears both places", () => {
  const o = { ...fresh(), keyring: memoryRing() };
  const f = { ...fresh(), keyring: null };
  loadOrCreateKey(o);
  loadOrCreateKey(f);
  removeKey(o);
  removeKey(f);
  assert.equal(o.keyring.value, null);
  assert.ok(!existsSync(join(f.dataDir, "master.key")));
});
