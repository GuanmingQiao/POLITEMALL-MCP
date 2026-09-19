import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveD2lPath, resolveD2lQuery } from "../../src/api/d2l-routes.js";
import { UnknownOperationError, InvalidRouteParamsError } from "../../src/api/errors.js";
import { parseCourseId, formatCourseId } from "../../src/api/courses.js";

// spec: d2l-route-catalog â€” "resolving a path from an operation key", "rejecting an unknown operation key"

test("resolveD2lPath: valid substitution for a course-scoped route with a path param", () => {
  const path = resolveD2lPath("le.rubrics.get", { rubricId: 42 }, 6606);
  assert.equal(path, "/d2l/api/le/{version}/6606/rubrics/42");
});

test("resolveD2lPath: valid substitution for a course-scoped route with no extra path params", () => {
  const path = resolveD2lPath("le.grades.finalValueMy", {}, 6606);
  assert.equal(path, "/d2l/api/le/{version}/6606/grades/final/values/myGradeValue");
});

test("resolveD2lPath: valid substitution for a global route (no orgUnitId at all)", () => {
  const path = resolveD2lPath("le.auditing.auditorGet", { auditorId: 123 });
  assert.equal(path, "/d2l/api/le/{version}/auditing/auditors/123");
});

test("resolveD2lPath: unknown operation key is rejected without touching the network", () => {
  assert.throws(() => resolveD2lPath("le.does.not.exist", {}, 6606), UnknownOperationError);
});

test("resolveD2lPath: invalid path params are rejected without touching the network", () => {
  // rubricId must be numeric; a non-numeric string fails the catalog's zod schema
  assert.throws(() => resolveD2lPath("le.rubrics.get", { rubricId: "not-a-number" }, 6606), InvalidRouteParamsError);
});

test("resolveD2lPath: course-scoped operation without an orgUnitId is rejected", () => {
  assert.throws(() => resolveD2lPath("le.rubrics.get", { rubricId: 42 }), InvalidRouteParamsError);
});

test("resolveD2lQuery: valid query params serialize to a query string", () => {
  const qs = resolveD2lQuery("le.discussions.postsList", { pageSize: 10, threadsOnly: true });
  const params = new URLSearchParams(qs.replace(/^\?/, ""));
  assert.equal(params.get("pageSize"), "10");
  assert.equal(params.get("threadsOnly"), "true");
});

test("resolveD2lQuery: an operation with no declared query schema returns an empty string", () => {
  assert.equal(resolveD2lQuery("le.rubrics.get", {}), "");
});

test("resolveD2lQuery: invalid query params are rejected without touching the network", () => {
  assert.throws(() => resolveD2lQuery("le.discussions.postsList", { pageSize: "not-a-number" }), InvalidRouteParamsError);
});

// courseId parsing (pre-existing behavior, unrelated to the catalog, kept here for the file's
// only other exported pure functions of note)

test("parseCourseId/formatCourseId round-trip", () => {
  const courseId = formatCourseId("politemall", 6606);
  assert.equal(courseId, "politemall:6606");
  assert.deepEqual(parseCourseId(courseId), { school: "politemall", numericId: 6606 });
});
