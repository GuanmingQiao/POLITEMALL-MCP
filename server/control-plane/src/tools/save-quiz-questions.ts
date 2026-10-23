import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiSend, leVersionOf } from "../api/d2l-client.js";
import { D2lHttpError } from "../api/errors.js";
import { parseCourseId } from "../api/courses.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchQuestions } from "../api/questions.js";
import {
  MAX_QUESTIONS_PER_CALL,
  MIN_QUESTION_WRITE_VERSION,
  buildQuestion,
  checkQuestion,
  questionCreatePath,
  questionPath,
  questionSchema,
  questionTypes,
  supportsQuestionWrites,
} from "../api/quiz-authoring.js";
import { WRITE_OVERWRITES, courseIdField, dryRunField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { toolResult, errorResult, authFor, explainD2lError, withRecovery } from "./helpers.js";

interface Planned {
  index: number;
  method: "POST" | "PUT";
  path: string;
  body: Record<string, unknown>;
  questionId?: number;
}

export function registerSaveQuizQuestions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "save_quiz_questions",
    {
      title: "Save quiz questions",
      description:
        "Add questions to a D2L quiz, or edit existing ones, from structured data. WRITES to the school's Brightspace: new questions appear in the quiz and edited ones are overwritten. Needs a role that can manage quizzes (instructor/TA). " +
        "You do the reading: turn the user's spreadsheet, CSV or document into the questions array yourself, this tool never reads files. " +
        `Each question has a type (${questionTypes.join(", ")}), its text, and the type's answer fields; points default to 1. Plain text is shown literally unless textFormat is "html". ` +
        "A question without questionId is added at the end of the quiz in the order given; a question with questionId (from get_quiz_questions or an earlier call) replaces that question, and its type cannot change. Questions cannot be deleted or reordered with this tool. " +
        `Up to ${MAX_QUESTIONS_PER_CALL} questions per call. All questions are checked before anything is sent, then sent one at a time; the batch is NOT atomic and stops at the first failure. ` +
        "Use create_quiz first to get a quizId. Set dryRun true to check the questions and preview the requests without saving, which is a good first step for a large import. " +
        "Returns each question's index and questionId. On failure it reports the questions already saved (with their questionIds), the one that failed and why, and those not attempted: retry with only the remaining questions, and do not resend the saved ones (that would duplicate them). A rate-limited request is not retried automatically.",
      inputSchema: {
        courseId: courseIdField,
        quizId: z.number().int().describe("The quiz's QuizId, from get_quizzes or create_quiz"),
        questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS_PER_CALL).describe("The questions to add or update, in the order they should appear"),
        dryRun: dryRunField,
      },
      annotations: WRITE_OVERWRITES,
    },
    async ({ courseId, quizId, questions, dryRun }) => {
      // Everything that can be wrong with the input is found before D2L is contacted.
      const problems = questions.flatMap((q, i) => checkQuestion(q).map((m) => `question ${i + 1}: ${m}`));
      if (problems.length) return errorResult(`Nothing was saved. Fix the input: ${problems.join("; ")}.`);

      const { school, numericId: orgUnitId } = parseCourseId(courseId);
      const credential = await authFor(ctx, school);
      if (!credential.ok) return errorResult(credential.message);
      const holder = { auth: credential.auth };

      try {
        const version = await leVersionOf(school);
        if (!supportsQuestionWrites(version)) {
          return errorResult(`${school} runs D2L API version ${version}, and writing questions needs ${MIN_QUESTION_WRITE_VERSION} or newer. Nothing was saved; add the questions in the D2L quiz editor.`);
        }

        // Updates must name a question that exists in this quiz and keep its type.
        if (questions.some((q) => q.questionId !== undefined)) {
          const existing = await withRecovery(ctx, school, holder, (auth) => fetchQuestions(school, resolveD2lPath("le.quizzes.questions", { quizId }, orgUnitId), auth));
          const typeOf = new Map(existing.map((e) => [e.questionId, e.questionTypeId]));
          const bad: string[] = [];
          questions.forEach((q, i) => {
            if (q.questionId === undefined) return;
            const built = buildQuestion(q);
            const current = typeOf.get(q.questionId);
            if (current === undefined) bad.push(`question ${i + 1}: questionId ${q.questionId} is not in this quiz`);
            else if (current !== built.QuestionTypeId) bad.push(`question ${i + 1}: questionId ${q.questionId} has a different type than ${q.type}, and a question's type cannot be changed`);
          });
          if (bad.length) return errorResult(`Nothing was saved. Fix the input: ${bad.join("; ")}.`);
        }

        const plan: Planned[] = questions.map((q, i) => {
          const { QuestionTypeId, ...withoutType } = buildQuestion(q);
          return {
            index: i + 1,
            method: q.questionId === undefined ? "POST" : "PUT",
            path: q.questionId === undefined ? questionCreatePath(orgUnitId, quizId) : questionPath(orgUnitId, quizId, q.questionId),
            // D2L rejects a QuestionTypeId on update (the type cannot change), so only a create sends it.
            body: q.questionId === undefined ? { QuestionTypeId, ...withoutType } : withoutType,
            questionId: q.questionId,
          };
        });
        const pageUrl = link.quiz(school, orgUnitId, quizId);

        if (dryRun) {
          return toolResult({ dryRun: true, quizId, wouldSend: plan.map(({ index, method, path, body }) => ({ index, method, path, body })) }, [school], { pageUrl });
        }

        const saved: { index: number; action: "created" | "updated"; questionId: unknown }[] = [];
        for (const step of plan) {
          try {
            const result = await withRecovery(ctx, school, holder, (auth) => apiSend<Record<string, unknown>>(school, step.method, step.path, auth, step.body));
            saved.push({ index: step.index, action: step.method === "POST" ? "created" : "updated", questionId: result.QuestionId ?? step.questionId });
          } catch (err) {
            const reason =
              err instanceof D2lHttpError && err.status === 429
                ? "D2L is rate-limiting requests right now (429). This request was not retried; try again later."
                : await explainD2lError(ctx, err, school, holder.auth, courseId);
            if (reason === undefined) throw err;
            const notAttempted = plan.filter((p) => p.index > step.index).map((p) => p.index);
            return errorResult(
              JSON.stringify({ saved: false, quizId, savedSoFar: saved, failed: { index: step.index, reason }, notAttempted }, null, 2)
            );
          }
        }
        return toolResult({ saved: true, quizId, questions: saved }, [school], { pageUrl });
      } catch (err) {
        const message = await explainD2lError(ctx, err, school, holder.auth, courseId);
        if (message === undefined) throw err;
        return errorResult(message);
      }
    }
  );
}
