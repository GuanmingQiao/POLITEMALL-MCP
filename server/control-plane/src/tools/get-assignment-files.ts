// Behaviour adapted from brightspace-mcp-server's get_assignment_files (MIT, (c) 2026 Rohan
// Muppa — see THIRD_PARTY_NOTICES.md): list which assignments have instructor attachments, then
// read one and return its text, so a student can ask what an assignment actually requires.
// Differences on purpose: attachments are untrusted input on a shared server, so downloads are
// capped at MAX_DOWNLOAD_BYTES, PDF parsing is time-limited and zip entries can't inflate past a
// limit; nothing is written to disk (this hosted tool has no filesystem to hand back).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet, apiGetBuffer, schoolBaseUrl, FileTooLargeError } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { extractPdfText } from "../utils/pdf-text.js";
import { officeDocumentText } from "../utils/zip-text.js";
import { assignmentUrl } from "../utils/deep-links.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

interface Attachment {
  FileId: number;
  FileName: string;
  Size: number;
}
interface FolderWithFiles {
  Id: number;
  Name: string;
  DueDate: string | null;
  IsHidden: boolean;
  Attachments?: Attachment[] | null;
  LinkAttachments?: { LinkId?: number; LinkName?: string; Href?: string }[] | null;
}

export type FileKind = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text" | "other";

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", pptx: "pptx",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  txt: "text", md: "text", csv: "text", json: "text",
};

export function fileKind(fileName: string): FileKind {
  return KIND_BY_EXTENSION[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "other";
}

const describeAttachment = (a: Attachment) => ({ fileId: a.FileId, fileName: a.FileName, size: a.Size, kind: fileKind(a.FileName) });

// Text from a downloaded file. Best effort: a scanned PDF or an image yields nothing, and that is
// reported as a note rather than treated as a failure.
export async function extractFileText(kind: FileKind, buffer: Buffer): Promise<{ text: string | null; note?: string }> {
  switch (kind) {
    case "pdf": {
      const text = (await extractPdfText(buffer))?.text?.trim() || null;
      return text ? { text } : { text: null, note: "No text layer in this PDF (it may be a scan) or it could not be read." };
    }
    case "docx":
    case "xlsx":
    case "pptx": {
      const text = officeDocumentText(buffer);
      return text ? { text } : { text: null, note: "No readable text found in this Office document." };
    }
    case "text":
      return { text: buffer.toString("utf-8").trim() || null };
    default:
      return { text: null, note: `Cannot extract text from a ${kind} file.` };
  }
}

async function visibleFolders(school: D2LSchool, cookie: string, numericId: number, folderId?: number): Promise<FolderWithFiles[]> {
  const all = await apiGet<FolderWithFiles[]>(school, resolveD2lPath("le.dropbox.foldersList", {}, numericId), cookie);
  return all.filter((f) => f.IsHidden !== true).filter((f) => folderId === undefined || f.Id === folderId);
}

export async function readAttachment(
  school: D2LSchool,
  cookie: string,
  numericId: number,
  folderId: number,
  attachment: Attachment,
  extract: boolean,
  maxChars: number
) {
  const base = describeAttachment(attachment);
  if (!extract) return { ...base, text: null, note: "Text extraction was not requested." };

  let buffer: Buffer;
  try {
    buffer = await apiGetBuffer(school, resolveD2lPath("le.dropbox.folderAttachment", { folderId, fileId: attachment.FileId }, numericId), cookie, MAX_DOWNLOAD_BYTES);
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      return { ...base, text: null, note: `File is larger than ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB, so it was not read. Open it from the assignment page instead.` };
    }
    throw err;
  }

  const { text, note } = await extractFileText(base.kind, buffer);
  const truncated = text !== null && text.length > maxChars;
  return { ...base, bytes: buffer.length, text: truncated ? text!.slice(0, maxChars) : text, truncated, ...(note ? { note } : {}) };
}

export function registerGetAssignmentFiles(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_assignment_files",
    {
      title: "Get assignment files",
      description:
        "Read the files an instructor attached to an assignment: the brief or instructions PDF, a starter workbook, a rubric document. Call it with just courseId to see which assignments have attachments (no file is opened), then again with folderId and fileId to read one — the response contains the file's text. Use this when the user asks what an assignment requires, what the instructions say, or wants a handout summarised. folderId comes from get_assignments (the assignment's id).",
      inputSchema: {
        courseId: courseIdField,
        folderId: z.number().int().positive().optional().describe("Assignment (dropbox folder) id. Omit to list every assignment in the course that has attachments."),
        fileId: z.number().int().positive().optional().describe("Attachment file id to read. Requires folderId. Omit to list files without reading them."),
        extractText: z.boolean().optional().describe("Extract readable text (PDF, DOCX, XLSX, PPTX, plain text). Default true."),
        maxChars: z.number().int().positive().max(100000).optional().describe("Maximum characters of text to return (default 12000). The response says whether it was truncated."),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, folderId, fileId, extractText, maxChars }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
        const base = schoolBaseUrl(school);
        if (fileId !== undefined && folderId === undefined) throw new Error("folderId is required when fileId is given.");

        const folders = await visibleFolders(school, cookie, id, folderId);
        if (folderId !== undefined && folders.length === 0) {
          throw new Error(`No visible assignment with id ${folderId} in ${courseId}. Use get_assignments to see the assignment ids.`);
        }

        if (fileId !== undefined) {
          const folder = folders[0];
          const attachment = (folder.Attachments ?? []).find((a) => a.FileId === fileId);
          if (!attachment) {
            throw new Error(
              `No attachment with id ${fileId} on assignment "${folder.Name}". Available: ${(folder.Attachments ?? []).map((a) => `${a.FileId} (${a.FileName})`).join(", ") || "none"}.`
            );
          }
          return {
            courseId,
            folderId: folder.Id,
            folderName: folder.Name,
            url: assignmentUrl(base, id, folder.Id),
            file: await readAttachment(school, cookie, id, folder.Id, attachment, extractText ?? true, maxChars ?? 12000),
          };
        }

        const withFiles = folders
          .filter((f) => (f.Attachments ?? []).length > 0 || (f.LinkAttachments ?? []).length > 0)
          .map((f) => ({
            folderId: f.Id,
            folderName: f.Name,
            dueDate: f.DueDate,
            url: assignmentUrl(base, id, f.Id),
            attachments: (f.Attachments ?? []).map(describeAttachment),
            ...((f.LinkAttachments ?? []).length ? { links: f.LinkAttachments!.map((l) => ({ name: l.LinkName ?? null, url: l.Href ?? null })) } : {}),
          }));
        return {
          courseId,
          assignments: withFiles,
          ...(withFiles.length === 0 ? { note: "No assignment in this course has an attached file or link." } : {}),
        };
      })
  );
}
