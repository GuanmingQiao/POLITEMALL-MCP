import type { School } from "./schools.js";

const LE_VERSION = "1.9";
const LP_VERSION = "1.9";

export type D2LSchool = Extract<School, "politemall" | "nyp">;

export const SCHOOL_HOSTS: Record<D2LSchool, string> = {
  politemall: "lms.polite.edu.sg",
  nyp: "nyplms.polite.edu.sg",
};

export class SessionExpiredError extends Error {}
// Distinct from SessionExpiredError: the cookie is valid, but the account
// lacks the D2L role/permission the endpoint requires (e.g. a student calling
// an instructor-only grading route). Telling the caller to reconnect would be
// wrong and confusing here — they need a different account or role, not a
// fresh session.
export class PermissionDeniedError extends Error {}

async function apiGet<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`https://${SCHOOL_HOSTS[school]}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status === 200) return (await res.json()) as T;
  if (res.status === 403) {
    throw new PermissionDeniedError(`No permission to access ${path} — this likely requires an instructor/TA role`);
  }
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

// --- Lecturer/TA: class-wide grades ---

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

// Requires grades:gradevalues:read — an instructor/TA/grader permission. A
// student calling this gets a 403 (PermissionDeniedError), same as the real UI
// would refuse them the gradebook view.
export async function getClassGrades(school: D2LSchool, cookieHeader: string, numericId: number): Promise<StudentGrade[]> {
  const [definitions, values, classlist] = await Promise.all([
    apiGet<GradeDefinition[]>(school, `/d2l/api/le/${LE_VERSION}/${numericId}/grades/`, cookieHeader),
    fetchAllPages<BulkGradeValue>(school, `/d2l/api/le/${LE_VERSION}/${numericId}/grades/values/`, cookieHeader),
    getClasslist(school, cookieHeader, numericId),
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

export async function getAnnouncements(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/news/`, cookieHeader);
}

export async function getCalendarEvents(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/calendar/events/`, cookieHeader);
}

export async function getAssignments(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, `/d2l/api/le/${LE_VERSION}/${numericId}/dropbox/folders/`, cookieHeader);
}

// --- Lecturer/TA: dropbox submissions for the whole class ---

interface DropboxFile {
  FileId: number;
  FileName: string;
  Size: number;
}
interface DropboxSubmissionEntry {
  Id: number;
  SubmissionDate: string;
  Files: DropboxFile[];
}
interface DropboxFeedback {
  Score: number | null;
  IsGraded: boolean;
}
interface EntityDropbox {
  Entity: { EntityId: number; EntityType: number } | null;
  Status: number;
  Submissions: DropboxSubmissionEntry[] | null;
  Feedback: DropboxFeedback | null;
  CompletionDate: string | null;
}
export interface StudentSubmission {
  studentUserId: string | null;
  studentName: string | null;
  status: number;
  completionDate: string | null;
  score: number | null;
  isGraded: boolean;
  submissions: { submittedDate: string; files: string[] }[];
}

// dropbox:folders:read on this specific folder requires grading permission —
// students only ever see their own submission through the UI/other routes.
// EntityId is a userId for individual folders but a groupId for group
// dropboxes, in which case classlist lookup just misses and studentName stays
// null (still returns the raw studentUserId for the caller to resolve via
// get_groups if needed).
export async function getDropboxSubmissions(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  folderId: number
): Promise<StudentSubmission[]> {
  const [entries, classlist] = await Promise.all([
    fetchAllPages<EntityDropbox>(
      school,
      `/d2l/api/le/${LE_VERSION}/${numericId}/dropbox/folders/${folderId}/submissions/paged/`,
      cookieHeader
    ),
    getClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return entries.map((e) => {
    const userId = e.Entity?.EntityId != null ? String(e.Entity.EntityId) : null;
    return {
      studentUserId: userId,
      studentName: userId ? nameById.get(userId) ?? null : null,
      status: e.Status,
      completionDate: e.CompletionDate,
      score: e.Feedback?.Score ?? null,
      isGraded: e.Feedback?.IsGraded ?? false,
      submissions: (e.Submissions ?? []).map((s) => ({
        submittedDate: s.SubmissionDate,
        files: (s.Files ?? []).map((f) => f.FileName),
      })),
    };
  });
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
  UserId: number;
  AttemptNumber: number;
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

// --- Lecturer/TA: quiz results for the whole class ---

export interface QuizResult {
  attemptId: number;
  userId: string;
  studentName: string | null;
  attemptNumber: number;
  score: number | null;
  started: string;
  completed: string | null;
  isPublished: boolean;
}

// Same underlying route as getQuizAttempts, but this one requires
// quizzing:attempts:read (view-or-grade-quiz permission) and returns every
// student's attempts rather than just the caller's own — joined with the
// classlist for names. Pass studentUserId (a classlist Identifier) to scope
// to one student instead of the whole class.
export async function getQuizResults(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  quizId: number,
  studentUserId?: string
): Promise<QuizResult[]> {
  const qs = studentUserId ? `?${new URLSearchParams({ userId: studentUserId })}` : "";
  const [attempts, classlist] = await Promise.all([
    fetchAllPages<QuizAttemptData>(school, `/d2l/api/le/${LE_VERSION}/${numericId}/quizzes/${quizId}/attempts/${qs}`, cookieHeader),
    getClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return attempts.map((a) => ({
    attemptId: a.AttemptId,
    userId: String(a.UserId),
    studentName: nameById.get(String(a.UserId)) ?? null,
    attemptNumber: a.AttemptNumber,
    score: a.Score,
    started: a.Started,
    completed: a.Completed,
    isPublished: a.IsPublished,
  }));
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
