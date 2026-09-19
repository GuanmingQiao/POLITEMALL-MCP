import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchQuestions } from "../api/questions.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetSurveyQuestions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_survey_questions",
    {
      title: "Get survey questions",
      description: "Get the questions defined for a survey (text, points, type) — visibility follows the survey's own settings and your D2L permissions.",
      inputSchema: {
        courseId: courseIdField,
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, surveyId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchQuestions(school, resolveD2lPath("le.surveys.questions", { surveyId }, id), cookie))
  );
}
