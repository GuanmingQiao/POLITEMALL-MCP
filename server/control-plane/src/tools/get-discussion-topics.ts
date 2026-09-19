import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetDiscussionTopics(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_discussion_topics",
    {
      title: "Get discussion topics",
      description: "List topics within a discussion forum.",
      inputSchema: {
        courseId: courseIdField,
        forumId: z.number().describe("The forum's ForumId, from get_discussion_forums"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, forumId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) =>
        apiGet(school, resolveD2lPath("le.discussions.topicsList", { forumId }, id), cookie)
      )
  );
}
