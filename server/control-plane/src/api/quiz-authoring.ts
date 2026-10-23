import { z } from "zod";
import { compareVersions } from "./d2l-versions.js";
import { versionedPath } from "./d2l-client.js";

// Everything the quiz-writing tools know about D2L's quiz and question write models: the friendly
// input they accept, the conversion to Valence request bodies, and the routes. Pure functions
// only; sending is done by the tools. The D2L shapes here follow the Valence docs and are the
// part to correct first if a live tenant disagrees (see openspec change add-quiz-write-tools,
// task 1.1): rich text, weights and enum values are each defined in exactly one place below.

// First `le` version with the question write routes.
export const MIN_QUESTION_WRITE_VERSION = "1.100";
export const MAX_QUESTIONS_PER_CALL = 100;

export function supportsQuestionWrites(leVersion: string): boolean {
  return compareVersions(leVersion, MIN_QUESTION_WRITE_VERSION) >= 0;
}

// --- routes ------------------------------------------------------------------------------

export const quizCreatePath = (orgUnitId: number) => versionedPath("le", `/${orgUnitId}/quizzes/`);
export const quizPath = (orgUnitId: number, quizId: number) => versionedPath("le", `/${orgUnitId}/quizzes/${quizId}`);
export const questionCreatePath = (orgUnitId: number, quizId: number) => versionedPath("le", `/${orgUnitId}/quizzes/${quizId}/questions/`);
export const questionPath = (orgUnitId: number, quizId: number, questionId: number) =>
  versionedPath("le", `/${orgUnitId}/quizzes/${quizId}/questions/${questionId}`);

// --- rich text and weights (the D2L-specific constants) ----------------------------------

export type TextFormat = "text" | "html";
export interface RichTextInput {
  Content: string;
  Type: "Text" | "Html";
}
export const rich = (content: string, format: TextFormat = "text"): RichTextInput => ({ Content: content, Type: format === "html" ? "Html" : "Text" });
const richOrNull = (content: string | undefined, format: TextFormat): RichTextInput | null => (content ? rich(content, format) : null);

const CORRECT_WEIGHT = 1;
const WRONG_WEIGHT = 0;

// QUESTION_T
const QUESTION_TYPE = {
  multiple_choice: 1,
  true_false: 2,
  multi_select: 4,
  matching: 5,
  ordering: 6,
  written_response: 7,
  short_answer: 8,
} as const;

// --- quiz settings -----------------------------------------------------------------------

const isoDate = z.string().datetime({ offset: true }).describe("ISO 8601 date-time with a time zone, e.g. 2026-11-02T09:00:00+08:00");

export const quizSettingsShape = {
  instructions: z.string().optional().describe("Instructions shown to students at the top of the quiz (plain text)"),
  description: z.string().optional().describe("Description shown on the quiz list (plain text)"),
  isActive: z.boolean().optional().describe("Whether students can see the quiz. create_quiz defaults to false (hidden)"),
  startDate: isoDate.nullable().optional().describe("When the quiz becomes available. null clears it"),
  endDate: isoDate.nullable().optional().describe("When the quiz stops being available. null clears it"),
  dueDate: isoDate.nullable().optional().describe("Due date; later attempts are late. null clears it"),
  attemptsAllowed: z.number().int().min(1).max(10).nullable().optional().describe("Attempts per student, 1 to 10. null means unlimited"),
  timeLimitMinutes: z.number().int().min(0).max(9999).nullable().optional().describe("Time limit in minutes, 1 to 9999, enforced by D2L. 0 or null means no time limit"),
  shuffleQuestions: z.boolean().optional().describe("Present the questions in a random order"),
  allowHints: z.boolean().optional().describe("Let students see question hints"),
  preventMovingBackwards: z.boolean().optional().describe("Stop students returning to earlier questions"),
} as const;

const settingsObject = z.object(quizSettingsShape);
export type QuizSettings = z.infer<typeof settingsObject>;

