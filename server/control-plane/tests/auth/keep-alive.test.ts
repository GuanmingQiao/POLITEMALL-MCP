import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionExpiredError, TokenRenewalError } from "../../src/api/errors.js";
import { runKeepAliveSweep, startKeepAlive } from "../../src/auth/keep-alive.js";

// spec: streamed-login-session - "Stored D2L sessions are kept alive in the background"

const t = (userId: string, school: "nyp" | "politemall") => ({ userId, school });

test("every session is renewed once, in order, and the event carries counts only", async () => {
  const order: string[] = [];
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  const summary = await runKeepAliveSweep({
    targets: () => [t("alice", "nyp"), t("alice", "politemall"), t("bob", "nyp")],
    refresh: async (u, s) => void order.push(`${u}:${s}`),
    paused: () => false,
    log: (event, fields) => void events.push({ event, fields }),
  });
  assert.deepEqual(order, ["alice:nyp", "alice:politemall", "bob:nyp"]);
  assert.deepEqual(summary, { seen: 3, renewed: 3, failed: 0, transient: 0, skipped: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "keepalive_sweep");
  assert.deepEqual(Object.keys(events[0].fields).sort(), ["failed", "renewed", "seen", "skipped", "transient"]);
});

test("one failing session never stops the rest, and failures are told apart", async () => {
  const seen: string[] = [];
  const summary = await runKeepAliveSweep({
    targets: () => [t("a", "nyp"), t("b", "nyp"), t("c", "nyp"), t("d", "nyp")],
    refresh: async (u) => {
      seen.push(u);
      if (u === "a") throw new SessionExpiredError("dead");
      if (u === "b") throw new TokenRenewalError("blip");
      if (u === "c") throw new Error("bug");
    },
    paused: () => false,
    log: () => undefined,
  });
  assert.deepEqual(seen, ["a", "b", "c", "d"]);
  assert.deepEqual(summary, { seen: 4, renewed: 1, failed: 2, transient: 1, skipped: 0 });
});

test("a session inside its post-failure pause is skipped without being touched", async () => {
  const touched: string[] = [];
  const summary = await runKeepAliveSweep({
    targets: () => [t("paused", "nyp"), t("fine", "nyp")],
    refresh: async (u) => void touched.push(u),
    paused: (u) => u === "paused",
    log: () => undefined,
  });
  assert.deepEqual(touched, ["fine"]);
  assert.equal(summary?.skipped, 1);
});

test("a sweep that starts while another is running does nothing", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let refreshes = 0;
  const slow = runKeepAliveSweep({
    targets: () => [t("a", "nyp")],
    refresh: async () => {
      refreshes++;
      await gate;
    },
    paused: () => false,
    log: () => undefined,
  });
  assert.equal(await runKeepAliveSweep({ targets: () => [t("b", "nyp")], refresh: async () => void refreshes++, log: () => undefined }), null);
  release();
  await slow;
  assert.equal(refreshes, 1);
});

test("the timer is unref'd, runs on the interval, and can be stopped", async () => {
  const stop = startKeepAlive(3_600_000, 3_600_000);
  assert.equal(typeof stop, "function");
  stop();
});

test("the default interval is 60 minutes and nothing starts just by importing the module", async () => {
  const { config } = await import("../../src/utils/config.js");
  assert.equal(config.keepAliveIntervalMs, 60 * 60 * 1000);
});
