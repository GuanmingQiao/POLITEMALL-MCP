import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { buildOrgUnitIdsCsv } from "../api/courses.js";
import { resolveD2lPath, resolveD2lQuery } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY } from "./schemas.js";
import { acrossSchoolsResult } from "./helpers.js";

export interface RecentUpdateCount {
  school: D2LSchool;
  orgUnitId: string;
  unreadDiscussions: number;
  unapprovedDiscussions: number;
  unreadAssignmentFeedback: number;
  unattemptedQuizzes: number;
  unreadAssignmentSubmissions: number;
  ungradedQuizzes: number;
}

export async function getRecentUpdates(school: D2LSchool, cookieHeader: string): Promise<RecentUpdateCount[]> {
  const orgUnitIdsCSV = await buildOrgUnitIdsCsv(school, cookieHeader);
  if (!orgUnitIdsCSV) return [];
  const qs = resolveD2lQuery("le.updates.global.myUpdates", { orgUnitIdsCSV });
  const raw = await fetchAllPages<{
    OrgUnitId: string;
    UnreadDiscussions: number;
    UnapprovedDiscussions: number;
    UnreadAssignmentFeedback: number;
    UnattemptedQuizzes: number;
    UnreadAssignmentSubmissions: number;
    UngradedQuizzes: number;
  }>(school, resolveD2lPath("le.updates.global.myUpdates", {}) + qs, cookieHeader);
  return raw.map((u) => ({
    school,
    orgUnitId: u.OrgUnitId,
    unreadDiscussions: u.UnreadDiscussions,
    unapprovedDiscussions: u.UnapprovedDiscussions,
    unreadAssignmentFeedback: u.UnreadAssignmentFeedback,
    unattemptedQuizzes: u.UnattemptedQuizzes,
    unreadAssignmentSubmissions: u.UnreadAssignmentSubmissions,
    ungradedQuizzes: u.UngradedQuizzes,
  }));
}

export function registerGetRecentUpdates(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_recent_updates",
    {
      title: "Get recent updates",
      description:
        "Get counts of unread/pending activity (discussions, assignment feedback, quizzes) across every connected school and course in one call — a \"what's new\" activity feed.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => acrossSchoolsResult(ctx, "updates", (school, cookieHeader) => getRecentUpdates(school, cookieHeader))
  );
}
