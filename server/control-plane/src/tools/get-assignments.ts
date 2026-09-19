// Output shape and behaviours adapted from brightspace-mcp-server's get_assignments (MIT,
// (c) 2026 Rohan Muppa — see THIRD_PARTY_NOTICES.md): dropbox folders and quizzes in one list,
// instructions as Markdown, rubric, the student's own submission and feedback, quiz attempt
// accounting that admits when the tenant won't say, and gradebook-only "heads-up" rows for work
// that is scored but has no assignment or quiz behind it.
// Differences on purpose:
//  - feedback comes from the embedded entry in /submissions/mysubmissions/ — the separate
//    /feedback/myFeedback/ route answers 404 on NYP, so reading it would silently lose feedback;
//  - quizzes come straight from the quiz list (it already returns full quiz objects);
//  - it spans every connected school, and says which courses/parts it could not read.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { apiGet, schoolBaseUrl } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { listCourses } from "../api/courses.js";
import { D2lHttpError, NotFoundError, PermissionDeniedError, SessionExpiredError } from "../api/errors.js";
import { htmlToMarkdown } from "../utils/html-to-markdown.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { assignmentUrl, quizUrl, gradebookUrl } from "../utils/deep-links.js";
import { READ_ONLY } from "./schemas.js";
import { toolResult, errorResult, runForD2LCourse, runAcrossD2LSchools } from "./helpers.js";

interface Rubric {
  Name: string;
  Criteria?: { Name: string; Levels?: { Name: string; Points: number; Description?: RichText | null }[] }[];
}
export interface DropboxFolder {
  Id: number;
  Name: string;
  CustomInstructions: RichText | null;
  DueDate: string | null;
  IsHidden: boolean;
  GradeItemId?: number | null;
  GroupTypeId: number | null;
  Attachments?: unknown[] | null;
  Assessment?: { ScoreDenominator: number | null; Rubrics?: Rubric[] } | null;
}
export interface MySubmissionEntry {
  Status: number;
  CompletionDate?: string | null;
  Feedback: { Score: number | null; Feedback: RichText | null; IsGraded?: boolean } | null;
  Submissions: { SubmissionDate: string; Comment: RichText | null; Files: { FileId: number; FileName: string; Size: number }[] | null }[] | null;
}

interface QuizRichText {
  Text?: { Text?: string | null; Html?: string | null } | string | null;
  Html?: string | null;
}
export interface QuizData {
  QuizId: number;
  Name: string;
  Description: QuizRichText | null;
  StartDate: string | null;
  EndDate: string | null;
  DueDate: string | null;
  IsActive: boolean;
  GradeItemId?: number | null;
  AttemptsAllowed: { IsUnlimited: boolean; NumberOfAttemptsAllowed: number | null } | null;
  SubmissionTimeLimit?: { IsEnforced: boolean; TimeLimitValue: number } | null;
  SubmissionGracePeriod?: number | null;
  Password?: string | null;
}
interface QuizAttempt {
  Score?: number | null;
  IsCompleted?: boolean;
  Completed?: string | null;
  CompletedDate?: string | null;
}
export interface GradeColumn {
  Id: number;
  Name: string;
  MaxPoints: number;
  GradeType?: string;
  IsHidden?: boolean;
  AssociatedTool?: { ToolId: number; ToolItemId: number } | null;
}

export interface AssignmentItem {
  type: "assignment" | "quiz" | "gradeOnly";
  id: number;
  name: string;
  url: string;
  dueDate: string | null;
  [key: string]: unknown;
}

// EntityDropbox.Status
const SUBMISSION_STATUS: Record<number, string> = { 0: "not submitted", 1: "submitted", 2: "draft", 3: "feedback published" };

// Quiz descriptions arrive nested one level deeper (Text.Html) on some tenants and flat on others.
function quizRichText(field: QuizRichText | null | undefined): string {
  if (!field) return "";
  const nested = typeof field.Text === "object" && field.Text !== null ? field.Text : null;
  const html = nested?.Html ?? field.Html ?? null;
  const md = htmlToMarkdown(html);
  if (md) return md;
  const text = nested?.Text ?? (typeof field.Text === "string" ? field.Text : "");
  return (text ?? "").trim();
}

