import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetQuizzes(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_quizzes",
    {
      title: "Get quizzes",
      description: "List quizzes for a D2L course (name, due date, availability window).",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchAllPages(school, resolveD2lPath("le.quizzes.list", {}, id), cookie))
  );
}
