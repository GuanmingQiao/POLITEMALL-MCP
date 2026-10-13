import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet, apiGetBuffer, FileTooLargeError } from "../api/d2l-client.js";
import { NotFoundError } from "../api/errors.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { extractPdfText } from "../utils/pdf-text.js";
import { listZipEntries, officeDocumentText } from "../utils/zip-text.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, containsUrl, linked, withSourceUrl } from "./provenance.js";
import { runForD2LCourse } from "./helpers.js";

export const MAX_TOPIC_FILE_BYTES = 25 * 1024 * 1024;

// Only .pdf and .docx are read here. The download carries no usable file name, so the format is
// recognised from the bytes themselves: "%PDF-" for a PDF, a ZIP holding word/document.xml for a
// DOCX (a .pptx/.xlsx is also a ZIP, but is deliberately left alone).
export function detectTopicFileFormat(bytes: Buffer): "pdf" | "docx" | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.length > 3 && bytes.readUInt32LE(0) === 0x04034b50 && listZipEntries(bytes)?.includes("word/document.xml")) return "docx";
  return null;
}

// Fields to add to a file-type topic's metadata: `extractedText` on success, an explanatory
// `extractedTextUnavailable` when the file is too large or unreadable, and nothing at all for a
// non-file topic or an unsupported format. A 404 on the file route is the normal answer for a
// link or native-page topic; session and permission failures still propagate.
export async function topicFileText(school: D2LSchool, cookie: string, numericId: number, topicId: number): Promise<Record<string, string>> {
  let bytes: Buffer;
  try {
    bytes = await apiGetBuffer(school, resolveD2lPath("le.content.topicFile", { topicId }, numericId), cookie, MAX_TOPIC_FILE_BYTES);
  } catch (err) {
    if (err instanceof NotFoundError) return {};
    if (err instanceof FileTooLargeError) {
      return { extractedTextUnavailable: "This file exceeds the maximum size supported for text extraction." };
    }
    throw err;
  }
  const format = detectTopicFileFormat(bytes);
  if (!format) return {};
  const text = format === "pdf" ? (await extractPdfText(bytes))?.text?.trim() : officeDocumentText(bytes);
  return text
    ? { extractedText: text }
    : { extractedTextUnavailable: "No readable text could be extracted (the file may be scanned, empty, or corrupted)." };
}

export function registerGetContentTopic(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_content_topic",
    {
      title: "Get content topic",
      description:
        "Get metadata for a single content topic (title, type, dates, url) — a single-item drill-down from get_course_content's table of contents. For a file-type topic whose file is a PDF or DOCX, the response also includes extractedText (the file's text); if the file is too large or unreadable, extractedTextUnavailable explains why.",
      inputSchema: {
        courseId: courseIdField,
        topicId: z.number().describe("The topic's id, from get_course_content"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, topicId }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
        const raw = await apiGet<Record<string, unknown>>(school, resolveD2lPath("le.content.topicGet", { topicId }, id), cookie);
        const fileText = await topicFileText(school, cookie, id, topicId);
        const item = withSourceUrl({ ...addSgt(raw, ["StartDateTime", "EndDateTime", "DueDate"]), ...fileText }, link.contentTopic(school, id, topicId));
        return linked(item, {
          untrusted: containsUrl(JSON.stringify((raw as { Description?: unknown }).Description ?? "")) || containsUrl(fileText.extractedText ?? ""),
        });
      })
  );
}
