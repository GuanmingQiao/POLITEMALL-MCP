import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

// Valence scopes rubric listing to a specific gradable object (a discussion topic, dropbox
// folder, etc.) — there is no "all rubrics in this course" route. get_rubrics therefore has
// two modes: pass rubricId to fetch one rubric directly (le.rubrics.get takes no other
// params), or pass objectType+objectId to list the rubrics attached to that object
// (le.rubrics.list).

export interface GetRubricsOptions {
  rubricId?: number;
  objectType?: string;
  objectId?: number;
}

export async function getRubrics(school: D2LSchool, cookieHeader: string, numericId: number, opts: GetRubricsOptions): Promise<unknown> {
  if (opts.rubricId !== undefined) {
    return apiGet(school, resolveD2lPath("le.rubrics.get", { rubricId: opts.rubricId }, numericId), cookieHeader);
  }
  if (!opts.objectType || opts.objectId === undefined) {
    throw new Error("get_rubrics requires either rubricId, or both objectType and objectId");
  }
  const qs = resolveD2lQuery("le.rubrics.list", { objectType: opts.objectType, objectId: opts.objectId });
  return apiGet(school, resolveD2lPath("le.rubrics.list", {}, numericId) + qs, cookieHeader);
}

export function registerGetRubrics(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_rubrics",
    {
      title: "Get rubrics",
      description:
        "Get rubric(s) for a D2L course. Pass rubricId to fetch one specific rubric's full criteria/levels directly. Otherwise pass objectType (e.g. \"Discussion\", \"Dropbox\") and objectId (that object's id, e.g. a topicId or folderId) to list the rubrics attached to it — D2L scopes rubric listing to a specific gradable object, not the whole course, so there's no way to list every rubric in a course at once.",
      inputSchema: {
        courseId: courseIdField,
        rubricId: z.number().optional().describe("A specific rubric's Id, if already known — returns its full criteria/levels"),
        objectType: z.string().optional().describe('The object type to list rubrics for, e.g. "Discussion" or "Dropbox" — required if rubricId is omitted'),
        objectId: z.number().optional().describe("The object's id (e.g. a topicId from get_discussion_topics or folderId from get_assignments) — required if rubricId is omitted"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, rubricId, objectType, objectId }) =>
      runForD2LCourse(ctx, courseId, (school, c, id) => getRubrics(school, c, id, { rubricId, objectType, objectId }))
  );
}
