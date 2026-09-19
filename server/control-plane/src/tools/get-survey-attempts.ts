import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetSurveyAttempts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_survey_attempts",
    {
      title: "Get survey attempts",
      description: "Get your attempt history for a specific survey.",
      inputSchema: {
        courseId: courseIdField,
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, surveyId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchAllPages(school, resolveD2lPath("le.surveys.attempts", { surveyId }, id), cookie))
  );
}
