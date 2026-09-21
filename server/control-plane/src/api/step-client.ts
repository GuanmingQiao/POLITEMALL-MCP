import { STEP_HOST } from "../utils/deep-links.js";

const BASE_URL = `https://${STEP_HOST}`;

export class SessionExpiredError extends Error {}

async function apiGet<T>(path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status !== 200) throw new SessionExpiredError(`GET ${path} failed with status ${res.status}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, cookieHeader: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Cookie: cookieHeader, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status !== 200) throw new SessionExpiredError(`POST ${path} failed with status ${res.status}`);
  return (await res.json()) as T;
}

// STEP wraps every response in this envelope regardless of endpoint.
interface Envelope<T> {
  data: T;
  code: number;
  status: number;
  message: string | null;
  errorCode: number;
}

function unwrap<T>(env: Envelope<T>): T {
  if (env.code !== 200 || env.status !== 0) {
    throw new Error(env.message ?? `STEP API error (code ${env.code}, status ${env.status})`);
  }
  return env.data;
}

interface MyCourseItem {
  courseId: string;
  courseName: string;
  courseCode: string;
  courseCategory: string;
  courseType: string;
  institute: number;
  intakeEnrolmentStatus: number;
  startTime: string | null;
  endTime: string | null;
}
interface PagedResult<T> {
  items: T[];
  pageCount: number;
  totalItemsCount: number;
}

export interface StepCourse {
  courseId: string;
  name: string;
  code: string;
  category: string;
  type: string;
  startTime: string | null;
  endTime: string | null;
}

// An enrolled course with the extra id its page link needs. `institute` never appears in a tool
// result; it only lets the tool layer build the link from what it just read.
export interface EnrolledCourse {
  course: StepCourse;
  institute: number;
}

export async function listCourses(cookieHeader: string): Promise<StepCourse[]> {
  return (await listCoursesWithInstitute(cookieHeader)).map((c) => c.course);
}

export async function listCoursesWithInstitute(cookieHeader: string): Promise<EnrolledCourse[]> {
  const courses: EnrolledCourse[] = [];
  for (let pageIndex = 1; pageIndex <= 10; pageIndex++) {
    const page = unwrap(
      await apiPost<Envelope<PagedResult<MyCourseItem>>>("/studentapi/api/v1/mycourse/paging", cookieHeader, {
        pageIndex,
        pageSize: 50,
        filters: {},
        isAscending: false,
      })
    );
    for (const item of page.items) {
      courses.push({
        institute: item.institute,
        course: {
          courseId: item.courseId,
          name: item.courseName,
          code: item.courseCode,
          category: item.courseCategory,
          type: item.courseType,
          startTime: item.startTime,
          endTime: item.endTime,
        },
      });
    }
    if (pageIndex >= page.pageCount) break;
  }
  return courses;
}

interface CatalogueItem {
  // The catalogue entry (an intake) — the course page is keyed on this, NOT on courseId: opening
  // the page with courseId renders a blank screen with no error.
  id?: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  courseCategory: string;
  courseType?: string;
  courseStart: string | null;
  courseEnd: string | null;
}

export interface CatalogueCourse {
  courseId: string;
  name: string;
  code: string;
  category: string;
  type: string | null;
  startTime: string | null;
  endTime: string | null;
}

// The public course catalog — unlike listCourses (your enrollments), this returns
// every course STEP offers, matching what the "All courses" browse/search page
// shows. searchContent narrows by keyword; omit it to browse everything.
export interface CatalogueEntry {
  course: CatalogueCourse;
  catalogueId: string | null;
}

export async function searchCourses(cookieHeader: string, searchContent = "", maxResults = 100): Promise<CatalogueCourse[]> {
  return (await searchCoursesWithIds(cookieHeader, searchContent, maxResults)).map((c) => c.course);
}

export async function searchCoursesWithIds(cookieHeader: string, searchContent = "", maxResults = 100): Promise<CatalogueEntry[]> {
  const courses: CatalogueEntry[] = [];
  for (let pageIndex = 1; pageIndex <= 10 && courses.length < maxResults; pageIndex++) {
    const page = unwrap(
      await apiPost<Envelope<PagedResult<CatalogueItem>>>("/studentapi/api/v1/coursecatalogue/paging", cookieHeader, {
        pageIndex,
        pageSize: 50,
        searchContent,
        filters: {},
        isAscending: false,
        isInterestedPage: false,
      })
    );
    for (const item of page.items) {
      courses.push({
        catalogueId: item.id ?? null,
        course: {
          courseId: item.courseId,
          name: item.courseName,
          code: item.courseCode,
          category: item.courseCategory,
          type: item.courseType ?? null,
          startTime: item.courseStart,
          endTime: item.courseEnd,
        },
      });
    }
    if (pageIndex >= page.pageCount) break;
  }
  return courses.slice(0, maxResults);
}

interface ModuleDetail {
  id: string;
  moduleName: string;
  moduleCode: string;
  moduleEnrolmentStatus: number;
  attendancePercentage: number;
  minimumAttendance: number;
  grade: string;
  overAllModuleGrade?: string | null;
  assessmentTimetables: unknown[];
}
interface MyCourseDetail {
  myCourseSimpleDto: MyCourseItem;
  myModuleDetailsDtos: ModuleDetail[];
}

export async function getCourseDetail(cookieHeader: string, courseId: string): Promise<unknown> {
  return unwrap(
    await apiGet<Envelope<MyCourseDetail>>(`/studentapi/api/v1/mycourse/mycourse/${courseId}`, cookieHeader)
  );
}

interface SessionItem {
  moduleName: string;
  sessionNumber: number;
  sessionName: string;
  startTime: string;
  endTime: string;
  trainers: { trainerName: string }[];
  facilityName: string;
  roomName: string;
  attendanceStatusStr: string;
}

// The sessions/paging endpoint keys off a module-detail id, not the courseId itself,
// so this fetches the course detail first to find it (a course can have more than
// one module; this uses the first).
export async function getTimetable(cookieHeader: string, courseId: string): Promise<SessionItem[]> {
  return (await getTimetableWithInstitute(cookieHeader, courseId)).sessions;
}

// The same sessions, plus the course's institute (needed for the course page link; not output).
export async function getTimetableWithInstitute(cookieHeader: string, courseId: string): Promise<{ sessions: SessionItem[]; institute: number | null }> {
  const detail = unwrap(
    await apiGet<Envelope<MyCourseDetail>>(`/studentapi/api/v1/mycourse/mycourse/${courseId}`, cookieHeader)
  );
  const institute = detail.myCourseSimpleDto?.institute ?? null;
  const moduleDetailId = detail.myModuleDetailsDtos[0]?.id;
  if (!moduleDetailId) return { sessions: [], institute };

  const page = unwrap(
    await apiPost<Envelope<PagedResult<SessionItem>>>("/studentapi/api/v1/mycourse/sessions/paging", cookieHeader, {
      pageIndex: 1,
      pageSize: 100,
      isAscending: false,
      filters: {},
      id: moduleDetailId,
    })
  );
  return { sessions: page.items, institute };
}

interface AnnouncementItem {
  announcementTitle: string;
  content: string;
  // Present in the real response; only the date is used (Singapore-time companion).
  publishDate?: string | null;
}

export async function getAnnouncements(cookieHeader: string): Promise<AnnouncementItem[]> {
  const page = unwrap(
    await apiPost<Envelope<PagedResult<AnnouncementItem>>>("/studentapi/api/v1/announcements", cookieHeader, {
      pageIndex: 1,
      pageSize: 20,
      filters: {},
      isAscending: false,
    })
  );
  return page.items;
}

export async function whoami(cookieHeader: string): Promise<unknown> {
  return unwrap(await apiGet<Envelope<unknown>>("/studentapi/api/v1/profile/me", cookieHeader));
}
