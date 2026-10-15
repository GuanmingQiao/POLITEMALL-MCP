import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// spec: streamed-login-session — "Stored sign-in material is protected and removable"
const dir = mkdtempSync(join(tmpdir(), "vault-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
process.env.MS_STATE_RETENTION_DAYS = "30";

const { setMasterKey } = await import("../../src/auth/crypto.js");
const vault = await import("../../src/auth/session-vault.js");

before(() => setMasterKey(randomBytes(32).toString("base64")));

const SESSION = { cookieHeader: "d2lSessionVal=AAA; d2lSecureSessionVal=BBB", xsrfToken: "xsrf-secret", accessToken: "token-secret", accessTokenExpiresAt: 123 };

test("a school session round-trips and is encrypted at rest", async () => {
  const user = await vault.createUser();
  assert.equal(await vault.saveSchoolSession(user, "nyp", SESSION), true);
  assert.deepEqual(vault.getSchoolSession(user, "nyp"), SESSION);
  assert.deepEqual(vault.connectedSchools(user), ["nyp"]);
  assert.equal(vault.getSchoolSession(user, "politemall"), null);

  const onDisk = readFileSync(process.env.SESSION_FILE!, "utf-8");
  for (const secret of ["AAA", "BBB", "xsrf-secret", "token-secret"]) assert.ok(!onDisk.includes(secret), `${secret} must not appear in plaintext`);
});

test("saving for an unknown user is refused", async () => {
  assert.equal(await vault.saveSchoolSession("nobody", "nyp", SESSION), false);
  assert.equal(await vault.saveBrowserState("nobody", "{}"), false);
});

test("a corrupt vault file reads as empty rather than throwing", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", SESSION);
  const good = readFileSync(process.env.SESSION_FILE!, "utf-8");
  writeFileSync(process.env.SESSION_FILE!, "{ not json");
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
  assert.deepEqual(vault.connectedSchools(user), []);
  writeFileSync(process.env.SESSION_FILE!, good);
});

test("a tampered ciphertext is treated as no session", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", SESSION);
  const file = JSON.parse(readFileSync(process.env.SESSION_FILE!, "utf-8"));
  const sealed: string = file[user].encryptedSchools.nyp;
  file[user].encryptedSchools.nyp = sealed.slice(0, -4) + "AAAA";
  writeFileSync(process.env.SESSION_FILE!, JSON.stringify(file));
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
});

test("Microsoft browser state is kept only within the retention window", async () => {
  const user = await vault.createUser();
  const state = JSON.stringify({ cookies: [{ name: "ESTSAUTHPERSISTENT", value: "ms-secret" }] });
  await vault.saveBrowserState(user, state);
  assert.equal(vault.getBrowserState(user), state);
  assert.ok(!readFileSync(process.env.SESSION_FILE!, "utf-8").includes("ms-secret"));
  const day = 24 * 60 * 60 * 1000;
  assert.equal(vault.getBrowserState(user, Date.now() + 29 * day), state);
  assert.equal(vault.getBrowserState(user, Date.now() + 31 * day), null, "expired state is not returned");
});

test("deleting a user removes everything held for them", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", SESSION);
  await vault.saveBrowserState(user, "{}");
  assert.equal(await vault.deleteUser(user), true);
  assert.equal(vault.userExists(user), false);
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
  assert.equal(vault.getBrowserState(user), null);
  assert.equal(await vault.deleteUser(user), false);
  assert.ok(!(user in JSON.parse(readFileSync(process.env.SESSION_FILE!, "utf-8"))));
});
