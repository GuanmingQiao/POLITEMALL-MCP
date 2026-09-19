import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
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
    async ({ courseId }) => runStep(ctx, (c) => step.getTimetable(c, courseId))
  );
}
