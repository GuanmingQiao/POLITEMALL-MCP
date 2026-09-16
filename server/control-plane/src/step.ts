const HOST = "stms.polite.edu.sg";
const BASE_URL = `https://${HOST}`;

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

export async function listCourses(cookieHeader: string): Promise<StepCourse[]> {
  const courses: StepCourse[] = [];
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
        courseId: item.courseId,
        name: item.courseName,
        code: item.courseCode,
        category: item.courseCategory,
        type: item.courseType,
        startTime: item.startTime,
        endTime: item.endTime,
      });
    }
    if (pageIndex >= page.pageCount) break;
  }
  return courses;
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
  const detail = unwrap(
    await apiGet<Envelope<MyCourseDetail>>(`/studentapi/api/v1/mycourse/mycourse/${courseId}`, cookieHeader)
  );
  const moduleDetailId = detail.myModuleDetailsDtos[0]?.id;
  if (!moduleDetailId) return [];

  const page = unwrap(
    await apiPost<Envelope<PagedResult<SessionItem>>>("/studentapi/api/v1/mycourse/sessions/paging", cookieHeader, {
      pageIndex: 1,
      pageSize: 100,
      isAscending: false,
      filters: {},
      id: moduleDetailId,
    })
  );
  return page.items;
}

interface AnnouncementItem {
  announcementTitle: string;
  content: string;
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
