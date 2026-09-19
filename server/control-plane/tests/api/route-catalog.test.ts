import { test } from "node:test";
import assert from "node:assert/strict";
import { D2L_ROUTE_CATALOG } from "../../src/api/route-catalog.js";

// spec: d2l-route-catalog — "Catalog is scoped to read-only Learning Environment routes"

test("every catalog entry is GET", () => {
  const nonGet = D2L_ROUTE_CATALOG.filter((r) => r.method !== "GET");
  assert.deepEqual(nonGet, []);
});

test("no catalog entry falls under an excluded route family", () => {
  const excluded = D2L_ROUTE_CATALOG.filter((r) =>
    /^\/(agents|locker|lti|ltiadvantage)\//.test(r.pathTemplate) || /^\/?(agents|locker|lti|ltiadvantage)\//.test(r.pathTemplate)
  );
  assert.deepEqual(
    excluded.map((r) => r.operation),
    []
  );
});

test("catalog has no duplicate operation keys", () => {
  const ops = D2L_ROUTE_CATALOG.map((r) => r.operation);
  assert.equal(new Set(ops).size, ops.length);
});

test("catalog has the expected total route count", () => {
  assert.equal(D2L_ROUTE_CATALOG.length, 190);
});

test("every course-scoped route's pathTemplate includes {orgUnitId}, and pathParams never declares it directly", () => {
  for (const r of D2L_ROUTE_CATALOG) {
    if (r.scope === "course") {
      assert.ok(r.pathTemplate.includes("{orgUnitId}"), `${r.operation} is course-scoped but has no {orgUnitId} placeholder`);
    }
    assert.ok(
      !("orgUnitId" in r.pathParams.shape),
      `${r.operation}'s pathParams must not declare orgUnitId directly — it is always auto-derived from courseId`
    );
  }
});
