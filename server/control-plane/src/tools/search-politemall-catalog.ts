import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { searchCatalog } from "../api/public-catalog.js";
import { READ_ONLY } from "./schemas.js";
import { toolResult } from "./helpers.js";

export function registerSearchPolitemallCatalog(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "search_politemall_catalog",
    {
      title: "Search POLITEMall public catalog",
      description:
        "Search or browse the public POLITEMall marketing catalog (politemall.polite.edu.sg) — all ~300 modules offered across the polys/ITE, not just your enrollments. No login required. This is a DIFFERENT system from Brightspace: catalogCode values here are NOT courseIds and can't be passed to get_grades/get_course_content/etc. Use list_courses for your actual enrolled Brightspace courses.",
      inputSchema: {
        query: z.string().optional().describe("Keyword to search names/descriptions/institution for, e.g. \"AI\". Omit to browse everything."),
        maxResults: z.number().optional().describe("Max courses to return (default 100)"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, maxResults }) => toolResult(await searchCatalog(query ?? "", maxResults ?? 100))
  );
}
