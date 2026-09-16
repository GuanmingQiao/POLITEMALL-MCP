import type { School } from "./schools.js";

const LE_VERSION = "1.9";
const LP_VERSION = "1.9";

export type D2LSchool = Extract<School, "politemall" | "nyp">;

export const SCHOOL_HOSTS: Record<D2LSchool, string> = {
  politemall: "lms.polite.edu.sg",
  nyp: "nyplms.polite.edu.sg",
};

export class SessionExpiredError extends Error {}

async function apiGet<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`https://${SCHOOL_HOSTS[school]}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status === 200) return (await res.json()) as T;
  throw new SessionExpiredError(`Request to ${path} failed with status ${res.status}`);
}

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
export interface Course {
  courseId: string;
  school: D2LSchool;
  name: string;
  code: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  lastAccessed: string | null;
}

export async function listCourses(school: D2LSchool, cookieHeader: string): Promise<Course[]> {
  const courses: Course[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ orgUnitTypeId: "3" });
    if (bookmark) qs.set("bookmark", bookmark);
    const data = await apiGet<MyEnrollmentsPage>(school, `/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/?${qs}`, cookieHeader);
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

export async function getCourseContent(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/content/toc`, cookieHeader);
}

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
    apiGet<GradeDefinition[]>(school, `/d2l/api/le/${LE_VERSION}/${numericId}/grades/`, cookieHeader),
    apiGet<GradeValue[]>(school, `/d2l/api/le/${LE_VERSION}/${numericId}/grades/values/myGradeValues/`, cookieHeader),
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

export async function getAnnouncements(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/news/`, cookieHeader);
}

export async function getCalendarEvents(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/calendar/events/`, cookieHeader);
}

export async function getAssignments(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/dropbox/folders/`, cookieHeader);
}

export async function whoami(school: D2LSchool, cookieHeader: string): Promise<unknown> {
  return apiGet(school, `/d2l/api/lp/${LP_VERSION}/users/whoami`, cookieHeader);
}
