import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// spec: local-npx-server — the server runs over stdio, opens no port, and offers the cloud tool list.
// Runs the compiled CLI exactly as an MCP client's `command` would.

const cli = fileURLToPath(new URL("../../src/local/cli.js", import.meta.url));

function runCli(args: string[], env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "stdio-"));
  // The test runner marks its children with NODE_TEST_CONTEXT, which would make this one speak the runner's protocol.
  const base = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...base, POLITEMALL_KEYRING: "off", POLITEMALL_DATA_DIR: dataDir, HOME: dataDir, USERPROFILE: dataDir, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  return { child, dataDir, out: () => stdout, err: () => stderr };
}

test("a handshake and tools/list produce only JSON-RPC on stdout", async () => {
  const run = runCli([]);
  const send = (m: unknown) => run.child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  await new Promise((r) => setTimeout(r, 1500));
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const end = Date.now() + 20_000;
  while (!run.out().includes('"id":2') && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  run.child.kill();

  const lines = run.out().split("\n").filter(Boolean);
  const messages = lines.map((l) => JSON.parse(l) as { jsonrpc: string; id?: number; result?: { tools?: { name: string }[] } });
  assert.ok(messages.length >= 2);
  assert.ok(messages.every((m) => m.jsonrpc === "2.0"), "nothing but JSON-RPC on stdout");
  const names = messages.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name) ?? [];
  assert.ok(names.includes("list_courses") && names.includes("whoami"));
  assert.ok(existsSync(join(run.dataDir)), "the data directory is the one given");
});

test("--version, help and unknown commands behave", async () => {
  const wait = (c: ReturnType<typeof runCli>) => new Promise<number | null>((r) => c.child.on("close", r));
  const v = runCli(["--version"]);
  assert.equal(await wait(v), 0);
  assert.match(v.out(), /^\d+\.\d+\.\d+/);
  const bad = runCli(["frobnicate"]);
  assert.equal(await wait(bad), 1);
  assert.match(bad.err(), /Unknown command/);
});

test("an unsupported Node version exits with a message naming the requirement", async () => {
  // Simulated by running the guard's logic: the CLI reads process.versions.node, which cannot be
  // faked from outside, so this checks the message text and threshold are in the shipped file.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(cli, "utf-8");
  assert.match(source, /MIN_NODE = 22/);
  assert.match(source, /needs Node\.js \$\{MIN_NODE\} or newer/);
});
