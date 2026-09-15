import { apiGet } from "./d2lClient.js";

const LE_VERSION = "1.9";
const LP_VERSION = "1.9";

interface EnrollmentItem {
  OrgUnit: { Id: number; Type: { Id: number; Code: string; Name: string }; Name: string; Code: string };
  Access: { IsActive: boolean; StartDate: string | null; EndDate: string | null; CanAccess: boolean; LastAccessed: string | null };
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

export async function listCourses(): Promise<Course[]> {
  const courses: Course[] = [];
  let bookmark: string | null = null;

  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ orgUnitTypeId: "3" });
    if (bookmark) qs.set("bookmark", bookmark);
    const data: MyEnrollmentsPage = await apiGet(`/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/?${qs}`);

    for (const item of data.Items) {
      if (item.OrgUnit.Type.Id !== 3) continue; // Course Offering only
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

export async function getCourseContent(courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/content/toc`);
}

interface GradeDefinition {
  Id: number;
  Name: string;
  ShortName: string;
  MaxPoints: number;
  Weight: number;
  GradeType: string;
  CategoryId: number | null;
  IsHidden: boolean;
}

interface GradeValue {
  GradeObjectIdentifier: string;
  GradeObjectName: string;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
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

export async function getGrades(courseId: number): Promise<GradeItem[]> {
  const [definitions, values] = await Promise.all([
    apiGet<GradeDefinition[]>(`/d2l/api/le/${LE_VERSION}/${courseId}/grades/`),
    apiGet<GradeValue[]>(`/d2l/api/le/${LE_VERSION}/${courseId}/grades/values/myGradeValues/`),
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

export async function getAnnouncements(courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/news/`);
}

export async function getCalendarEvents(courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/calendar/events/`);
}

export async function getAssignments(courseId: number): Promise<unknown> {
  return apiGet(`/d2l/api/le/${LE_VERSION}/${courseId}/dropbox/folders/`);
}

export async function whoami(): Promise<unknown> {
  return apiGet(`/d2l/api/lp/${LP_VERSION}/users/whoami`);
}
