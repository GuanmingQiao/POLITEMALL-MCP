import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetDiscussionForums(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_discussion_forums",
    {
      title: "Get discussion forums",
      description: "List discussion forums for a D2L course.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => apiGet(school, resolveD2lPath("le.discussions.forumsList", {}, id), cookie))
  );
}
