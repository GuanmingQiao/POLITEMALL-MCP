import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// spec: hosted-master-key — the hosted server gets its key from Key Vault and fails closed.
const { config } = await import("../../src/utils/config.js");
const { loadMasterKey } = await import("../../src/auth/secrets.js");
const { encrypt, decrypt } = await import("../../src/auth/crypto.js");

const saved = { local: config.local, url: config.keyVaultUrl, name: config.keyVaultSecretName, env: process.env.MASTER_KEY_BASE64 };

beforeEach(() => {
  delete process.env.MASTER_KEY_BASE64;
  config.local = false;
  config.keyVaultUrl = "https://example-vault.vault.azure.net";
  config.keyVaultSecretName = "master-key";
});

afterEach(() => {
  config.local = saved.local;
  config.keyVaultUrl = saved.url;
  config.keyVaultSecretName = saved.name;
  if (saved.env === undefined) delete process.env.MASTER_KEY_BASE64;
  else process.env.MASTER_KEY_BASE64 = saved.env;
});

const goodKey = () => randomBytes(32).toString("base64");

test("loads a valid key from the vault and uses it to encrypt", async () => {
  const key = goodKey();
  let asked: [string, string] | undefined;
  await loadMasterKey(async (url, name) => ((asked = [url, name]), key));
  assert.deepEqual(asked, ["https://example-vault.vault.azure.net", "master-key"]);
  assert.equal(decrypt(encrypt("hello")), "hello");
});

test("MASTER_KEY_BASE64 wins and the vault is not contacted", async () => {
  process.env.MASTER_KEY_BASE64 = goodKey();
  await loadMasterKey(async () => assert.fail("vault must not be contacted"));
  assert.equal(decrypt(encrypt("x")), "x");
});

test("refuses to start when the vault URL is not configured", async () => {
  config.keyVaultUrl = "";
  await assert.rejects(loadMasterKey(async () => goodKey()), /AZURE_KEY_VAULT_URL/);
});

test("refuses an empty secret", async () => {
  await assert.rejects(loadMasterKey(async () => ""), /empty/);
  await assert.rejects(loadMasterKey(async () => undefined), /empty/);
});

test("refuses a malformed or wrong-length key without echoing it", async () => {
  const bad = ["not base64 at all!!", randomBytes(16).toString("base64"), randomBytes(33).toString("base64")];
  for (const value of bad) {
    await assert.rejects(loadMasterKey(async () => value), (err: Error) => {
      assert.match(err.message, /not base64 for exactly 32 bytes/);
      assert.ok(!err.message.includes(value), "error must not contain the secret value");
      return true;
    });
  }
});

test("access denied names the vault and secret but carries no key material", async () => {
  await assert.rejects(
    loadMasterKey(async () => {
      throw new Error("AuthorizationFailed: caller lacks Key Vault Secrets User");
    }),
    (err: Error) => {
      assert.match(err.message, /master-key/);
      assert.match(err.message, /example-vault\.vault\.azure\.net/);
      assert.match(err.message, /AuthorizationFailed/);
      return true;
    },
  );
});
