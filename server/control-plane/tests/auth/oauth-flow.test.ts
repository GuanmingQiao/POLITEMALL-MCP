import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

// spec: streamed-login-session — "MCP clients connect by URL through the MCP authorization flow",
// "Legacy cookie upload is removed", sign-out.
const dir = mkdtempSync(join(tmpdir(), "oauth-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
process.env.OAUTH_FILE = join(dir, "oauth.json");
process.env.STORE_FILE = join(dir, "tokens.json");

const { setMasterKey } = await import("../../src/auth/crypto.js");
const { config } = await import("../../src/utils/config.js");
const vault = await import("../../src/auth/session-vault.js");
const registry = await import("../../src/auth/signin-registry.js");
const { buildApp } = await import("../../src/app.js");

let server: Server;
let base = "";
const REDIRECT = "http://127.0.0.1:9999/callback";

before(async () => {
  setMasterKey(randomBytes(32).toString("base64"));
  // The origin is fixed when the app is built, so pick the port first.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  base = `http://127.0.0.1:${port}`;
  config.publicOrigin = base;
  server = createServer(buildApp());
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
});
after(() => new Promise((r) => server.close(r)));

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

async function register(): Promise<string> {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], client_name: "test" }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).client_id;
}

// Runs /authorize and plays the part of a finished streamed sign-in, returning the redirect the
// client would be sent to (and the person who signed in).
async function authorize(clientId: string, challenge: string, state = "st-1") {
  const url = `${base}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 302);
  const location = res.headers.get("location")!;
  const id = new URL(location).pathname.split("/").pop()!;
  assert.match(location, /\/signin\/[A-Za-z0-9_-]{16,}$/, "authorize sends the person to the streamed sign-in");
  const signin = registry.getSignin(id)!;
  const userId = await vault.createUser();
  const redirect = new URL((await signin.onSuccess!(userId))!);
  return { userId, redirect };
}

async function exchange(clientId: string, code: string, verifier: string) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT }),
  });
}

const rpc = (token: string | undefined, body: unknown) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

test("an unauthenticated client gets 401 with discovery metadata, and no D2L data", async () => {
  const res = await rpc(undefined, INIT);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata=".*oauth-protected-resource/);
  const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) assert.ok(meta[k], k);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(resource.resource, `${base}/mcp`);
});

test("a full PKCE flow ends in a token that works on /mcp, and refresh rotates it", async () => {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const { redirect, userId } = await authorize(clientId, challenge);
  assert.equal(redirect.origin + redirect.pathname, REDIRECT);
  assert.equal(redirect.searchParams.get("state"), "st-1");

  const tokenRes = await exchange(clientId, redirect.searchParams.get("code")!, verifier);
  assert.equal(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assert.ok(tokens.access_token && tokens.refresh_token);

  const init = await rpc(tokens.access_token, INIT);
  assert.equal(init.status, 200);
  const list = await rpc(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.match(await list.text(), /get_content_topic/);

  const refreshed = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token }),
  });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  const replay = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token }),
  });
  assert.equal(replay.status, 400, "a spent refresh token is refused");
  assert.equal((await rpc(next.access_token, INIT)).status, 200);
  assert.ok(vault.userExists(userId));
});

test("a wrong code verifier is rejected, and the code is spent either way", async () => {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const { redirect } = await authorize(clientId, challenge);
  const code = redirect.searchParams.get("code")!;
  assert.equal((await exchange(clientId, code, pkce().verifier)).status, 400);
  assert.equal((await exchange(clientId, code, verifier)).status, 400, "the code cannot be retried after a failed attempt");
});

test("a replayed authorization code is rejected", async () => {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const { redirect } = await authorize(clientId, challenge);
  const code = redirect.searchParams.get("code")!;
  assert.equal((await exchange(clientId, code, verifier)).status, 200);
  assert.equal((await exchange(clientId, code, verifier)).status, 400);
});

test("a redirect URI that was not registered is refused, with no redirect to it", async () => {
  const clientId = await register();
  const { challenge } = pkce();
  const res = await fetch(`${base}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("http://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`, { redirect: "manual" });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("location"), null);
});

test("authorization without PKCE is refused", async () => {
  const clientId = await register();
  const res = await fetch(`${base}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`, { redirect: "manual" });
  assert.ok(res.status === 400 || (res.status === 302 && /error=/.test(res.headers.get("location") ?? "")));
});

test("another client cannot redeem a code issued to a different client", async () => {
  const a = await register();
  const b = await register();
  const { verifier, challenge } = pkce();
  const { redirect } = await authorize(a, challenge);
  assert.equal((await exchange(b, redirect.searchParams.get("code")!, verifier)).status, 400);
});

test("sign-out deletes the person's stored state and their tokens stop working", async () => {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const { redirect, userId } = await authorize(clientId, challenge);
  const tokens = await (await exchange(clientId, redirect.searchParams.get("code")!, verifier)).json();
  await vault.saveSchoolSession(userId, "nyp", { cookieHeader: "c", xsrfToken: "x" });
  await vault.saveBrowserState(userId, "{}");

  const out = await fetch(`${base}/signout`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(out.status, 200);
  assert.equal(vault.userExists(userId), false);
  assert.equal(vault.getSchoolSession(userId, "nyp"), null);
  assert.equal(vault.getBrowserState(userId), null);
  assert.equal((await rpc(tokens.access_token, INIT)).status, 401);
  const refresh = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token }),
  });
  assert.equal(refresh.status, 400);
});

test("the old cookie signup, sync and connect endpoints are gone", async () => {
  for (const [method, path] of [["POST", "/signup"], ["POST", "/sync"], ["GET", "/connect"]] as const) {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: "Bearer anything" }, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});

test("an access token that was never issued is refused", async () => {
  assert.equal((await rpc("0".repeat(64), INIT)).status, 401);
});
