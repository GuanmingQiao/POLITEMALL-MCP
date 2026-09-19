import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHOOL_HOSTS } from "../../src/api/d2l-client.js";
import { callD2lOperation } from "../../src/api/d2l-routes.js";
import { UnknownOperationError, InvalidRouteParamsError, UnsupportedOperationError } from "../../src/api/errors.js";
import { primeD2lVersions } from "../../src/api/d2l-versions.js";

// Versions are discovered per tenant at runtime; these tests are about the routes, not discovery.
for (const host of Object.values(SCHOOL_HOSTS)) primeD2lVersions(host, { le: "1.97", lp: "1.63" });

// spec: d2l-mcp-tool-surface â€” "generic tool invokes a cataloged operation", "generic tool
// rejects an operation not in the catalog", "generic tool rejects invalid parameters"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(t: import("node:test").TestContext, answers: { match: string; body: unknown }[]) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(String(url));
    const hit = answers.find((a) => String(url).includes(a.match));
    if (!hit) throw new Error(`Unmocked fetch: ${url}`);
    return jsonResponse(hit.body);
  });
  return calls;
}

test("callD2lOperation: valid operation and params succeed (single-object route)", async (t) => {
  const calls = mockFetch(t, [{ match: "/rubrics/42", body: { RubricId: 42, Name: "Essay Rubric" } }]);
  const result = await callD2lOperation("politemall", "cookie", "le.rubrics.get", { rubricId: 42 }, {}, 6606);
  assert.deepEqual(result, { RubricId: 42, Name: "Essay Rubric" });
  assert.equal(calls.length, 1);
});

test("callD2lOperation: unknown operation key is rejected without touching the network", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(
    () => callD2lOperation("politemall", "cookie", "le.does.not.exist", {}, {}, 6606),
    UnknownOperationError
  );
  assert.equal(calls.length, 0);
});

test("callD2lOperation: invalid params are rejected without touching the network", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(
    () => callD2lOperation("politemall", "cookie", "le.rubrics.get", { rubricId: "not-a-number" }, {}, 6606),
    InvalidRouteParamsError
  );
  assert.equal(calls.length, 0);
});

test("callD2lOperation: a caller cannot override orgUnitId by smuggling it into pathParams", async (t) => {
  // orgUnitId isn't in le.rubrics.get's declared pathParams schema, so zod strips it from a
  // caller-supplied value even before the trusted orgUnitId argument is applied â€” the request
  // must always go to the org unit implied by the caller's own courseId (6606 here), never one
  // the caller writes into pathParams directly (999 here).
  const calls = mockFetch(t, [{ match: "/6606/rubrics/42", body: { RubricId: 42 } }]);
  const result = await callD2lOperation("politemall", "cookie", "le.rubrics.get", { rubricId: 42, orgUnitId: 999 }, {}, 6606);
  assert.deepEqual(result, { RubricId: 42 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/6606\/rubrics\/42$/);
  assert.ok(!calls[0].includes("/999/"), "must not have used the smuggled orgUnitId");
});

test("callD2lOperation: objectList pagination is followed across pages", async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    seen.push(String(url));
    if (seen.length === 1) return jsonResponse({ Next: "/d2l/api/le/1.97/6606/quizzes/?page=2", Objects: [{ QuizId: 1 }] });
    return jsonResponse({ Next: null, Objects: [{ QuizId: 2 }] });
  });
  const result = await callD2lOperation("politemall", "cookie", "le.quizzes.list", {}, {}, 6606);
  assert.deepEqual(result, [{ QuizId: 1 }, { QuizId: 2 }]);
  assert.equal(seen.length, 2);
});

test("callD2lOperation: bookmark pagination is followed across pages", async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    seen.push(String(url));
    if (seen.length === 1) return jsonResponse({ PagingInfo: { Bookmark: "abc", HasMoreItems: true }, Items: [{ CompletionId: 1 }] });
    return jsonResponse({ PagingInfo: { Bookmark: null, HasMoreItems: false }, Items: [{ CompletionId: 2 }] });
  });
  const result = await callD2lOperation("politemall", "cookie", "le.grades.courseCompletionList", {}, {}, 6606);
  assert.deepEqual(result, [{ CompletionId: 1 }, { CompletionId: 2 }]);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /bookmark=abc/);
});

test("callD2lOperation: a binary-returning operation is rejected outright, without touching the network", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(
    () => callD2lOperation("politemall", "cookie", "le.content.topicFile", { topicId: 1 }, {}, 6606),
    UnsupportedOperationError
  );
  assert.equal(calls.length, 0);
});
