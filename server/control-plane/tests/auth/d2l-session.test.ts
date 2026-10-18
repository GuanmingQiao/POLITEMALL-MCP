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
const { getD2lAuth, invalidateD2lAuth, recoverD2lAuth, refreshD2lSession, configureD2lSession, RELOGIN_PAUSE_MS, MAX_RELOGIN_FAILURES } = await import("../../src/auth/d2l-session.js");
const { SessionExpiredError, TokenRenewalError } = await import("../../src/api/errors.js");

before(() => setMasterKey(randomBytes(32).toString("base64")));

let now = 1_000_000;
const HOUR = 3_600_000;
const session = (over: Partial<import("../../src/auth/session-vault.js").SchoolSession> = {}) => ({ cookieHeader: "d2lSessionVal=a; d2lSecureSessionVal=b", xsrfToken: "x", ...over });

type Mint = (o: { school: "nyp" | "politemall"; cookieHeader: string; xsrfToken: string }) => Promise<any>;
function wire(mint: Mint, silentRelogin: (u: string, s: any) => Promise<any> = async () => ({ ok: false, reason: "no_state" })) {
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
    async () => ({ ok: true, session: session({ cookieHeader: "new-cookies" }) })
  );
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer revived");
  assert.deepEqual(calls, { mint: 2, relogin: 1 });
  assert.equal(vault.getSchoolSession(user, "nyp")?.cookieHeader, "new-cookies", "the fresh session is what is stored");
});

test("with no Microsoft state to replay, the session is cleared at once and SessionExpiredError is raised", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "no_state" }));
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
});

test("a first failed silent re-login keeps the session, marked lapsed, and says it expired", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "old", accessTokenExpiresAt: now - 1 }));
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "microsoft_prompt" }));
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  const kept = vault.getSchoolSession(user, "nyp");
  assert.ok(kept, "the session is still there");
  assert.equal(kept!.lapsedAt, now);
  assert.equal(kept!.reloginFailures, 1);
  assert.equal(kept!.accessToken, undefined);
  assert.deepEqual(vault.connectedSchools(user), ["nyp"], "still listed, so the message is 'expired' not 'not connected'");
});

test("inside the pause after a failure nothing is tried; after it, one attempt is", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ lapsedAt: now, reloginFailures: 1 }));
  const calls = wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "timeout" }));
  now += RELOGIN_PAUSE_MS - 1;
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  assert.deepEqual(calls, { mint: 0, relogin: 0 }, "no request and no browser inside the pause");
  now += 2;
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  assert.deepEqual(calls, { mint: 1, relogin: 1 });
  assert.equal(vault.getSchoolSession(user, "nyp")?.reloginFailures, 2);
});

test("the third failed silent re-login in a row ends the session", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ lapsedAt: now - RELOGIN_PAUSE_MS - 1, reloginFailures: MAX_RELOGIN_FAILURES - 1 }));
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "error" }));
  await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  assert.equal(vault.getSchoolSession(user, "nyp"), null);
});

test("a success clears the lapsed mark and the failure count", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ lapsedAt: now - RELOGIN_PAUSE_MS - 1, reloginFailures: 2 }));
  wire(async () => ok("back"));
  assert.equal(await getD2lAuth(user, "nyp"), "Bearer back");
  const s = vault.getSchoolSession(user, "nyp")!;
  assert.equal(s.lapsedAt, undefined);
  assert.equal(s.reloginFailures, undefined);
});

test("no free browser slot is a temporary failure, not a failed attempt", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "no_slot" }));
  await assert.rejects(getD2lAuth(user, "nyp"), TokenRenewalError);
  const s = vault.getSchoolSession(user, "nyp")!;
  assert.equal(s.lapsedAt, undefined);
  assert.equal(s.reloginFailures, undefined);
});

test("every silent re-login is logged with its school, outcome and reason, and nothing else", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ cookieHeader: "d2lSessionVal=SECRETCOOKIE" }));
  wire(async () => ({ ok: false, reason: "sessionExpired" }), async () => ({ ok: false, reason: "microsoft_prompt" }));
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await assert.rejects(getD2lAuth(user, "nyp"), SessionExpiredError);
  } finally {
    console.log = realLog;
  }
  const event = lines.map((l) => JSON.parse(l)).find((e) => e.event === "silent_relogin");
  assert.ok(event);
  assert.equal(event.school, "nyp");
  assert.equal(event.ok, false);
  assert.equal(event.reason, "microsoft_prompt");
  assert.equal(typeof event.elapsedMs, "number");
  assert.ok(!lines.join(" ").includes("SECRETCOOKIE"));
});

