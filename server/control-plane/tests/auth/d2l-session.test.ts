import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// spec: streamed-login-session — "D2L access uses a renewable Bearer token", "Lapsed sessions are
// re-established silently where possible"
const dir = mkdtempSync(join(tmpdir(), "d2l-session-"));
process.env.SESSION_FILE = join(dir, "sessions.json");

const { setMasterKey } = await import("../../src/auth/crypto.js");
const vault = await import("../../src/auth/session-vault.js");
const { getD2lAuth, invalidateD2lAuth, configureD2lSession } = await import("../../src/auth/d2l-session.js");
const { SessionExpiredError, TokenRenewalError } = await import("../../src/api/errors.js");

before(() => setMasterKey(randomBytes(32).toString("base64")));

let now = 1_000_000;
const HOUR = 3_600_000;
const session = (over: Partial<import("../../src/auth/session-vault.js").SchoolSession> = {}) => ({ cookieHeader: "d2lSessionVal=a; d2lSecureSessionVal=b", xsrfToken: "x", ...over });

type Mint = (o: { school: "nyp" | "politemall"; cookieHeader: string; xsrfToken: string }) => Promise<any>;
function wire(mint: Mint, silentRelogin: (u: string, s: any) => Promise<any> = async () => null) {
  const calls = { mint: 0, relogin: 0 };
  configureD2lSession({
    now: () => now,
    mint: async (o) => {
      calls.mint++;
      return mint(o);
    },
    silentRelogin: async (u, s) => {
      calls.relogin++;
      return silentRelogin(u, s);
    },
  });
  return calls;
}
const ok = (token: string) => ({ ok: true, accessToken: token, expiresAt: now + HOUR });

test("an unexpired cached token is used without any request", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "cached", accessTokenExpiresAt: now + HOUR }));
  const calls = wire(async () => ok("new"));
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer cached");
  assert.equal(calls.mint, 0);
});

test("a school the person has not signed in to is simply not connected", async () => {
  const user = await vault.createUser();
  wire(async () => ok("new"));
  assert.equal(await getD2lAuth(user, "nyp"), null);
});

test("an expired token is renewed by one mint, no browser, and saved", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "old", accessTokenExpiresAt: now - 1 }));
  const calls = wire(async () => ok("fresh"));
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer fresh");
  assert.deepEqual(calls, { mint: 1, relogin: 0 });
  assert.equal(vault.getSchoolSession(user, "nyp")?.accessToken, "fresh");
});

test("a token inside the refresh buffer is renewed early", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "soon", accessTokenExpiresAt: now + 60_000 }));
  const calls = wire(async () => ok("fresh"));
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer fresh");
  assert.equal(calls.mint, 1);
});

test("concurrent calls share one renewal", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = wire(async () => {
    await gate;
    return ok("shared");
  });
  const all = Promise.all([getD2lAuth(user, "nyp"), getD2lAuth(user, "nyp"), getD2lAuth(user, "nyp")]);
  release();
  assert.deepEqual(await all, ["Bearer shared", "Bearer shared", "Bearer shared"]);
  assert.equal(calls.mint, 1);
});

test("a dead D2L session triggers a silent re-login, then a second mint", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ cookieHeader: "old-cookies" }));
  let n = 0;
  const calls = wire(
    async (o) => (n++ === 0 ? { ok: false, reason: "sessionExpired" } : o.cookieHeader === "new-cookies" ? ok("revived") : { ok: false, reason: "sessionExpired" }),
    async () => session({ cookieHeader: "new-cookies" })
  );
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer revived");
  assert.deepEqual(calls, { mint: 2, relogin: 1 });
  assert.equal(vault.getSchoolSession(user, "nyp")?.cookieHeader, "new-cookies", "the fresh session is what is stored");
});

test("when silent re-login cannot help, the session is cleared and SessionExpiredError is raised", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => null);
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
});

test("a transient mint failure is TokenRenewalError, keeps the session, and never launches a browser", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  const calls = wire(async () => ({ ok: false, reason: "transient", detail: "HTTP 503" }));
  await assert.rejects(getD2lAuth(user, "nyp"), (e: Error) => e instanceof TokenRenewalError && /503/.test(e.message));
  assert.equal(calls.relogin, 0);
  assert.ok(vault.getSchoolSession(user, "nyp"), "a temporary failure must not sign the person out");
});

test("invalidating forgets the cached token so the next call renews", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "rejected", accessTokenExpiresAt: now + HOUR }));
  const calls = wire(async () => ok("replacement"));
  await invalidateD2lAuth(user, "nyp");
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer replacement");
  assert.equal(calls.mint, 1);
});
