import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "local-ctx-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
process.env.STORE_FILE = join(dir, "tokens.json");
const { setMasterKey } = await import("../../src/auth/crypto.js");
setMasterKey(randomBytes(32).toString("base64"));
const { authFor, runAcrossD2LSchools } = await import("../../src/tools/helpers.js");
const { createLocalContext } = await import("../../src/local/context.js");
const { createUserContext } = await import("../../src/auth/session-context.js");
const { startLocalSignin, resetLocalSigninForTests } = await import("../../src/local/signin.js");

// spec: local-npx-server — sign-in guidance fits a local user; only one sign-in at a time.

test("signed out: the message says a window opened, and shows no web link", async () => {
  let starts = 0;
  const ctx = createLocalContext(() => void starts++);
  const r = await authFor(ctx, "politemall");
  assert.equal(r.ok, false);
  const message = (r as { message: string }).message;
  assert.match(message, /sign-in window has opened on this computer/);
  assert.doesNotMatch(message, /https?:\/\//);
  assert.equal(starts, 1);

  const none = await runAcrossD2LSchools(ctx, async () => []);
  assert.match(none.warnings[0], /No school connected yet\. A sign-in window has opened/);
});

test("the hosted context's messages are unchanged", async () => {
  const ctx = createUserContext("nobody");
  const r = await authFor(ctx, "politemall");
  assert.match((r as { message: string }).message, /^Your politemall session isn't connected\. Sign in at .*\/signin\/.+\.$/);
});

test("two requests while signed out open one sign-in", async () => {
  resetLocalSigninForTests();
  let launches = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const deps = {
    overallMs: 1000,
    mint: async () => ({ ok: false as const, reason: "sessionExpired" as const }),
    launch: async () => {
      launches++;
      await gate;
      throw new Error("stop");
    },
  };
  const a = startLocalSignin(deps as never);
  const b = startLocalSignin(deps as never);
  assert.strictEqual(a, b, "the second call reuses the open sign-in");
  release();
  const result = await a;
  assert.equal(result.ok, false);
  assert.equal(launches, 1);
});
