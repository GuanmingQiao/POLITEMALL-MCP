import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { D2L_ROUTE_CATALOG } from "../api/route-catalog.js";
import { READ_ONLY } from "./schemas.js";
import { toolResult } from "./helpers.js";

export function registerListD2lOperations(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "list_d2l_operations",
    {
      title: "List D2L operations (advanced)",
      description:
        "List/search the full catalog of D2L Valence operations reachable via call_d2l_operation — the long-tail routes that don't have a dedicated tool above. Filter by category (e.g. \"grades\", \"checklists\", \"quizzes\") and/or a keyword search across the operation key and description. Use this first to find an operation's key and required parameters before calling call_d2l_operation.",
      inputSchema: {
        category: z.string().optional().describe('Restrict to one catalog category, e.g. "grades", "checklists", "cpd"'),
        query: z.string().optional().describe("Keyword to match against the operation key or description"),
      },
      annotations: READ_ONLY,
    },
    async ({ category, query }) => {
      const q = query?.toLowerCase();
      const matches = D2L_ROUTE_CATALOG.filter((r) => {
        if (category && r.category !== category) return false;
        if (q && !r.operation.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
        return true;
      }).map((r) => ({
        operation: r.operation,
        category: r.category,
        description: r.description,
        scope: r.scope,
        pathParams: Object.keys(r.pathParams.shape),
        queryParams: r.queryParams ? Object.keys(r.queryParams.shape) : [],
        pagination: r.pagination,
        curatedTools: r.curatedTools ?? [],
      }));
      return toolResult({ count: matches.length, operations: matches });
    }
  );
}
