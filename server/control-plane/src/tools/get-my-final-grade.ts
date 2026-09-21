import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { linked } from "./provenance.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetMyFinalGrade(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_my_final_grade",
    {
      title: "Get my final grade",
      description: "Get your calculated/adjusted final grade for a D2L course — distinct from get_grades, which lists per-item scores.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) =>
        linked(await apiGet(school, resolveD2lPath("le.grades.finalValueMy", {}, id), cookie), { pageUrl: link.myGrades(school, id) })
      )
  );
}