function richMarkdown(d: RichText | null | undefined): string {
  return htmlToMarkdown(d?.Html) || (d?.Text ?? "").trim();
}

export function mapFolder(folder: DropboxFolder, entry: MySubmissionEntry | null | undefined, base: string, courseNumericId: number): AssignmentItem {
  const instructions = richMarkdown(folder.CustomInstructions);
  const rubrics = (folder.Assessment?.Rubrics ?? []).map((r) => ({
    name: r.Name,
    criteria: (r.Criteria ?? []).map((c) => ({
      name: c.Name,
      levels: (c.Levels ?? []).map((l) => ({ name: l.Name, points: l.Points, description: l.Description?.Text || null })),
    })),
  }));
  // The most recent submission, since D2L keeps every resubmission.
  const latest = [...(entry?.Submissions ?? [])].sort((a, b) => Date.parse(b.SubmissionDate) - Date.parse(a.SubmissionDate))[0];
  const feedbackText = richMarkdown(entry?.Feedback?.Feedback);

  return {
    type: "assignment",
    id: folder.Id,
    name: folder.Name,
    url: assignmentUrl(base, courseNumericId, folder.Id),
    dueDate: folder.DueDate,
    ...(instructions ? { instructions } : {}),
    points: folder.Assessment?.ScoreDenominator ?? null,
    isGroup: folder.GroupTypeId !== null,
    ...(folder.Attachments?.length ? { attachmentCount: folder.Attachments.length } : {}),
    ...(rubrics.length ? { rubric: rubrics } : {}),
    // null = the submission state could not be read, which is not the same as "not submitted".
    submissionStatus: entry ? (SUBMISSION_STATUS[entry.Status] ?? `status ${entry.Status}`) : null,
    submission: latest
      ? {
          submittedDate: latest.SubmissionDate,
          files: (latest.Files ?? []).map((f) => ({ name: f.FileName, size: f.Size, fileId: f.FileId })),
          comment: latest.Comment?.Text || null,
        }
      : null,
    feedback: entry?.Feedback ? { score: entry.Feedback.Score, ...(feedbackText ? { feedback: feedbackText } : {}) } : null,
  };
}

export function mapQuiz(quiz: QuizData, attempts: QuizAttempt[] | null, base: string, courseNumericId: number): AssignmentItem {
  const completed = attempts?.filter((a) => a.IsCompleted === true || a.Completed || a.CompletedDate) ?? null;
  const allowed = quiz.AttemptsAllowed;
  let attemptsRemaining: number | "Unlimited" | null = null;
  let attemptWarning: string | undefined;
  if (completed) {
    attemptsRemaining = "Unlimited";
    if (allowed && !allowed.IsUnlimited) {
      attemptsRemaining = (allowed.NumberOfAttemptsAllowed ?? 0) - completed.length;
      if (attemptsRemaining <= 0) attemptWarning = "No attempts remaining";
      else if (attemptsRemaining === 1) attemptWarning = "Only 1 attempt remaining";
    }
  }
  const instructions = quizRichText(quiz.Description);
  const limit = quiz.SubmissionTimeLimit;
  return {
    type: "quiz",
    id: quiz.QuizId,
    name: quiz.Name,
    url: quizUrl(base, courseNumericId, quiz.QuizId),
    dueDate: quiz.DueDate,
    startDate: quiz.StartDate,
    endDate: quiz.EndDate,
    ...(instructions ? { instructions } : {}),
    timeLimitMinutes: limit?.IsEnforced ? limit.TimeLimitValue : null,
    attemptsAllowed: allowed?.IsUnlimited ? "Unlimited" : (allowed?.NumberOfAttemptsAllowed ?? null),
    // False when the tenant refused the attempts route (students get 403 on NYP): every count is
    // then null rather than a guess of zero.
    attemptsAvailable: completed !== null,
    attemptsUsed: completed?.length ?? null,
    attemptsRemaining,
    ...(attemptWarning ? { attemptWarning } : {}),
    bestScore: completed && completed.length ? Math.max(...completed.map((a) => a.Score ?? 0)) : null,
    gracePeriodMinutes: quiz.SubmissionGracePeriod ?? null,
    hasPassword: Boolean(quiz.Password),
  };
}

