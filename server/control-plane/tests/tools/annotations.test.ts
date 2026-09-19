import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../../src/server.js";
import { createTokenContext } from "../../src/auth/session-context.js";

// spec: d2l-mcp-tool-surface — "annotation present on a new tool" (verified here for every
// D2L/STEP tool, not just the new ones, per task 6.1's stated scope)

test("every registered tool is annotated readOnlyHint/destructiveHint via a real MCP tool listing", async () => {
  const server = buildMcpServer(createTokenContext("fake-token-for-annotation-check-only"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotation-check", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 41, `expected 41 registered tools, got ${tools.length}`);

  const missing = tools.filter((t) => t.annotations?.readOnlyHint !== true || t.annotations?.destructiveHint !== false);
  assert.deepEqual(
    missing.map((t) => t.name),
    [],
    "every tool must have readOnlyHint: true and destructiveHint: false"
  );

  await client.close();
  await server.close();
});
