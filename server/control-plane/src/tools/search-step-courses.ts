import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { stepLink } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { runStep } from "./helpers.js";

export function registerSearchStepCourses(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "search_step_courses",
    {
      title: "Search STEP course catalog",
      description:
        "Search or browse STEP's full public course catalog (thousands of SkillsFuture/short courses across all polys/ITE) — not just your own enrollments. Omit query to browse the most recent listings.",
      inputSchema: {
        query: z.string().optional().describe("Keyword to search course names/descriptions for, e.g. \"AI\". Omit to browse without filtering."),
        maxResults: z.number().optional().describe("Max courses to return (default 100)"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, maxResults }) => runStep(ctx, async (c) => {
        const entries = await step.searchCoursesWithIds(c, query ?? "", maxResults ?? 100);
        return linked(
          // The page is keyed on the catalogue entry id, never on course.courseId.
          entries.map(({ course, catalogueId }) => withSourceUrl(addSgt(course, ["startTime", "endTime"]), stepLink.catalogueCourse(catalogueId))),
          { pageUrl: stepLink.home() }
        );
      })
  );
}
