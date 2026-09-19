import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { runStep } from "./helpers.js";

export function registerGetStepAnnouncements(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_step_announcements",
    {
      title: "Get STEP announcements",
      description: "Get portal-wide announcements from STEP.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStep(ctx, (c) => step.getAnnouncements(c))
  );
}
