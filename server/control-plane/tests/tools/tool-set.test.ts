import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../../src/server.js";
import { createUserContext } from "../../src/auth/session-context.js";
import type { ToolContext } from "../../src/types/tool-context.js";

// The server must expose the same tools however it is hosted. Tools only see a ToolContext, so
// a context that isn't backed by the token store (what a local or embedded host would supply)
// must yield exactly the tool set the hosted server has.

async function listToolNames(ctx: ToolContext): Promise<string[]> {
  const server = buildMcpServer(ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-set-check", version: "0.0.1" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools.map((t) => t.name).sort();
}

test("hosted and non-hosted contexts expose the identical tool set", async () => {
  const inMemory: ToolContext = {
    connectedSchools: () => ["nyp"],
    getD2lAuth: async () => "Bearer x",
    connectUrl: () => "http://localhost:3000/signin/x",
  };
  const hosted = await listToolNames(createUserContext("some-user"));
  const other = await listToolNames(inMemory);
  assert.deepEqual(other, hosted);
  assert.equal(hosted.length, 36);
  for (const name of hosted) assert.doesNotMatch(name, /step/i, "STEP tools are not exposed");
});
