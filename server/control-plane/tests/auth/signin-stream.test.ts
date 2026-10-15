import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";

// spec: streamed-login-session — streamed sign-in, isolation/caps/timeouts, completion, silent re-login.
// A real Chromium is driven against local stand-ins for the school sites (a login form on
// 127.0.0.1 for POLITEMall; "already signed in via Microsoft" on localhost for NYP). The test
// plays the viewer: it sends pointer and key events over the WebSocket exactly as the page does.
// Skipped when no Chromium is installed (set CHROMIUM_PATH to point at one).

const dir = mkdtempSync(join(tmpdir(), "signin-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
process.env.OAUTH_FILE = join(dir, "oauth.json");
process.env.STORE_FILE = join(dir, "tokens.json");

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p && existsSync(p));
if (CANDIDATES[0]) process.env.CHROMIUM_PATH = CANDIDATES[0];
const HAVE_BROWSER = CANDIDATES.length > 0;

const { setMasterKey } = await import("../../src/auth/crypto.js");
const { config } = await import("../../src/utils/config.js");
const vault = await import("../../src/auth/session-vault.js");
const registry = await import("../../src/auth/signin-registry.js");
const browser = await import("../../src/auth/signin-browser.js");
const { buildApp } = await import("../../src/app.js");
const { attachSigninSockets } = await import("../../src/auth/signin-stream.js");
const { configureD2lSession } = await import("../../src/auth/d2l-session.js");

const PASSWORD = "Sup3r-Secret-Pw!";
let received: string[] = [];
let stubServer: Server;
let appServer: Server;
let stubPort = 0;
let appPort = 0;

const HOME = `<!doctype html><title>Home</title><h1>Home</h1><script>window.D2L={LP:{Web:{Authentication:{Xsrf:{GetXsrfToken:function(){return "xsrf-123"}}}}}}</script>`;
const LOGIN = `<!doctype html><title>Sign in</title><body style="margin:0"><form method="POST" action="/login"><input id="pw" name="pw" type="password" style="position:absolute;left:100px;top:100px;width:300px;height:40px"></form></body>`;

before(async () => {
  setMasterKey(randomBytes(32).toString("base64"));
  stubServer = createServer((req, res) => {
    const host = (req.headers.host ?? "").split(":")[0];
    const cookies = req.headers.cookie ?? "";
    if (req.url === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(decodeURIComponent(body.replace(/^pw=/, "")));
        res.writeHead(302, { "Set-Cookie": ["d2lSessionVal=S1; Path=/", "d2lSecureSessionVal=S2; Path=/"], Location: "/d2l/home" }).end();
      });
      return;
    }
    if (req.url === "/login") return void res.writeHead(200, { "content-type": "text/html" }).end(LOGIN);
    if (req.url?.startsWith("/d2l/home")) {
      if (host === "localhost") {
        // NYP: the Microsoft session already exists, so D2L signs the person straight in.
        return void res.writeHead(200, { "content-type": "text/html", "Set-Cookie": ["d2lSessionVal=N1; Path=/", "d2lSecureSessionVal=N2; Path=/"] }).end(HOME);
      }
      if (cookies.includes("d2lSessionVal=S1")) return void res.writeHead(200, { "content-type": "text/html" }).end(HOME);
      return void res.writeHead(302, { Location: "/login" }).end();
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => stubServer.listen(0, "127.0.0.1", r));
  stubPort = (stubServer.address() as AddressInfo).port;
  // localhost may resolve to ::1; listen there too so both host names reach the same stand-in.
  browser.origins.politemall = `http://127.0.0.1:${stubPort}`;
  browser.origins.nyp = `http://localhost:${stubPort}`;

  appServer = createServer(buildApp());
  attachSigninSockets(appServer);
  await new Promise<void>((r) => appServer.listen(0, "127.0.0.1", r));
  appPort = (appServer.address() as AddressInfo).port;
  config.publicOrigin = `http://127.0.0.1:${appPort}`;
  config.signinTimeoutMs = 60_000;
  configureD2lSession({ mint: async () => ({ ok: true, accessToken: "minted", expiresAt: Date.now() + 3_600_000 }) });
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => stubServer.close(r));
});

