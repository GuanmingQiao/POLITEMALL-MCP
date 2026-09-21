import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSwitch, resourceLinksEnabled, sourceLinksEnabled } from "../../src/utils/config.js";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const before = { SOURCE_LINKS: process.env.SOURCE_LINKS, SOURCE_RESOURCE_LINKS: process.env.SOURCE_RESOURCE_LINKS };
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("SOURCE_LINKS defaults on; off turns it off; junk is the default", () => {
  withEnv({ SOURCE_LINKS: undefined }, () => assert.equal(sourceLinksEnabled(), true));
  withEnv({ SOURCE_LINKS: "on" }, () => assert.equal(sourceLinksEnabled(), true));
  withEnv({ SOURCE_LINKS: "off" }, () => assert.equal(sourceLinksEnabled(), false));
  withEnv({ SOURCE_LINKS: " OFF " }, () => assert.equal(sourceLinksEnabled(), false));
  withEnv({ SOURCE_LINKS: "banana" }, () => assert.equal(sourceLinksEnabled(), true));
  withEnv({ SOURCE_LINKS: "" }, () => assert.equal(sourceLinksEnabled(), true));
});

test("SOURCE_RESOURCE_LINKS defaults off, and never on while links are off", () => {
  withEnv({ SOURCE_RESOURCE_LINKS: undefined }, () => assert.equal(resourceLinksEnabled(), false));
  withEnv({ SOURCE_RESOURCE_LINKS: "on" }, () => assert.equal(resourceLinksEnabled(), true));
  withEnv({ SOURCE_RESOURCE_LINKS: "off" }, () => assert.equal(resourceLinksEnabled(), false));
  withEnv({ SOURCE_RESOURCE_LINKS: "banana" }, () => assert.equal(resourceLinksEnabled(), false));
  withEnv({ SOURCE_LINKS: "off", SOURCE_RESOURCE_LINKS: "on" }, () => assert.equal(resourceLinksEnabled(), false));
});

test("parseSwitch takes the default for anything that is not an explicit on/off", () => {
  assert.equal(parseSwitch(undefined, true), true);
  assert.equal(parseSwitch(undefined, false), false);
  assert.equal(parseSwitch("junk", true), true);
  assert.equal(parseSwitch("junk", false), false);
  assert.equal(parseSwitch("1", false), true);
  assert.equal(parseSwitch("0", true), false);
});
