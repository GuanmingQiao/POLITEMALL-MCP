import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { stepLink } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { runStep } from "./helpers.js";

export function registerGetStepCourseDetail(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_step_course_detail",
    {
      title: "Get STEP course detail",
      description: "Get attendance percentage, grade, and enrolment status for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runStep(ctx, async (c) => {
        const detail = (await step.getCourseDetail(c, courseId)) as { myCourseSimpleDto?: Record<string, unknown> } | null;
        if (!detail || typeof detail !== "object") return detail;
        const simple = detail.myCourseSimpleDto;
        const shown = simple ? { ...detail, myCourseSimpleDto: addSgt(simple, ["startTime", "endTime"]) } : detail;
        return linked(withSourceUrl(shown, stepLink.course(courseId, simple?.institute)), { pageUrl: stepLink.myCourses() });
      })
  );
}
