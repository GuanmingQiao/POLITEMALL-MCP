import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";

// spec: signin-browser-hardening — network policy enforced in a real Chromium. The "school" is a
// stub on 127.0.0.1; a second stub on localhost plays an attacker's site (localhost is not an
// allowed host here, so it is refused). Skipped when no Chromium is installed.

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p && existsSync(p));
if (CANDIDATES[0]) process.env.CHROMIUM_PATH = CANDIDATES[0];
const HAVE_BROWSER = CANDIDATES.length > 0;

const browser = await import("../../src/auth/signin-browser.js");

let school: Server;
let evil: Server;
let evilHits = 0;
let schoolPort = 0;
let evilPort = 0;
const realOrigins = { ...browser.origins };

before(async () => {
  evil = createServer((_req, res) => {
    evilHits++;
    res.writeHead(200, { "content-type": "text/html" }).end("<title>evil</title>evil");
  });
  await new Promise<void>((r) => evil.listen(0, "127.0.0.1", r));
  evilPort = (evil.address() as AddressInfo).port;
  school = createServer((req, res) => {
    const evilUrl = `http://localhost:${evilPort}/`;
    if (req.url === "/redir") return void res.writeHead(302, { Location: evilUrl }).end();
    if (req.url === "/link") return void res.writeHead(200, { "content-type": "text/html" }).end(`<title>link</title><a id="a" href="${evilUrl}">x</a>`);
    if (req.url === "/script-nav") return void res.writeHead(200, { "content-type": "text/html" }).end(`<title>script</title><script>setTimeout(()=>{location.href="${evilUrl}"},50)</script>`);
    if (req.url === "/probe") {
      return void res.writeHead(200, { "content-type": "text/html" }).end(`<title>probe</title><script>fetch("http://169.254.169.254/latest/meta-data/").catch(()=>{});fetch("http://localhost:${evilPort}/img").catch(()=>{})</script>`);
    }
    res.writeHead(200, { "content-type": "text/html" }).end("<title>home</title>home");
  });
  await new Promise<void>((r) => school.listen(0, "127.0.0.1", r));
  schoolPort = (school.address() as AddressInfo).port;
  browser.origins.politemall = `http://127.0.0.1:${schoolPort}`;
  browser.origins.nyp = `http://127.0.0.1:${schoolPort}`;
});

after(async () => {
  Object.assign(browser.origins, realOrigins);
  await new Promise((r) => school.close(r));
  await new Promise((r) => evil.close(r));
});

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("navigation off the allowed hosts never reaches the other site", { skip: !HAVE_BROWSER }, async () => {
  evilHits = 0;
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  const b = await browser.launchBrowser();
  try {
    const base = `http://127.0.0.1:${schoolPort}`;
    // link click
    await b.page.goto(`${base}/link`);
    await b.page.click("#a", { noWaitAfter: true }).catch(() => undefined);
    await settle(500);
    assert.match(b.page.url(), new RegExp(`127\.0\.0\.1:${schoolPort}/link`), "stays on its page after a link");
    // script navigation
    await b.page.goto(`${base}/script-nav`);
    await settle(800);
    assert.match(b.page.url(), /script-nav/, "stays after a scripted navigation");
    // redirect hop
    await b.page.goto(`${base}/redir`, { timeout: 3000 }).catch(() => undefined);
    assert.ok(!b.page.url().includes(`localhost:${evilPort}`), "redirect hop refused");
    // internal addresses, from a page script
    await b.page.goto(`${base}/probe`);
    await settle(800);
    assert.equal(evilHits, 0, "the other site never saw a request");
    // a normal page still loads
    await b.page.goto(`${base}/home`);
    assert.equal(await b.page.title(), "home");
  } finally {
    await b.close();
    console.log = realLog;
  }
  const summary = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.event === "signin_net_summary");
  assert.ok(summary, "a summary is written when the browser ends");
  assert.ok(`localhost` in summary.blocked, "blocked host named");
  assert.ok("169.254.169.254" in summary.blocked, "metadata address named");
  const text = lines.join("\n");
  assert.ok(!text.includes("meta-data") && !text.includes("/probe") && !text.includes("cookie"), "no URLs, paths or cookies in the log");
});

test("report mode lets the request through but still counts it", { skip: !HAVE_BROWSER }, async () => {
  evilHits = 0;
  process.env.SIGNIN_NET_MODE = "report";
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  const b = await browser.launchBrowser();
  try {
    await b.page.goto(`http://127.0.0.1:${schoolPort}/link`);
    await b.page.goto(`http://localhost:${evilPort}/`).catch(() => undefined);
    assert.ok(evilHits > 0, "reached in report mode");
  } finally {
    delete process.env.SIGNIN_NET_MODE;
    await b.close();
    console.log = realLog;
  }
  const summary = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.event === "signin_net_summary");
  assert.ok(summary && "localhost" in summary.reported);
});

test("sandbox is on unless explicitly disabled", () => {
  assert.ok(!browser.chromiumArgs({}).includes("--no-sandbox"));
  assert.ok(browser.chromiumArgs({ CHROMIUM_NO_SANDBOX: "1" }).includes("--no-sandbox"));
  assert.equal(browser.sandboxDisabled({}), false);
  assert.equal(browser.sandboxDisabled({ CHROMIUM_NO_SANDBOX: "1" }), true);
});
