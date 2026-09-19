import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet, versionedPath } from "../api/d2l-client.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface GroupCategoryData {
  GroupCategoryId: number;
  Name: string;
  Groups: number[];
}
interface GroupData {
  GroupId: number;
  Name: string;
  Code: string;
  Enrollments: number[];
}
export interface GroupCategoryWithGroups {
  groupCategoryId: number;
  name: string;
  groups: { groupId: number; name: string; code: string; memberCount: number }[];
}

export async function getGroups(school: D2LSchool, cookieHeader: string, numericId: number): Promise<GroupCategoryWithGroups[]> {
  const categories = await apiGet<GroupCategoryData[]>(school, versionedPath("lp", `/${numericId}/groupcategories/`), cookieHeader);
  const result: GroupCategoryWithGroups[] = [];
  for (const category of categories) {
    const groups = await apiGet<GroupData[]>(
      school,
      versionedPath("lp", `/${numericId}/groupcategories/${category.GroupCategoryId}/groups/`),
      cookieHeader
    );
    result.push({
      groupCategoryId: category.GroupCategoryId,
      name: category.Name,
      groups: groups.map((g) => ({ groupId: g.GroupId, name: g.Name, code: g.Code, memberCount: g.Enrollments.length })),
    });
  }
  return result;
}

export function registerGetGroups(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_groups",
    {
      title: "Get groups",
      description: "List group categories and groups (with member counts) for a D2L course.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getGroups(school, c, id))
  );
}
