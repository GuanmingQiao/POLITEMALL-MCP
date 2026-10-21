import { z } from "zod";
import { DEFAULT_MAX_CHARS, MAX_MAX_CHARS } from "../utils/text-page.js";

// Every tool is read-only: none of them can change anything in D2L.
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const courseIdField = z.string().describe("The course's courseId, from list_courses");

export const maxCharsField = (def = DEFAULT_MAX_CHARS) =>
  z.number().int().positive().max(MAX_MAX_CHARS).optional().describe(`Maximum characters of text to return (default ${def}, max ${MAX_MAX_CHARS}). The response says whether it was truncated and the offset to continue from.`);

export const offsetField = z.number().int().min(0).optional().describe("Character position to start reading the text from (default 0). Use the nextOffset from a truncated response to read the next part.");
