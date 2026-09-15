const LMS_HOST = "lms.polite.edu.sg";
const BASE_URL = `https://${LMS_HOST}`;
const LE_VERSION = "1.9";
const LP_VERSION = "1.9";

export class SessionExpiredError extends Error {}

async function apiGet<T>(path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status === 200) return (await res.json()) as T;
  throw new SessionExpiredError(`Request to ${path} failed with status ${res.status}`);
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
  orgUnitId: number;
  name: string;
  code: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  lastAccessed: string | null;
}

export async function listCourses(cookieHeader: string): Promise<Course[]> {
  const courses: Course[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ orgUnitTypeId: "3" });
    if (bookmark) qs.set("bookmark", bookmark);
    const data = await apiGet<MyEnrollmentsPage>(`/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/?${qs}`, cookieHeader);
    for (const item of data.Items) {
      if (item.OrgUnit.Type.Id !== 3) continue;
      courses.push({
        orgUnitId: item.OrgUnit.Id,
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

export async function getCourseContent(cookieHeader: string, courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/content/toc`, cookieHeader);
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

export async function getGrades(cookieHeader: string, courseId: number): Promise<GradeItem[]> {
  const [definitions, values] = await Promise.all([
    apiGet<GradeDefinition[]>(`/d2l/api/le/${LE_VERSION}/${courseId}/grades/`, cookieHeader),
    apiGet<GradeValue[]>(`/d2l/api/le/${LE_VERSION}/${courseId}/grades/values/myGradeValues/`, cookieHeader),
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

export async function getAnnouncements(cookieHeader: string, courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/news/`, cookieHeader);
}

export async function getCalendarEvents(cookieHeader: string, courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/calendar/events/`, cookieHeader);
}

export async function getAssignments(cookieHeader: string, courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/dropbox/folders/`, cookieHeader);
}

export async function whoami(cookieHeader: string): Promise<unknown> {
  return apiGet(`/d2l/api/lp/${LP_VERSION}/users/whoami`, cookieHeader);
}