const SETTING_KEYS = Object.keys(quizSettingsShape) as (keyof QuizSettings)[];
export const suppliedSettings = (s: QuizSettings): (keyof QuizSettings)[] => SETTING_KEYS.filter((k) => s[k] !== undefined);

// Cross-field rules that a per-field schema cannot express. Returns messages, empty when fine.
export function checkSettings(s: QuizSettings): string[] {
  const problems: string[] = [];
  const t = (v: string | null | undefined) => (v ? Date.parse(v) : undefined);
  const [start, end, due] = [t(s.startDate), t(s.endDate), t(s.dueDate)];
  if (start !== undefined && end !== undefined && end < start) problems.push("endDate is earlier than startDate");
  if (start !== undefined && due !== undefined && due < start) problems.push("dueDate is earlier than startDate");
  return problems;
}

const utc = (v: string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

// A rich-text block as the QuizData model wants it.
const block = (text: string | undefined, shown: boolean) => ({ Text: rich(text ?? ""), IsDisplayed: shown });

// Every QuizData property with the value a new quiz gets when the caller says nothing.
export function buildQuizCreateBody(name: string, s: QuizSettings): Record<string, unknown> {
  const limit = s.timeLimitMinutes ?? 0;
  return {
    Name: name,
    IsActive: s.isActive ?? false,
    SortOrder: 0,
    AutoExportToGrades: false,
    GradeItemId: null,
    IsAutoSetGraded: false,
    Instructions: block(s.instructions, s.instructions !== undefined),
    Description: block(s.description, s.description !== undefined),
    Header: block(undefined, false),
    Footer: block(undefined, false),
    StartDate: utc(s.startDate),
    EndDate: utc(s.endDate),
    DueDate: utc(s.dueDate),
    DisplayInCalendar: false,
    NumberOfAttemptsAllowed: s.attemptsAllowed ?? null,
    LateSubmissionInfo: { LateSubmissionOption: 0, LateLimitMinutes: null },
    SubmissionTimeLimit: { IsEnforced: limit > 0, ShowClock: true, TimeLimitValue: limit },
    SubmissionGracePeriod: 0,
    Password: null,
    AllowHints: s.allowHints ?? false,
    DisableRightClick: false,
    DisablePagerAndAlerts: false,
    NotificationEmail: null,
    CalcTypeId: 1,
    RestrictIPAddressRange: null,
    CategoryId: null,
    PreventMovingBackwards: s.preventMovingBackwards ?? false,
    Shuffle: s.shuffleQuestions ?? false,
    AllowOnlyUsersWithSpecialAccess: false,
    IsRetakeIncorrectOnly: false,
    PagingTypeId: null,
    IsSynchronous: false,
    DeductionPercentage: null,
    HideQuestionPoints: false,
    IsSingleSession: false,
    AnnotationToolsEnabled: true,
  };
}

// The QuizData properties a PUT carries (everything buildQuizCreateBody sets).
const QUIZ_DATA_KEYS = Object.keys(buildQuizCreateBody("", {}));
const RICH_BLOCK_KEYS = ["Instructions", "Description", "Header", "Footer"];

interface ReadRichText {
  Text?: string | null;
  Html?: string | null;
}

// A quiz as D2L returns it (QuizReadData) turned into a body that can be sent back (QuizData),
// so a PUT that only means to change one setting leaves every other one as it was.
export function toWriteModel(read: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // D2L reports attempts as { IsUnlimited, NumberOfAttemptsAllowed } but takes the bare number.
  const attempts = read.AttemptsAllowed as { IsUnlimited?: boolean; NumberOfAttemptsAllowed?: number | null } | undefined;
  if (attempts && typeof attempts === "object") body.NumberOfAttemptsAllowed = attempts.IsUnlimited ? null : (attempts.NumberOfAttemptsAllowed ?? null);
  for (const key of QUIZ_DATA_KEYS) {
    if (!(key in read)) continue;
    const value = read[key];
    if (RICH_BLOCK_KEYS.includes(key) && value && typeof value === "object") {
      const { Text, IsDisplayed } = value as { Text?: ReadRichText | null; IsDisplayed?: boolean };
      const html = Text?.Html;
      body[key] = { Text: html ? rich(html, "html") : rich(Text?.Text ?? ""), IsDisplayed: IsDisplayed ?? false };
    } else {
      body[key] = value;
    }
  }
  return body;
}

// Overlays only the settings the caller supplied onto a write model.
export function applyQuizPatch(current: Record<string, unknown>, name: string | undefined, s: QuizSettings): Record<string, unknown> {
  const body = { ...current };
  if (name !== undefined) body.Name = name;
  if (s.isActive !== undefined) body.IsActive = s.isActive;
  if (s.instructions !== undefined) body.Instructions = block(s.instructions, true);
  if (s.description !== undefined) body.Description = block(s.description, true);
  if (s.startDate !== undefined) body.StartDate = utc(s.startDate);
  if (s.endDate !== undefined) body.EndDate = utc(s.endDate);
  if (s.dueDate !== undefined) body.DueDate = utc(s.dueDate);
  if (s.attemptsAllowed !== undefined) body.NumberOfAttemptsAllowed = s.attemptsAllowed;
  if (s.timeLimitMinutes !== undefined) {
    const limit = s.timeLimitMinutes ?? 0;
    const previous = (current.SubmissionTimeLimit ?? {}) as Record<string, unknown>;
    body.SubmissionTimeLimit = { IsEnforced: limit > 0, ShowClock: previous.ShowClock ?? true, TimeLimitValue: limit };
  }
  if (s.shuffleQuestions !== undefined) body.Shuffle = s.shuffleQuestions;
  if (s.allowHints !== undefined) body.AllowHints = s.allowHints;
  if (s.preventMovingBackwards !== undefined) body.PreventMovingBackwards = s.preventMovingBackwards;
  return body;
}

// --- questions ---------------------------------------------------------------------------

const text = z.string().min(1).describe("The question text");
const common = {
  text,
  textFormat: z.enum(["text", "html"]).optional().describe('"text" (default) shows all characters literally; "html" lets the text and answers contain HTML markup'),
  points: z.number().min(0).max(10000).optional().describe("Points the question is worth (default 1)"),
  hint: z.string().optional().describe("Hint shown to students when the quiz allows hints"),
  feedback: z.string().optional().describe("General feedback shown after the question is marked"),
  questionId: z.number().int().optional().describe("Set this to update the existing question with this id (from get_quiz_questions or an earlier save). Leave out to create a new question. The question's type cannot be changed"),
};
const answerText = z.string().min(1);
const choice = z.object({
  text: answerText.describe("The answer as students see it"),
  correct: z.boolean().describe("Whether this answer is correct"),
  feedback: z.string().optional().describe("Feedback shown when a student picks this answer"),
});

export const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("multiple_choice"),
    ...common,
    answers: z.array(choice).min(2).max(20).describe("The options. Exactly one must have correct: true"),
    randomize: z.boolean().optional().describe("Shuffle the options for each student"),
  }),
  z.object({
    type: z.literal("true_false"),
    ...common,
    answer: z.boolean().describe("Whether the statement is true"),
    trueFeedback: z.string().optional(),
    falseFeedback: z.string().optional(),
  }),
  z.object({
    type: z.literal("multi_select"),
    ...common,
    answers: z.array(choice).min(2).max(20).describe("The options. At least one must have correct: true"),
    randomize: z.boolean().optional().describe("Shuffle the options for each student"),
  }),
  z.object({
    type: z.literal("short_answer"),
    ...common,
    answers: z.array(answerText).min(1).max(20).describe("Every accepted answer; a student's response is correct if it matches any of them"),
  }),
  z.object({
    type: z.literal("written_response"),
    ...common,
    answerKey: z.string().optional().describe("A model answer shown to markers. Written responses are graded by hand"),
  }),
  z.object({
    type: z.literal("matching"),
    ...common,
    pairs: z.array(z.object({ prompt: answerText, match: answerText })).min(2).max(20).describe("Each prompt and the choice it correctly matches"),
    distractors: z.array(answerText).max(20).optional().describe("Extra wrong choices that match no prompt"),
  }),
  z.object({
    type: z.literal("ordering"),
    ...common,
    items: z.array(answerText).min(2).max(20).describe("The items in their correct order; students see them shuffled"),
  }),
]);

