import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare, enrollment } from "../helpers/mcp-harness.js";
import { gradebookOnlyItems, mapQuiz, type QuizData } from "../../src/tools/get-assignments.js";

const BASE = "https://nyplms.polite.edu.sg";

// Shaped like real NYP answers (see the dropbox folder / mysubmissions / quiz / grade objects).
const FOLDERS = [
  {
    Id: 808471, Name: "Submission of Completion Certificate", IsHidden: false, GradeItemId: null, GroupTypeId: null, Attachments: [],
    CustomInstructions: { Text: "Upload your certificate.", Html: "<p>Upload your <b>certificate</b>.</p>" },
    DueDate: null, Assessment: { ScoreDenominator: null, Rubrics: [] },
  },
  {
    Id: 900001, Name: "Essay", IsHidden: false, GradeItemId: 21, GroupTypeId: 5, Attachments: [{ FileId: 7, FileName: "brief.pdf", Size: 999 }],
    CustomInstructions: { Text: "", Html: "" }, DueDate: "2026-10-01T04:00:00.000Z",
    Assessment: { ScoreDenominator: 40, Rubrics: [{ Name: "Essay rubric", Criteria: [{ Name: "Argument", Levels: [{ Name: "Good", Points: 10, Description: { Text: "Clear", Html: "" } }] }] }] },
  },
  { Id: 900002, Name: "Secret", IsHidden: true, GradeItemId: null, GroupTypeId: null, Attachments: [], CustomInstructions: null, DueDate: null, Assessment: null },
];
const MINE: Record<number, unknown> = {
  808471: [{ Status: 1, Feedback: null, Submissions: [
    { SubmissionDate: "2026-09-01T00:00:00Z", Comment: null, Files: [{ FileId: 1, FileName: "old.pdf", Size: 1 }] },
    { SubmissionDate: "2026-09-10T00:00:00Z", Comment: { Text: "final", Html: "" }, Files: [{ FileId: 5, FileName: "cert.pdf", Size: 1234 }] },
  ] }],
  900001: [{ Status: 3, Feedback: { Score: 33, IsGraded: true, Feedback: { Text: "Nice", Html: "<p>Nice <i>work</i></p>" } }, Submissions: [] }],
};
const QUIZZES = [
  { QuizId: 11, Name: "Quiz A", IsActive: true, GradeItemId: 22, DueDate: "2026-09-25T00:00:00.000Z", StartDate: null, EndDate: null, SubmissionGracePeriod: 5, Password: null,
    AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 2 }, SubmissionTimeLimit: { IsEnforced: true, TimeLimitValue: 30 },
    Description: { Text: { Text: "Unit 3 quiz", Html: "<p>Unit 3 <b>quiz</b></p>" } } },
  { QuizId: 12, Name: "Quiz B (inactive)", IsActive: false, AttemptsAllowed: null, DueDate: null, StartDate: null, EndDate: null, Description: null },
  { QuizId: 13, Name: "Quiz C", IsActive: true, GradeItemId: null, DueDate: null, StartDate: null, EndDate: null, Password: "pw", SubmissionGracePeriod: null,
    AttemptsAllowed: { IsUnlimited: true, NumberOfAttemptsAllowed: null }, SubmissionTimeLimit: { IsEnforced: false, TimeLimitValue: 0 }, Description: { Text: "flat text" } },
];
const GRADES = [
  { Id: 21, Name: "Essay column", MaxPoints: 40, GradeType: "Numeric", AssociatedTool: null, IsHidden: false }, // explained by folder.GradeItemId
  { Id: 22, Name: "Quiz A column", MaxPoints: 10, GradeType: "Numeric", AssociatedTool: null, IsHidden: false }, // explained by quiz.GradeItemId
  { Id: 23, Name: "In-class test", MaxPoints: 50, GradeType: "Numeric", AssociatedTool: null, IsHidden: false },
  { Id: 24, Name: "Weighted total", MaxPoints: 100, GradeType: "Calculated", AssociatedTool: null, IsHidden: false },
  { Id: 25, Name: "Hidden column", MaxPoints: 5, GradeType: "Numeric", AssociatedTool: null, IsHidden: true },
];

const page = (objects: unknown[]) => json({ Objects: objects, Next: null });

