import type { School } from "./schools.js";
import { getRouteDescriptor } from "./d2lRouteCatalog.js";

// Exported so d2lVersionCheck.ts can verify these are still supported by every tenant at
// startup, without duplicating the pin in a second place.
export const LE_VERSION = "1.9";
export const LP_VERSION = "1.9";

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
// Distinct from both of the above: the cookie is valid and the role is fine,
// but D2L returns a bare 404 for this route — in practice this means the
// underlying tool (Quizzes, Surveys, ...) isn't enabled/visible on this
// particular course, not that anything is wrong with the session.
export class NotFoundError extends Error {}

async function apiGet<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`https://${SCHOOL_HOSTS[school]}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status === 200) return (await res.json()) as T;
  if (res.status === 403) {
    throw new PermissionDeniedError(`No permission to access ${path} — this likely requires an instructor/TA role`);
  }
  if (res.status === 404) {
    throw new NotFoundError(`${path} returned 404 — this tool likely isn't enabled for this course`);
  }
  // A dead/expired D2L session manifests as either a redirect to the login
  // page (redirect: "manual" surfaces that as a 3xx here) or a 401 — anything
  // else (500s, etc.) is a real server-side failure, not a session problem.
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    throw new SessionExpiredError(`Request to ${path} failed with status ${res.status}`);
  }
  throw new Error(`Request to ${path} failed with unexpected status ${res.status}`);
}

// --- Route catalog dispatch --------------------------------------------------

export class UnknownOperationError extends Error {}
export class InvalidRouteParamsError extends Error {}

// Builds the full request path (e.g. "/d2l/api/le/1.9/6606/rubrics/{rubricId}" resolved to
// "/d2l/api/le/1.9/6606/rubrics/42") for a cataloged operation. `pathParams` is validated
// against the catalog entry's declared schema — it must NOT include orgUnitId; for a
// course-scoped operation, `orgUnitId` is a separate argument the caller derives from a
// courseId, never from caller-supplied path params (closing off the class of bug where a
// valid session for one course probes another course's orgUnitId — see design.md Decision 3).
export function resolveD2lPath(operation: string, pathParams: Record<string, unknown> = {}, orgUnitId?: number): string {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }

  const parsed = descriptor.pathParams.safeParse(pathParams);
  if (!parsed.success) {
    throw new InvalidRouteParamsError(`Invalid path params for "${operation}": ${parsed.error.message}`);
  }

  const substitutions: Record<string, unknown> = { ...parsed.data };
  if (descriptor.scope === "course") {
    if (orgUnitId === undefined) {
      throw new InvalidRouteParamsError(`Operation "${operation}" is course-scoped and requires an orgUnitId`);
    }
    substitutions.orgUnitId = orgUnitId;
  }

  let path = descriptor.pathTemplate;
  for (const [key, value] of Object.entries(substitutions)) {
    path = path.split(`{${key}}`).join(encodeURIComponent(String(value)));
  }
  if (/\{[a-zA-Z]+\}/.test(path)) {
    throw new InvalidRouteParamsError(`Unresolved path placeholder(s) for "${operation}": ${path}`);
  }

  const version = descriptor.product === "le" ? LE_VERSION : LP_VERSION;
  return `/d2l/api/${descriptor.product}/${version}${path}`;
}