// The grade types a student is actually scored on; the rest (calculated, formula) are the
// gradebook's own arithmetic, not work anybody owes.
const STUDENT_SCORED = new Set(["numeric", "passfail", "selectbox", "text"]);

// Gradebook columns that describe work no fetched assignment or quiz explains. A column counts as
// explained when it is linked to a fetched item — by its AssociatedTool or by the item's own
// GradeItemId — not merely "unlinked", because a released exam's column IS linked, to a quiz the
// student's own quiz list may not show, and that column is the whole reason this exists.
export function gradebookOnlyItems(columns: GradeColumn[], fetched: { ids: Set<number>; gradeItemIds: Set<number> }, base: string, courseNumericId: number): AssignmentItem[] {
  const rows: AssignmentItem[] = [];
  for (const c of columns) {
    if (c.IsHidden) continue;
    if (!STUDENT_SCORED.has(String(c.GradeType ?? "").toLowerCase())) continue;
    if (c.AssociatedTool && fetched.ids.has(c.AssociatedTool.ToolItemId)) continue;
    if (fetched.gradeItemIds.has(c.Id)) continue;
    if (typeof c.Id !== "number" || typeof c.Name !== "string") continue; // one malformed row costs only itself
    rows.push({ type: "gradeOnly", id: c.Id, name: c.Name, url: gradebookUrl(base, courseNumericId), points: c.MaxPoints ?? null, dueDate: null });
  }
  return rows;
}

const byDueDate = (a: AssignmentItem, b: AssignmentItem) =>
  a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : Date.parse(a.dueDate) - Date.parse(b.dueDate);

function why(err: unknown): string {
  return err instanceof D2lHttpError ? `D2L answered ${err.status}` : "unexpected error";
}

export async function fetchCourseAssignments(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number
): Promise<{ items: AssignmentItem[]; warnings: string[] }> {
  const base = schoolBaseUrl(school);
  const [folderR, quizR, gradeR] = await Promise.allSettled([
    apiGet<DropboxFolder[]>(school, resolveD2lPath("le.dropbox.foldersList", {}, numericId), cookieHeader),
    fetchAllPages<QuizData>(school, resolveD2lPath("le.quizzes.list", {}, numericId), cookieHeader),
    apiGet<GradeColumn[]>(school, resolveD2lPath("le.grades.definitionsList", {}, numericId), cookieHeader),
  ]);
  for (const r of [folderR, quizR, gradeR]) if (r.status === "rejected" && r.reason instanceof SessionExpiredError) throw r.reason;
  // Both primary lists failing means the course itself is the problem — surface that, not "empty".
  if (folderR.status === "rejected" && quizR.status === "rejected") throw folderR.reason;

  const warnings: string[] = [];
  const items: AssignmentItem[] = [];
  const fetched = { ids: new Set<number>(), gradeItemIds: new Set<number>() };
  let submissionsUnreadable = false;

  if (folderR.status === "fulfilled") {
    const folders = folderR.value.filter((f) => !f.IsHidden);
    const entries = await mapWithConcurrency(folders, 4, async (f) => {
      try {
        return (await apiGet<MySubmissionEntry[]>(school, resolveD2lPath("le.dropbox.mySubmissions", { folderId: f.Id }, numericId), cookieHeader))[0] ?? null;
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        if (!(err instanceof D2lHttpError)) throw err;
        submissionsUnreadable = true;
        return null;
      }
    });
    folders.forEach((f, i) => {
      items.push(mapFolder(f, entries[i], base, numericId));
      fetched.ids.add(f.Id);
      if (f.GradeItemId) fetched.gradeItemIds.add(f.GradeItemId);
    });
    if (submissionsUnreadable) warnings.push("Your submission status could not be read for some assignments (submissionStatus is null there).");
  } else {
    warnings.push(`Assignments could not be read (${why(folderR.reason)}).`);
  }

  if (quizR.status === "fulfilled") {
    // Students get 403 on the attempts route on some tenants; once one quiz proves it, the rest
    // would answer the same, so they aren't asked.
    let attemptsForbidden = false;
    for (const quiz of quizR.value) {
      if (!quiz.IsActive) continue;
      let attempts: QuizAttempt[] | null = null;
      if (!attemptsForbidden) {
        try {
          attempts = await fetchAllPages<QuizAttempt>(school, resolveD2lPath("le.quizzes.attempts", { quizId: quiz.QuizId }, numericId), cookieHeader);
        } catch (err) {
          if (err instanceof NotFoundError) attempts = []; // no attempts yet is a measurement of zero
          else if (err instanceof PermissionDeniedError) attemptsForbidden = true;
          else if (!(err instanceof D2lHttpError)) throw err;
        }
      }
      items.push(mapQuiz(quiz, attempts, base, numericId));
      fetched.ids.add(quiz.QuizId);
      if (quiz.GradeItemId) fetched.gradeItemIds.add(quiz.GradeItemId);
    }
  } else {
    warnings.push(`Quizzes could not be read (${why(quizR.reason)}).`);
  }

  if (gradeR.status === "fulfilled" && Array.isArray(gradeR.value)) {
    items.push(...gradebookOnlyItems(gradeR.value, fetched, base, numericId));
  } else if (gradeR.status === "rejected") {
    warnings.push(`The gradebook could not be read (${why(gradeR.reason)}), so scored items without an assignment or quiz are not listed.`);
  }

  return { items: items.sort(byDueDate), warnings };
}

