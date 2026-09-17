import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import * as d2l from "./d2l.js";
import {
  SessionExpiredError as D2LSessionExpiredError,
  PermissionDeniedError as D2LPermissionDeniedError,
  NotFoundError as D2LNotFoundError,
  type D2LSchool,
} from "./d2l.js";
import * as step from "./step.js";
import { SessionExpiredError as StepSessionExpiredError } from "./step.js";
import { connectedSchools, getCookieHeader } from "./tokenStore.js";
import * as catalog from "./catalog.js";

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

// Runs fn against every D2L school (politemall/nyp) the token has a saved cookie
// for, merging results. A single school's session being expired/never-connected
// doesn't fail the whole call — it's reported alongside whatever data the other
// school(s) returned.
async function runAcrossD2LSchools<T>(
  token: string,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>
): Promise<{ results: T[]; warnings: string[] }> {
  const schools = connectedSchools(token).filter((s): s is D2LSchool => s === "politemall" || s === "nyp");
  if (schools.length === 0) {
    return { results: [], warnings: [`No school connected yet. Connect at least one at ${connectUrl()}.`] };
  }

  const results: T[] = [];
  const warnings: string[] = [];
  for (const school of schools) {
    const cookieHeader = getCookieHeader(token, school);
    if (!cookieHeader) continue;
    try {
      results.push(...(await fn(school, cookieHeader)));
    } catch (err) {
      if (err instanceof D2LSessionExpiredError) {
        warnings.push(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
      } else {
        throw err;
      }
    }
  }
  return { results, warnings };
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
    if (err instanceof D2LSessionExpiredError) {
      return errorResult(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
    }
    if (err instanceof D2LPermissionDeniedError) {
      return errorResult(
        `You don't have instructor/TA permission for this in your ${school} course — this tool needs a grading role, not just enrollment.`
      );
    }
    if (err instanceof D2LNotFoundError) {
      return errorResult(`This tool isn't enabled for this course in ${school} — no data to return, not a session problem.`);
    }
    throw err;
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
    },
    async () => {
      const { results, warnings } = await runAcrossD2LSchools(token, (school, cookieHeader) => d2l.listCourses(school, cookieHeader));
      return toolResult({ courses: results, warnings: warnings.length ? warnings : undefined });
    }
  );

  server.registerTool(
    "get_course_content",
    {
      title: "Get course content",
      description: "Get the module/topic table of contents for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getCourseContent(school, c, id))
  );

  server.registerTool(
    "get_grades",
    {
      title: "Get grades",
      description: "Get your grade items and scores for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
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
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getClassGrades(school, c, id))
  );

  server.registerTool(
    "get_announcements",
    {
      title: "Get announcements",
      description: "Get news/announcements posted in a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getAnnouncements(school, c, id))
  );

  server.registerTool(
    "get_calendar_events",
    {
      title: "Get calendar events",
      description: "Get calendar events for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getCalendarEvents(school, c, id))
  );

  server.registerTool(
    "get_assignments",
    {
      title: "Get assignments",
      description: "Get dropbox/assignment folders and due dates for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getAssignments(school, c, id))
  );

  server.registerTool(
    "get_dropbox_submissions",
    {
      title: "Get dropbox submissions (instructor/TA)",
      description:
        "Get every student's submission for a dropbox/assignment folder — files, submission dates, score, and grading status. Requires an instructor/TA/grader role for the folder.",
      inputSchema: {
        courseId: z.string().describe("The course's courseId, from list_courses"),
        folderId: z.number().describe("The dropbox folder's Id, from get_assignments"),
      },
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
    },
    async () => {
      const { results, warnings } = await runAcrossD2LSchools(token, (school, cookieHeader) => d2l.getDueItems(school, cookieHeader));
      return toolResult({ dueItems: results, warnings: warnings.length ? warnings : undefined });
    }
  );

  server.registerTool(
    "get_quizzes",
    {
      title: "Get quizzes",
      description: "List quizzes for a D2L course (name, due date, availability window).",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
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
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getClasslist(school, c, id))
  );

  server.registerTool(
    "get_surveys",
    {
      title: "Get surveys",
      description: "List surveys for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
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
    },
    async ({ courseId, surveyId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getSurveyAttempts(school, c, id, surveyId))
  );

  server.registerTool(
    "get_groups",
    {
      title: "Get groups",
      description: "List group categories and groups (with member counts) for a D2L course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForD2LCourse(token, courseId, (school, c, id) => d2l.getGroups(school, c, id))
  );

  server.registerTool(
    "list_step_courses",
    {
      title: "List STEP courses",
      description:
        "List your enrolled SkillsFuture/short courses on STEP (stms.polite.edu.sg) — a separate system from POLITEMall/NYP D2L, covering training enrollment and attendance rather than course content.",
      inputSchema: {},
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
    },
    async ({ query, maxResults }) => runStep(token, (c) => step.searchCourses(c, query ?? "", maxResults ?? 100))
  );

  server.registerTool(
    "get_step_course_detail",
    {
      title: "Get STEP course detail",
      description: "Get attendance percentage, grade, and enrolment status for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
    },
    async ({ courseId }) => runStep(token, (c) => step.getCourseDetail(c, courseId))
  );

  server.registerTool(
    "get_step_timetable",
    {
      title: "Get STEP timetable",
      description: "Get the class session timetable (dates, trainer, room, attendance status) for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
    },
    async ({ courseId }) => runStep(token, (c) => step.getTimetable(c, courseId))
  );

  server.registerTool(
    "get_step_announcements",
    {
      title: "Get STEP announcements",
      description: "Get portal-wide announcements from STEP.",
      inputSchema: {},
    },
    async () => runStep(token, (c) => step.getAnnouncements(c))
  );

  server.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: "Get your identity on each connected school (POLITEMall, NYP, and/or STEP).",
      inputSchema: {},
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
          if (err instanceof D2LSessionExpiredError) {
            warnings.push(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
          } else {
            throw err;
          }
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