function serve(t: import("node:test").TestContext, over: (url: string) => Response | undefined = () => undefined) {
  return mockD2l(t, (url) => {
    const o = over(url);
    if (o) return o;
    if (url.endsWith("/973535/dropbox/folders/")) return json(FOLDERS);
    const m = /\/dropbox\/folders\/(\d+)\/submissions\/mysubmissions\//.exec(url);
    if (m) return json(MINE[Number(m[1])] ?? []);
    if (url.endsWith("/973535/quizzes/")) return page(QUIZZES);
    if (url.includes("/quizzes/") && url.includes("/attempts/")) return bare(403);
    if (url.endsWith("/973535/grades/")) return json(GRADES);
  });
}

test("one course: dropbox, quizzes and gradebook-only rows in one list, soonest due first", async (t) => {
  serve(t);
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignments", { courseId: "nyp:973535" });
  assert.equal(r.isError, false, r.text);
  const body = JSON.parse(r.text);
  const names = body.assignments.map((a: { name: string }) => a.name);
  // Quiz A (due 25 Sep) before Essay (due 1 Oct); the undated ones follow in fetch order.
  assert.deepEqual(names, ["Quiz A", "Essay", "Submission of Completion Certificate", "Quiz C", "In-class test"]);
  assert.ok(!names.includes("Secret"), "hidden folders are dropped");
  assert.ok(!names.includes("Quiz B (inactive)"), "inactive quizzes are dropped");
  assert.ok(!names.includes("Essay column") && !names.includes("Quiz A column"), "columns explained by an assignment/quiz are not repeated");
  assert.ok(!names.includes("Weighted total") && !names.includes("Hidden column"));
  await c.close();
});

test("an assignment carries instructions, rubric, latest submission, status and deep link", async (t) => {
  serve(t);
  const c = await connect(["nyp"]);
  const body = JSON.parse((await c.call("get_assignments", { courseId: "nyp:973535" })).text);
  const cert = body.assignments.find((a: { id: number }) => a.id === 808471);
  assert.equal(cert.type, "assignment");
  assert.equal(cert.instructions, "Upload your **certificate**.");
  assert.equal(cert.submissionStatus, "submitted");
  assert.equal(cert.submission.submittedDate, "2026-09-10T00:00:00Z", "the latest of several submissions");
  assert.deepEqual(cert.submission.files, [{ name: "cert.pdf", size: 1234, fileId: 5 }]);
  assert.equal(cert.submission.comment, "final");
  assert.equal(cert.isGroup, false);
  assert.equal(cert.url, `${BASE}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=973535`);
  assert.ok(!("rubric" in cert) && !("attachmentCount" in cert));

  const essay = body.assignments.find((a: { id: number }) => a.id === 900001);
  assert.equal(essay.points, 40);
  assert.equal(essay.isGroup, true);
  assert.equal(essay.attachmentCount, 1, "points the agent at get_assignment_files");
  assert.equal(essay.rubric[0].criteria[0].levels[0].points, 10);
  assert.equal(essay.submissionStatus, "feedback published");
  assert.deepEqual(essay.feedback, { score: 33, feedback: "Nice _work_" });
  await c.close();
});

test("quiz attempts the tenant refuses are reported as unavailable, and asked for only once", async (t) => {
  const seen = serve(t);
  const c = await connect(["nyp"]);
  const body = JSON.parse((await c.call("get_assignments", { courseId: "nyp:973535" })).text);
  const quizA = body.assignments.find((a: { id: number }) => a.id === 11);
  assert.equal(quizA.attemptsAvailable, false);
  assert.equal(quizA.attemptsUsed, null);
  assert.equal(quizA.attemptsRemaining, null);
  assert.equal(quizA.timeLimitMinutes, 30);
  assert.equal(quizA.attemptsAllowed, 2);
  assert.equal(quizA.instructions, "Unit 3 **quiz**");
  const quizC = body.assignments.find((a: { id: number }) => a.id === 13);
  assert.equal(quizC.hasPassword, true);
  assert.equal(quizC.attemptsAllowed, "Unlimited");
  assert.equal(quizC.instructions, "flat text");
  assert.equal(seen.filter((u) => u.includes("/attempts/")).length, 1, "the second active quiz isn't asked once the first proved 403");
  await c.close();
});

