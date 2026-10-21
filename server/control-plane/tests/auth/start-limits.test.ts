import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// spec: signin-browser-hardening — anonymous clients cannot monopolise sign-in capacity.
const { config } = await import("../../src/utils/config.js");
const { allow, clientIp } = await import("../../src/auth/rate-limit.js");
const limits = await import("../../src/auth/start-limits.js");
const registry = await import("../../src/auth/signin-registry.js");

beforeEach(() => {
  limits.resetStartLimitsForTests();
  registry.resetSigninRegistryForTests();
});

test("allow: budget runs out, then the window rolls over", () => {
  assert.ok(allow("k", 2, 1000, 0));
  assert.ok(allow("k", 2, 1000, 10));
  assert.ok(!allow("k", 2, 1000, 20));
  assert.ok(allow("k", 2, 1000, 1500), "a new window starts");
  assert.ok(allow("other", 2, 1000, 20), "other keys are independent");
});

test("starts: the per-IP budget refuses extra attempts, others are unaffected", () => {
  const n = config.signinStartsPerWindow;
  for (let i = 0; i < n; i++) assert.equal(limits.checkStart("1.1.1.1", 1000 + i), undefined);
  assert.equal(limits.checkStart("1.1.1.1", 2000)?.kind, "start");
  assert.equal(limits.checkStart("2.2.2.2", 2000), undefined);
  assert.equal(limits.checkStart("1.1.1.1", 1000 + config.signinStartWindowMs + 5), undefined, "window rolls over");
});

test("strikes: N unsuccessful sign-ins pause one IP, a success clears them, the pause expires", () => {
  const n = config.signinStrikesBeforePause;
  for (let i = 0; i < n - 1; i++) limits.recordStrike("1.1.1.1", 100);
  assert.equal(limits.checkStart("1.1.1.1", 101), undefined, "not paused below the threshold");
  limits.clearStrikes("1.1.1.1");
  for (let i = 0; i < n - 1; i++) limits.recordStrike("1.1.1.1", 100);
  assert.equal(limits.checkStart("1.1.1.1", 102), undefined, "a success cleared the earlier strikes");
  limits.recordStrike("1.1.1.1", 103);
  const refused = limits.checkStart("1.1.1.1", 104);
  assert.equal(refused?.kind, "paused");
  assert.match(limits.refusalMessage(refused!), /Try again in about \d+ minutes?/);
  assert.equal(limits.checkStart("2.2.2.2", 104), undefined, "another IP is unaffected");
  assert.equal(limits.checkStart("1.1.1.1", 103 + config.signinPauseMs + 1), undefined, "pause expires");
});

test("clientIp: the address Caddy appended wins over anything the client sent", () => {
  const sock = { remoteAddress: "172.18.0.3" };
  assert.equal(clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" }, socket: sock }), "203.0.113.7");
  assert.equal(clientIp({ headers: { "x-forwarded-for": "203.0.113.7" }, socket: sock }), "203.0.113.7");
  assert.equal(clientIp({ headers: {}, socket: sock }), "172.18.0.3");
});

test("open links: per-IP and overall caps, authenticated links exempt, freed as links start or expire", () => {
  const perIp = config.signinMaxPendingPerIp;
  const made = [];
  for (let i = 0; i < perIp; i++) {
    assert.equal(registry.anonymousLinkCap("1.1.1.1"), undefined);
    made.push(registry.createSignin({ ip: "1.1.1.1" }));
  }
  assert.equal(registry.anonymousLinkCap("1.1.1.1"), "pending_ip");
  assert.equal(registry.anonymousLinkCap("2.2.2.2"), undefined);
  // A link for a known person is always issued and does not count against the cap.
  const known = registry.createSignin({ userId: "u1", ip: "1.1.1.1" });
  assert.equal(known.createdByIp, undefined);
  assert.equal(registry.anonymousLinkCap("1.1.1.1"), "pending_ip");
  made[0].state = "running";
  assert.equal(registry.anonymousLinkCap("1.1.1.1"), undefined, "starting a link frees its place");

  const saved = config.signinMaxPending;
  config.signinMaxPending = 3;
  try {
    registry.resetSigninRegistryForTests();
    for (let i = 0; i < 3; i++) registry.createSignin({ ip: `3.3.3.${i}` });
    assert.equal(registry.anonymousLinkCap("4.4.4.4"), "pending_total");
    assert.equal(registry.anonymousLinkCap("4.4.4.4", Date.now() + config.signinLinkTtlMs + 1), undefined, "expired links free their place");
  } finally {
    config.signinMaxPending = saved;
  }
});

test("defaults match the design", () => {
  assert.equal(config.signinFirstInputMs, 60_000);
  assert.equal(config.signinStartsPerWindow, 20);
  assert.equal(config.signinStartWindowMs, 10 * 60_000);
  assert.equal(config.signinStrikesBeforePause, 5);
  assert.equal(config.signinPauseMs, 5 * 60_000);
  assert.equal(config.signinMaxPendingPerIp, 10);
  assert.equal(config.signinMaxPending, 200);
});
