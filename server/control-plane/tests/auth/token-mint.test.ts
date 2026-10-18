import { test } from "node:test";
import assert from "node:assert/strict";
import { mintAccessToken } from "../../src/auth/token-mint.js";

// spec: streamed-login-session — "D2L access uses a renewable Bearer token obtained from the user's session"

const base = { school: "nyp" as const, cookieHeader: "d2lSessionVal=a; d2lSecureSessionVal=b", xsrfToken: "x" };
const NOW = 1_000_000;

function mint(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { calls, result: mintAccessToken({ ...base, fetchImpl, now: () => NOW }) };
}
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

test("a good session yields a token, and the request carries the cookies, XSRF header and scope", async () => {
  const { calls, result } = mint(new Response(JSON.stringify({ access_token: "tok", expires_in: 3000 }), { status: 200 }));
  assert.deepEqual(await result, { ok: true, accessToken: "tok", expiresAt: NOW + 3_000_000 });
  assert.equal(calls[0].url, "https://nyplms.polite.edu.sg/d2l/lp/auth/oauth2/token");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.cookie, base.cookieHeader);
  assert.equal(headers["x-csrf-token"], "x");
  assert.equal(calls[0].init.body, "scope=*:*:*");
  assert.equal(calls[0].init.redirect, "manual");
});

test("expiry falls back to the JWT exp claim, then to one hour", async () => {
  const withExp = await mint(new Response(JSON.stringify({ access_token: jwt(2000) }), { status: 200 })).result;
  assert.equal(withExp.ok && withExp.expiresAt, 2_000_000);
  const bare = await mint(new Response(JSON.stringify({ access_token: "opaque" }), { status: 200 })).result;
  assert.equal(bare.ok && bare.expiresAt, NOW + 3_600_000);
});

test("401, the login redirect and the expired-session stub all mean the session is dead", async () => {
  assert.deepEqual(await mint(new Response("", { status: 401 })).result, { ok: false, reason: "sessionExpired" });
  assert.deepEqual(
    await mint(new Response("", { status: 302, headers: { location: "/d2l/login?sessionExpired=1" } })).result,
    { ok: false, reason: "sessionExpired" }
  );
  assert.deepEqual(
    await mint(new Response("<script>location='/d2l/login?sessionExpired=1'</script>", { status: 200 })).result,
    { ok: false, reason: "sessionExpired" }
  );
});

test("a redirect to another host is not evidence of an expired session", async () => {
  const r = await mint(new Response("", { status: 302, headers: { location: "https://evil.example/d2l/login" } })).result;
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "transient");
});

test("5xx, 429, network errors, 403 and junk are transient, never session-expired", async () => {
  for (const res of [new Response("", { status: 500 }), new Response("", { status: 503 }), new Response("", { status: 429 }), new Response("", { status: 403 }), new Response("not json", { status: 200 }), new Response("{}", { status: 200 }), new Error("ECONNRESET")]) {
    const r = await mint(res).result;
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "transient", String(res));
  }
});

// spec: streamed-login-session - "Stored D2L sessions are kept alive in the background" (rotated cookies)
test("replacement session cookies in the response are returned merged into the cookie header", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "d2lSessionVal=NEWA; path=/; HttpOnly");
  headers.append("set-cookie", "somethingElse=zzz; path=/");
  const { result } = mint(new Response(JSON.stringify({ access_token: "tok", expires_in: 3000 }), { status: 200, headers }));
  const r = await result;
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.cookieHeader, "d2lSessionVal=NEWA; d2lSecureSessionVal=b");
});

test("no replacement cookies, or the same values, leave cookieHeader out", async () => {
  const same = new Headers();
  same.append("set-cookie", "d2lSessionVal=a; path=/");
  const r1 = await mint(new Response(JSON.stringify({ access_token: "t" }), { status: 200, headers: same })).result;
  const r2 = await mint(new Response(JSON.stringify({ access_token: "t" }), { status: 200 })).result;
  assert.ok(r1.ok && r2.ok);
  if (r1.ok && r2.ok) {
    assert.equal("cookieHeader" in r1, false);
    assert.equal("cookieHeader" in r2, false);
  }
});

test("rotated cookie values never appear in a failure result", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "d2lSessionVal=LEAKME; path=/");
  const r = await mint(new Response("oops", { status: 503, headers })).result;
  assert.ok(!JSON.stringify(r).includes("LEAKME"));
});