export type QuestionInput = z.infer<typeof questionSchema>;
export const questionTypes = Object.keys(QUESTION_TYPE);

// Rules a per-field schema cannot express. Returns messages, empty when fine.
export function checkQuestion(q: QuestionInput): string[] {
  if (q.type === "multiple_choice") {
    const n = q.answers.filter((a) => a.correct).length;
    return n === 1 ? [] : [`a multiple_choice question needs exactly one correct answer, this has ${n}`];
  }
  if (q.type === "multi_select") {
    return q.answers.some((a) => a.correct) ? [] : ["a multi_select question needs at least one correct answer"];
  }
  return [];
}

export function buildQuestion(q: QuestionInput): Record<string, unknown> {
  const f: TextFormat = q.textFormat ?? "text";
  const r = (s: string) => rich(s, f);
  const ro = (s: string | undefined) => richOrNull(s, f);
  const info: Record<string, unknown> = { QuestionText: r(q.text) };

  switch (q.type) {
    case "multiple_choice":
      info.Randomize = q.randomize ?? false;
      info.Enumeration = null;
      info.Answers = q.answers.map((a) => ({ Answer: r(a.text), Weight: a.correct ? CORRECT_WEIGHT : WRONG_WEIGHT, AnswerFeedback: ro(a.feedback) }));
      break;
    case "true_false":
      info.IsTrue = q.answer;
      info.Enumeration = null;
      info.TrueFeedback = ro(q.trueFeedback);
      info.FalseFeedback = ro(q.falseFeedback);
      break;
    case "multi_select":
      info.Randomize = q.randomize ?? false;
      info.Enumeration = null;
      info.GradingType = null;
      info.Answers = q.answers.map((a) => ({ Answer: r(a.text), IsCorrect: a.correct, AnswerFeedback: ro(a.feedback) }));
      break;
    case "short_answer":
      info.GradingType = null;
      info.Blanks = [{ Answers: q.answers, EvaluationType: null }];
      break;
    case "written_response":
      info.InitialText = null;
      info.AnswerKey = ro(q.answerKey);
      info.EnableStudentEditor = null;
      info.EnableAttachments = null;
      break;
    case "matching": {
      // One choice per distinct text, so two prompts with the same answer share a choice.
      const ids = new Map<string, string>();
      const choices: { ChoiceId: string; Choice: RichTextInput }[] = [];
      const idFor = (t: string) => {
        let id = ids.get(t);
        if (!id) {
          id = `c${ids.size + 1}`;
          ids.set(t, id);
          choices.push({ ChoiceId: id, Choice: r(t) });
        }
        return id;
      };
      const prompts = q.pairs.map((p) => ({ Prompt: r(p.prompt), CorrectChoiceId: idFor(p.match) }));
      for (const d of q.distractors ?? []) idFor(d);
      info.GradingType = null;
      info.Choices = choices;
      info.Prompts = prompts;
      break;
    }
    case "ordering":
      info.GradingType = null;
      info.Items = q.items.map((i) => ({ Item: r(i), ItemFeedback: null }));
      break;
  }

  return dropNulls({
    QuestionTypeId: QUESTION_TYPE[q.type],
    Name: null,
    Points: q.points ?? 1,
    Bonus: false,
    Mandatory: false,
    Difficulty: null,
    Hint: ro(q.hint),
    Feedback: ro(q.feedback),
    QuestionInfo: info,
  });
}

// D2L answers a JSON binding error (400) to a question body that contains a null, so a value that
// is not set is left out instead.
function dropNulls<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => (v === null ? undefined : v)));
}
