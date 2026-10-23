import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../../src/server.js";
import { createUserContext } from "../../src/auth/session-context.js";

// spec: d2l-mcp-tool-surface — every tool is read-only except the quiz authoring tools, and
// those are annotated as modifying (spec: quiz-authoring-tools — "annotations").
const WRITE_TOOLS = {
  create_quiz: { destructiveHint: false },
  update_quiz: { destructiveHint: true },
  save_quiz_questions: { destructiveHint: true },
} as const;

test("every registered tool is annotated via a real MCP tool listing; exactly the three quiz tools write", async () => {
  const server = buildMcpServer(createUserContext("fake-user-for-annotation-check-only"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotation-check", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 39, `expected 39 registered tools, got ${tools.length}`);

  const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true);
  assert.deepEqual(writers.map((t) => t.name).sort(), Object.keys(WRITE_TOOLS).sort(), "only the declared tools may modify D2L");
  for (const t of writers) {
    assert.equal(t.annotations?.readOnlyHint, false, t.name);
    assert.equal(t.annotations?.destructiveHint, WRITE_TOOLS[t.name as keyof typeof WRITE_TOOLS].destructiveHint, t.name);
  }

  const readers = tools.filter((t) => !(t.name in WRITE_TOOLS));
  const wrong = readers.filter((t) => t.annotations?.readOnlyHint !== true || t.annotations?.destructiveHint !== false);
  assert.deepEqual(
    wrong.map((t) => t.name),
    [],
    "every other tool must have readOnlyHint: true and destructiveHint: false"
  );

  await client.close();
  await server.close();
});

test("write tool descriptions say what they change, when to use something else, and what they return", async () => {
  const server = buildMcpServer(createUserContext("fake-user-for-description-check-only"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "description-check", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();

  for (const name of Object.keys(WRITE_TOOLS)) {
    const tool = tools.find((t) => t.name === name)!;
    const d = tool.description ?? "";
    assert.match(d, /WRITES/, `${name}: says it changes data`);
    assert.match(d, /instructor\/TA/, `${name}: says who can use it`);
    assert.match(d, /\bUse \w+/, `${name}: points to the right tool for the neighbouring job`);
    assert.match(d, /dryRun/, `${name}: mentions the preview`);
    assert.match(d, /Returns/, `${name}: says what it returns`);
    const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
    for (const [field, schema] of Object.entries(props)) {
      assert.ok(schema.description || "anyOf" in schema || "oneOf" in schema || field === "questions", `${name}.${field} has a description`);
    }
  }
  assert.match(tools.find((t) => t.name === "create_quiz")!.description!, /twice creates two quizzes/);

  await client.close();
  await server.close();
});
