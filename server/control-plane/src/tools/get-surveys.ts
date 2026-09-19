import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetSurveys(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_surveys",
    {
      title: "Get surveys",
      description: "List surveys for a D2L course.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) =>
      runForD2LCourse(ctx, courseId, (school, cookie, id) => fetchAllPages(school, resolveD2lPath("le.surveys.list", {}, id), cookie))
  );
}
