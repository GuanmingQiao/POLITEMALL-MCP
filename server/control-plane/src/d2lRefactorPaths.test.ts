import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveD2lPath, resolveD2lQuery } from "./d2l.js";

// spec: d2l-mcp-tool-surface — "Existing tools are behavior-preserving"
//
// Pins resolveD2lPath's output against the exact hardcoded template-literal paths the
// pre-refactor code used, for every LE-scoped tool wrapper that moved onto the catalog in
// task 3.1. If this drifts, an existing tool's request path silently changed.

const LE = "/d2l/api/le/1.9";
const numericId = 6606;

test("existing-tool path parity: get_course_content", () => {
  assert.equal(resolveD2lPath("le.content.toc", {}, numericId), `${LE}/${numericId}/content/toc`);
});

test("existing-tool path parity: get_grades", () => {
  assert.equal(resolveD2lPath("le.grades.definitionsList", {}, numericId), `${LE}/${numericId}/grades/`);
  assert.equal(resolveD2lPath("le.grades.myValues", {}, numericId), `${LE}/${numericId}/grades/values/myGradeValues/`);
});

test("existing-tool path parity: get_class_grades", () => {
  assert.equal(resolveD2lPath("le.grades.definitionsList", {}, numericId), `${LE}/${numericId}/grades/`);
  assert.equal(resolveD2lPath("le.grades.valuesAll", {}, numericId), `${LE}/${numericId}/grades/values/`);
});

test("existing-tool path parity: get_announcements / get_calendar_events / get_assignments", () => {
  assert.equal(resolveD2lPath("le.news.list", {}, numericId), `${LE}/${numericId}/news/`);
  assert.equal(resolveD2lPath("le.calendar.list", {}, numericId), `${LE}/${numericId}/calendar/events/`);
  assert.equal(resolveD2lPath("le.dropbox.foldersList", {}, numericId), `${LE}/${numericId}/dropbox/folders/`);
});

test("existing-tool path parity: get_dropbox_submissions", () => {
  const folderId = 555;
  assert.equal(
    resolveD2lPath("le.dropbox.submissionsPaged", { folderId }, numericId),
    `${LE}/${numericId}/dropbox/folders/${folderId}/submissions/paged/`
  );
});

test("existing-tool path parity: get_quizzes / get_quiz_attempts", () => {
  const quizId = 77;
  assert.equal(resolveD2lPath("le.quizzes.list", {}, numericId), `${LE}/${numericId}/quizzes/`);
  assert.equal(resolveD2lPath("le.quizzes.attempts", { quizId }, numericId), `${LE}/${numericId}/quizzes/${quizId}/attempts/`);
});

test("existing-tool path parity: get_quiz_results with and without studentUserId", () => {
  const quizId = 77;
  const basePath = resolveD2lPath("le.quizzes.attempts", { quizId }, numericId);
  assert.equal(basePath, `${LE}/${numericId}/quizzes/${quizId}/attempts/`);
  const qs = resolveD2lQuery("le.quizzes.attempts", { userId: "42" });
  assert.equal(basePath + qs, `${LE}/${numericId}/quizzes/${quizId}/attempts/?userId=42`);
  assert.equal(basePath + "", `${LE}/${numericId}/quizzes/${quizId}/attempts/`);
});

test("existing-tool path parity: get_discussion_forums / topics / posts", () => {
  const forumId = 11;
  const topicId = 22;
  assert.equal(resolveD2lPath("le.discussions.forumsList", {}, numericId), `${LE}/${numericId}/discussions/forums/`);
  assert.equal(
    resolveD2lPath("le.discussions.topicsList", { forumId }, numericId),
    `${LE}/${numericId}/discussions/forums/${forumId}/topics/`
  );
  assert.equal(
    resolveD2lPath("le.discussions.postsList", { forumId, topicId }, numericId),
    `${LE}/${numericId}/discussions/forums/${forumId}/topics/${topicId}/posts/`
  );
});

test("existing-tool path parity: get_classlist", () => {
  assert.equal(resolveD2lPath("le.classlist.list", {}, numericId), `${LE}/${numericId}/classlist/`);
});

test("existing-tool path parity: get_surveys / get_survey_attempts", () => {
  const surveyId = 33;
  assert.equal(resolveD2lPath("le.surveys.list", {}, numericId), `${LE}/${numericId}/surveys/`);
  assert.equal(resolveD2lPath("le.surveys.attempts", { surveyId }, numericId), `${LE}/${numericId}/surveys/${surveyId}/attempts/`);
});

test("existing-tool path parity: get_due_items (cross-org, no orgUnitId)", () => {
  assert.equal(resolveD2lPath("le.content.global.myItemsCompletionsDue", {}), `${LE}/content/myItems/completions/due/`);
});
