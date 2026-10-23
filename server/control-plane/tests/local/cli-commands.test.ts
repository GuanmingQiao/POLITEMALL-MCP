import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.POLITEMALL_HOST = "local";
const dir = mkdtempSync(join(tmpdir(), "cli-cmd-"));
process.env.POLITEMALL_DATA_DIR = dir;
const { config } = await import("../../src/utils/config.js");
const { setMasterKey } = await import("../../src/auth/crypto.js");
const vault = await import("../../src/auth/session-vault.js");
const { runDoctor, logoutCommand } = await import("../../src/local/commands.js");
const { registerClient, runSetup, detectClients, SERVER_NAME } = await import("../../src/local/setup.js");

// spec: local-npx-server — CLI: doctor, logout, setup.

test("data lives under the per-user directory in a local run", () => {
  assert.equal(config.local, true);
  assert.equal(config.sessionFile, join(dir, "sessions.json"));
});

test("doctor reports each check by name and never prints key or session material", async () => {
  setMasterKey(randomBytes(32).toString("base64"));
  await vault.ensureUser("local");
  await vault.saveSchoolSession("local", "politemall", { cookieHeader: "d2lSessionVal=TOPSECRETCOOKIE", xsrfToken: "x", accessToken: "TOPSECRETTOKEN", accessTokenExpiresAt: Date.now() + 3_600_000 });
  const checks = await runDoctor({ browser: async () => "test browser", reachable: async () => true });
  const names = checks.map((c) => c.name);
  for (const n of ["Node.js", "Browser", "Data directory", "Encryption key", "Reach politemall", "Reach nyp", "Signed in", "Version"]) assert.ok(names.includes(n), n);
  assert.equal(checks.find((c) => c.name === "Signed in")?.detail, "politemall");
  const text = JSON.stringify(checks);
  assert.doesNotMatch(text, /TOPSECRET/);
  assert.doesNotMatch(text, /d2lSessionVal/);
});

test("doctor flags a missing browser", async () => {
  const checks = await runDoctor({
    browser: async () => {
      throw new Error("x");
    },
    reachable: async () => false,
  });
  assert.equal(checks.find((c) => c.name === "Browser")?.ok, false);
  assert.equal(checks.find((c) => c.name === "Reach nyp")?.ok, false);
});

test("logout deletes the stored sessions so nothing is connected", async () => {
  assert.ok(existsSync(config.sessionFile));
  assert.equal(await logoutCommand(), 0);
  assert.ok(!existsSync(config.sessionFile));
  assert.deepEqual(vault.connectedSchools("local"), []);
});

test("registering with a client keeps existing entries and is idempotent", () => {
  const file = join(dir, "client.json");
  writeFileSync(file, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }));
  assert.equal(registerClient(file), "added");
  const json = JSON.parse(readFileSync(file, "utf-8"));
  assert.equal(json.theme, "dark");
  assert.deepEqual(json.mcpServers.other, { command: "x" });
  assert.deepEqual(json.mcpServers[SERVER_NAME], { command: "npx", args: ["-y", "@qiaoguanming/politemall-mcp@latest"] });
  assert.equal(registerClient(file), "already");
  writeFileSync(file, "not json");
  assert.equal(registerClient(file), "unreadable");
  assert.equal(readFileSync(file, "utf-8"), "not json", "an unreadable file is left untouched");
});

test("setup writes nothing without a yes, and never asks for a password", async () => {
  const file = join(dir, "declined.json");
  writeFileSync(file, "{}");
  const asked: string[] = [];
  const io = { say: () => undefined, ask: async (q: string) => (asked.push(q), false) };
  const code = await runSetup(io, [{ name: "Test", file }], async () => 0, async () => [{ name: "Node.js", ok: true, detail: "" }, { name: "Browser", ok: true, detail: "" }]);
  assert.equal(readFileSync(file, "utf-8"), "{}", "declined, so unchanged");
  assert.ok(asked.length >= 1);
  assert.ok(asked.every((q) => !/password/i.test(q.replace(/you type your own Microsoft credentials/i, ""))), "no question asks for a password");
  assert.equal(code, 0);
});

test("client detection finds only configuration files that exist", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  assert.deepEqual(detectClients({}, "linux", home), []);
  writeFileSync(join(home, ".claude.json"), "{}");
  assert.deepEqual(detectClients({}, "linux", home).map((c) => c.name), ["Claude Code (user)"]);
});
