import { test } from "node:test";
import assert from "node:assert/strict";
import * as d2l from "./d2l.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Records every URL fetched, and answers from a URL->body map (matched by substring), so each
// test can assert both the request shape and the mapped response shape in one place.
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

test("getRubrics: rubricId mode calls le.rubrics.get with no query string", async (t) => {
  const calls = mockFetch(t, [{ match: "/rubrics/42", body: { RubricId: 42, Name: "Essay Rubric" } }]);
  const result = await d2l.getRubrics("politemall", "cookie", 6606, { rubricId: 42 });
  assert.deepEqual(result, { RubricId: 42, Name: "Essay Rubric" });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/6606\/rubrics\/42$/);
});

test("getRubrics: objectType/objectId mode calls le.rubrics.list with a query string", async (t) => {
  const calls = mockFetch(t, [{ match: "/rubrics/", body: [{ RubricId: 1, Name: "Discussion Rubric" }] }]);
  const result = await d2l.getRubrics("politemall", "cookie", 6606, { objectType: "Discussion", objectId: 999 });
  assert.deepEqual(result, [{ RubricId: 1, Name: "Discussion Rubric" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/6606\/rubrics\/\?objectType=Discussion&objectId=999/);
});

test("getRubrics: neither rubricId nor objectType/objectId throws without any network call", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(() => d2l.getRubrics("politemall", "cookie", 6606, {}));
  assert.equal(calls.length, 0);
});

test("getAllFinalGrades: maps embedded User/GradeValue entries, no separate classlist call needed", async (t) => {
  mockFetch(t, [
    {
      match: "/grades/final/values/",
      body: {
        Next: null,
        Objects: [
          { User: { Identifier: "111", DisplayName: "Alice Tan" }, GradeValue: { DisplayedGrade: "85%", PointsNumerator: 85, PointsDenominator: 100 } },
          { User: { Identifier: "222", DisplayName: "Bob Lim" }, GradeValue: null },
        ],
      },
    },
  ]);
  const result = await d2l.getAllFinalGrades("politemall", "cookie", 6606);
  assert.deepEqual(result, [
    { userId: "111", studentName: "Alice Tan", displayedGrade: "85%", pointsNumerator: 85, pointsDenominator: 100 },
    { userId: "222", studentName: "Bob Lim", displayedGrade: null, pointsNumerator: null, pointsDenominator: null },
  ]);
});

test("getMyDropboxSubmission: maps status/feedback/submissions", async (t) => {
  mockFetch(t, [
    {
      match: "/submissions/mysubmissions/",
      body: [
        {
          Status: 2,
          CompletionDate: "2026-01-01T00:00:00Z",
          Feedback: { Score: 9, Feedback: { Text: "Great work", Html: "<p>Great work</p>" }, IsGraded: true },
          Submissions: [{ Id: 1, SubmittedBy: 111, SubmissionDate: "2025-12-30T00:00:00Z", Comment: null, Files: [{ FileId: 1, FileName: "essay.pdf", Size: 100 }] }],
        },
      ],
    },
  ]);
  const result = await d2l.getMyDropboxSubmission("politemall", "cookie", 6606, 555);
  assert.deepEqual(result, [
    {
      status: 2,
      completionDate: "2026-01-01T00:00:00Z",
      score: 9,
      isGraded: true,
      feedbackText: "Great work",
      submissions: [{ submittedDate: "2025-12-30T00:00:00Z", comment: null, files: ["essay.pdf"] }],
    },
  ]);
});

test("getSurveyResults: filters by studentUserId and joins classlist names", async (t) => {
  mockFetch(t, [
    { match: "/attempts/?userId=111", body: { Next: null, Objects: [{ AttemptId: 1, SurveyId: 33, UserId: 111, AttemptNumber: 1, Started: "s", Completed: "c" }] } },
    { match: "/classlist/", body: [{ Identifier: "111", DisplayName: "Alice Tan", Username: null, Email: null, RoleId: null, ClasslistRoleDisplayName: "Learner" }] },
  ]);
  const result = await d2l.getSurveyResults("politemall", "cookie", 6606, 33, "111");
  assert.deepEqual(result, [{ attemptId: 1, userId: "111", studentName: "Alice Tan", attemptNumber: 1, started: "s", completed: "c" }]);
});

test("getMyCalendarEvents: builds orgUnitIdsCSV from the caller's own courses", async (t) => {
  const calls = mockFetch(t, [
    {
      match: "/enrollments/myenrollments/",
      body: { PagingInfo: { Bookmark: null, HasMoreItems: false }, Items: [{ OrgUnit: { Id: 6606, Type: { Id: 3 }, Name: "Course A", Code: "A" }, Access: { IsActive: true, StartDate: null, EndDate: null, LastAccessed: null } }] },
    },
    { match: "/calendar/events/myEvents/", body: { Next: null, Objects: [{ CalendarEventId: 1, Title: "Lecture", StartDateTime: "s", EndDateTime: "e", OrgUnitName: "Course A" }] } },
  ]);
  const result = await d2l.getMyCalendarEvents("politemall", "cookie", "2026-01-01", "2026-02-01");
  assert.deepEqual(result, [{ school: "politemall", eventId: 1, title: "Lecture", startDateTime: "s", endDateTime: "e", orgUnitName: "Course A" }]);
  const calendarCall = calls.find((c) => c.includes("/calendar/events/myEvents/"));
  assert.match(calendarCall!, /orgUnitIdsCSV=6606/);
  assert.match(calendarCall!, /startDateTime=2026-01-01/);
});

test("getMyCalendarEvents: no enrolled courses returns an empty array without calling the calendar route", async (t) => {
  const calls = mockFetch(t, [{ match: "/enrollments/myenrollments/", body: { PagingInfo: { Bookmark: null, HasMoreItems: false }, Items: [] } }]);
  const result = await d2l.getMyCalendarEvents("politemall", "cookie", "2026-01-01", "2026-02-01");
  assert.deepEqual(result, []);
  assert.ok(!calls.some((c) => c.includes("/calendar/")));
});

test("getOverdueItems: maps items with no query string required", async (t) => {
  const calls = mockFetch(t, [{ match: "/overdueItems/myItems", body: { Next: null, Objects: [{ OrgUnitId: "6606", ItemId: 1, ItemName: "Reading", DueDate: "d" }] } }]);
  const result = await d2l.getOverdueItems("politemall", "cookie");
  assert.deepEqual(result, [{ school: "politemall", orgUnitId: "6606", itemId: 1, itemName: "Reading", dueDate: "d" }]);
  assert.ok(!calls[0].includes("?"));
});
