import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import * as step from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { stepLink } from "../utils/deep-links.js";
import { addSgt, containsUrl, linked } from "./provenance.js";
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
    async () => runStep(ctx, async (c) => {
        const items = await step.getAnnouncements(c);
        // This is the banner feed shown on the STEP home page. The Announcements page lists a
        // different feed, so it is not linked.
        return linked(
          items.map((a) => addSgt(a, ["publishDate"])),
          { pageUrl: stepLink.home(), untrusted: items.some((a) => containsUrl(a.content)) }
        );
      })
  );
}