const watchers = new WeakMap<WebSocket, ReturnType<typeof watch>>();
const open = (id: string, origin = config.publicOrigin) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/signin/${id}/ws`, { origin });
    // Listen from the very start: the server may send (and close) before "open" is observed.
    watchers.set(ws, watch(ws));
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

function watch(ws: WebSocket) {
  const events: { type: string; [k: string]: unknown }[] = [];
  let frames = 0;
  ws.on("message", (data, isBinary) => {
    if (isBinary) frames++;
    else events.push(JSON.parse(data.toString()));
  });
  const until = async (pred: () => boolean, ms = 30_000) => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    return pred();
  };
  return { events, frames: () => frames, until };
}

const send = (ws: WebSocket, o: unknown) => ws.send(JSON.stringify(o));
async function typeText(ws: WebSocket, text: string) {
  for (const key of text) {
    send(ws, { t: "key", key });
    await new Promise((r) => setTimeout(r, 15));
  }
}

test("links: a link page opens while open, and is refused once used up or unknown", async () => {
  registry.resetSigninRegistryForTests();
  const s = registry.createSignin();
  const ok = await fetch(`http://127.0.0.1:${appPort}/signin/${s.id}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-security-policy") ?? "", /script-src 'nonce-/);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  s.state = "done";
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/signin/${s.id}`)).status, 410);
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/signin/not-a-real-link-id-1234567890`)).status, 410);
});

test("links: an expired link is refused", async () => {
  const s = registry.createSignin({}, Date.now() - config.signinLinkTtlMs - 1000);
  assert.equal(registry.getOpenSignin(s.id), undefined);
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/signin/${s.id}`)).status, 410);
});

test("websocket: a wrong or missing Origin, or an unknown link, is refused", async () => {
  const s = registry.createSignin();
  await assert.rejects(open(s.id, "https://evil.example"));
  await assert.rejects(open("unknown-link-id-1234567890"));
  assert.equal(registry.getOpenSignin(s.id)?.state, "open", "refused attempts do not consume the link");
});

test("capacity: when the cap is reached the user is told to retry and no browser starts", async () => {
  const release = browser.acquireBrowserSlot(1)!;
  const before = browser.activeBrowserCount();
  const original = config.signinMaxConcurrent;
  config.signinMaxConcurrent = before; // the cap equals what is already running
  try {
    const s = registry.createSignin();
    const ws = await open(s.id);
    const w = watchers.get(ws)!;
    assert.ok(await w.until(() => w.events.some((e) => e.type === "fail")));
    assert.match(String(w.events.find((e) => e.type === "fail")!.reason), /try again/i);
    assert.equal(browser.activeBrowserCount(), before, "no extra browser was started");
  } finally {
    config.signinMaxConcurrent = original;
    release();
  }
});

test("sign-in: typing into the streamed browser signs the person in to both tenants, then the browser closes", { skip: !HAVE_BROWSER && "no Chromium installed", timeout: 90_000 }, async () => {
  received = [];
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  };
  try {
    registry.resetSigninRegistryForTests();
    let successUser = "";
    const s = registry.createSignin({
      onSuccess: async (userId) => {
        successUser = userId;
        return "http://client.example/callback?code=abc";
      },
    });
    const ws = await open(s.id);
    const w = watchers.get(ws)!;
    assert.ok(await w.until(() => w.frames() > 0), "the browser view is streamed as frames");
    await new Promise((r) => setTimeout(r, 2500)); // let the login page load, as a person would wait

    // Click the password box (where the stand-in login page puts it), type, press Enter.
    send(ws, { t: "mouse", type: "down", x: 150, y: 120 });
    send(ws, { t: "mouse", type: "up", x: 150, y: 120 });
    await typeText(ws, PASSWORD);
    send(ws, { t: "key", key: "Enter" });

    assert.ok(await w.until(() => w.events.some((e) => e.type === "done"), 60_000), `sign-in completes (events: ${JSON.stringify(w.events)}, received: ${JSON.stringify(received)})`);
    assert.equal(w.events.find((e) => e.type === "done")!.redirect, "http://client.example/callback?code=abc");
    assert.deepEqual(received, [PASSWORD], "the page received exactly what the viewer typed");

    // Both tenants vaulted with a minted token; Microsoft state saved; person created.
    assert.ok(successUser && vault.userExists(successUser));
    assert.deepEqual(vault.connectedSchools(successUser).sort(), ["nyp", "politemall"]);
    const pm = vault.getSchoolSession(successUser, "politemall")!;
    assert.equal(pm.cookieHeader, "d2lSessionVal=S1; d2lSecureSessionVal=S2");
    assert.equal(pm.xsrfToken, "xsrf-123");
    assert.equal(pm.accessToken, "minted");
    assert.equal(vault.getSchoolSession(successUser, "nyp")?.cookieHeader, "d2lSessionVal=N1; d2lSecureSessionVal=N2");
    assert.ok(vault.getBrowserState(successUser), "the browser state is kept for silent re-login");

    // The browser is gone, and the link is spent.
    assert.ok(await w.until(() => browser.activeBrowserCount() === 0, 10_000));
    assert.equal(registry.getOpenSignin(s.id), undefined);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/signin/${s.id}`)).status, 410);
  } finally {
    console.log = realLog;
  }
  // What was typed appears in no log line.
  assert.ok(!logged.join("\n").includes(PASSWORD), "the password must never be logged");
  assert.ok(!logged.join("\n").includes("S1") && !logged.join("\n").includes("xsrf-123"), "no cookies or tokens are logged");
});

