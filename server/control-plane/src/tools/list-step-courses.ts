import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { runStep } from "./helpers.js";

export function registerListStepCourses(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_step_courses",
    {
      title: "List STEP courses",
      description:
        "List your enrolled SkillsFuture/short courses on STEP (stms.polite.edu.sg) — a separate system from POLITEMall/NYP D2L, covering training enrollment and attendance rather than course content.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStep(ctx, (c) => step.listCourses(c))
  );
}
