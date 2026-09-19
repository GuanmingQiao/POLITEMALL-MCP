import type { D2LSchool } from "../types/schools.js";
import type { Course, CourseAccess } from "../types/d2l.js";
import { apiGet, versionedPath } from "./d2l-client.js";
import { NotFoundError, PermissionDeniedError } from "./errors.js";

// Course IDs are only unique within a single D2L tenant, and politemall/nyp are
// independent tenants with independent ID spaces — so every course ID exposed by
// a tool is a "school:numericId" composite, disambiguating which tenant (and
// therefore which stored cookie) a later tool call should use.
export function formatCourseId(school: D2LSchool, numericId: number): string {
  return `${school}:${numericId}`;
}

export function parseCourseId(courseId: string): { school: D2LSchool; numericId: number } {
  const [school, idStr] = courseId.split(":");
  if (school !== "politemall" && school !== "nyp") {
    throw new Error(`Unknown school in courseId "${courseId}"`);
  }
  const numericId = Number(idStr);
  if (!Number.isFinite(numericId)) {
    throw new Error(`Invalid courseId "${courseId}"`);
  }
  return { school, numericId };
}

interface EnrollmentItem {
  OrgUnit: { Id: number; Type: { Id: number }; Name: string; Code: string };
  Access: { IsActive: boolean; StartDate: string | null; EndDate: string | null; LastAccessed: string | null };
}
interface MyEnrollmentsPage {
  PagingInfo: { Bookmark: string | null; HasMoreItems: boolean };
  Items: EnrollmentItem[];
}

export async function listCourses(school: D2LSchool, cookieHeader: string): Promise<Course[]> {
  const courses: Course[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ orgUnitTypeId: "3" });
    if (bookmark) qs.set("bookmark", bookmark);
    const data = await apiGet<MyEnrollmentsPage>(school, versionedPath("lp", `/enrollments/myenrollments/?${qs}`), cookieHeader);
    for (const item of data.Items) {
      if (item.OrgUnit.Type.Id !== 3) continue;
      courses.push({
        courseId: formatCourseId(school, item.OrgUnit.Id),
        school,
        name: item.OrgUnit.Name,
        code: item.OrgUnit.Code,
        isActive: item.Access.IsActive,
        startDate: item.Access.StartDate,
        endDate: item.Access.EndDate,
        lastAccessed: item.Access.LastAccessed,
      });
    }
    if (!data.PagingInfo.HasMoreItems || !data.PagingInfo.Bookmark) break;
    bookmark = data.PagingInfo.Bookmark;
  }
  return courses;
}

// The cross-course routes (calendar, updates, due items) declare orgUnitIdsCSV as a required
// query param — building it means first listing the caller's own course org unit ids for this
// school, the same identifiers listCourses already exposes as courseIds.
export async function buildOrgUnitIdsCsv(school: D2LSchool, cookieHeader: string): Promise<string> {
  const courses = await listCourses(school, cookieHeader);
  return courses.map((c) => parseCourseId(c.courseId).numericId).join(",");
}

// Asks D2L about the caller's own enrollment in one org unit. Used only on the error path, to
// tell "you aren't in this course" apart from "you are, but this item/tool/permission isn't
// available" — the HTTP status alone can't (D2L answers both with 403/404).
export async function getCourseAccess(school: D2LSchool, cookieHeader: string, numericId: number): Promise<CourseAccess> {
  try {
    const e = await apiGet<{ Access: { IsActive: boolean; ClasslistRoleName: string | null } }>(
      school,
      versionedPath("lp", `/enrollments/myenrollments/${numericId}`),
      cookieHeader
    );
    return { enrolled: true, role: e.Access?.ClasslistRoleName ?? null, isActive: e.Access?.IsActive ?? null };
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PermissionDeniedError) {
      return { enrolled: false, role: null, isActive: null };
    }
    throw err;
  }
}
