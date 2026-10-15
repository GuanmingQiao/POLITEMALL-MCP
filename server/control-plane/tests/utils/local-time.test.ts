import { test } from "node:test";
import assert from "node:assert/strict";
import { toSgt } from "../../src/utils/local-time.js";

test("the three pairs verified against the real pages", () => {
  // NYP announcement: API 05:23Z, page shows 1:23 PM
  assert.equal(toSgt("2026-09-09T05:23:00.000Z"), "2026-09-09T13:23:00+08:00");
  // a due date
  assert.equal(toSgt("2026-10-01T04:00:00.000Z"), "2026-10-01T12:00:00+08:00");
  // API 01:00+00:00, page shows 09:00
  assert.equal(toSgt("2026-10-06T01:00:00+00:00"), "2026-10-06T09:00:00+08:00");
});

test("a time late in the UTC day lands on the next Singapore day", () => {
  assert.equal(toSgt("2026-12-31T20:30:00Z"), "2027-01-01T04:30:00+08:00");
});

test("an input already carrying an offset is the same instant, expressed in +08:00", () => {
  assert.equal(toSgt("2026-10-01T12:00:00+08:00"), "2026-10-01T12:00:00+08:00");
  assert.equal(toSgt("2026-10-01T12:00:00-05:00"), "2026-10-02T01:00:00+08:00");
});

test("null, garbage, a bare local time and an 'unset' date give no companion", () => {
  for (const bad of [null, undefined, "", "not a date", 12345, "2026-10-01", "2026-10-01T12:00:00", "0001-01-01T00:00:00+00:00", {}]) {
    assert.equal(toSgt(bad), undefined, String(bad));
  }
});
