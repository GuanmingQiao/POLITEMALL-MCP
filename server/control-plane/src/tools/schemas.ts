import { z } from "zod";

// Every tool is read-only: none of them can change anything in D2L or STEP.
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const courseIdField = z.string().describe("The course's courseId, from list_courses");