export function registerGetAssignments(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_assignments",
    {
      title: "Get assignments",
      description:
        "Fetch assignments and quizzes, soonest due first, for one course or — if courseId is omitted — every active course on every connected school. Each assignment shows its due date, points, instructions (Markdown), rubric, whether YOU have submitted (submissionStatus), your submitted files and any feedback/score; each quiz shows dates, time limit and attempts. type 'gradeOnly' rows are scored items with no assignment or quiz behind them (e.g. an in-class test). attachmentCount > 0 means the instructor attached files: read them with get_assignment_files. Use this when the user asks about assignments, homework, what to submit, what is due, quizzes, rubrics or feedback.",
      inputSchema: {
        courseId: z.string().optional().describe("The course's courseId, from list_courses. If omitted, returns assignments for all active courses."),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => {
      if (courseId) {
        return runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
          const { items, warnings } = await fetchCourseAssignments(school, cookie, id);
          return { courseId, count: items.length, assignments: items, ...(warnings.length ? { warnings } : {}) };
        });
      }

      const skippedCourses: string[] = [];
      const courseWarnings: string[] = [];
      let withoutAssignments = 0;
      const { results, warnings, attempted, failed } = await runAcrossD2LSchools(ctx, async (school, cookie) => {
        const courses = (await listCourses(school, cookie)).filter((c) => c.isActive);
        const per = await mapWithConcurrency(courses, 3, async (course) => {
          try {
            const { items, warnings: w } = await fetchCourseAssignments(school, cookie, Number(course.courseId.split(":")[1]));
            courseWarnings.push(...w.map((m) => `${course.courseId}: ${m}`));
            if (items.length === 0) {
              withoutAssignments++;
              return [];
            }
            return [{ courseId: course.courseId, courseName: course.name, assignments: items }];
          } catch (err) {
            if (err instanceof D2lHttpError) {
              skippedCourses.push(`${course.courseId} (${course.name}): D2L answered ${err.status}`);
              return [];
            }
            throw err;
          }
        });
        return per.flat();
      });

      if (attempted > 0 && failed === attempted) return errorResult(warnings.join("\n"));
      const allWarnings = [...warnings, ...courseWarnings];
      return toolResult({
        courses: results,
        coursesWithoutAssignments: withoutAssignments,
        ...(skippedCourses.length ? { skippedCourses } : {}),
        ...(allWarnings.length ? { warnings: allWarnings } : {}),
      });
    }
  );
}
