import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

export interface FinalGradeForStudent {
  userId: string;
  studentName: string | null;
  displayedGrade: string | null;
  pointsNumerator: number | null;
  pointsDenominator: number | null;
}
interface UserGradeValueEntry {
  User: { Identifier: string; DisplayName: string | null };
  GradeValue: { DisplayedGrade: string; PointsNumerator: number | null; PointsDenominator: number | null } | null;
}

// Requires the same grading permission as get_class_grades — a student calling this gets a 403.
export async function getAllFinalGrades(school: D2LSchool, cookieHeader: string, numericId: number): Promise<FinalGradeForStudent[]> {
  const entries = await fetchAllPages<UserGradeValueEntry>(school, resolveD2lPath("le.grades.finalValuesAll", {}, numericId), cookieHeader);
  return entries.map((e) => ({
    userId: e.User.Identifier,
    studentName: e.User.DisplayName,
    displayedGrade: e.GradeValue?.DisplayedGrade ?? null,
    pointsNumerator: e.GradeValue?.PointsNumerator ?? null,
    pointsDenominator: e.GradeValue?.PointsDenominator ?? null,
  }));
}

export function registerGetAllFinalGrades(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_all_final_grades",
    {
      title: "Get all final grades (instructor/TA)",
      description:
        "Get every enrolled student's calculated/adjusted final grade for a D2L course — the gradebook's final-grade column. Requires an instructor/TA/grader role; students calling this get a permission error, not their own grade (use get_my_final_grade for that instead).",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getAllFinalGrades(school, c, id))
  );
}
