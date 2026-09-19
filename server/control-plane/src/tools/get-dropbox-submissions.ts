import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { fetchClasslist } from "../api/classlist.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface DropboxFile {
  FileId: number;
  FileName: string;
  Size: number;
}
interface DropboxSubmissionEntry {
  Id: number;
  SubmissionDate: string;
  Files: DropboxFile[];
}
interface DropboxFeedback {
  Score: number | null;
  IsGraded: boolean;
}
interface EntityDropbox {
  Entity: { EntityId: number; EntityType: number } | null;
  Status: number;
  Submissions: DropboxSubmissionEntry[] | null;
  Feedback: DropboxFeedback | null;
  CompletionDate: string | null;
}
export interface StudentSubmission {
  studentUserId: string | null;
  studentName: string | null;
  status: number;
  completionDate: string | null;
  score: number | null;
  isGraded: boolean;
  submissions: { submittedDate: string; files: string[] }[];
}

// Scope follows the caller's role: with grading permission D2L returns every student's
// entry; a learner is not refused (no 403) but gets only their own entry — confirmed live
// against the NYP tenant — so callers must not read a single row as "one submission in
// the class". EntityId is a userId for individual folders but a groupId for group
// dropboxes, in which case classlist lookup just misses and studentName stays
// null (still returns the raw studentUserId for the caller to resolve via
// get_groups if needed).
export async function getDropboxSubmissions(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  folderId: number
): Promise<StudentSubmission[]> {
  const [entries, classlist] = await Promise.all([
    fetchAllPages<EntityDropbox>(school, resolveD2lPath("le.dropbox.submissionsPaged", { folderId }, numericId), cookieHeader),
    fetchClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return entries.map((e) => {
    const userId = e.Entity?.EntityId != null ? String(e.Entity.EntityId) : null;
    return {
      studentUserId: userId,
      studentName: userId ? nameById.get(userId) ?? null : null,
      status: e.Status,
      completionDate: e.CompletionDate,
      score: e.Feedback?.Score ?? null,
      isGraded: e.Feedback?.IsGraded ?? false,
      submissions: (e.Submissions ?? []).map((s) => ({
        submittedDate: s.SubmissionDate,
        files: (s.Files ?? []).map((f) => f.FileName),
      })),
    };
  });
}

export function registerGetDropboxSubmissions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_dropbox_submissions",
    {
      title: "Get dropbox submissions (instructor/TA)",
      description:
        "Get submissions for a dropbox/assignment folder — files, submission dates, score, and grading status. What you get depends on your role in the course: an instructor/TA/grader gets every student's submission; a learner is NOT refused but gets only their own entry, so a single-row result does not mean the class has one submission. To fetch your own submission with feedback, use get_my_dropbox_submission.",
      inputSchema: {
        courseId: courseIdField,
        folderId: z.number().describe("The dropbox folder's Id, from get_assignments"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, folderId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getDropboxSubmissions(school, c, id, folderId))
  );
}
