import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiSend } from "../api/d2l-client.js";
import { buildQuizCreateBody, checkSettings, quizCreatePath, quizSettingsShape, type QuizSettings } from "../api/quiz-authoring.js";
import { WRITE_ADDS, courseIdField, dryRunField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { errorResult, runForD2LCourse } from "./helpers.js";

const DATE_FIELDS = ["DueDate", "StartDate", "EndDate"];

export function registerCreateQuiz(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_quiz",
    {
      title: "Create quiz",
      description:
        "Create a new, empty quiz in a D2L course. WRITES to the school's Brightspace: it adds a quiz that instructors can see in the course. Needs a role that can manage quizzes (instructor/TA); other accounts get a permission error. " +
        "The quiz is created HIDDEN from students (isActive false) unless you set isActive true, and it has no questions: follow with save_quiz_questions to add them. " +
        "Use update_quiz to change an existing quiz instead, and get_quizzes first to check the quiz does not already exist: calling create_quiz twice creates two quizzes, so do not retry after an unclear failure without checking. " +
        "Only the settings listed are supported; anything else (grade item, password, IP limits) must be set in D2L. Dates need a time zone, e.g. 2026-11-02T09:00:00+08:00. Set dryRun true to preview the request without creating anything. " +
        "Returns the created quiz with its quizId (use it with save_quiz_questions and update_quiz) and a link to open it.",
      inputSchema: {
        courseId: courseIdField,
        name: z.string().min(1).max(256).describe("The quiz name shown to students"),
        ...quizSettingsShape,
        dryRun: dryRunField,
      },
      annotations: WRITE_ADDS,
    },
    async ({ courseId, name, dryRun, ...settings }) => {
      const s = settings as QuizSettings;
      const problems = checkSettings(s);
      if (problems.length) return errorResult(`Nothing was created. Fix the input: ${problems.join("; ")}.`);
      const body = buildQuizCreateBody(name, s);

      return runForD2LCourse(ctx, courseId, async (school, auth, orgUnitId) => {
        const path = quizCreatePath(orgUnitId);
        if (dryRun) return { dryRun: true, wouldSend: { method: "POST", path, body } };
        const quiz = await apiSend<Record<string, unknown>>(school, "POST", path, auth, body);
        const pageUrl = link.quiz(school, orgUnitId, quiz.QuizId);
        return linked({ created: true, quizId: quiz.QuizId, quiz: withSourceUrl(addSgt(quiz, DATE_FIELDS), pageUrl) }, { pageUrl });
      });
    }
  );
}
