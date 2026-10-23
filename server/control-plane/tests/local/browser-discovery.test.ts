import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_CHANNELS, NoBrowserError, launchBrowserProcess } from "../../src/auth/browser-discovery.js";
import { chromiumArgs } from "../../src/auth/signin-browser.js";

// spec: local-npx-server — sign-in uses an installed browser and never downloads one.

type Opts = Record<string, unknown>;
const recorder = (failing: string[] = []) => {
  const calls: Opts[] = [];
  const launch = (async (o: Opts) => {
    calls.push(o);
    if (typeof o.channel === "string" && failing.includes(o.channel)) throw new Error("not installed");
    return { fake: true } as never;
  }) as never;
  return { calls, launch };
};

test("hosted launch is unchanged: configured executable or Playwright default, no channel", async () => {
  const a = recorder();
  await launchBrowserProcess(a.launch, { headless: true, args: ["--x"] }, { local: false, env: {} });
  assert.deepEqual(a.calls, [{ headless: true, args: ["--x"], executablePath: undefined }]);
  const b = recorder();
  await launchBrowserProcess(b.launch, { headless: true, args: [] }, { local: false, env: { CHROMIUM_PATH: "/usr/bin/chromium" } });
  assert.equal(b.calls[0].executablePath, "/usr/bin/chromium");
  assert.equal(b.calls[0].channel, undefined);
});

test("local: CHROMIUM_PATH wins; otherwise Chrome, then Edge", async () => {
  const path = recorder();
  await launchBrowserProcess(path.launch, { headless: false, args: [] }, { local: true, env: { CHROMIUM_PATH: "C:\\b.exe" } });
  assert.equal(path.calls[0].executablePath, "C:\\b.exe");

  const chrome = recorder();
  await launchBrowserProcess(chrome.launch, { headless: false, args: [] }, { local: true, env: {} });
  assert.deepEqual(chrome.calls.map((c) => c.channel), ["chrome"]);

  const edge = recorder(["chrome"]);
  await launchBrowserProcess(edge.launch, { headless: false, args: [] }, { local: true, env: {} });
  assert.deepEqual(edge.calls.map((c) => c.channel), ["chrome", "msedge"]);
});

test("local: no browser gives a clear error naming the supported ones", async () => {
  const none = recorder([...LOCAL_CHANNELS]);
  await assert.rejects(
    launchBrowserProcess(none.launch, { headless: false, args: [] }, { local: true, env: {} }),
    (e: Error) => e instanceof NoBrowserError && /Chrome or Microsoft Edge/.test(e.message) && /CHROMIUM_PATH/.test(e.message)
  );
});

test("the sandbox stays on unless explicitly disabled", () => {
  assert.ok(!chromiumArgs({}).includes("--no-sandbox"));
  assert.ok(chromiumArgs({ CHROMIUM_NO_SANDBOX: "1" }).includes("--no-sandbox"));
});
