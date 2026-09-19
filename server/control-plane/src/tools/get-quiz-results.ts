import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { fetchClasslist } from "../api/classlist.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface QuizAttemptData {
  AttemptId: number;
  QuizId: number;
  UserId: number;
  AttemptNumber: number;
  Score: number | null;
  Started: string;
  Completed: string | null;
  IsPublished: boolean;
}

export interface QuizResult {
  attemptId: number;
  userId: string;
  studentName: string | null;
  attemptNumber: number;
  score: number | null;
  started: string;
  completed: string | null;
  isPublished: boolean;
}

// Same underlying route as get_quiz_attempts, and it needs quizzing:attempts:read (the
// view-or-grade-quiz permission) either way: D2L returns every student's attempts, joined here
// with the classlist for names. Pass studentUserId (a classlist Identifier) to scope to one
// student instead of the whole class.
export async function getQuizResults(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  quizId: number,
  studentUserId?: string
): Promise<QuizResult[]> {
  const qs = studentUserId ? resolveD2lQuery("le.quizzes.attempts", { userId: studentUserId }) : "";
  const [attempts, classlist] = await Promise.all([
    fetchAllPages<QuizAttemptData>(school, resolveD2lPath("le.quizzes.attempts", { quizId }, numericId) + qs, cookieHeader),
    fetchClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return attempts.map((a) => ({
    attemptId: a.AttemptId,
    userId: String(a.UserId),
    studentName: nameById.get(String(a.UserId)) ?? null,
    attemptNumber: a.AttemptNumber,
    score: a.Score,
    started: a.Started,
    completed: a.Completed,
    isPublished: a.IsPublished,
  }));
}

export function registerGetQuizResults(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_quiz_results",
    {
      title: "Get quiz results (instructor/TA)",
      description:
        "Get every student's attempts (score, started/completed times) for a quiz — the instructor grading view. Requires permission to view/grade the quiz. Optionally scope to one student by their classlist Identifier instead of the whole class.",
      inputSchema: {
        courseId: courseIdField,
        quizId: z.number().describe("The quiz's QuizId, from get_quizzes"),
        studentUserId: z.string().optional().describe("A student's Identifier from get_classlist, to scope to just that student"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, quizId, studentUserId }) =>
      runForD2LCourse(ctx, courseId, (school, c, id) => getQuizResults(school, c, id, quizId, studentUserId))
  );
}