test("mapQuiz does attempt accounting when attempts are readable", () => {
  const quiz = QUIZZES[0] as unknown as QuizData;
  const two = mapQuiz(quiz, [{ IsCompleted: true, Score: 6 }, { Completed: "2026-09-02T00:00:00Z", Score: 8 }], BASE, 1);
  assert.equal(two.attemptsUsed, 2);
  assert.equal(two.attemptsRemaining, 0);
  assert.equal(two.attemptWarning, "No attempts remaining");
  assert.equal(two.bestScore, 8);
  const one = mapQuiz(quiz, [{ IsCompleted: true, Score: 5 }, { IsCompleted: false }], BASE, 1);
  assert.equal(one.attemptsRemaining, 1);
  assert.equal(one.attemptWarning, "Only 1 attempt remaining");
  const none = mapQuiz(quiz, [], BASE, 1);
  assert.equal(none.attemptsAvailable, true, "zero attempts is a measurement, not 'unknown'");
  assert.equal(none.bestScore, null);
});

test("gradebookOnlyItems skips hidden, calculated, and columns explained by a fetched item", () => {
  const rows = gradebookOnlyItems(GRADES, { ids: new Set([11]), gradeItemIds: new Set([21, 22]) }, BASE, 973535);
  assert.deepEqual(rows.map((r) => r.name), ["In-class test"]);
  assert.equal(rows[0].type, "gradeOnly");
  assert.equal(rows[0].url, `${BASE}/d2l/lms/grades/my_grades/main.d2l?ou=973535`);
  const viaTool = gradebookOnlyItems([{ Id: 30, Name: "Linked", MaxPoints: 1, GradeType: "Numeric", AssociatedTool: { ToolId: 2000, ToolItemId: 11 } }], { ids: new Set([11]), gradeItemIds: new Set() }, BASE, 1);
  assert.equal(viaTool.length, 0, "linked to a fetched quiz through AssociatedTool");
});

test("if submissions can't be read the status is null (unknown), with a warning — not 'not submitted'", async (t) => {
  serve(t, (url) => (url.includes("/mysubmissions/") ? bare(500) : undefined));
  const c = await connect(["nyp"]);
  const body = JSON.parse((await c.call("get_assignments", { courseId: "nyp:973535" })).text);
  const cert = body.assignments.find((a: { id: number }) => a.id === 808471);
  assert.equal(cert.submissionStatus, null);
  assert.match(body.warnings.join(" "), /submission status could not be read/);
  await c.close();
});

test("a course where every list is refused is an error that names the role, not an empty result", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/enrollments/myenrollments/973535")) return enrollment("Learner");
    if (url.includes("/dropbox/folders/") || url.includes("/quizzes/")) return bare(403);
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignments", { courseId: "nyp:973535" });
  assert.equal(r.isError, true);
  assert.match(r.text, /Your role in this course is "Learner"/);
  await c.close();
});

const enrollments = (items: { id: number; active: boolean }[]) =>
  json({ PagingInfo: { Bookmark: null, HasMoreItems: false }, Items: items.map((i) => ({ OrgUnit: { Id: i.id, Type: { Id: 3 }, Name: `Course ${i.id}`, Code: `C${i.id}` }, Access: { IsActive: i.active, StartDate: null, EndDate: null, LastAccessed: null } })) });

test("all courses: lists courses that have work, counts the empty ones, skips inactive and names unreadable ones", async (t) => {
  const seen = mockD2l(t, (url) => {
    if (url.includes("/enrollments/myenrollments/?")) return enrollments([{ id: 973535, active: true }, { id: 111, active: false }, { id: 222, active: true }, { id: 333, active: true }]);
    if (url.includes("/973535/")) {
      if (url.endsWith("/dropbox/folders/")) return json(FOLDERS);
      if (url.includes("/mysubmissions/")) return json([]);
      if (url.endsWith("/quizzes/")) return page([]);
      if (url.endsWith("/grades/")) return json([]);
    }
    if (url.includes("/222/")) return bare(403);
    if (url.includes("/333/")) {
      if (url.endsWith("/dropbox/folders/") || url.endsWith("/grades/")) return json([]);
      if (url.endsWith("/quizzes/")) return page([]);
    }
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignments");
  assert.equal(r.isError, false, r.text);
  const body = JSON.parse(r.text);
  assert.deepEqual(body.courses.map((x: { courseId: string }) => x.courseId), ["nyp:973535"]);
  assert.equal(body.courses[0].courseName, "Course 973535");
  assert.equal(body.coursesWithoutAssignments, 1, "course 333 has none");
  assert.match(body.skippedCourses[0], /nyp:222.*403/);
  assert.ok(!seen.some((u) => u.includes("/111/")), "inactive course not requested");
  await c.close();
});

test("all courses: an error only when every connected school failed", async (t) => {
  mockD2l(t, () => bare(500));
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignments");
  assert.equal(r.isError, true);
  assert.match(r.text, /nyp: .*HTTP 500/);
  await c.close();
});
