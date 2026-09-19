import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import * as d2l from "./d2l.js";
import {
  SessionExpiredError as D2LSessionExpiredError,
  PermissionDeniedError as D2LPermissionDeniedError,
  NotFoundError as D2LNotFoundError,
  D2lHttpError,
  type D2LSchool,
} from "./d2l.js";
import { D2lVersionDiscoveryError } from "./d2lVersions.js";
import { describeD2lFailure } from "./d2lErrors.js";
import * as step from "./step.js";
import { SessionExpiredError as StepSessionExpiredError } from "./step.js";
import { connectedSchools, getCookieHeader } from "./tokenStore.js";
import * as catalog from "./catalog.js";
import { D2L_ROUTE_CATALOG, getRouteDescriptor } from "./d2lRouteCatalog.js";

const D2L_SCHOOLS: D2LSchool[] = ["politemall", "nyp"];

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function connectUrl(): string {
  return `${config.publicOrigin}/connect`;
}

// Turns a failed D2L call into a message an agent can act on, or undefined if `err` isn't a
// D2L/session/version failure (a genuine bug — let it propagate). For 403/404 on a course-scoped
// call it also asks D2L for the caller's own enrollment: the HTTP status alone can't tell "not in
// this course" from "in it, but lacking permission / item missing / tool off".
async function explainD2lError(err: unknown, school: D2LSchool, cookieHeader: string, courseId?: string): Promise<string | undefined> {
  if (err instanceof D2LSessionExpiredError) {
    return `Your ${school} session expired — reconnect it at ${connectUrl()}.`;
  }
  if (err instanceof D2lVersionDiscoveryError) {
    return `Couldn't determine which D2L API version ${school} supports right now (${err.message}). This is temporary — try again shortly.`;
  }
  if (err instanceof D2lHttpError) {
    console.warn(`D2L ${err.status} for ${school} ${err.route}${err.detail ? ` (${err.detail})` : ""}`);
    let access;
    if (courseId && (err instanceof D2LPermissionDeniedError || err instanceof D2LNotFoundError)) {
      try {
        access = await d2l.getCourseAccess(school, cookieHeader, d2l.parseCourseId(courseId).numericId);
      } catch {
        // Diagnosis is best-effort; fall back to the status-only message.
      }
    }
    return describeD2lFailure(err, { school, courseId, access });
  }
  return undefined;
}

// Runs fn against every D2L school (politemall/nyp) the token has a saved cookie
// for, merging results. One school failing (expired session, a route that school's D2L rejects,
// an outage) doesn't fail the whole call — it's reported as a warning next to whatever data the
// other school(s) returned. `failed` counts schools that produced no data at all.
async function runAcrossD2LSchools<T>(
  token: string,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>
): Promise<{ results: T[]; warnings: string[]; attempted: number; failed: number }> {
  const schools = connectedSchools(token).filter((s): s is D2LSchool => s === "politemall" || s === "nyp");
  if (schools.length === 0) {
    return { results: [], warnings: [`No school connected yet. Connect at least one at ${connectUrl()}.`], attempted: 0, failed: 0 };
  }

  const results: T[] = [];
  const warnings: string[] = [];
  let attempted = 0;
  let failed = 0;
  for (const school of schools) {
    const cookieHeader = getCookieHeader(token, school);
    if (!cookieHeader) continue;
    attempted++;
    try {
      results.push(...(await fn(school, cookieHeader)));
    } catch (err) {
      const message = await explainD2lError(err, school, cookieHeader);
      if (message === undefined) throw err;
      failed++;
      warnings.push(`${school}: ${message}`);
    }
  }
  return { results, warnings, attempted, failed };
}

// Wraps a cross-school tool's output. If every connected school failed there is no data to
// return, so that is an error rather than a success carrying only warnings.
async function acrossSchoolsResult<T>(
  token: string,
  key: string,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>
) {
  const { results, warnings, attempted, failed } = await runAcrossD2LSchools(token, fn);
  if (attempted > 0 && failed === attempted) return errorResult(warnings.join("\n"));
  return toolResult({ [key]: results, warnings: warnings.length ? warnings : undefined });
}

