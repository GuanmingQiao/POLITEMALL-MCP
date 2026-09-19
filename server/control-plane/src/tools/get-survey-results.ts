import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { fetchClasslist } from "../api/classlist.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface SurveyAttemptData {
  AttemptId: number;
  SurveyId: number;
  // null on anonymous surveys.
  UserId: number | null;
  AttemptNumber: number;
  Started: string;
  Completed: string | null;
}

export interface SurveyResult {
  attemptId: number;
  userId: string | null;
  studentName: string | null;
  attemptNumber: number;
  started: string;
  completed: string | null;
}

// Same underlying route as get_survey_attempts, but requires class-wide view/grade permission
// and returns every student's attempts. D2L rejects userId filtering with 400 on an anonymous
// survey (no UserId exists to filter by) — that surfaces as a D2L 400 explained to the caller.
export async function getSurveyResults(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  surveyId: number,
  studentUserId?: string
): Promise<SurveyResult[]> {
  const qs = studentUserId ? resolveD2lQuery("le.surveys.attempts", { userId: studentUserId }) : "";
  const [attempts, classlist] = await Promise.all([
    fetchAllPages<SurveyAttemptData>(school, resolveD2lPath("le.surveys.attempts", { surveyId }, numericId) + qs, cookieHeader),
    fetchClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return attempts.map((a) => ({
    attemptId: a.AttemptId,
    userId: a.UserId != null ? String(a.UserId) : null,
    studentName: a.UserId != null ? nameById.get(String(a.UserId)) ?? null : null,
    attemptNumber: a.AttemptNumber,
    started: a.Started,
    completed: a.Completed,
  }));
}

export function registerGetSurveyResults(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_survey_results",
    {
      title: "Get survey results (instructor/TA)",
      description:
        "Get every student's attempts for a survey — the instructor grading/review view. Requires permission to view/grade the survey. Optionally scope to one student by their classlist Identifier instead of the whole class. Not available on anonymous surveys when scoping to one student, since anonymous attempts have no recorded student identity.",
      inputSchema: {
        courseId: courseIdField,
        surveyId: z.number().describe("The survey's SurveyId, from get_surveys"),
        studentUserId: z.string().optional().describe("A student's Identifier from get_classlist, to scope to just that student"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, surveyId, studentUserId }) =>
      runForD2LCourse(ctx, courseId, (school, c, id) => getSurveyResults(school, c, id, surveyId, studentUserId))
  );
}
