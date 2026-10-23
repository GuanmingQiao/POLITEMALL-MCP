import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuizPatch,
  buildQuestion,
  buildQuizCreateBody,
  checkQuestion,
  checkSettings,
  questionSchema,
  supportsQuestionWrites,
  suppliedSettings,
  toWriteModel,
  type QuestionInput,
} from "../../src/api/quiz-authoring.js";

// spec: quiz-authoring-tools. Shapes follow the Valence docs; replace the expectations with the
// recorded live bodies once task 1.1 of add-quiz-write-tools has been done.

const q = (input: unknown) => questionSchema.parse(input);
const info = (built: Record<string, unknown>) => built.QuestionInfo as Record<string, any>;

test("a quiz is created hidden with no limits unless told otherwise", () => {
  const body = buildQuizCreateBody("Week 1", {});
  assert.equal(body.IsActive, false);
  assert.equal(body.NumberOfAttemptsAllowed, null);
  assert.deepEqual(body.SubmissionTimeLimit, { IsEnforced: false, ShowClock: true, TimeLimitValue: 0 });
  assert.equal(body.StartDate, null);
});

test("settings map to D2L fields and dates are sent in UTC", () => {
  const body = buildQuizCreateBody("Week 1", {
    isActive: true,
    attemptsAllowed: 2,
    timeLimitMinutes: 30,
    dueDate: "2026-11-02T09:00:00+08:00",
    shuffleQuestions: true,
    instructions: "Answer all",
  });
  assert.equal(body.IsActive, true);
  assert.equal(body.NumberOfAttemptsAllowed, 2);
  assert.deepEqual(body.SubmissionTimeLimit, { IsEnforced: true, ShowClock: true, TimeLimitValue: 30 });
  assert.equal(body.DueDate, "2026-11-02T01:00:00.000Z");
  assert.equal(body.Shuffle, true);
  assert.deepEqual(body.Instructions, { Text: { Content: "Answer all", Type: "Text" }, IsDisplayed: true });
});

test("cross-field rules reject an end before the start", () => {
  assert.deepEqual(checkSettings({ startDate: "2026-11-02T09:00:00+08:00", endDate: "2026-11-01T09:00:00+08:00" }), ["endDate is earlier than startDate"]);
  assert.deepEqual(checkSettings({ startDate: "2026-11-01T09:00:00+08:00", endDate: "2026-11-02T09:00:00+08:00" }), []);
});

test("attempts above 10 are not accepted by the settings schema", async () => {
  const { quizSettingsShape } = await import("../../src/api/quiz-authoring.js");
  assert.equal(quizSettingsShape.attemptsAllowed.safeParse(11).success, false);
  assert.equal(quizSettingsShape.attemptsAllowed.safeParse(10).success, true);
  assert.equal(quizSettingsShape.attemptsAllowed.safeParse(null).success, true);
});

const READ_QUIZ = {
  QuizId: 7,
  Name: "Old name",
  IsActive: true,
  SortOrder: 3,
  Instructions: { Text: { Text: "plain", Html: "<p>plain</p>" }, IsDisplayed: true },
  Description: { Text: { Text: "", Html: "" }, IsDisplayed: false },
  Header: { Text: { Text: "", Html: "" }, IsDisplayed: false },
  Footer: { Text: { Text: "", Html: "" }, IsDisplayed: false },
  StartDate: "2026-10-01T00:00:00.000Z",
  EndDate: null,
  DueDate: "2026-10-20T00:00:00.000Z",
  AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 3 },
  SubmissionTimeLimit: { IsEnforced: true, ShowClock: false, TimeLimitValue: 45 },
  Shuffle: true,
  PasswordProtected: true,
  CalcTypeId: 3,
};

test("converting a read quiz drops read-only fields and keeps the rest", () => {
  const w = toWriteModel(READ_QUIZ);
  assert.equal("QuizId" in w, false);
  assert.equal("PasswordProtected" in w, false);
  assert.equal(w.Name, "Old name");
  assert.equal(w.CalcTypeId, 3);
  assert.deepEqual(w.Instructions, { Text: { Content: "<p>plain</p>", Type: "Html" }, IsDisplayed: true });
});

test("attempts are read as an object and written back as a number, null when unlimited", () => {
  assert.equal(toWriteModel(READ_QUIZ).NumberOfAttemptsAllowed, 3);
  assert.equal(toWriteModel({ ...READ_QUIZ, AttemptsAllowed: { IsUnlimited: true, NumberOfAttemptsAllowed: 0 } }).NumberOfAttemptsAllowed, null);
});

test("updating only the due date leaves every other setting as it was", () => {
  const before = toWriteModel(READ_QUIZ);
  const after = applyQuizPatch(before, undefined, { dueDate: "2026-12-01T00:00:00Z" });
  assert.equal(after.DueDate, "2026-12-01T00:00:00.000Z");
  assert.deepEqual({ ...after, DueDate: before.DueDate }, before);
});

test("changing the time limit keeps the clock setting; clearing it removes the limit", () => {
  const before = toWriteModel(READ_QUIZ);
  assert.deepEqual(applyQuizPatch(before, undefined, { timeLimitMinutes: 60 }).SubmissionTimeLimit, { IsEnforced: true, ShowClock: false, TimeLimitValue: 60 });
  assert.deepEqual(applyQuizPatch(before, undefined, { timeLimitMinutes: null }).SubmissionTimeLimit, { IsEnforced: false, ShowClock: false, TimeLimitValue: 0 });
  assert.equal(applyQuizPatch(before, undefined, { attemptsAllowed: null }).NumberOfAttemptsAllowed, null);
});