// Single-course D2L tools resolve which school a "school:numericId" courseId
// belongs to and use that school's cookie only.
async function runForD2LCourse<T>(
  token: string,
  courseId: string,
  fn: (school: D2LSchool, cookieHeader: string, numericId: number) => Promise<T>
) {
  const { school, numericId } = d2l.parseCourseId(courseId);
  const cookieHeader = getCookieHeader(token, school);
  if (!cookieHeader) {
    return errorResult(`Your ${school} session isn't connected. Connect it at ${connectUrl()}.`);
  }
  try {
    return toolResult(await fn(school, cookieHeader, numericId));
  } catch (err) {
    const message = await explainD2lError(err, school, cookieHeader, courseId);
    if (message === undefined) throw err;
    return errorResult(message);
  }
}

async function runStep<T>(token: string, fn: (cookieHeader: string) => Promise<T>) {
  const cookieHeader = getCookieHeader(token, "step");
  if (!cookieHeader) {
    return errorResult(`Your STEP session isn't connected. Connect it at ${connectUrl()}.`);
  }
  try {
    return toolResult(await fn(cookieHeader));
  } catch (err) {
    if (err instanceof StepSessionExpiredError) {
      return errorResult(`Your STEP session expired — reconnect it at ${connectUrl()}.`);
    }
    throw err;
  }
}