test("abandoned: a viewer who leaves ends the browser and keeps nothing", { skip: !HAVE_BROWSER && "no Chromium installed", timeout: 60_000 }, async () => {
  registry.resetSigninRegistryForTests();
  const s = registry.createSignin();
  const ws = await open(s.id);
  const w = watchers.get(ws)!;
  assert.ok(await w.until(() => w.frames() > 0));
  assert.equal(browser.activeBrowserCount(), 1);
  ws.close();
  assert.ok(await w.until(() => browser.activeBrowserCount() === 0, 15_000), "the browser is terminated when the viewer leaves");
  assert.equal(registry.getSignin(s.id)?.state, "failed");
  assert.equal(registry.getOpenSignin(s.id), undefined);
});

test("timeout: a sign-in left open past its limit is terminated", { skip: !HAVE_BROWSER && "no Chromium installed", timeout: 60_000 }, async () => {
  registry.resetSigninRegistryForTests();
  const original = config.signinTimeoutMs;
  config.signinTimeoutMs = 4000;
  try {
    const s = registry.createSignin();
    const ws = await open(s.id);
    const w = watchers.get(ws)!;
    assert.ok(await w.until(() => w.events.some((e) => e.type === "fail"), 30_000), "the stream reports the failure");
    assert.ok(await w.until(() => browser.activeBrowserCount() === 0, 10_000));
    assert.equal(registry.getSignin(s.id)?.state, "failed");
  } finally {
    config.signinTimeoutMs = original;
  }
});

test("a second viewer cannot attach to a sign-in that is already running", { skip: !HAVE_BROWSER && "no Chromium installed", timeout: 60_000 }, async () => {
  registry.resetSigninRegistryForTests();
  const s = registry.createSignin();
  const first = await open(s.id);
  const w = watchers.get(first)!;
  assert.ok(await w.until(() => w.frames() > 0));
  await assert.rejects(open(s.id), "the link is single-use");
  first.close();
  await w.until(() => browser.activeBrowserCount() === 0, 15_000);
});

test("silent re-login: saved Microsoft state revives a session with no input; no state means none", { skip: !HAVE_BROWSER && "no Chromium installed", timeout: 90_000 }, async () => {
  const user = await vault.createUser();
  assert.equal(await browser.silentRelogin(user, "politemall"), null, "no saved state: nothing to replay");

  // State that the stand-in site accepts: it holds the D2L cookies, so /d2l/home loads signed in.
  const state = JSON.stringify({
    cookies: [
      { name: "d2lSessionVal", value: "S1", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      { name: "d2lSecureSessionVal", value: "S2", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
    ],
    origins: [],
  });
  await vault.saveBrowserState(user, state);
  const fresh = await browser.silentRelogin(user, "politemall");
  assert.ok(fresh, "revived");
  assert.equal(fresh!.cookieHeader, "d2lSessionVal=S1; d2lSecureSessionVal=S2");
  assert.equal(fresh!.xsrfToken, "xsrf-123");
  assert.equal(browser.activeBrowserCount(), 0, "the background browser is closed again");

  // State the site no longer accepts: it lands on the login form, needs interaction, gives up.
  await vault.saveBrowserState(user, JSON.stringify({ cookies: [], origins: [] }));
  assert.equal(await browser.silentRelogin(user, "politemall"), null);
  assert.equal(browser.activeBrowserCount(), 0);
});
