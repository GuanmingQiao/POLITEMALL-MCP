import { test } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { connect, json } from "../helpers/mcp-harness.js";
import { resetD2lVersionCache } from "../../src/api/d2l-versions.js";

// spec: quiz-authoring-tools. D2L is mocked; the real MCP server, client and session vault run.

interface Seen {
  method: string;
  url: string;
  body?: any;
  auth?: string;
}

function mockQuizD2l(t: TestContext, opts: { le?: string; failQuestionNumber?: number; failStatus?: number; existing?: any[] } = {}) {
  resetD2lVersionCache();
  const le = opts.le ?? "1.100";
  const writes: Seen[] = [];
  const reads: Seen[] = [];
  let questionCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/d2l/api/versions/")) {
      return json([
        { ProductCode: "le", LatestVersion: le, SupportedVersions: [le] },
        { ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.63"] },
      ]);
    }
    const seen: Seen = { method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization };
    if (method !== "GET") writes.push(seen);
    else reads.push(seen);

    if (method === "POST" && url.endsWith("/quizzes/")) return json({ QuizId: 77, Name: seen.body.Name, IsActive: seen.body.IsActive, DueDate: seen.body.DueDate });
    if (method === "GET" && /\/quizzes\/77$/.test(url)) {
      return json({ QuizId: 77, Name: "Existing", IsActive: false, Instructions: { Text: { Text: "hi", Html: "" }, IsDisplayed: true }, SubmissionTimeLimit: { IsEnforced: true, ShowClock: true, TimeLimitValue: 20 }, DueDate: null });
    }
    if (url.includes("/enrollments/")) return json({ Access: { IsActive: true, ClasslistRoleName: "Instructor" } });
    if (method === "GET" && /\/quizzes\/404$/.test(url)) return new Response("", { status: 404 });
    if (method === "PUT" && /\/quizzes\/77$/.test(url)) return json({ QuizId: 77, ...seen.body });
    if (method === "GET" && url.endsWith("/quizzes/77/questions/")) {
      return json({ PagingInfo: { HasMoreItems: false, Bookmark: null }, Objects: opts.existing ?? [] });
    }
    if (/\/quizzes\/77\/questions\//.test(url) && (method === "POST" || method === "PUT")) {
      questionCalls++;
      if (opts.failQuestionNumber === questionCalls) return new Response("", { status: opts.failStatus ?? 400 });
      return json({ QuestionId: 1000 + questionCalls });
    }
    return new Response("", { status: 404 });
  });
  return { writes, reads };
}

const COURSE = "nyp:5001";
const mc = (n: number) => ({ type: "multiple_choice", text: `Question ${n}`, answers: [{ text: "A", correct: true }, { text: "B", correct: false }] });
const questionsOf = (n: number) => Array.from({ length: n }, (_, i) => mc(i + 1));

test("create_quiz creates a hidden quiz and returns its id", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const r = await c.call("create_quiz", { courseId: COURSE, name: "Week 1", timeLimitMinutes: 30 });
  assert.equal(r.isError, false, r.text);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "POST");
  assert.match(writes[0].url, /\/d2l\/api\/le\/1\.100\/5001\/quizzes\/$/);
  assert.equal(writes[0].auth, "Bearer test-token");
  assert.equal(writes[0].body.IsActive, false);
  assert.equal(writes[0].body.SubmissionTimeLimit.TimeLimitValue, 30);
  assert.match(r.text, /"quizId": 77/);
  await c.close();
});

test("create_quiz dry run and invalid input send nothing", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const dry = await c.call("create_quiz", { courseId: COURSE, name: "Week 1", dryRun: true });
  assert.equal(dry.isError, false);
  assert.match(dry.text, /"dryRun": true/);
  const bad = await c.call("create_quiz", { courseId: COURSE, name: "x", startDate: "2026-11-02T09:00:00+08:00", endDate: "2026-11-01T09:00:00+08:00" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /endDate is earlier than startDate/);
  const tooMany = await c.call("create_quiz", { courseId: COURSE, name: "x", attemptsAllowed: 11 });
  assert.equal(tooMany.isError, true);
  assert.equal(writes.length, 0);
  await c.close();
});

test("create_quiz tells a caller without a session to sign in and sends nothing", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["politemall"]);
  const r = await c.call("create_quiz", { courseId: COURSE, name: "x" });
  assert.equal(r.isError, true);
  assert.match(r.text, /isn't connected/);
  assert.equal(writes.length, 0);
  await c.close();
});