test("replacement session cookies in a mint response are stored", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session());
  wire(async () => ({ ...ok("t"), cookieHeader: "d2lSessionVal=rotated; d2lSecureSessionVal=b" }));
  await getD2lAuth(user, "nyp");
  assert.equal(vault.getSchoolSession(user, "nyp")?.cookieHeader, "d2lSessionVal=rotated; d2lSecureSessionVal=b");
});

test("refreshing mints even when the cached token is fine, and shares an in-flight renewal", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "fine", accessTokenExpiresAt: now + HOUR }));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = wire(async () => {
    await gate;
    return ok("kept-alive");
  });
  const both = Promise.all([refreshD2lSession(user, "nyp"), getD2lAuth(user, "nyp")]);
  release();
  const [refreshed] = await both;
  assert.equal(refreshed?.accessToken, "kept-alive");
  assert.equal(calls.mint, 1, "a sweep and a tool call at once cause one mint");
  assert.equal(await refreshD2lSession(user, "politemall"), null, "no session, nothing to refresh");
});

test("recovering a rejected token mints a replacement and forgets the rejected one", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "bad", accessTokenExpiresAt: now + HOUR }));
  const calls = wire(async () => ok("good"));
  assert.equal(await recoverD2lAuth(user, "nyp", "Bearer bad"), "Bearer good");
  assert.equal(calls.mint, 1);
  assert.equal(vault.getSchoolSession(user, "nyp")?.accessToken, "good");
});

test("if another call already renewed, recovery reuses that token without a request", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "newer", accessTokenExpiresAt: now + HOUR }));
  const calls = wire(async () => ok("unused"));
  assert.equal(await recoverD2lAuth(user, "nyp", "Bearer older"), "Bearer newer");
  assert.equal(calls.mint, 0);
});

test("concurrent rejections share one recovery", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "bad", accessTokenExpiresAt: now + HOUR }));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = wire(async () => {
    await gate;
    return ok("good");
  });
  const all = Promise.all([recoverD2lAuth(user, "nyp", "Bearer bad"), recoverD2lAuth(user, "nyp", "Bearer bad"), recoverD2lAuth(user, "nyp", "Bearer bad")]);
  release();
  assert.deepEqual(await all, ["Bearer good", "Bearer good", "Bearer good"]);
  assert.equal(calls.mint, 1);
});

test("recovery gives up (null) when the mint returns the very token that was rejected", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "same", accessTokenExpiresAt: now + HOUR }));
  wire(async () => ok("same"));
  assert.equal(await recoverD2lAuth(user, "nyp", "Bearer same"), null);
});

test("recovery: a transient failure is TokenRenewalError with no browser, a dead session goes through silent re-login", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "bad", accessTokenExpiresAt: now + HOUR }));
  let calls = wire(async () => ({ ok: false, reason: "transient", detail: "HTTP 503" }));
  await assert.rejects(recoverD2lAuth(user, "nyp", "Bearer bad"), TokenRenewalError);
  assert.equal(calls.relogin, 0);
  assert.ok(vault.getSchoolSession(user, "nyp"), "the session survives a temporary failure");

  let n = 0;
  calls = wire(
    async () => (n++ === 0 ? { ok: false, reason: "sessionExpired" } : ok("revived")),
    async () => ({ ok: true, session: session({ cookieHeader: "fresh" }) })
  );
  assert.equal(await recoverD2lAuth(user, "nyp", "Bearer bad"), "Bearer revived");
  assert.deepEqual(calls, { mint: 2, relogin: 1 });
});

test("recovery events carry the school and outcome only", async () => {
  const user = await vault.createUser();
  await vault.saveSchoolSession(user, "nyp", session({ accessToken: "SECRETTOKEN", accessTokenExpiresAt: now + HOUR }));
  wire(async () => ok("NEWSECRET"));
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await recoverD2lAuth(user, "nyp", "Bearer SECRETTOKEN");
  } finally {
    console.log = realLog;
  }
  const joined = lines.join(" ");
  assert.match(joined, /token_recovered/);
  assert.ok(!joined.includes("SECRETTOKEN") && !joined.includes("NEWSECRET"));
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