// Validates and serializes query params for a cataloged operation into a "?"-prefixed string
// (or "" if there are none / the operation declares no queryParams schema).
export function resolveD2lQuery(operation: string, queryParams: Record<string, unknown> = {}): string {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }
  if (!descriptor.queryParams) return "";

  const parsed = descriptor.queryParams.safeParse(queryParams);
  if (!parsed.success) {
    throw new InvalidRouteParamsError(`Invalid query params for "${operation}": ${parsed.error.message}`);
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    qs.set(key, String(value));
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
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

interface BookmarkPage<T> {
  PagingInfo: { Bookmark: string | null; HasMoreItems: boolean };
  Items: T[];
}

// Valence's PagedResultSet convention (Api.PagedResultSet — distinct from ObjectListPage
// above) — used by several catalog routes (e.g. le.grades.courseCompletionList,
// le.import.importLogs) that no curated tool touches today, so nothing previously needed this.
async function fetchAllBookmarkPages<T>(school: D2LSchool, basePath: string, cookieHeader: string): Promise<T[]> {
  const items: T[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 20; page++) {
    const path = bookmark
      ? `${basePath}${basePath.includes("?") ? "&" : "?"}bookmark=${encodeURIComponent(bookmark)}`
      : basePath;
    const page_: BookmarkPage<T> = await apiGet(school, path, cookieHeader);
    items.push(...page_.Items);
    if (!page_.PagingInfo.HasMoreItems || !page_.PagingInfo.Bookmark) break;
    bookmark = page_.PagingInfo.Bookmark;
  }
  return items;
}

// The catalog-driven dispatch behind call_d2l_operation (see mcp.ts). Unlike every curated
// tool above, this returns the D2L response raw/unshaped — see design.md Decision 3.
export class UnsupportedOperationError extends Error {}

export async function callD2lOperation(
  school: D2LSchool,
  cookieHeader: string,
  operation: string,
  pathParams: Record<string, unknown>,
  queryParams: Record<string, unknown>,
  orgUnitId?: number
): Promise<unknown> {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }
  if (descriptor.pagination === "binary") {
    throw new UnsupportedOperationError(
      `Operation "${operation}" returns binary file content, which call_d2l_operation cannot return as text.`
    );
  }

  const path = resolveD2lPath(operation, pathParams, orgUnitId) + resolveD2lQuery(operation, queryParams);
  if (descriptor.pagination === "objectList") return fetchAllPages(school, path, cookieHeader);
  if (descriptor.pagination === "bookmark") return fetchAllBookmarkPages(school, path, cookieHeader);
  return apiGet(school, path, cookieHeader);
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
  return apiGet(school, resolveD2lPath("le.content.toc", {}, numericId), cookieHeader);
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
    apiGet<GradeDefinition[]>(school, resolveD2lPath("le.grades.definitionsList", {}, numericId), cookieHeader),
    fetchAllPages<BulkGradeValue>(school, resolveD2lPath("le.grades.valuesAll", {}, numericId), cookieHeader),
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
  return apiGet(school, resolveD2lPath("le.news.list", {}, numericId), cookieHeader);
}

export async function getCalendarEvents(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, resolveD2lPath("le.calendar.list", {}, numericId), cookieHeader);
}

export async function getAssignments(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, resolveD2lPath("le.dropbox.foldersList", {}, numericId), cookieHeader);
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
    fetchAllPages<EntityDropbox>(school, resolveD2lPath("le.dropbox.submissionsPaged", { folderId }, numericId), cookieHeader),
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
  return fetchAllPages(school, resolveD2lPath("le.quizzes.list", {}, numericId), cookieHeader);
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
  return fetchAllPages(school, resolveD2lPath("le.quizzes.attempts", { quizId }, numericId), cookieHeader);
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
  const qs = studentUserId ? resolveD2lQuery("le.quizzes.attempts", { userId: studentUserId }) : "";
  const [attempts, classlist] = await Promise.all([
    fetchAllPages<QuizAttemptData>(school, resolveD2lPath("le.quizzes.attempts", { quizId }, numericId) + qs, cookieHeader),
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
  return apiGet(school, resolveD2lPath("le.discussions.forumsList", {}, numericId), cookieHeader);
}

export async function listDiscussionTopics(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  forumId: number
): Promise<Topic[]> {
  return apiGet(school, resolveD2lPath("le.discussions.topicsList", { forumId }, numericId), cookieHeader);
}

export async function listDiscussionPosts(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  forumId: number,
  topicId: number
): Promise<Post[]> {
  return apiGet(school, resolveD2lPath("le.discussions.postsList", { forumId, topicId }, numericId), cookieHeader);
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
  return apiGet(school, resolveD2lPath("le.classlist.list", {}, numericId), cookieHeader);
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
  return fetchAllPages(school, resolveD2lPath("le.surveys.list", {}, numericId), cookieHeader);
}

interface SurveyAttemptData {
  AttemptId: number;
  SurveyId: number;
  // Present on the real API response but unused by the original own-scoped getSurveyAttempts
  // (which never needed to know whose attempt it was); null on anonymous surveys.
  UserId: number | null;
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
  return fetchAllPages(school, resolveD2lPath("le.surveys.attempts", { surveyId }, numericId), cookieHeader);
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
  }>(school, resolveD2lPath("le.content.global.myItemsCompletionsDue", {}), cookieHeader);
  return items.map((i) => ({
    school,
    orgUnitId: i.OrgUnitId,
    itemName: i.ItemName,
    dueDate: i.DueDate,
    dateCompleted: i.DateCompleted,
  }));
}

