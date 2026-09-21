// The link registry: the ONLY place in the server that turns ids into a URL a user can open.
// Every pattern here was opened in a signed-in session on the real site and shown to return the
// item's own page (see openspec/changes/add-trust-metadata/design.md for the verification matrix);
// a pattern that is not verified for a system emits nothing there, and SOURCE_LINKS=off emits
// nothing anywhere. Ids are validated, so a bad id yields "no link" rather than a guessed one.
//
// The three legacy builders at the bottom (assignmentUrl, quizUrl, gradebookUrl) produce the
// `url` field get_assignments has always returned. Their templates are the ones the course pages
// themselves use (harvested by brightspace-mcp-server, MIT, (c) 2026 Rohan Muppa — see
// THIRD_PARTY_NOTICES.md).
import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import type { D2LSchool } from "../types/schools.js";
import { sourceLinksEnabled } from "./config.js";

export const STEP_HOST = "stms.polite.edu.sg";

export type LinkSystem = D2LSchool | "step";

export type LinkPattern =
  | "courseHome"
  | "announcement"
  | "announcementsList"
  | "contentTopic"
  | "contentRoot"
  | "classlist"
  | "discussionTopic"
  | "discussionsList"
  | "assignment"
  | "submissionHistory"
  | "quiz"
  | "quizList"
  | "survey"
  | "surveyList"
  | "myGrades"
  | "courseCalendar"
  | "calendarEvent"
  | "groups"
  | "schoolHome"
  | "graderGradebook"
  | "graderAssignments"
  | "graderQuizzes"
  | "stepMyCourses"
  | "stepCourse"
  | "stepCatalogueCourse"
  | "stepHome"
  | "stepCalendar"
  | "stepProfile";

const both = { nyp: true, politemall: true, step: false } as const;
// No item of this kind exists in the account's POLITEMall courses, so it has not been opened there.
const nypOnly = { nyp: true, politemall: false, step: false } as const;
const stepOnly = { nyp: false, politemall: false, step: true } as const;

// Where each pattern has been verified (true) or not (false). An unverified pair emits no link.
// Flipping an entry is the whole change needed to enable or switch off a pattern.
//  - POLITEMall's test account is a Learner, so it cannot open the grader pages, and it has no
//    assignment folder or calendar event to test with.
//  - STEP was only tested with a course at institute 4 (NYP).
export const VERIFIED: Record<LinkPattern, Record<LinkSystem, boolean>> = {
  courseHome: both,
  announcement: both,
  announcementsList: both,
  contentTopic: both,
  contentRoot: both,
  classlist: both,
  discussionTopic: both,
  discussionsList: both,
  assignment: nypOnly,
  submissionHistory: nypOnly,
  quiz: both,
  quizList: both,
  survey: both,
  surveyList: both,
  myGrades: both,
  courseCalendar: both,
  calendarEvent: nypOnly,
  groups: both,
  schoolHome: both,
  graderGradebook: nypOnly,
  graderAssignments: nypOnly,
  graderQuizzes: nypOnly,
  stepMyCourses: stepOnly,
  stepCourse: stepOnly,
  stepCatalogueCourse: stepOnly,
  stepHome: stepOnly,
  stepCalendar: stepOnly,
  stepProfile: stepOnly,
};

