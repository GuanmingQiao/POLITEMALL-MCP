import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface GradeDefinition {
  Id: number;
  Name: string;
  MaxPoints: number;
  Weight: number;
  IsHidden: boolean;
}
interface GradeValue {
  GradeObjectIdentifier: string;
  PointsNumerator: number | null;
  DisplayedGrade: string;
  LastModified: string | null;
}
export interface GradeItem {
  id: number;
  name: string;
  maxPoints: number;
  weight: number;
  pointsAwarded: number | null;
  displayedGrade: string | null;
  lastModified: string | null;
}

export async function getGrades(school: D2LSchool, cookieHeader: string, numericId: number): Promise<GradeItem[]> {
  const [definitions, values] = await Promise.all([
    apiGet<GradeDefinition[]>(school, resolveD2lPath("le.grades.definitionsList", {}, numericId), cookieHeader),
    apiGet<GradeValue[]>(school, resolveD2lPath("le.grades.myValues", {}, numericId), cookieHeader),
  ]);
  const valueById = new Map(values.map((v) => [v.GradeObjectIdentifier, v]));
  return definitions
    .filter((d) => !d.IsHidden)
    .map((d) => {
      const v = valueById.get(String(d.Id));
      return {
        id: d.Id,
        name: d.Name,
        maxPoints: d.MaxPoints,
        weight: d.Weight,
        pointsAwarded: v?.PointsNumerator ?? null,
        displayedGrade: v?.DisplayedGrade ?? null,
        lastModified: v?.LastModified ?? null,
      };
    });
}

export function registerGetGrades(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_grades",
    {
      title: "Get grades",
      description: "Get your grade items and scores for a D2L course.",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getGrades(school, c, id))
  );
}
