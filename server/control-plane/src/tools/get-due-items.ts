import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { buildOrgUnitIdsCsv } from "../api/courses.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY } from "./schemas.js";
import { acrossSchoolsResult } from "./helpers.js";

export interface DueItem {
  school: D2LSchool;
  orgUnitId: string;
  itemName: string;
  dueDate: string | null;
  dateCompleted: string | null;
}

// orgUnitIdsCSV is required by this route (D2L answers 400 without it), same as the calendar and
// updates routes — so list the caller's own course org units first.
export async function getDueItems(school: D2LSchool, cookieHeader: string): Promise<DueItem[]> {
  const orgUnitIdsCSV = await buildOrgUnitIdsCsv(school, cookieHeader);
  if (!orgUnitIdsCSV) return [];
  const qs = resolveD2lQuery("le.content.global.myItemsCompletionsDue", { orgUnitIdsCSV });
  const items = await fetchAllPages<{
    OrgUnitId: string;
    ItemName: string;
    DueDate: string | null;
    DateCompleted: string | null;
  }>(school, resolveD2lPath("le.content.global.myItemsCompletionsDue", {}) + qs, cookieHeader);
  return items.map((i) => ({
    school,
    orgUnitId: i.OrgUnitId,
    itemName: i.ItemName,
    dueDate: i.DueDate,
    dateCompleted: i.DateCompleted,
  }));
}

export function registerGetDueItems(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_due_items",
    {
      title: "Get due items",
      description:
        "Get content items with due dates across every connected D2L school (POLITEMall and/or NYP) and every course, in one call — completed and pending. dateCompleted is null for items not yet done.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => acrossSchoolsResult(ctx, "dueItems", (school, cookieHeader) => getDueItems(school, cookieHeader))
  );
}
