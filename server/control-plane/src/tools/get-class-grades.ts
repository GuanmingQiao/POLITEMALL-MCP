import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { fetchAllPages } from "../api/paginate.js";
import { fetchClasslist } from "../api/classlist.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface GradeDefinition {
  Id: number;
  Name: string;
  MaxPoints: number;
}
interface BulkGradeValue {
  UserId: string;
  GradeObjectIdentifier: string;
  GradeObjectName: string;
  DisplayedGrade: string;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
}
export interface StudentGrade {
  userId: string;
  studentName: string | null;
  gradeItemId: string;
  gradeItemName: string;
  maxPoints: number | null;
  pointsAwarded: number | null;
  pointsDenominator: number | null;
  displayedGrade: string;
}

// Requires grades:gradevalues:read — an instructor/TA/grader permission. A student calling this
// gets a 403 (PermissionDeniedError), same as the real UI would refuse them the gradebook view.
export async function getClassGrades(school: D2LSchool, cookieHeader: string, numericId: number): Promise<StudentGrade[]> {
  const [definitions, values, classlist] = await Promise.all([
    apiGet<GradeDefinition[]>(school, resolveD2lPath("le.grades.definitionsList", {}, numericId), cookieHeader),
    fetchAllPages<BulkGradeValue>(school, resolveD2lPath("le.grades.valuesAll", {}, numericId), cookieHeader),
    fetchClasslist(school, cookieHeader, numericId),
  ]);
  const defById = new Map(definitions.map((d) => [String(d.Id), d]));
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return values.map((v) => {
    const def = defById.get(v.GradeObjectIdentifier);
    return {
      userId: v.UserId,
      studentName: nameById.get(v.UserId) ?? null,
      gradeItemId: v.GradeObjectIdentifier,
      gradeItemName: v.GradeObjectName || def?.Name || "",
      maxPoints: def?.MaxPoints ?? null,
      pointsAwarded: v.PointsNumerator,
      pointsDenominator: v.PointsDenominator,
      displayedGrade: v.DisplayedGrade,
    };
  });
}

export function registerGetClassGrades(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_class_grades",
    {
      title: "Get class grades (instructor/TA)",
      description:
        "Get every grade item and score for EVERY student in a D2L course — the gradebook view. Requires an instructor/TA/grader role in the course; students calling this get a permission error, not their own grades (use get_grades for that instead).",
      inputSchema: { courseId: courseIdField },
      annotations: READ_ONLY,
    },
    async ({ courseId }) => runForD2LCourse(ctx, courseId, (school, c, id) => getClassGrades(school, c, id))
  );
}
