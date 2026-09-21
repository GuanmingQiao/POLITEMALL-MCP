import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetCalendarEvents(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_calendar_events",
    {
      title: "Get calendar events",
      description: "Get calendar events for a D2L course.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
        const events = await apiGet<Record<string, unknown>[]>(school, resolveD2lPath("le.calendar.list", {}, id), cookie);
        // D2L supplies each event's own page (its id differs from CalendarEventId); an event without
        // one falls back to the course calendar, carried as the page rather than as the event's link.
        return linked(
          events.map((e) => withSourceUrl(addSgt(e, ["StartDateTime", "EndDateTime"]), link.calendarEvent(school, e.CalendarEventViewUrl))),
          { pageUrl: link.courseCalendar(school, id) }
        );
      })
  );
}
