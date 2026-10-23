import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const dir = mkdtempSync(join(tmpdir(), "parity-"));
process.env.SESSION_FILE = join(dir, "sessions.json");
process.env.STORE_FILE = join(dir, "tokens.json");
const { setMasterKey } = await import("../../src/auth/crypto.js");
setMasterKey(randomBytes(32).toString("base64"));
const { buildMcpServer } = await import("../../src/server.js");
const { createUserContext } = await import("../../src/auth/session-context.js");
const { createLocalContext } = await import("../../src/local/context.js");

// spec: local-npx-server — the local server offers exactly the cloud server's functionality.

async function listTools(ctx: Parameters<typeof buildMcpServer>[0]) {
  const server = buildMcpServer(ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const tools = (await client.listTools()).tools;
  const instructions = client.getInstructions();
  await client.close();
  return { tools, instructions };
}

test("local and cloud list identical tools (names, schemas, descriptions, annotations) and instructions", async () => {
  const cloud = await listTools(createUserContext("someone"));
  const local = await listTools(createLocalContext(() => undefined));
  assert.ok(cloud.tools.length > 30);
  assert.deepEqual(local.tools, cloud.tools);
  assert.equal(local.instructions, cloud.instructions);
});
