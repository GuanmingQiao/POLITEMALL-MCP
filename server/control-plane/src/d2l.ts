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

interface ObjectListPage<T> {
  Next: string | null;
  Objects: T[];
}

// Valence's ObjectListPage convention (distinct from the Bookmark-based paging
// enrollments/myenrollments uses) — follow the opaque "Next" URL until exhausted.
async function fetchAllPages<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  for (let page = 0; page < 20 && next; page++) {
    const page_: ObjectListPage<T> = await apiGet(school, next, cookieHeader);
    items.push(...page_.Objects);
    next = page_.Next ? page_.Next.replace(`https://${SCHOOL_HOSTS[school]}`, "") : null;
  }
  return items;
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

// --- Quizzes ---

interface QuizReadData {
  QuizId: number;
  Name: string;
  DueDate: string | null;
  StartDate: string | null;
  EndDate: string | null;
  AttemptsAllowed: unknown;
}

export async function listQuizzes(school: D2LSchool, cookieHeader: string, numericId: number): Promise<QuizReadData[]> {
  return fetchAllPages(school, `/d2l/api/le/${LE_VERSION}/${numericId}/quizzes/`, cookieHeader);
}

interface QuizAttemptData {
  AttemptId: number;
  QuizId: number;
  Score: number | null;
  Started: string;
  Completed: string | null;
  IsPublished: boolean;
}

export async function getQuizAttempts(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  quizId: number
): Promise<QuizAttemptData[]> {
  return fetchAllPages(school, `/d2l/api/le/${LE_VERSION}/${numericId}/quizzes/${quizId}/attempts/`, cookieHeader);
}

// --- Discussions ---

interface Forum {
  ForumId: number;
  Name: string;
}
interface Topic {
  TopicId: number;
  ForumId: number;
  Name: string;
}
interface Post {
  PostId: number;
  Subject: string;
  Message: { Html: string; Text: string };
  PostingUserDisplayName: string;
  DatePosted: string;
}

export async function listDiscussionForums(school: D2LSchool, cookieHeader: string, numericId: number): Promise<Forum[]> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/discussions/forums/`, cookieHeader);
}

export async function listDiscussionTopics(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  forumId: number
): Promise<Topic[]> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/discussions/forums/${forumId}/topics/`, cookieHeader);
}

export async function listDiscussionPosts(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  forumId: number,
  topicId: number
): Promise<Post[]> {
  return apiGet(
    school,
    `/d2l/api/le/${LE_VERSION}/${numericId}/discussions/forums/${forumId}/topics/${topicId}/posts/`,
    cookieHeader
  );
}

// --- Classlist ---

interface ClasslistUser {
  Identifier: string;
  DisplayName: string;
  Username: string | null;
  Email: string | null;
  RoleId: number | null;
  ClasslistRoleDisplayName: string;
}

export async function getClasslist(school: D2LSchool, cookieHeader: string, numericId: number): Promise<ClasslistUser[]> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/classlist/`, cookieHeader);
}

// --- Surveys ---

interface SurveyReadData {
  SurveyId: number;
  Name: string;
  IsActive: boolean;
  StartDate: string | null;
  EndDate: string | null;
}

export async function listSurveys(school: D2LSchool, cookieHeader: string, numericId: number): Promise<SurveyReadData[]> {
  return fetchAllPages(school, `/d2l/api/le/${LE_VERSION}/${numericId}/surveys/`, cookieHeader);
}

interface SurveyAttemptData {
  AttemptId: number;
  SurveyId: number;
  AttemptNumber: number;
  Started: string;
  Completed: string | null;
}

export async function getSurveyAttempts(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  surveyId: number
): Promise<SurveyAttemptData[]> {
  return fetchAllPages(school, `/d2l/api/le/${LE_VERSION}/${numericId}/surveys/${surveyId}/attempts/`, cookieHeader);
}

// --- Groups ---

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
  const categories = await apiGet<GroupCategoryData[]>(
    school,
    `/d2l/api/lp/${LP_VERSION}/${numericId}/groupcategories/`,
    cookieHeader
  );
  const result: GroupCategoryWithGroups[] = [];
  for (const category of categories) {
    const groups = await apiGet<GroupData[]>(
      school,
      `/d2l/api/lp/${LP_VERSION}/${numericId}/groupcategories/${category.GroupCategoryId}/groups/`,
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

// --- Due / completion tracking (cross-course, per school) ---

export interface DueItem {
  school: D2LSchool;
  orgUnitId: string;
  itemName: string;
  dueDate: string | null;
  dateCompleted: string | null;
}

export async function getDueItems(school: D2LSchool, cookieHeader: string): Promise<DueItem[]> {
  const items = await fetchAllPages<{
    OrgUnitId: string;
    ItemName: string;
    DueDate: string | null;
    DateCompleted: string | null;
  }>(school, `/d2l/api/le/${LE_VERSION}/content/myItems/completions/due/`, cookieHeader);
  return items.map((i) => ({
    school,
    orgUnitId: i.OrgUnitId,
    itemName: i.ItemName,
    dueDate: i.DueDate,
    dateCompleted: i.DateCompleted,
  }));
}
