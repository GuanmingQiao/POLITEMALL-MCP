import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { stepLink } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { runStep } from "./helpers.js";

export function registerGetStepTimetable(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_step_timetable",
    {
      title: "Get STEP timetable",
      description: "Get the class session timetable (dates, trainer, room, attendance status) for a STEP course.",
      inputSchema: { courseId: z.string().describe("The course's courseId, from list_step_courses") },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runStep(ctx, async (c) => {
        const { sessions, institute } = await step.getTimetableWithInstitute(c, courseId);
        // The course page lists these sessions; the calendar is the parent page.
        const page = stepLink.course(courseId, institute);
        return linked(
          sessions.map((s) => withSourceUrl(addSgt(s, ["startTime", "endTime"]), page)),
          { pageUrl: stepLink.calendar() }
        );
      })
  );
}