// Institutes a STEP enrolled-course link has been opened for (informational; the link always
// uses the course's own institute value).
export const STEP_VERIFIED_INSTITUTES = [4];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(n: unknown): number | undefined {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
function guid(s: unknown): string | undefined {
  return typeof s === "string" && GUID.test(s) ? s.toLowerCase() : undefined;
}

// D2L sends some org-unit ids as numeric strings ("6606"); accept those, nothing else.
export function toId(raw: unknown): number | undefined {
  if (typeof raw === "string" && /^\d{1,15}$/.test(raw)) return id(Number(raw));
  return id(raw);
}

function hostOf(system: LinkSystem): string {
  return system === "step" ? STEP_HOST : SCHOOL_HOSTS[system];
}

// `path` is not a string when an id failed validation (the `id(x) && "/path"` idiom leaves
// undefined behind), and that means no link.
function emit(pattern: LinkPattern, system: LinkSystem, path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  if (!sourceLinksEnabled() || !VERIFIED[pattern][system]) return undefined;
  return `https://${hostOf(system)}${path}`;
}

const ou = (n: number) => `ou=${n}`;

export const link = {
  courseHome: (s: D2LSchool, courseId: unknown) => emit("courseHome", s, id(courseId) && `/d2l/home/${id(courseId)}`),
  announcement: (s: D2LSchool, courseId: unknown, newsId: unknown) =>
    emit("announcement", s, id(courseId) && id(newsId) && `/d2l/le/news/${id(courseId)}/${id(newsId)}/view`),
  announcementsList: (s: D2LSchool, courseId: unknown) =>
    emit("announcementsList", s, id(courseId) && `/d2l/lms/news/main.d2l?${ou(id(courseId)!)}`),
  contentTopic: (s: D2LSchool, courseId: unknown, topicId: unknown) =>
    emit("contentTopic", s, id(courseId) && id(topicId) && `/d2l/le/lessons/${id(courseId)}/topics/${id(topicId)}`),
  contentRoot: (s: D2LSchool, courseId: unknown) => emit("contentRoot", s, id(courseId) && `/d2l/le/lessons/${id(courseId)}`),
  classlist: (s: D2LSchool, courseId: unknown) =>
    emit("classlist", s, id(courseId) && `/d2l/lms/classlist/classlist.d2l?${ou(id(courseId)!)}`),
  discussionTopic: (s: D2LSchool, courseId: unknown, topicId: unknown) =>
    emit("discussionTopic", s, id(courseId) && id(topicId) && `/d2l/le/${id(courseId)}/discussions/topics/${id(topicId)}/View`),
  discussionsList: (s: D2LSchool, courseId: unknown) =>
    emit("discussionsList", s, id(courseId) && `/d2l/le/${id(courseId)}/discussions/List`),
  assignment: (s: D2LSchool, courseId: unknown, folderId: unknown) =>
    emit("assignment", s, id(courseId) && id(folderId) && `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id(folderId)}&grpid=0&${ou(id(courseId)!)}`),
  submissionHistory: (s: D2LSchool, courseId: unknown) =>
    emit("submissionHistory", s, id(courseId) && `/d2l/lms/dropbox/user/folders_history.d2l?${ou(id(courseId)!)}`),
  quiz: (s: D2LSchool, courseId: unknown, quizId: unknown) =>
    emit("quiz", s, id(courseId) && id(quizId) && `/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${id(quizId)}&${ou(id(courseId)!)}`),
  quizList: (s: D2LSchool, courseId: unknown) =>
    emit("quizList", s, id(courseId) && `/d2l/lms/quizzing/user/quizzes_list.d2l?${ou(id(courseId)!)}`),
  survey: (s: D2LSchool, courseId: unknown, surveyId: unknown) =>
    emit("survey", s, id(courseId) && id(surveyId) && `/d2l/lms/survey/user/survey_activities.d2l?si=${id(surveyId)}&${ou(id(courseId)!)}`),
  surveyList: (s: D2LSchool, courseId: unknown) =>
    emit("surveyList", s, id(courseId) && `/d2l/lms/survey/user/surveys_list.d2l?${ou(id(courseId)!)}`),
  myGrades: (s: D2LSchool, courseId: unknown) =>
    emit("myGrades", s, id(courseId) && `/d2l/lms/grades/my_grades/main.d2l?${ou(id(courseId)!)}`),
  courseCalendar: (s: D2LSchool, courseId: unknown) => emit("courseCalendar", s, id(courseId) && `/d2l/le/calendar/${id(courseId)}`),
  groups: (s: D2LSchool, courseId: unknown) =>
    emit("groups", s, id(courseId) && `/d2l/lms/group/user_group_list.d2l?${ou(id(courseId)!)}`),
  schoolHome: (s: D2LSchool) => emit("schoolHome", s, "/d2l/home"),
  graderGradebook: (s: D2LSchool, courseId: unknown) =>
    emit("graderGradebook", s, id(courseId) && `/d2l/lms/grades/admin/enter/user_list_view.d2l?${ou(id(courseId)!)}`),
  graderAssignments: (s: D2LSchool, courseId: unknown) =>
    emit("graderAssignments", s, id(courseId) && `/d2l/lms/dropbox/admin/folders_manage.d2l?${ou(id(courseId)!)}`),
  graderQuizzes: (s: D2LSchool, courseId: unknown) =>
    emit("graderQuizzes", s, id(courseId) && `/d2l/lms/quizzing/admin/quizzes_manage.d2l?${ou(id(courseId)!)}`),
  // A calendar event's own id cannot be used to build its page (the page keys on an occurrence id
  // only D2L knows), so the URL D2L supplied is used — after it passes sameTenantUrl.
  calendarEvent: (s: D2LSchool, d2lSuppliedUrl: unknown) => {
    const safe = sameTenantUrl(s, d2lSuppliedUrl);
    return safe && sourceLinksEnabled() && VERIFIED.calendarEvent[s] ? safe : undefined;
  },
};

export const stepLink = {
  myCourses: () => emit("stepMyCourses", "step", "/student/mycourse"),
  // `institute` is the course's own institute field; the page resolves the course from courseId.
  course: (courseId: unknown, institute: unknown) =>
    emit("stepCourse", "step", guid(courseId) && id(institute) && `/student/mycourse/details/${guid(courseId)}/${id(institute)}/coursedetails`),
  // Keys on the catalogue item's own `id`, never its courseId: with courseId the page renders blank.
  catalogueCourse: (catalogueItemId: unknown) =>
    emit("stepCatalogueCourse", "step", guid(catalogueItemId) && `/student/ihlcourse/detail/${guid(catalogueItemId)}`),
  home: () => emit("stepHome", "step", "/student/"),
  calendar: () => emit("stepCalendar", "step", "/student/calendar"),
  profile: () => emit("stepProfile", "step", "/student/profile"),
};

// Accepts a D2L-supplied URL only if it is https, on exactly this school's host, without
// credentials or a non-default port, and under /d2l/. Anything else — including a look-alike host
// or a URL an instructor typed into a course — yields undefined and is never passed through.
export function sameTenantUrl(school: D2LSchool, raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined; // relative, protocol-relative ("//host/x") or malformed
  }
  if (u.protocol !== "https:") return undefined;
  if (u.hostname !== SCHOOL_HOSTS[school]) return undefined;
  if (u.username || u.password || u.port) return undefined;
  if (!u.pathname.startsWith("/d2l/")) return undefined;
  return u.href;
}

// --- Legacy `url` field of get_assignments (unchanged behaviour; not gated). ---
const trim = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

export function assignmentUrl(baseUrl: string, courseId: number, folderId: number): string {
  return `${trim(baseUrl)}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&grpid=0&ou=${courseId}`;
}

export function quizUrl(baseUrl: string, courseId: number, quizId: number): string {
  return `${trim(baseUrl)}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quizId}&ou=${courseId}`;
}

// There is no per-column page a student may open, so every gradebook row in a course shares this.
export function gradebookUrl(baseUrl: string, courseId: number): string {
  return `${trim(baseUrl)}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`;
}
