import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface MyDropboxSubmissionEntry {
  Id: number;
  SubmittedBy: number | null;
  SubmissionDate: string;
  Comment: RichText | null;
  Files: { FileId: number; FileName: string; Size: number }[] | null;
}
interface MyDropboxFeedback {
  Score: number | null;
  Feedback: RichText | null;
  IsGraded: boolean;
}
interface MyDropboxEntry {
  Status: number;
  CompletionDate: string | null;
  Feedback: MyDropboxFeedback | null;
  Submissions: MyDropboxSubmissionEntry[] | null;
}
export interface MyDropboxSubmission {
  status: number;
  completionDate: string | null;
  score: number | null;
  isGraded: boolean;
  feedbackText: string | null;
  submissions: { submittedDate: string; comment: string | null; files: string[] }[];
}

export async function getMyDropboxSubmission(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  folderId: number
): Promise<MyDropboxSubmission[]> {
  const entries = await apiGet<MyDropboxEntry[]>(school, resolveD2lPath("le.dropbox.mySubmissions", { folderId }, numericId), cookieHeader);
  return entries.map((e) => ({
    status: e.Status,
    completionDate: e.CompletionDate,
    score: e.Feedback?.Score ?? null,
    isGraded: e.Feedback?.IsGraded ?? false,
    feedbackText: e.Feedback?.Feedback?.Text ?? null,
    submissions: (e.Submissions ?? []).map((s) => ({
      submittedDate: s.SubmissionDate,
      comment: s.Comment?.Text ?? null,
      files: (s.Files ?? []).map((f) => f.FileName),
    })),
  }));
}

export function registerGetMyDropboxSubmission(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_my_dropbox_submission",
    {
      title: "Get my dropbox submission",
      description:
        "Get your own submission (files, dates, score, feedback) for a dropbox/assignment folder. Student-facing counterpart to get_dropbox_submissions, which is instructor/TA-only.",
      inputSchema: {
        courseId: courseIdField,
        folderId: z.number().describe("The dropbox folder's Id, from get_assignments"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, folderId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getMyDropboxSubmission(school, c, id, folderId))
  );
}
