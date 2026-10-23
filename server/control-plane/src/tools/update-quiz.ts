import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet, apiSend } from "../api/d2l-client.js";
import { applyQuizPatch, checkSettings, quizPath, quizSettingsShape, suppliedSettings, toWriteModel, type QuizSettings } from "../api/quiz-authoring.js";
import { WRITE_OVERWRITES, courseIdField, dryRunField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { errorResult, runForD2LCourse } from "./helpers.js";

const DATE_FIELDS = ["DueDate", "StartDate", "EndDate"];

export function registerUpdateQuiz(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "update_quiz",
    {
      title: "Update quiz settings",
      description:
        "Change settings of an existing D2L quiz. WRITES to the school's Brightspace and overwrites the settings you pass; it does not touch the quiz's questions. Needs a role that can manage quizzes (instructor/TA). " +
        "Pass only the settings you want to change: every setting you leave out keeps its current value (the tool reads the quiz first and sends it back with your changes). Pass at least one setting. To clear a date or the attempt/time limit, pass null. " +
        "Typical uses: make a finished quiz visible (isActive true), move the due date, set a time limit. Use create_quiz to make a new quiz and save_quiz_questions to change questions. " +
        "If students have already attempted the quiz, D2L's handling of existing attempts is not specified: check with get_quiz_attempts before changing scoring-related settings. Find quizId with get_quizzes. Set dryRun true to read the quiz and preview the change without saving it. " +
        "Returns the quiz as saved.",
      inputSchema: {
        courseId: courseIdField,
        quizId: z.number().int().describe("The quiz's QuizId, from get_quizzes or create_quiz"),
        name: z.string().min(1).max(256).optional().describe("A new quiz name"),
        ...quizSettingsShape,
        dryRun: dryRunField,
      },
      annotations: WRITE_OVERWRITES,
    },
    async ({ courseId, quizId, name, dryRun, ...settings }) => {
      const s = settings as QuizSettings;
      if (name === undefined && suppliedSettings(s).length === 0) {
        return errorResult("Nothing to change: pass at least one setting (for example dueDate or isActive).");
      }
      const problems = checkSettings(s);
      if (problems.length) return errorResult(`Nothing was changed. Fix the input: ${problems.join("; ")}.`);

      return runForD2LCourse(ctx, courseId, async (school, auth, orgUnitId) => {
        const path = quizPath(orgUnitId, quizId);
        const current = await apiGet<Record<string, unknown>>(school, path, auth);
        const body = applyQuizPatch(toWriteModel(current), name, s);
        if (dryRun) return { dryRun: true, wouldSend: { method: "PUT", path, body } };
        const quiz = await apiSend<Record<string, unknown>>(school, "PUT", path, auth, body);
        const pageUrl = link.quiz(school, orgUnitId, quizId);
        return linked({ updated: true, quizId, quiz: withSourceUrl(addSgt(quiz, DATE_FIELDS), pageUrl) }, { pageUrl });
      });
    }
  );
}