// --- Rubrics ---
//
// Valence scopes rubric listing to a specific gradable object (a discussion topic, dropbox
// folder, etc.) — there is no "all rubrics in this course" route. get_rubrics therefore has
// two modes: pass rubricId to fetch one rubric directly (le.rubrics.get takes no other
// params), or pass objectType+objectId to list the rubrics attached to that object
// (le.rubrics.list). This is a real API constraint discovered during implementation, not the
// "get_rubrics(courseId, rubricId?)"-only signature tasks.md originally sketched.

export interface GetRubricsOptions {
  rubricId?: number;
  objectType?: string;
  objectId?: number;
}

export async function getRubrics(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  opts: GetRubricsOptions
): Promise<unknown> {
  if (opts.rubricId !== undefined) {
    return apiGet(school, resolveD2lPath("le.rubrics.get", { rubricId: opts.rubricId }, numericId), cookieHeader);
  }
  if (!opts.objectType || opts.objectId === undefined) {
    throw new Error("get_rubrics requires either rubricId, or both objectType and objectId");
  }
  const qs = resolveD2lQuery("le.rubrics.list", { objectType: opts.objectType, objectId: opts.objectId });
  return apiGet(school, resolveD2lPath("le.rubrics.list", {}, numericId) + qs, cookieHeader);
}

// --- Final grades (student vs instructor/TA pair) ---

export async function getMyFinalGrade(school: D2LSchool, cookieHeader: string, numericId: number): Promise<unknown> {
  return apiGet(school, resolveD2lPath("le.grades.finalValueMy", {}, numericId), cookieHeader);
}

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

// Requires the same grading permission as getClassGrades — a student calling this gets a 403.
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

// --- Dropbox: the student's own submission (pairs with the existing instructor-facing
// getDropboxSubmissions) ---

interface RichTextLike {
  Text: string;
  Html: string;
}
interface MyDropboxSubmissionEntry {
  Id: number;
  SubmittedBy: number | null;
  SubmissionDate: string;
  Comment: RichTextLike | null;
  Files: { FileId: number; FileName: string; Size: number }[] | null;
}
interface MyDropboxFeedback {
  Score: number | null;
  Feedback: RichTextLike | null;
  IsGraded: boolean;
}
interface MyDropboxEntry {
  Status: number;
  CompletionDate: string | null;
  Feedback: MyDropboxFeedback | null;
  Submissions: MyDropboxSubmissionEntry[] | null;
}
export interface MyDropboxSubmission {
  status: number;
  completionDate: string | null;
  score: number | null;
  isGraded: boolean;
  feedbackText: string | null;
  submissions: { submittedDate: string; comment: string | null; files: string[] }[];
}

export async function getMyDropboxSubmission(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  folderId: number
): Promise<MyDropboxSubmission[]> {
  const entries = await apiGet<MyDropboxEntry[]>(school, resolveD2lPath("le.dropbox.mySubmissions", { folderId }, numericId), cookieHeader);
  return entries.map((e) => ({
    status: e.Status,
    completionDate: e.CompletionDate,
    score: e.Feedback?.Score ?? null,
    isGraded: e.Feedback?.IsGraded ?? false,
    feedbackText: e.Feedback?.Feedback?.Text ?? null,
    submissions: (e.Submissions ?? []).map((s) => ({
      submittedDate: s.SubmissionDate,
      comment: s.Comment?.Text ?? null,
      files: (s.Files ?? []).map((f) => f.FileName),
    })),
  }));
}

