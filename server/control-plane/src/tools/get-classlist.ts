// Privacy-first default (staff only), search, and limit-with-truncation reporting adapted from
// brightspace-mcp-server's get_roster (MIT, (c) 2026 Rohan Muppa — see THIRD_PARTY_NOTICES.md).
// Differences on purpose: staff are told apart by role *name* rather than Purdue's hard-coded
// role ids (RoleId is null for some staff on NYP), and the answer always includes headcounts per
// role so a class of 2,700 doesn't have to be listed to be described.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { ClasslistUser } from "../types/d2l.js";
import { fetchClasslist } from "../api/classlist.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

// D2L's stock name for the student role; tenants that rename it use "Student".
const LEARNER_ROLE = /^(learner|student)s?$/i;

export interface ClasslistOptions {
  includeStudents: boolean;
  searchTerm?: string;
  limit: number;
}

export interface ClasslistEntry {
  id: string;
  name: string;
  role: string;
  username?: string;
  email?: string;
}

export function isLearner(u: ClasslistUser): boolean {
  return LEARNER_ROLE.test(u.ClasslistRoleDisplayName ?? "");
}

function matches(u: ClasslistUser, needle: string): boolean {
  return [u.DisplayName, u.Username, u.Email, u.FirstName, u.LastName].some((f) => f?.toLowerCase().includes(needle));
}

export function summarizeClasslist(users: ClasslistUser[], opts: ClasslistOptions) {
  const roleCounts: Record<string, number> = {};
  for (const u of users) roleCounts[u.ClasslistRoleDisplayName] = (roleCounts[u.ClasslistRoleDisplayName] ?? 0) + 1;

  const needle = opts.searchTerm?.trim().toLowerCase();
  let selected = users.filter((u) => (opts.includeStudents || !isLearner(u)) && (!needle || matches(u, needle)));
  // Staff first, then by name, so a cut-off never drops the instructors.
  selected = [...selected].sort(
    (a, b) => Number(isLearner(a)) - Number(isLearner(b)) || a.ClasslistRoleDisplayName.localeCompare(b.ClasslistRoleDisplayName) || a.DisplayName.localeCompare(b.DisplayName)
  );

  const total = selected.length;
  const truncated = total > opts.limit;
  const entries: ClasslistEntry[] = selected.slice(0, opts.limit).map((u) => ({
    id: u.Identifier,
    name: u.DisplayName,
    role: u.ClasslistRoleDisplayName,
    ...(u.Username ? { username: u.Username } : {}),
    ...(u.Email ? { email: u.Email } : {}),
  }));

  const hiddenLearners = opts.includeStudents ? 0 : users.filter(isLearner).length;
  const notes = [
    truncated ? `Showing ${entries.length} of ${total}. Raise limit (max 1000) or narrow with searchTerm to see more.` : null,
    hiddenLearners > 0 && !needle ? `${hiddenLearners} learner(s) are not listed; pass includeStudents=true to list them.` : null,
  ].filter(Boolean);

  return {
    classSize: users.length,
    roleCounts,
    total,
    returned: entries.length,
    truncated,
    ...(notes.length ? { note: notes.join(" ") } : {}),
    users: entries,
  };
}

export function registerGetClasslist(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_classlist",
    {
      title: "Get classlist",
      description:
        "Get who is in a course: headcount per role plus the people. By default only instructors and other staff are listed (with names and usernames) — students are left out for privacy and size; pass includeStudents=true only when the user actually needs classmates, and use searchTerm to look one person up. Use this when the user asks who teaches a course, who the tutors are, how big the class is, or to find someone by name. classSize and roleCounts always cover the whole class, and the response reports truncation.",
      inputSchema: {
        courseId: courseIdField,
        includeStudents: z.boolean().optional().describe("Also list students/learners. Default false: instructors and other staff only."),
        searchTerm: z.string().max(200).optional().describe("Case-insensitive match on name, username or email."),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum people to list (default 100). The response reports the true total and whether it was truncated."),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, includeStudents, searchTerm, limit }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => ({
        courseId,
        ...summarizeClasslist(await fetchClasslist(school, cookie, id), {
          includeStudents: includeStudents ?? false,
          searchTerm,
          limit: limit ?? 100,
        }),
      }))
  );
}
