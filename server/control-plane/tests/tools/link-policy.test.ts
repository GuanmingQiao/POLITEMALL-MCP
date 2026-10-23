import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l } from "../helpers/mcp-harness.js";
import { LINK_POLICY } from "../../src/tools/link-policy.js";

test("every registered tool has a link-policy decision, and every decision names a real tool", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  const registered = (await c.tools()).map((x) => x.name).sort();
  assert.deepEqual(registered, Object.keys(LINK_POLICY).sort(), "adding a tool without deciding its links fails here");
  assert.equal(registered.length, 39);
  await c.close();
});

test("every tool that returns links says so in its description, naming the fields", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  for (const tool of await c.tools()) {
    const policy = LINK_POLICY[tool.name];
    const description = tool.description ?? "";
    if (policy.kind === "none") {
      assert.doesNotMatch(description, /Evidence links/, tool.name);
      continue;
    }
    assert.match(description, /Evidence links/, tool.name);
    for (const field of policy.fields) assert.ok(description.includes(field), `${tool.name} should mention ${field}`);
    if (policy.sgt) assert.match(description, /Sgt/, tool.name);
    assert.match(description, /never build or edit a link/, tool.name);
  }
  await c.close();
});

test("the reason for every policy is written down", () => {
  for (const [name, p] of Object.entries(LINK_POLICY)) assert.ok(p.reason.length > 4, name);
});
