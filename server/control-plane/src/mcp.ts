import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import * as d2l from "./d2l.js";
import { SessionExpiredError } from "./d2l.js";
import { getCookieHeader } from "./tokenStore.js";

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function loginRequiredResult() {
  const connectUrl = `${config.publicOrigin}/connect`;
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Your POLITEMall session has expired or was never connected. Reconnect at ${connectUrl} (you'll need a fresh cookie from lms.polite.edu.sg).`,
      },
    ],
  };
}

async function run<T>(token: string, fn: (cookieHeader: string) => Promise<T>) {
  const cookieHeader = getCookieHeader(token);
  if (!cookieHeader) return loginRequiredResult();
  try {
    return toolResult(await fn(cookieHeader));
  } catch (err) {
    if (err instanceof SessionExpiredError) return loginRequiredResult();
    throw err;
  }
}

export function buildMcpServerForToken(token: string): McpServer {
  const server = new McpServer({ name: "politemall-mcp", version: "0.1.0" });

  server.registerTool(
    "list_courses",
    { title: "List courses", description: "List the courses you are enrolled in on POLITEMall.", inputSchema: {} },
    async () => run(token, (c) => d2l.listCourses(c))
  );

  server.registerTool(
    "get_course_content",
    {
      title: "Get course content",
      description: "Get the module/topic table of contents for a course.",
      inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
    },
    async ({ courseId }) => run(token, (c) => d2l.getCourseContent(c, courseId))
  );

  server.registerTool(
    "get_grades",
    {
      title: "Get grades",
      description: "Get your grade items and scores for a course.",
      inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
    },
    async ({ courseId }) => run(token, (c) => d2l.getGrades(c, courseId))
  );

  server.registerTool(
    "get_announcements",
    {
      title: "Get announcements",
      description: "Get news/announcements posted in a course.",
      inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
    },
    async ({ courseId }) => run(token, (c) => d2l.getAnnouncements(c, courseId))
  );

  server.registerTool(
    "get_calendar_events",
    {
      title: "Get calendar events",
      description: "Get calendar events for a course.",
      inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
    },
    async ({ courseId }) => run(token, (c) => d2l.getCalendarEvents(c, courseId))
  );

  server.registerTool(
    "get_assignments",
    {
      title: "Get assignments",
      description: "Get dropbox/assignment folders and due dates for a course.",
      inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
    },
    async ({ courseId }) => run(token, (c) => d2l.getAssignments(c, courseId))
  );

  server.registerTool(
    "whoami",
    { title: "Whoami", description: "Get the currently authenticated POLITEMall user's identity.", inputSchema: {} },
    async () => run(token, (c) => d2l.whoami(c))
  );

  return server;
}
