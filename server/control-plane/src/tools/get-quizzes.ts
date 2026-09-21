import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
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
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
        const quizzes = await fetchAllPages<Record<string, unknown>>(school, resolveD2lPath("le.quizzes.list", {}, id), cookie);
        return linked(
          quizzes.map((q) => withSourceUrl(addSgt(q, ["DueDate", "StartDate", "EndDate"]), link.quiz(school, id, q.QuizId))),
          { pageUrl: link.quizList(school, id) }
        );
      })
  );
}
