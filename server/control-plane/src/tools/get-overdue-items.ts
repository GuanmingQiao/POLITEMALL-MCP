import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY } from "./schemas.js";
import { acrossSchoolsResult } from "./helpers.js";

export interface OverdueItem {
  school: D2LSchool;
  orgUnitId: string;
  itemId: number;
  itemName: string;
  dueDate: string | null;
}

// Unlike the due-items and updates routes, orgUnitIdsCSV is genuinely optional here — D2L
// defaults to the caller's own active enrollments when it's omitted.
export async function getOverdueItems(school: D2LSchool, cookieHeader: string): Promise<OverdueItem[]> {
  const raw = await fetchAllPages<{ OrgUnitId: string; ItemId: number; ItemName: string; DueDate: string | null }>(
    school,
    resolveD2lPath("le.content.global.overdueItemsMy", {}),
    cookieHeader
  );
  return raw.map((i) => ({ school, orgUnitId: i.OrgUnitId, itemId: i.ItemId, itemName: i.ItemName, dueDate: i.DueDate }));
}

export function registerGetOverdueItems(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_overdue_items",
    {
      title: "Get overdue items",
      description:
        "Get D2L-computed overdue content items across every connected school and course in one call — a filtered view distinct from get_due_items (which includes not-yet-due pending items too).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => acrossSchoolsResult(ctx, "overdueItems", (school, cookieHeader) => getOverdueItems(school, cookieHeader))
  );
}