export function buildMcpServerForToken(token: string): McpServer {
  const server = new McpServer({ name: "politemall-mcp", version: "0.1.0" });

  server.registerTool(
    "list_courses",
    {
      title: "List courses",
      description:
        "List your enrolled courses across every connected D2L school (POLITEMall and/or NYP). courseId values are opaque strings scoped to a school — pass them as-is to the other D2L tools. For SkillsFuture/STEP enrollments, use list_step_courses instead.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => acrossSchoolsResult(token, "courses", (school, cookieHeader) => d2l.listCourses(school, cookieHeader))
  );

  server.registerTool(
    "get_course_content",
    {
      title: "Get course content",
      description: "Get the module/topic table of contents for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getCourseContent(school, c, id))
  );

  server.registerTool(
    "get_grades",
    {
      title: "Get grades",
      description: "Get your grade items and scores for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getGrades(school, c, id))
  );

  server.registerTool(
    "get_class_grades",
    {
      title: "Get class grades (instructor/TA)",
      description:
        "Get every grade item and score for EVERY student in a D2L course — the gradebook view. Requires an instructor/TA/grader role in the course; students calling this get a permission error, not their own grades (use get_grades for that instead).",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getClassGrades(school, c, id))
  );

  server.registerTool(
    "get_announcements",
    {
      title: "Get announcements",
      description: "Get news/announcements posted in a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getAnnouncements(school, c, id))
  );

  server.registerTool(
    "get_calendar_events",
    {
      title: "Get calendar events",
      description: "Get calendar events for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getCalendarEvents(school, c, id))
  );

  server.registerTool(
    "get_assignments",
    {
      title: "Get assignments",
      description: "Get dropbox/assignment folders and due dates for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getAssignments(school, c, id))
  );

  server.registerTool(
    "get_dropbox_submissions",
    {
      title: "Get dropbox submissions (instructor/TA)",
      description:
        "Get submissions for a dropbox/assignment folder — files, submission dates, score, and grading status. What you get depends on your role in the course: an instructor/TA/grader gets every student's submission; a learner is NOT refused but gets only their own entry, so a single-row result does not mean the class has one submission. To fetch your own submission with feedback, use get_my_dropbox_submission.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        folderId: z.number().describe("The dropbox folder's Id, from get_assignments"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, folderId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getDropboxSubmissions(school, c, id, folderId))
  );

  server.registerTool(
    "search_politemall_catalog",
    {
      title: "Search POLITEMall public catalog",
      description:
        "Search or browse the public POLITEMall marketing catalog (politemall.polite.edu.sg) — all ~300 modules offered across the polys/ITE, not just your enrollments. No login required. This is a DIFFERENT system from Brightspace: catalogCode values here are NOT courseIds and can't be passed to get_grades/get_course_content/etc. Use list_courses for your actual enrolled Brightspace courses.",
      inputSchema: {
        query: z.string().optional().describe("Keyword to search names/descriptions/institution for, e.g. \"AI\". Omit to browse everything."),
        maxResults: z.number().optional().describe("Max courses to return (default 100)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ query, maxResults }) => toolResult(await catalog.searchCatalog(query ?? "", maxResults ?? 100))
  );

  server.registerTool(
    "get_due_items",
    {
      title: "Get due items",
      description:
        "Get content items with due dates across every connected D2L school (POLITEMall and/or NYP) and every course, in one call — completed and pending. dateCompleted is null for items not yet done.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => acrossSchoolsResult(token, "dueItems", (school, cookieHeader) => d2l.getDueItems(school, cookieHeader))
  );

  server.registerTool(
    "get_quizzes",
    {
      title: "Get quizzes",
      description: "List quizzes for a D2L course (name, due date, availability window).",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.listQuizzes(school, c, id))
  );

  server.registerTool(
    "get_quiz_attempts",
    {
      title: "Get quiz attempts",
      description: "Get your attempt history (score, started/completed times) for a specific quiz.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, quizId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getQuizAttempts(school, c, id, quizId))
  );

  server.registerTool(
    "get_quiz_results",
    {
      title: "Get quiz results (instructor/TA)",
      description:
        "Get every student's attempts (score, started/completed times) for a quiz — the instructor grading view. Requires permission to view/grade the quiz. Optionally scope to one student by their classlist Identifier instead of the whole class.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
        studentUserId: z.string().optional().describe("A student's Identifier from get_classlist, to scope to just that student"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, quizId, studentUserId }) =>
      runForD2LCourse(token, courseId, (school, c, id) => d2l.getQuizResults(school, c, id, quizId, studentUserId))
  );

  server.registerTool(
    "get_discussion_forums",
    {
      title: "Get discussion forums",
      description: "List discussion forums for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.listDiscussionForums(school, c, id))
  );

  server.registerTool(
    "get_discussion_topics",
    {
      title: "Get discussion topics",
      description: "List topics within a discussion forum.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        forumId: z.number().describe("The forum's ForumId, from get_discussion_forums"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, forumId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.listDiscussionTopics(school, c, id, forumId))
  );

  server.registerTool(
    "get_discussion_posts",
    {
      title: "Get discussion posts",
      description: "List posts (with content and author) within a discussion topic.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        forumId: z.number().describe("The forum's ForumId, from get_discussion_forums"),
        topicId: z.number().describe("The topic's TopicId, from get_discussion_topics"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, forumId, topicId }) =>
      runForD2LCourse(token, courseId, (school, c, id) => d2l.listDiscussionPosts(school, c, id, forumId, topicId))
  );

  server.registerTool(
    "get_classlist",
    {
      title: "Get classlist",
      description: "List the students/instructors enrolled in a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getClasslist(school, c, id))
  );

  server.registerTool(
    "get_surveys",
    {
      title: "Get surveys",
      description: "List surveys for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.listSurveys(school, c, id))
  );

  server.registerTool(
    "get_survey_attempts",
    {
      title: "Get survey attempts",
      description: "Get your attempt history for a specific survey.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, surveyId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getSurveyAttempts(school, c, id, surveyId))
  );

  server.registerTool(
    "get_groups",
    {
      title: "Get groups",
      description: "List group categories and groups (with member counts) for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getGroups(school, c, id))
  );

  server.registerTool(
    "get_rubrics",
    {
      title: "Get rubrics",
      description:
        "Get rubric(s) for a D2L course. Pass rubricId to fetch one specific rubric's full criteria/levels directly. Otherwise pass objectType (e.g. \"Discussion\", \"Dropbox\") and objectId (that object's id, e.g. a topicId or folderId) to list the rubrics attached to it — D2L scopes rubric listing to a specific gradable object, not the whole course, so there's no way to list every rubric in a course at once.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        rubricId: z.number().optional().describe("A specific rubric's Id, if already known — returns its full criteria/levels"),
        objectType: z.string().optional().describe('The object type to list rubrics for, e.g. "Discussion" or "Dropbox" — required if rubricId is omitted'),
        objectId: z.number().optional().describe("The object's id (e.g. a topicId from get_discussion_topics or folderId from get_assignments) — required if rubricId is omitted"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, rubricId, objectType, objectId }) =>
      runForD2LCourse(token, courseId, (school, c, id) => d2l.getRubrics(school, c, id, { rubricId, objectType, objectId }))
  );

  server.registerTool(
    "get_my_final_grade",
    {
      title: "Get my final grade",
      description: "Get your calculated/adjusted final grade for a D2L course — distinct from get_grades, which lists per-item scores.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getMyFinalGrade(school, c, id))
  );

  server.registerTool(
    "get_all_final_grades",
    {
      title: "Get all final grades (instructor/TA)",
      description:
        "Get every enrolled student's calculated/adjusted final grade for a D2L course — the gradebook's final-grade column. Requires an instructor/TA/grader role; students calling this get a permission error, not their own grade (use get_my_final_grade for that instead).",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getAllFinalGrades(school, c, id))
  );

  server.registerTool(
    "get_my_dropbox_submission",
    {
      title: "Get my dropbox submission",
      description:
        "Get your own submission (files, dates, score, feedback) for a dropbox/assignment folder. Student-facing counterpart to get_dropbox_submissions, which is instructor/TA-only.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        folderId: z.number().describe("The dropbox folder's Id, from get_assignments"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, folderId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getMyDropboxSubmission(school, c, id, folderId))
  );

  server.registerTool(
    "get_survey_results",
    {
      title: "Get survey results (instructor/TA)",
      description:
        "Get every student's attempts for a survey — the instructor grading/review view. Requires permission to view/grade the survey. Optionally scope to one student by their classlist Identifier instead of the whole class. Not available on anonymous surveys when scoping to one student, since anonymous attempts have no recorded student identity.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
        studentUserId: z.string().optional().describe("A student's Identifier from get_classlist, to scope to just that student"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, surveyId, studentUserId }) =>
      runForD2LCourse(token, courseId, (school, c, id) => d2l.getSurveyResults(school, c, id, surveyId, studentUserId))
  );

  server.registerTool(
    "get_quiz_questions",
    {
      title: "Get quiz questions",
      description: "Get the questions defined for a quiz (text, points, type) — visibility follows the quiz's own settings and your D2L permissions.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, quizId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getQuizQuestions(school, c, id, quizId))
  );

  server.registerTool(
    "get_survey_questions",
    {
      title: "Get survey questions",
      description: "Get the questions defined for a survey (text, points, type) — visibility follows the survey's own settings and your D2L permissions.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, surveyId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getSurveyQuestions(school, c, id, surveyId))
  );

  server.registerTool(
    "get_course_overview",
    {
      title: "Get course overview",
      description: "Get the course description/overview content for a D2L course (the \"Class Overview\"/syllabus feature).",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getCourseOverview(school, c, id))
  );

  server.registerTool(
    "get_content_topic",
    {
      title: "Get content topic",
      description: "Get metadata for a single content topic (title, type, dates, url) — a single-item drill-down from get_course_content's table of contents.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        topicId: z.number().describe("The topic's TopicId, from get_course_content"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId, topicId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getContentTopic(school, c, id, topicId))
  );

  server.registerTool(
    "get_my_calendar_events",
    {
      title: "Get my calendar events (all courses)",
      description:
        "Get your calendar events across every connected D2L school and every enrolled course in one call — cross-course parity with get_due_items. Defaults to a rolling window from 7 days ago to 60 days ahead; pass startDate/endDate (ISO 8601) to widen or narrow it.",
      inputSchema: {
        startDate: z.string().optional().describe("ISO 8601 datetime; defaults to 7 days ago"),
        endDate: z.string().optional().describe("ISO 8601 datetime; defaults to 60 days from now"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ startDate, endDate }) => {
      const now = Date.now();
      const start = startDate ?? new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const end = endDate ?? new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();
      return acrossSchoolsResult(token, "events", (school, cookieHeader) => d2l.getMyCalendarEvents(school, cookieHeader, start, end));
    }
  );

  server.registerTool(
    "get_overdue_items",
    {
      title: "Get overdue items",
      description:
        "Get D2L-computed overdue content items across every connected school and course in one call — a filtered view distinct from get_due_items (which includes not-yet-due pending items too).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => acrossSchoolsResult(token, "overdueItems", (school, cookieHeader) => d2l.getOverdueItems(school, cookieHeader))
  );

  server.registerTool(
    "get_recent_updates",
    {
      title: "Get recent updates",
      description:
        "Get counts of unread/pending activity (discussions, assignment feedback, quizzes) across every connected school and course in one call — a \"what's new\" activity feed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => acrossSchoolsResult(token, "updates", (school, cookieHeader) => d2l.getRecentUpdates(school, cookieHeader))
  );

  server.registerTool(
    "list_d2l_operations",
    {
      title: "List D2L operations (advanced)",
      description:
        "List/search the full catalog of D2L Valence operations reachable via call_d2l_operation — the long-tail routes that don't have a dedicated tool above. Filter by category (e.g. \"grades\", \"checklists\", \"quizzes\") and/or a keyword search across the operation key and description. Use this first to find an operation's key and required parameters before calling call_d2l_operation.",
      inputSchema: {
        category: z.string().optional().describe('Restrict to one catalog category, e.g. "grades", "checklists", "cpd"'),
        query: z.string().optional().describe("Keyword to match against the operation key or description"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ category, query }) => {
      const q = query?.toLowerCase();
      const matches = D2L_ROUTE_CATALOG.filter((r) => {
        if (category && r.category !== category) return false;
        if (q && !r.operation.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
        return true;
      }).map((r) => ({
        operation: r.operation,
        category: r.category,
        description: r.description,
        scope: r.scope,
        pathParams: Object.keys(r.pathParams.shape),
        queryParams: r.queryParams ? Object.keys(r.queryParams.shape) : [],
        pagination: r.pagination,
        curatedTools: r.curatedTools ?? [],
      }));
      return toolResult({ count: matches.length, operations: matches });
    }
  );

  server.registerTool(
    "call_d2l_operation",
    {
      title: "Call D2L operation (advanced)",
      description:
        "Invoke any cataloged D2L Valence route by its operation key — the long-tail escape hatch for routes without a dedicated tool above. Use list_d2l_operations first to find the right operation key and its parameters. Course-scoped operations need courseId (orgUnitId is derived from it automatically — never pass orgUnitId directly); global/user-scoped operations need school instead. Always read-only (GET); operations that return binary file content are rejected, not supported here.",
      inputSchema: {
        operation: z.string().describe('The catalog operation key, from list_d2l_operations, e.g. "le.checklists.list"'),
        courseId: z.string().optional().describe("Required for course-scoped operations — the course's courseId from list_courses"),
        school: z.enum(["politemall", "nyp"]).optional().describe("Required for global/user-scoped operations that aren't tied to one course"),
        pathParams: z.record(z.unknown()).optional().describe("Path parameters the operation needs, other than orgUnitId"),
        queryParams: z.record(z.unknown()).optional().describe("Query parameters the operation accepts"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ operation, courseId, school, pathParams, queryParams }) => {
      const descriptor = getRouteDescriptor(operation);
      if (!descriptor) {
        return errorResult(`Unknown D2L operation "${operation}". Use list_d2l_operations to find a valid one.`);
      }

      let targetSchool: D2LSchool;
      let orgUnitId: number | undefined;
      if (descriptor.scope === "course") {
        if (!courseId) return errorResult(`Operation "${operation}" is course-scoped — pass courseId.`);
        const parsed = d2l.parseCourseId(courseId);
        targetSchool = parsed.school;
        orgUnitId = parsed.numericId;
      } else {
        if (!school) {
          return errorResult(`Operation "${operation}" is not course-scoped — pass school ("politemall" or "nyp") instead of courseId.`);
        }
        targetSchool = school;
      }

      const cookieHeader = getCookieHeader(token, targetSchool);
      if (!cookieHeader) {
        return errorResult(`Your ${targetSchool} session isn't connected. Connect it at ${connectUrl()}.`);
      }

      try {
        const result = await d2l.callD2lOperation(targetSchool, cookieHeader, operation, pathParams ?? {}, queryParams ?? {}, orgUnitId);
        return toolResult({ operation, result });
      } catch (err) {
        if (err instanceof d2l.InvalidRouteParamsError || err instanceof d2l.UnsupportedOperationError) {
          return errorResult(err.message);
        }
        const message = await explainD2lError(err, targetSchool, cookieHeader, courseId);
        if (message === undefined) throw err;
        return errorResult(`"${operation}" failed. ${message}`);
      }
    }
  );

  server.registerTool(
    "list_step_courses",
    {
      title: "List STEP courses",
      description:
        "List your enrolled SkillsFuture/short courses on STEP (stms.polite.edu.sg) — a separate system from POLITEMall/NYP D2L, covering training enrollment and attendance rather than course content.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => runStep(token, (c) => step.listCourses(c))
  );

  server.registerTool(
    "search_step_courses",
    {
      title: "Search STEP course catalog",
      description:
        "Search or browse STEP's full public course catalog (thousands of SkillsFuture/short courses across all polys/ITE) — not just your own enrollments. Omit query to browse the most recent listings.",
      inputSchema: {
        query: z.string().optional().describe("Keyword to search course names/descriptions for, e.g. \"AI\". Omit to browse without filtering."),
        maxResults: z.number().optional().describe("Max courses to return (default 100)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ query, maxResults }) => runStep(token, (c) => step.searchCourses(c, query ?? "", maxResults ?? 100))
  );

  server.registerTool(
    "get_step_course_detail",
    {
      title: "Get STEP course detail",
      description: "Get attendance percentage, grade, and enrolment status for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runStep(token, (c) => step.getCourseDetail(c, courseId))
  );

  server.registerTool(
    "get_step_timetable",
    {
      title: "Get STEP timetable",
      description: "Get the class session timetable (dates, trainer, room, attendance status) for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ courseId }) => runStep(token, (c) => step.getTimetable(c, courseId))
  );

  server.registerTool(
    "get_step_announcements",
    {
      title: "Get STEP announcements",
      description: "Get portal-wide announcements from STEP.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => runStep(token, (c) => step.getAnnouncements(c))
  );

  server.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: "Get your identity on each connected school (POLITEMall, NYP, and/or STEP).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const results: Record<string, unknown> = {};
      const warnings: string[] = [];

      for (const school of D2L_SCHOOLS) {
        const cookieHeader = getCookieHeader(token, school);
        if (!cookieHeader) continue;
        try {
          results[school] = await d2l.whoami(school, cookieHeader);
        } catch (err) {
          const message = await explainD2lError(err, school, cookieHeader);
          if (message === undefined) throw err;
          warnings.push(`${school}: ${message}`);
        }
      }

      const stepCookie = getCookieHeader(token, "step");
      if (stepCookie) {
        try {
          results.step = await step.whoami(stepCookie);
        } catch (err) {
          if (err instanceof StepSessionExpiredError) {
            warnings.push(`Your STEP session expired — reconnect it at ${connectUrl()}.`);
          } else {
            throw err;
          }
        }
      }

      return toolResult({ ...results, warnings: warnings.length ? warnings : undefined });
    }
  );

  return server;
}