// --- Lecturer/TA: survey results for the whole class (pairs with getSurveyAttempts) ---

export interface SurveyResult {
  attemptId: number;
  userId: string | null;
  studentName: string | null;
  attemptNumber: number;
  started: string;
  completed: string | null;
}

// Same underlying route as getSurveyAttempts, but requires class-wide view/grade permission
// and returns every student's attempts. D2L rejects userId filtering with 400 on an anonymous
// survey (no UserId exists to filter by) — that surfaces as a generic Error, same as any other
// unexpected status from apiGet.
export async function getSurveyResults(
  school: D2LSchool,
  cookieHeader: string,
  numericId: number,
  surveyId: number,
  studentUserId?: string
): Promise<SurveyResult[]> {
  const qs = studentUserId ? resolveD2lQuery("le.surveys.attempts", { userId: studentUserId }) : "";
  const [attempts, classlist] = await Promise.all([
    fetchAllPages<SurveyAttemptData>(school, resolveD2lPath("le.surveys.attempts", { surveyId }, numericId) + qs, cookieHeader),
    getClasslist(school, cookieHeader, numericId),
  ]);
  const nameById = new Map(classlist.map((u) => [u.Identifier, u.DisplayName]));
  return attempts.map((a) => ({
    attemptId: a.AttemptId,
    userId: a.UserId != null ? String(a.UserId) : null,
    studentName: a.UserId != null ? nameById.get(String(a.UserId)) ?? null : null,
    attemptNumber: a.AttemptNumber,
    started: a.Started,
    completed: a.Completed,
  }));
}

// --- Quiz / survey questions ---

interface QuestionData {
  QuestionId: number;
  Name: string | null;
  QuestionText: RichTextLike | null;
  Points: number;
  QuestionTypeId: number;
}
export interface QuizQuestion {
  questionId: number;
  name: string | null;
  questionText: string | null;
  points: number;
  questionTypeId: number;
}

export async function getQuizQuestions(school: D2LSchool, cookieHeader: string, numericId: number, quizId: number): Promise<QuizQuestion[]> {
  const raw = await fetchAllPages<QuestionData>(school, resolveD2lPath("le.quizzes.questions", { quizId }, numericId), cookieHeader);
  return raw.map((q) => ({
    questionId: q.QuestionId,
    name: q.Name,
    questionText: q.QuestionText?.Text ?? null,
    points: q.Points,
    questionTypeId: q.QuestionTypeId,
  }));
}

// Docs describe the survey question structure as identical to the quiz one.
export async function getSurveyQuestions(school: D2LSchool, cookieHeader: string, numericId: number, surveyId: number): Promise<QuizQuestion[]> {
  const raw = await fetchAllPages<QuestionData>(school, resolveD2lPath("le.surveys.questions", { surveyId }, numericId), cookieHeader);
  return raw.map((q) => ({
    questionId: q.QuestionId,
    name: q.Name,
    questionText: q.QuestionText?.Text ?? null,
    points: q.Points,
    questionTypeId: q.QuestionTypeId,
  }));
}

// --- Course overview ---

export interface CourseOverview {
  description: string | null;
  hasAttachment: boolean;
}

export async function getCourseOverview(school: D2LSchool, cookieHeader: string, numericId: number): Promise<CourseOverview> {
  const raw = await apiGet<{ Description: RichTextLike | null; HasAttachment: boolean }>(
    school,
    resolveD2lPath("le.overview.get", {}, numericId),
    cookieHeader
  );
  return { description: raw.Description?.Text ?? null, hasAttachment: raw.HasAttachment };
}

// --- Single content topic (drill-down from getCourseContent) ---

export async function getContentTopic(school: D2LSchool, cookieHeader: string, numericId: number, topicId: number): Promise<unknown> {
  return apiGet(school, resolveD2lPath("le.content.topicGet", { topicId }, numericId), cookieHeader);
}

// --- Cross-course aggregations (student-facing, fanned out per connected school like
// getDueItems) ---

