import { test } from "node:test";
import assert from "node:assert/strict";
import { addSgt, buildContent, buildProvenance, containsUrl, footerText, withSourceUrl } from "../../src/tools/provenance.js";

const NOW = new Date("2026-09-20T05:12:34.567Z");

test("one school: a single `source`; two schools: `sources`, one retrieval time", () => {
  const one = buildProvenance(["nyp"], {}, NOW);
  assert.deepEqual(one, { source: "NYP Brightspace", retrievedAt: "2026-09-20T05:12:34Z", timezone: "Asia/Singapore (+08:00)" });
  const two = buildProvenance(["nyp", "politemall", "nyp"], {}, NOW);
  assert.deepEqual(two.sources, ["NYP Brightspace", "POLITEMall Brightspace"]);
  assert.equal(two.source, undefined);
  assert.equal(buildProvenance(["step"], {}, NOW).source, "STEP");
});

test("the untrusted flag is set only when asked", () => {
  assert.equal(buildProvenance(["nyp"], {}, NOW).untrustedLinksInText, undefined);
  const flagged = buildProvenance(["nyp"], { untrusted: true }, NOW);
  assert.equal(flagged.untrustedLinksInText, true);
  assert.match(flagged.note ?? "", /not evidence/);
});

test("containsUrl finds typed URLs and nothing else", () => {
  assert.equal(containsUrl("see https://example.com/x"), true);
  assert.equal(containsUrl("go to www.example.com"), true);
  assert.equal(containsUrl("HTTP://EXAMPLE.COM"), true);
  assert.equal(containsUrl("no link here, just text about https"), false);
  assert.equal(containsUrl(null, undefined, 5), false);
  assert.equal(containsUrl("plain", "with http://x.y"), true);
});

test("the footer for array results carries source, time, page and the untrusted warning", () => {
  const prov = buildProvenance(["nyp"], {}, NOW);
  assert.equal(
    footerText(prov, { pageUrl: "https://nyplms.polite.edu.sg/d2l/home" }),
    "Source: NYP Brightspace — retrieved 2026-09-20T05:12:34Z; times with an Sgt suffix are Singapore time (+08:00). Page: https://nyplms.polite.edu.sg/d2l/home"
  );
  assert.match(footerText(buildProvenance(["nyp", "step"], {}, NOW), {}), /^Source: NYP Brightspace \+ STEP —/);
  assert.match(footerText(prov, { untrusted: true }), /not evidence/);
  assert.doesNotMatch(footerText(prov, {}), /Page:/);
});

test("addSgt keeps the original, adds only readable companions, and withSourceUrl adds nothing for no link", () => {
  const item = { due: "2026-10-01T04:00:00.000Z", none: null, junk: "soon" };
  const out = addSgt(item, ["due", "none", "junk", "missing"]);
  assert.deepEqual(out, { ...item, dueSgt: "2026-10-01T12:00:00+08:00" });
  assert.equal(addSgt(item, ["none"]), item, "nothing to add returns the same object");
  assert.deepEqual(withSourceUrl({ a: 1 }, undefined), { a: 1 });
  assert.deepEqual(withSourceUrl({ a: 1 }, "https://x"), { a: 1, sourceUrl: "https://x" });
});

test("buildContent: objects get provenance inline; arrays get a footer; no source means bare JSON", () => {
  const obj = buildContent({ a: 1 }, ["nyp"], { pageUrl: "https://nyplms.polite.edu.sg/d2l/home" });
  assert.equal(obj.length, 1);
  const parsed = JSON.parse((obj[0] as { text: string }).text);
  assert.equal(parsed.a, 1);
  assert.equal(parsed.pageUrl, "https://nyplms.polite.edu.sg/d2l/home");
  assert.equal(parsed.provenance.source, "NYP Brightspace");

  const arr = buildContent([1, 2], ["nyp"]);
  assert.equal(arr.length, 2);
  assert.deepEqual(JSON.parse((arr[0] as { text: string }).text), [1, 2]);

  const bare = buildContent({ a: 1 }, []);
  assert.equal((bare[0] as { text: string }).text, JSON.stringify({ a: 1 }, null, 2));
});
