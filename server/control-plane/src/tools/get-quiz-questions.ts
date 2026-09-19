import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchQuestions } from "../api/questions.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetQuizQuestions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_quiz_questions",
    {
      title: "Get quiz questions",
      description: "Get the questions defined for a quiz (text, points, type) — visibility follows the quiz's own settings and your D2L permissions.",
      inputSchema: {
        courseId: courseIdField,
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, quizId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchQuestions(school, resolveD2lPath("le.quizzes.questions", { quizId }, id), cookie))
  );
}
