import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import * as d2l from "./d2l.js";
import { SessionExpiredError, type School } from "./d2l.js";
import { connectedSchools, getCookieHeader } from "./tokenStore.js";

const SCHOOLS: School[] = ["politemall", "nyp"];

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function connectUrl(): string {
  return `${config.publicOrigin}/connect`;
}

// Runs fn against every school the token has a saved cookie for, merging results.
// A single school's session being expired/never-connected doesn't fail the whole
// call — it's reported alongside whatever data the other school(s) returned.
async function runAcrossSchools<T>(
  token: string,
  fn: (school: School, cookieHeader: string) => Promise<T[]>
): Promise<{ results: T[]; warnings: string[] }> {
  const schools = connectedSchools(token);
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
      if (err instanceof SessionExpiredError) {
        warnings.push(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
      } else {
        throw err;
      }
    }
  }
  return { results, warnings };
}

// Single-course tools resolve which school a "school:numericId" courseId belongs to
// and use that school's cookie only.
async function runForCourse<T>(token: string, courseId: string, fn: (school: School, cookieHeader: string, numericId: number) => Promise<T>) {
  const { school, numericId } = d2l.parseCourseId(courseId);
  const cookieHeader = getCookieHeader(token, school);
  if (!cookieHeader) {
    return errorResult(`Your ${school} session isn't connected. Connect it at ${connectUrl()}.`);
  }
  try {
    return toolResult(await fn(school, cookieHeader, numericId));
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return errorResult(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
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
        "List your enrolled courses across every connected school (POLITEMall and/or NYP). courseId values are opaque strings scoped to a school — pass them as-is to the other tools.",
      inputSchema: {},
    },
    async () => {
      const { results, warnings } = await runAcrossSchools(token, (school, cookieHeader) => d2l.listCourses(school, cookieHeader));
      return toolResult({ courses: results, warnings: warnings.length ? warnings : undefined });
    }
  );

  server.registerTool(
    "get_course_content",
    {
      title: "Get course content",
      description: "Get the module/topic table of contents for a course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForCourse(token, courseId, (school, c, id) => d2l.getCourseContent(school, c, id))
  );

  server.registerTool(
    "get_grades",
    {
      title: "Get grades",
      description: "Get your grade items and scores for a course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForCourse(token, courseId, (school, c, id) => d2l.getGrades(school, c, id))
  );

  server.registerTool(
    "get_announcements",
    {
      title: "Get announcements",
      description: "Get news/announcements posted in a course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForCourse(token, courseId, (school, c, id) => d2l.getAnnouncements(school, c, id))
  );

  server.registerTool(
    "get_calendar_events",
    {
      title: "Get calendar events",
      description: "Get calendar events for a course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForCourse(token, courseId, (school, c, id) => d2l.getCalendarEvents(school, c, id))
  );

  server.registerTool(
    "get_assignments",
    {
      title: "Get assignments",
      description: "Get dropbox/assignment folders and due dates for a course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_courses") },
    },
    async ({ courseId }) => runForCourse(token, courseId, (school, c, id) => d2l.getAssignments(school, c, id))
  );

  server.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: "Get your identity on each connected school (POLITEMall and/or NYP).",
      inputSchema: {},
    },
    async () => {
      const results: Record<string, unknown> = {};
      const warnings: string[] = [];
      for (const school of SCHOOLS) {
        const cookieHeader = getCookieHeader(token, school);
        if (!cookieHeader) continue;
        try {
          results[school] = await d2l.whoami(school, cookieHeader);
        } catch (err) {
          if (err instanceof SessionExpiredError) {
            warnings.push(`Your ${school} session expired — reconnect it at ${connectUrl()}.`);
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
