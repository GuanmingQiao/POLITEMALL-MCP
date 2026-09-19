import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export interface CourseOverview {
  description: string | null;
  hasAttachment: boolean;
}

export async function getCourseOverview(school: D2LSchool, cookieHeader: string, numericId: number): Promise<CourseOverview> {
  const raw = await apiGet<{ Description: RichText | null; HasAttachment: boolean }>(
    school,
    resolveD2lPath("le.overview.get", {}, numericId),
    cookieHeader
  );
  return { description: raw.Description?.Text ?? null, hasAttachment: raw.HasAttachment };
}

export function registerGetCourseOverview(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_course_overview",
    {
      title: "Get course overview",
      description: "Get the course description/overview content for a D2L course (the \"Class Overview\"/syllabus feature).",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getCourseOverview(school, c, id))
  );
}
