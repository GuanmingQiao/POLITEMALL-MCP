import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// spec: local-npx-server — sign-in in the user's own browser. A real Chromium is driven against
// local stand-ins for the two school sites that are already signed in via Microsoft. The hosted
// launch (headless) is used so the test shows no window; the flow after launch is the local one.
// Skipped when no Chromium is installed (set CHROMIUM_PATH to point at one).

const dir = mkdtempSync(join(tmpdir(), "local-signin-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
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
const vault = await import("../../src/auth/session-vault.js");
const browser = await import("../../src/auth/signin-browser.js");
const { startLocalSignin, resetLocalSigninForTests, LOCAL_USER_ID } = await import("../../src/local/signin.js");

const HOME = `<!doctype html><title>Home</title><h1>Home</h1><script>window.D2L={LP:{Web:{Authentication:{Xsrf:{GetXsrfToken:function(){return "xsrf-123"}}}}}}</script>`;
let stub: Server;
const mint = async () => ({ ok: true as const, accessToken: "minted", expiresAt: Date.now() + 3_600_000 });

before(async () => {
  setMasterKey(randomBytes(32).toString("base64"));
  stub = createServer((req, res) => {
    if (req.url?.startsWith("/d2l/home")) {
      return void res.writeHead(200, { "content-type": "text/html", "Set-Cookie": ["d2lSessionVal=A; Path=/", "d2lSecureSessionVal=B; Path=/"] }).end(HOME);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const port = (stub.address() as AddressInfo).port;
  browser.origins.politemall = `http://127.0.0.1:${port}`;
  browser.origins.nyp = `http://localhost:${port}`;
});

after(async () => {
  stub.closeAllConnections();
  await new Promise((r) => stub.close(r));
});

test("signing in stores both schools and the Microsoft state under the one local user", { skip: !HAVE_BROWSER && "no Chromium installed" }, async () => {
  resetLocalSigninControl();
  const result = await startLocalSignin({ launch: () => browser.launchBrowser(), mint, overallMs: 30_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(vault.connectedSchools(LOCAL_USER_ID).sort(), ["nyp", "politemall"]);
  assert.ok(vault.getSchoolSession(LOCAL_USER_ID, "politemall")?.accessToken);
  assert.equal(vault.browserStateStatus(LOCAL_USER_ID), "ok");
});

test("a window closed before sign-in ends the attempt and leaves the stored session alone", { skip: !HAVE_BROWSER && "no Chromium installed" }, async () => {
  resetLocalSigninControl();
  const before = vault.getSchoolSession(LOCAL_USER_ID, "politemall");
  assert.ok(before, "a session from the previous test");
  const result = await startLocalSignin({
    launch: async () => {
      const launched = await browser.launchBrowser();
      // The person closes the window before signing in: the page goes away, nothing was captured.
      await launched.page.goto("about:blank");
      setTimeout(() => void launched.page.close(), 300);
      return launched;
    },
    mint: async () => ({ ok: false as const, reason: "sessionExpired" as const }),
    overallMs: 30_000,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(vault.getSchoolSession(LOCAL_USER_ID, "politemall"), before);
});

function resetLocalSigninControl() {
  resetLocalSigninForTests();
}