test("create_quiz reports a permission error for an account that cannot manage quizzes", async (t) => {
  resetD2lVersionCache();
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = String(input);
    if (url.endsWith("/d2l/api/versions/")) return json([{ ProductCode: "le", LatestVersion: "1.100", SupportedVersions: ["1.100"] }, { ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.63"] }]);
    if (url.includes("/enrollments/")) return json({ Access: { IsActive: true, ClasslistRoleName: "Learner" } });
    return new Response("", { status: 403 });
  });
  const c = await connect(["nyp"]);
  const r = await c.call("create_quiz", { courseId: COURSE, name: "x" });
  assert.equal(r.isError, true);
  assert.match(r.text, /403/);
  assert.match(r.text, /permission/);
  await c.close();
});

test("update_quiz reads the quiz, changes only what was passed, and writes the whole quiz back", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const r = await c.call("update_quiz", { courseId: COURSE, quizId: 77, isActive: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PUT");
  assert.equal(writes[0].body.IsActive, true);
  assert.deepEqual(writes[0].body.SubmissionTimeLimit, { IsEnforced: true, ShowClock: true, TimeLimitValue: 20 });
  assert.deepEqual(writes[0].body.Instructions, { Text: { Content: "hi", Type: "Text" }, IsDisplayed: true });
  await c.close();
});

test("update_quiz with no settings, or a missing quiz, writes nothing; a dry run only reads", async (t) => {
  const { writes, reads } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const none = await c.call("update_quiz", { courseId: COURSE, quizId: 77 });
  assert.equal(none.isError, true);
  assert.match(none.text, /at least one setting/);
  assert.equal(reads.length, 0);

  const missing = await c.call("update_quiz", { courseId: COURSE, quizId: 404, isActive: true });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /404/);
  assert.match(missing.text, /quizId/);

  const dry = await c.call("update_quiz", { courseId: COURSE, quizId: 77, dueDate: "2026-12-01T00:00:00Z", dryRun: true });
  assert.equal(dry.isError, false);
  assert.match(dry.text, /"method": "PUT"/);
  assert.equal(writes.length, 0);
  await c.close();
});

test("save_quiz_questions creates questions in order and returns their ids", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(3) });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(writes.map((w) => w.body.QuestionInfo.QuestionText.Content), ["Question 1", "Question 2", "Question 3"]);
  assert.ok(writes.every((w) => w.method === "POST" && /\/5001\/quizzes\/77\/questions\/$/.test(w.url)));
  const out = JSON.parse(r.text);
  assert.deepEqual(out.questions.map((x: any) => x.questionId), [1001, 1002, 1003]);
  await c.close();
});

test("a failure on the 7th of 20 stops there and says what was saved and what was not attempted", async (t) => {
  const { writes } = mockQuizD2l(t, { failQuestionNumber: 7 });
  const c = await connect(["nyp"]);
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(20) });
  assert.equal(r.isError, true);
  assert.equal(writes.length, 7, "nothing is sent after the failure");
  const out = JSON.parse(r.text);
  assert.deepEqual(out.savedSoFar.map((x: any) => x.questionId), [1001, 1002, 1003, 1004, 1005, 1006]);
  assert.equal(out.failed.index, 7);
  assert.deepEqual(out.notAttempted, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  await c.close();
});

test("a rate-limited question is reported and not retried", async (t) => {
  const { writes } = mockQuizD2l(t, { failQuestionNumber: 2, failStatus: 429 });
  const c = await connect(["nyp"]);
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(3) });
  assert.equal(r.isError, true);
  assert.equal(writes.length, 2);
  assert.match(r.text, /not retried/);
  await c.close();
});

test("invalid questions are all reported before anything is sent", async (t) => {
  const { writes, reads } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const noCorrect = { type: "multiple_choice", text: "bad", answers: [{ text: "A", correct: false }, { text: "B", correct: false }] };
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: [mc(1), noCorrect] });
  assert.equal(r.isError, true);
  assert.match(r.text, /question 2: .*exactly one correct answer/);
  const tooMany = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(101) });
  assert.equal(tooMany.isError, true);
  const wrongType = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: [{ type: "essay", text: "x" }] });
  assert.equal(wrongType.isError, true);
  assert.equal(writes.length, 0);
  assert.equal(reads.length, 0);
  await c.close();
});

test("a tenant older than le 1.100 gets an explanation and no question request", async (t) => {
  const { writes } = mockQuizD2l(t, { le: "1.97" });
  const c = await connect(["nyp"]);
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(1) });
  assert.equal(r.isError, true);
  assert.match(r.text, /1\.97/);
  assert.match(r.text, /1\.100/);
  assert.equal(writes.length, 0);
  await c.close();
});

test("a question with a questionId updates it in place, and its type cannot change", async (t) => {
  const { writes } = mockQuizD2l(t, { existing: [{ QuestionId: 900, QuestionTypeId: 1, Points: 1, Name: null, QuestionText: null }] });
  const c = await connect(["nyp"]);
  const ok = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: [{ ...mc(1), questionId: 900 }] });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(writes[0].method, "PUT");
  assert.match(writes[0].url, /\/quizzes\/77\/questions\/900$/);
  assert.equal("QuestionTypeId" in writes[0].body, false, "D2L rejects a QuestionTypeId on update");
  assert.equal(JSON.parse(ok.text).questions[0].action, "updated");

  const wrongType = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: [{ type: "true_false", text: "x", answer: true, questionId: 900 }] });
  assert.equal(wrongType.isError, true);
  assert.match(wrongType.text, /type cannot be changed/);
  const unknown = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: [{ ...mc(1), questionId: 12345 }] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /not in this quiz/);
  assert.equal(writes.length, 1, "only the valid update was sent");
  await c.close();
});

test("save_quiz_questions dry run returns the requests and sends nothing", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const r = await c.call("save_quiz_questions", { courseId: COURSE, quizId: 77, questions: questionsOf(2), dryRun: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(JSON.parse(r.text).wouldSend.length, 2);
  assert.equal(writes.length, 0);
  await c.close();
});

test("call_d2l_operation cannot reach a write route", async (t) => {
  const { writes } = mockQuizD2l(t);
  const c = await connect(["nyp"]);
  const r = await c.call("call_d2l_operation", { operation: "le.quizzes.create", courseId: COURSE });
  assert.equal(r.isError, true);
  assert.match(r.text, /Unknown D2L operation/);
  assert.equal(writes.length, 0);
  await c.close();
});
