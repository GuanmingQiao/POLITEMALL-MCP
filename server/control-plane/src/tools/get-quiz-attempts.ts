import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetQuizAttempts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_quiz_attempts",
    {
      title: "Get quiz attempts",
      description: "Get your attempt history (score, started/completed times) for a specific quiz.",
      inputSchema: {
        courseId: courseIdField,
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, quizId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchAllPages(school, resolveD2lPath("le.quizzes.attempts", { quizId }, id), cookie))
  );
}
