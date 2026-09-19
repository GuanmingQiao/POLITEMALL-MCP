import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetContentTopic(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_content_topic",
    {
      title: "Get content topic",
      description: "Get metadata for a single content topic (title, type, dates, url) — a single-item drill-down from get_course_content's table of contents.",
      inputSchema: {
        courseId: courseIdField,
        topicId: z.number().describe("The topic's id, from get_course_content"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, topicId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => apiGet(school, resolveD2lPath("le.content.topicGet", { topicId }, id), cookie))
  );
}
