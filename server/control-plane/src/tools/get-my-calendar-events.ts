import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { buildOrgUnitIdsCsv } from "../api/courses.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY } from "./schemas.js";
import { acrossSchoolsResult } from "./helpers.js";

export interface MyCalendarEvent {
  school: D2LSchool;
  eventId: number;
  title: string;
  startDateTime: string | null;
  endDateTime: string | null;
  orgUnitName: string;
}

export async function getMyCalendarEvents(
  school: D2LSchool,
  cookieHeader: string,
  startDateTime: string,
  endDateTime: string
): Promise<MyCalendarEvent[]> {
  const orgUnitIdsCSV = await buildOrgUnitIdsCsv(school, cookieHeader);
  if (!orgUnitIdsCSV) return [];
  const qs = resolveD2lQuery("le.calendar.global.myEvents", { orgUnitIdsCSV, startDateTime, endDateTime });
  const raw = await fetchAllPages<{
    CalendarEventId: number;
    Title: string;
    StartDateTime: string | null;
    EndDateTime: string | null;
    OrgUnitName: string;
  }>(school, resolveD2lPath("le.calendar.global.myEvents", {}) + qs, cookieHeader);
  return raw.map((e) => ({
    school,
    eventId: e.CalendarEventId,
    title: e.Title,
    startDateTime: e.StartDateTime,
    endDateTime: e.EndDateTime,
    orgUnitName: e.OrgUnitName,
  }));
}

export function registerGetMyCalendarEvents(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_my_calendar_events",
    {
      title: "Get my calendar events (all courses)",
      description:
        "Get your calendar events across every connected D2L school and every enrolled course in one call — cross-course parity with get_due_items. Defaults to a rolling window from 7 days ago to 60 days ahead; pass startDate/endDate (ISO 8601) to widen or narrow it.",
      inputSchema: {
        startDate: z.string().optional().describe("ISO 8601 datetime; defaults to 7 days ago"),
        endDate: z.string().optional().describe("ISO 8601 datetime; defaults to 60 days from now"),
      },
      annotations: READ_ONLY,
    },
    async ({ startDate, endDate }) => {
      const now = Date.now();
      const start = startDate ?? new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const end = endDate ?? new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();
      return acrossSchoolsResult(ctx, "events", (school, cookieHeader) => getMyCalendarEvents(school, cookieHeader, start, end));
    }
  );
}