// le.calendar.global.myEvents and le.updates.global.myUpdates both declare orgUnitIdsCSV as a
// required query param — building it means first listing the caller's own course org unit ids
// for this school, same identifiers listCourses already exposes as courseIds.
async function buildOrgUnitIdsCsv(school: D2LSchool, cookieHeader: string): Promise<string> {
  const courses = await listCourses(school, cookieHeader);
  return courses.map((c) => parseCourseId(c.courseId).numericId).join(",");
}

export interface MyCalendarEvent {
  school: D2LSchool;
  eventId: number;
  title: string;
  startDateTime: string | null;
  endDateTime: string | null;
  orgUnitName: string;
}

export async function getMyCalendarEvents(
  school: D2LSchool,
  cookieHeader: string,
  startDateTime: string,
  endDateTime: string
): Promise<MyCalendarEvent[]> {
  const orgUnitIdsCSV = await buildOrgUnitIdsCsv(school, cookieHeader);
  if (!orgUnitIdsCSV) return [];
  const qs = resolveD2lQuery("le.calendar.global.myEvents", { orgUnitIdsCSV, startDateTime, endDateTime });
  const raw = await fetchAllPages<{
    CalendarEventId: number;
    Title: string;
    StartDateTime: string | null;
    EndDateTime: string | null;
    OrgUnitName: string;
  }>(school, resolveD2lPath("le.calendar.global.myEvents", {}) + qs, cookieHeader);
  return raw.map((e) => ({
    school,
    eventId: e.CalendarEventId,
    title: e.Title,
    startDateTime: e.StartDateTime,
    endDateTime: e.EndDateTime,
    orgUnitName: e.OrgUnitName,
  }));
}

export interface RecentUpdateCount {
  school: D2LSchool;
  orgUnitId: string;
  unreadDiscussions: number;
  unapprovedDiscussions: number;
  unreadAssignmentFeedback: number;
  unattemptedQuizzes: number;
  unreadAssignmentSubmissions: number;
  ungradedQuizzes: number;
}

export async function getRecentUpdates(school: D2LSchool, cookieHeader: string): Promise<RecentUpdateCount[]> {
  const orgUnitIdsCSV = await buildOrgUnitIdsCsv(school, cookieHeader);
  if (!orgUnitIdsCSV) return [];
  const qs = resolveD2lQuery("le.updates.global.myUpdates", { orgUnitIdsCSV });
  const raw = await fetchAllPages<{
    OrgUnitId: string;
    UnreadDiscussions: number;
    UnapprovedDiscussions: number;
    UnreadAssignmentFeedback: number;
    UnattemptedQuizzes: number;
    UnreadAssignmentSubmissions: number;
    UngradedQuizzes: number;
  }>(school, resolveD2lPath("le.updates.global.myUpdates", {}) + qs, cookieHeader);
  return raw.map((u) => ({
    school,
    orgUnitId: u.OrgUnitId,
    unreadDiscussions: u.UnreadDiscussions,
    unapprovedDiscussions: u.UnapprovedDiscussions,
    unreadAssignmentFeedback: u.UnreadAssignmentFeedback,
    unattemptedQuizzes: u.UnattemptedQuizzes,
    unreadAssignmentSubmissions: u.UnreadAssignmentSubmissions,
    ungradedQuizzes: u.UngradedQuizzes,
  }));
}

export interface OverdueItem {
  school: D2LSchool;
  orgUnitId: string;
  itemId: number;
  itemName: string;
  dueDate: string | null;
}

// Unlike the two above, orgUnitIdsCSV is genuinely optional here — D2L defaults to the
// caller's own active enrollments when it's omitted.
export async function getOverdueItems(school: D2LSchool, cookieHeader: string): Promise<OverdueItem[]> {
  const raw = await fetchAllPages<{ OrgUnitId: string; ItemId: number; ItemName: string; DueDate: string | null }>(
    school,
    resolveD2lPath("le.content.global.overdueItemsMy", {}),
    cookieHeader
  );
  return raw.map((i) => ({ school, orgUnitId: i.OrgUnitId, itemId: i.ItemId, itemName: i.ItemName, dueDate: i.DueDate }));
}
