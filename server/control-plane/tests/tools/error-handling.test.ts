import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare, enrollment } from "../helpers/mcp-harness.js";

// End-to-end through a real MCP client, the real token store and encrypted cookie storage;
// only D2L's HTTP responses are mocked. Covers what an agent actually sees when D2L refuses.
test("a learner calling an instructor-only tool is told it's a permission problem, with their actual role", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/grades/final/values/")) return bare(403);
    if (url.includes("/enrollments/myenrollments/524042")) return enrollment("Learner");
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_all_final_grades", { courseId: "nyp:524042" });
  assert.equal(r.isError, true);
  assert.match(r.text, /403/);
  assert.match(r.text, /Your role in this course is "Learner"/);
  assert.match(r.text, /needs a permission your account doesn't have/);
  assert.doesNotMatch(r.text, /isn't enabled|not a session problem/);
  await c.close();
});

test("the tool requests the discovered le version, not a pinned one", async (t) => {
  const seen: string[] = [];
  mockD2l(t, (url) => {
    seen.push(url);
    if (url.includes("/grades/final/values/")) return json({ Objects: [], Next: null });
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_all_final_grades", { courseId: "nyp:524042" });
  assert.equal(r.isError, false);
  assert.ok(seen.some((u) => u.includes("/d2l/api/le/1.97/524042/grades/final/values/")), seen.join("\n"));
  assert.ok(!seen.some((u) => u.includes("/le/1.9/")));
  await c.close();
});

test("a course the caller isn't in is reported as not found/not enrolled, not as a disabled tool", async (t) => {
  mockD2l(t, () => undefined); // everything 404s, including the enrollment lookup
  const c = await connect(["nyp"]);
  const r = await c.call("get_quizzes", { courseId: "nyp:99999999" });
  assert.equal(r.isError, true);
  assert.match(r.text, /doesn't exist, or you aren't enrolled/);
  assert.match(r.text, /list_courses/);
  assert.doesNotMatch(r.text, /isn't enabled/);
  await c.close();
});

test("an enrolled user's 404 lists the possible causes instead of asserting the tool is disabled", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/enrollments/myenrollments/524042")) return enrollment("Tutor");
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_quiz_attempts", { courseId: "nyp:524042", quizId: 1 });
  assert.equal(r.isError, true);
  assert.match(r.text, /Your role in this course is "Tutor"/);
  assert.match(r.text, /item id you passed/);
  assert.doesNotMatch(r.text, /not a session problem/);
  await c.close();
});

test("a D2L 400 surfaces D2L's own detail", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/grades/final/values/"))
      return json({ title: "Invalid Parameters", detail: "Request has missing or invalid parameters." }, 400);
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_all_final_grades", { courseId: "nyp:524042" });
  assert.match(r.text, /invalid \(400\)/);
  assert.match(r.text, /missing or invalid parameters/);
  await c.close();
});

test("call_d2l_operation reports failures with the same specific messages", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/quizzes/")) return bare(403);
    if (url.includes("/enrollments/myenrollments/524042")) return enrollment("Learner");
  });
  const c = await connect(["nyp"]);
  const r = await c.call("call_d2l_operation", { operation: "le.quizzes.list", courseId: "nyp:524042" });
  assert.equal(r.isError, true);
  assert.match(r.text, /"le\.quizzes\.list" failed/);
  assert.match(r.text, /Your role in this course is "Learner"/);
  await c.close();
});

test("cross-course tools return one school's data plus a warning when the other school fails", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("nyplms") && url.includes("/enrollments/myenrollments/")) {
      return json({ PagingInfo: { Bookmark: null, HasMoreItems: false }, Items: [{ OrgUnit: { Id: 1, Type: { Id: 3 }, Name: "N", Code: "N" }, Access: { IsActive: true, StartDate: null, EndDate: null, LastAccessed: null } }] });
    }
    if (url.includes("lms.polite") && url.includes("/enrollments/myenrollments/")) return bare(500);
  });
  const c = await connect(["nyp", "politemall"]);
  const r = await c.call("list_courses");
  assert.equal(r.isError, false);
  const body = JSON.parse(r.text);
  assert.equal(body.courses.length, 1);
  assert.equal(body.courses[0].school, "nyp");
  assert.match(body.warnings[0], /^politemall: .*HTTP 500/);
  await c.close();
});

test("cross-course tools are an error only when every connected school failed", async (t) => {
  mockD2l(t, () => bare(500));
  const c = await connect(["nyp", "politemall"]);
  const r = await c.call("list_courses");
  assert.equal(r.isError, true);
  assert.match(r.text, /nyp: .*HTTP 500/);
  assert.match(r.text, /politemall: .*HTTP 500/);
  await c.close();
});

test("an expired session still tells the user to reconnect", async (t) => {
  mockD2l(t, () => new Response(null, { status: 302 }));
  const c = await connect(["nyp"]);
  const r = await c.call("get_grades", { courseId: "nyp:524042" });
  assert.equal(r.isError, true);
  assert.match(r.text, /session expired — reconnect/);
  await c.close();
});
