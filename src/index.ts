#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as d2l from "./d2l.js";

const server = new McpServer({
  name: "politemall-mcp",
  version: "0.1.0",
});

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "list_courses",
  {
    title: "List courses",
    description: "List the courses you are enrolled in on POLITEMall.",
    inputSchema: {},
  },
  async () => toolResult(await d2l.listCourses())
);

server.registerTool(
  "get_course_content",
  {
    title: "Get course content",
    description: "Get the module/topic table of contents for a course.",
    inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
  },
  async ({ courseId }) => toolResult(await d2l.getCourseContent(courseId))
);

server.registerTool(
  "get_grades",
  {
    title: "Get grades",
    description: "Get your grade items and scores for a course.",
    inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
  },
  async ({ courseId }) => toolResult(await d2l.getGrades(courseId))
);

server.registerTool(
  "get_announcements",
  {
    title: "Get announcements",
    description: "Get news/announcements posted in a course.",
    inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
  },
  async ({ courseId }) => toolResult(await d2l.getAnnouncements(courseId))
);

server.registerTool(
  "get_calendar_events",
  {
    title: "Get calendar events",
    description: "Get calendar events for a course.",
    inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
  },
  async ({ courseId }) => toolResult(await d2l.getCalendarEvents(courseId))
);

server.registerTool(
  "get_assignments",
  {
    title: "Get assignments",
    description: "Get dropbox/assignment folders and due dates for a course.",
    inputSchema: { courseId: z.number().describe("The course's orgUnitId, from list_courses") },
  },
  async ({ courseId }) => toolResult(await d2l.getAssignments(courseId))
);

server.registerTool(
  "whoami",
  {
    title: "Whoami",
    description: "Get the currently authenticated POLITEMall user's identity.",
    inputSchema: {},
  },
  async () => toolResult(await d2l.whoami())
);

const transport = new StdioServerTransport();
await server.connect(transport);
