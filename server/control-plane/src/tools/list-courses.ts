import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { listCourses } from "../api/courses.js";
import { READ_ONLY } from "./schemas.js";
import { acrossSchoolsResult } from "./helpers.js";

export function registerListCourses(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_courses",
    {
      title: "List courses",
      description:
        "List your enrolled courses across every connected D2L school (POLITEMall and/or NYP). courseId values are opaque strings scoped to a school — pass them as-is to the other D2L tools. For SkillsFuture/STEP enrollments, use list_step_courses instead.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => acrossSchoolsResult(ctx, "courses", (school, cookieHeader) => listCourses(school, cookieHeader))
  );
}