test("an empty patch supplies no settings", () => {
  assert.deepEqual(suppliedSettings({}), []);
  assert.deepEqual(suppliedSettings({ isActive: false }), ["isActive"]);
});

test("multiple choice: only the correct answer earns the points; text is plain by default", () => {
  const built = buildQuestion(q({ type: "multiple_choice", text: "2 < 3 <b>?</b>", answers: [{ text: "yes", correct: true }, { text: "no", correct: false, feedback: "Look again" }] }));
  assert.equal(built.QuestionTypeId, 1);
  assert.equal(built.Points, 1);
  assert.deepEqual(info(built).QuestionText, { Content: "2 < 3 <b>?</b>", Type: "Text" });
  assert.deepEqual(info(built).Answers.map((a: any) => a.Weight), [1, 0]);
  assert.deepEqual(info(built).Answers[1].AnswerFeedback, { Content: "Look again", Type: "Text" });
});

test("html text is opt-in", () => {
  const built = buildQuestion(q({ type: "true_false", text: "<i>x</i>", textFormat: "html", answer: true, points: 2 }));
  assert.equal(built.QuestionTypeId, 2);
  assert.equal(built.Points, 2);
  assert.deepEqual(info(built).QuestionText, { Content: "<i>x</i>", Type: "Html" });
  assert.equal(info(built).IsTrue, true);
});

test("multiple choice needs exactly one correct answer, multi select at least one", () => {
  const mc = (flags: boolean[]) => q({ type: "multiple_choice", text: "t", answers: flags.map((correct, i) => ({ text: `a${i}`, correct })) }) as QuestionInput;
  assert.match(checkQuestion(mc([false, false]))[0], /exactly one correct answer, this has 0/);
  assert.match(checkQuestion(mc([true, true]))[0], /this has 2/);
  assert.deepEqual(checkQuestion(mc([true, false])), []);
  const ms = (flags: boolean[]) => q({ type: "multi_select", text: "t", answers: flags.map((correct, i) => ({ text: `a${i}`, correct })) }) as QuestionInput;
  assert.match(checkQuestion(ms([false, false]))[0], /at least one/);
  assert.deepEqual(checkQuestion(ms([true, true])), []);
});

test("matching builds one choice per distinct text, with distractors as extra choices", () => {
  const built = buildQuestion(q({ type: "matching", text: "Match", pairs: [{ prompt: "H2O", match: "Water" }, { prompt: "Aqua", match: "Water" }, { prompt: "NaCl", match: "Salt" }], distractors: ["Sugar", "Salt"] }));
  const i = info(built);
  assert.deepEqual(i.Choices.map((c: any) => c.Choice.Content), ["Water", "Salt", "Sugar"]);
  assert.deepEqual(i.Prompts.map((p: any) => p.CorrectChoiceId), ["c1", "c1", "c2"]);
});

test("matching with two pairs and two distractors offers four choices", () => {
  const built = buildQuestion(q({ type: "matching", text: "m", pairs: [{ prompt: "a", match: "A" }, { prompt: "b", match: "B" }], distractors: ["X", "Y"] }));
  assert.equal(info(built).Choices.length, 4);
});

test("short answer, ordering and written response", () => {
  const sa = buildQuestion(q({ type: "short_answer", text: "Capital of France?", answers: ["Paris", "paris"] }));
  assert.equal(sa.QuestionTypeId, 8);
  assert.deepEqual(info(sa).Blanks[0].Answers, ["Paris", "paris"]);
  const ord = buildQuestion(q({ type: "ordering", text: "Sort", items: ["one", "two", "three"] }));
  assert.equal(ord.QuestionTypeId, 6);
  assert.deepEqual(info(ord).Items.map((x: any) => x.Item.Content), ["one", "two", "three"]);
  const wr = buildQuestion(q({ type: "written_response", text: "Discuss", answerKey: "Key points" }));
  assert.equal(wr.QuestionTypeId, 7);
  assert.deepEqual(info(wr).AnswerKey, { Content: "Key points", Type: "Text" });
});

test("no question body contains a null, which D2L rejects with a JSON binding error", () => {
  const all = [
    { type: "multiple_choice", text: "t", answers: [{ text: "a", correct: true }, { text: "b", correct: false }] },
    { type: "true_false", text: "t", answer: false },
    { type: "multi_select", text: "t", answers: [{ text: "a", correct: true }, { text: "b", correct: false }] },
    { type: "short_answer", text: "t", answers: ["x"] },
    { type: "written_response", text: "t" },
    { type: "matching", text: "t", pairs: [{ prompt: "a", match: "A" }, { prompt: "b", match: "B" }] },
    { type: "ordering", text: "t", items: ["a", "b"] },
  ];
  for (const question of all) {
    assert.doesNotMatch(JSON.stringify(buildQuestion(q(question))), /null/, question.type);
  }
});

test("an unsupported question type is rejected with the supported list", () => {
  const r = questionSchema.safeParse({ type: "essay", text: "x" });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /multiple_choice/);
});

test("question writes need le 1.100 or newer, compared numerically", () => {
  assert.equal(supportsQuestionWrites("1.97"), false);
  assert.equal(supportsQuestionWrites("1.99"), false);
  assert.equal(supportsQuestionWrites("1.100"), true);
  assert.equal(supportsQuestionWrites("1.110"), true);
});
