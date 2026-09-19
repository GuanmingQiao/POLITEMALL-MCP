import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// LOCAL_MODE must give a working master key with no AWS and no env key: created on first start,
// reused on the next, so sessions stored earlier can still be decrypted.
const dir = mkdtempSync(join(tmpdir(), "local-mode-"));
process.env.LOCAL_MODE = "1";
process.env.STORE_FILE = join(dir, "tokens.json");
delete process.env.MASTER_KEY_BASE64;

const { loadMasterKey } = await import("../../src/auth/secrets.js");
const { encrypt, decrypt } = await import("../../src/auth/crypto.js");
const { config } = await import("../../src/utils/config.js");

test("local mode defaults: localhost origin, no AWS", () => {
  assert.equal(config.local, true);
  assert.match(config.publicOrigin, /^http:\/\/localhost:\d+$/);
});

test("local mode creates a key file once and reuses it", async () => {
  await loadMasterKey();
  const keyFile = join(dir, "master.key");
  assert.ok(existsSync(keyFile), "key file created next to the token store");
  const first = readFileSync(keyFile, "utf-8");
  const sealed = encrypt("d2lSessionVal=secret");

  await loadMasterKey(); // "restart"
  assert.equal(readFileSync(keyFile, "utf-8"), first, "key not regenerated");
  assert.equal(decrypt(sealed), "d2lSessionVal=secret", "earlier ciphertext still decrypts");
  if (process.platform !== "win32") assert.equal(statSync(keyFile).mode & 0o077, 0, "owner-only");
});
