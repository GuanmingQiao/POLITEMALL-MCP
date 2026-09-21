import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { link, stepLink, sameTenantUrl, toId, VERIFIED, type LinkPattern } from "../../src/utils/deep-links.js";
import type { D2LSchool } from "../../src/types/schools.js";

const NYP = "https://nyplms.polite.edu.sg";
const PM = "https://lms.polite.edu.sg";
const SCHOOLS: [D2LSchool, string][] = [
  ["nyp", NYP],
  ["politemall", PM],
];
const COURSE = "d2c8f1a0-0b1c-4d2e-8f3a-123456789abc";
const ITEM = "2e493178-34a1-493e-8a18-159b0e123456";

test("every Brightspace builder makes the exact verified URL on the school's own host", () => {
  for (const [s, base] of SCHOOLS) {
    assert.equal(link.courseHome(s, 524042), `${base}/d2l/home/524042`);
    assert.equal(link.announcement(s, 524042, 77), `${base}/d2l/le/news/524042/77/view`);
    assert.equal(link.announcementsList(s, 524042), `${base}/d2l/lms/news/main.d2l?ou=524042`);
    assert.equal(link.contentTopic(s, 524042, 9), `${base}/d2l/le/lessons/524042/topics/9`);
    assert.equal(link.contentRoot(s, 524042), `${base}/d2l/le/lessons/524042`);
    assert.equal(link.classlist(s, 524042), `${base}/d2l/lms/classlist/classlist.d2l?ou=524042`);
    assert.equal(link.discussionTopic(s, 524042, 5), `${base}/d2l/le/524042/discussions/topics/5/View`);
    assert.equal(link.discussionsList(s, 524042), `${base}/d2l/le/524042/discussions/List`);
    assert.equal(link.quiz(s, 524042, 3), `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=3&ou=524042`);
    assert.equal(link.quizList(s, 524042), `${base}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=524042`);
    assert.equal(link.survey(s, 524042, 8), `${base}/d2l/lms/survey/user/survey_activities.d2l?si=8&ou=524042`);
    assert.equal(link.surveyList(s, 524042), `${base}/d2l/lms/survey/user/surveys_list.d2l?ou=524042`);
    assert.equal(link.myGrades(s, 524042), `${base}/d2l/lms/grades/my_grades/main.d2l?ou=524042`);
    assert.equal(link.courseCalendar(s, 524042), `${base}/d2l/le/calendar/524042`);
    assert.equal(link.groups(s, 524042), `${base}/d2l/lms/group/user_group_list.d2l?ou=524042`);
    assert.equal(link.schoolHome(s), `${base}/d2l/home`);
  }
});

test("patterns not yet verified on a school emit nothing there, and only there", () => {
  assert.equal(link.assignment("politemall", 6606, 12), undefined);
  assert.equal(link.submissionHistory("politemall", 6606), undefined);
  assert.equal(link.graderGradebook("politemall", 6606), undefined);
  assert.equal(link.graderAssignments("politemall", 6606), undefined);
  assert.equal(link.graderQuizzes("politemall", 6606), undefined);
  assert.ok(link.quiz("politemall", 6606, 12), "quiz IS verified on POLITEMall");

  assert.equal(link.assignment("nyp", 973535, 808471), `${NYP}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=973535`);
  assert.equal(link.submissionHistory("nyp", 973535), `${NYP}/d2l/lms/dropbox/user/folders_history.d2l?ou=973535`);
  assert.equal(link.graderGradebook("nyp", 524042), `${NYP}/d2l/lms/grades/admin/enter/user_list_view.d2l?ou=524042`);
  assert.equal(link.graderAssignments("nyp", 524042), `${NYP}/d2l/lms/dropbox/admin/folders_manage.d2l?ou=524042`);
  assert.equal(link.graderQuizzes("nyp", 524042), `${NYP}/d2l/lms/quizzing/admin/quizzes_manage.d2l?ou=524042`);
});

test("the VERIFIED table: every pattern is verified for its own system(s) and for no other kind", () => {
  const step: LinkPattern[] = ["stepMyCourses", "stepCourse", "stepCatalogueCourse", "stepHome", "stepCalendar", "stepProfile"];
  for (const [pattern, where] of Object.entries(VERIFIED) as [LinkPattern, (typeof VERIFIED)[LinkPattern]][]) {
    if (step.includes(pattern)) {
      assert.deepEqual(where, { nyp: false, politemall: false, step: true }, pattern);
    } else {
      assert.equal(where.step, false, pattern);
      assert.equal(where.nyp, true, `${pattern} is verified on NYP`);
    }
  }
});

test("ids must be positive safe integers; anything else means no link, never a guessed one", () => {
  for (const bad of [NaN, 0, -1, 1.5, "12", "abc", null, undefined, Infinity, 2 ** 60, {}]) {
    assert.equal(link.courseHome("nyp", bad), undefined, String(bad));
    assert.equal(link.announcement("nyp", 5, bad), undefined, String(bad));
    assert.equal(link.announcement("nyp", bad, 5), undefined, String(bad));
  }
  assert.equal(toId("6606"), 6606, "D2L sends some org-unit ids as numeric strings");
  assert.equal(toId("6606; drop"), undefined);
  assert.equal(toId("-3"), undefined);
});

test("STEP builders", () => {
  assert.equal(stepLink.myCourses(), "https://stms.polite.edu.sg/student/mycourse");
  assert.equal(stepLink.home(), "https://stms.polite.edu.sg/student/");
  assert.equal(stepLink.calendar(), "https://stms.polite.edu.sg/student/calendar");
  assert.equal(stepLink.profile(), "https://stms.polite.edu.sg/student/profile");
  assert.equal(stepLink.course(COURSE, 4), `https://stms.polite.edu.sg/student/mycourse/details/${COURSE}/4/coursedetails`);
  assert.equal(stepLink.catalogueCourse(ITEM), `https://stms.polite.edu.sg/student/ihlcourse/detail/${ITEM}`);
});

test("STEP ids must be GUIDs: no path traversal, and a missing catalogue id is no link", () => {
  for (const bad of ["../../etc/passwd", `${COURSE}/../x`, "not-a-guid", "", null, undefined, 12, `${COURSE}?x=1`]) {
    assert.equal(stepLink.catalogueCourse(bad), undefined, String(bad));
    assert.equal(stepLink.course(bad, 4), undefined, String(bad));
  }
  assert.equal(stepLink.course(COURSE, 0), undefined);
  assert.equal(stepLink.course(COURSE, "4"), undefined);
});

test("sameTenantUrl accepts D2L's own calendar event URL and nothing off-tenant", () => {
  const real = `${NYP}/d2l/le/calendar/524042/event/9123456/detailsview`;
  assert.equal(sameTenantUrl("nyp", real), real);
  assert.equal(sameTenantUrl("politemall", real), undefined, "a NYP URL is not valid for POLITEMall data");

  for (const bad of [
    "https://evil.example/d2l/le/calendar/1/event/2/detailsview",
    "https://nyplms.polite.edu.sg.evil.com/d2l/home",
    "http://nyplms.polite.edu.sg/d2l/home",
    "javascript:alert(1)",
    "//nyplms.polite.edu.sg/d2l/home",
    "/d2l/home",
    "https://user:pw@nyplms.polite.edu.sg/d2l/home",
    "https://nyplms.polite.edu.sg:8443/d2l/home",
    "https://nyplms.polite.edu.sg/other/path",
    "https://nyplms.polite.edu.sg",
    42,
    null,
  ]) {
    assert.equal(sameTenantUrl("nyp", bad), undefined, String(bad));
  }
  assert.equal(link.calendarEvent("nyp", "https://evil.example/d2l/x"), undefined);
  assert.equal(link.calendarEvent("politemall", `${PM}/d2l/le/calendar/1/event/2/detailsview`), undefined, "unverified on POLITEMall");
});

test("no builder output carries anything that looks like a credential or personal identifier", () => {
  const all = [
    ...SCHOOLS.flatMap(([s]) => [
      link.courseHome(s, 1), link.announcement(s, 1, 2), link.announcementsList(s, 1), link.contentTopic(s, 1, 2), link.contentRoot(s, 1),
      link.classlist(s, 1), link.discussionTopic(s, 1, 2), link.discussionsList(s, 1), link.assignment(s, 1, 2), link.submissionHistory(s, 1),
      link.quiz(s, 1, 2), link.quizList(s, 1), link.survey(s, 1, 2), link.surveyList(s, 1), link.myGrades(s, 1), link.courseCalendar(s, 1),
      link.groups(s, 1), link.schoolHome(s), link.graderGradebook(s, 1), link.graderAssignments(s, 1), link.graderQuizzes(s, 1),
    ]),
    stepLink.myCourses(), stepLink.home(), stepLink.calendar(), stepLink.profile(), stepLink.course(COURSE, 4), stepLink.catalogueCourse(ITEM),
  ].filter((u): u is string => typeof u === "string");
  assert.ok(all.length > 30);
  for (const u of all) {
    assert.match(u, /^https:\/\/(nyplms|lms|stms)\.polite\.edu\.sg\//);
    assert.doesNotMatch(u, /token|cookie|session|bearer|@|password/i, u);
  }
});

// Nothing outside the registry may write down a school URL or a page path: that is how a wrong or
// unverified link would sneak in. API hosts and API paths (/d2l/api/, /studentapi/) are not links.
test("no file under src/tools or src/api builds a page URL by hand", () => {
  const roots = [join(process.cwd(), "src", "tools"), join(process.cwd(), "src", "api")];
  // These files own the API base addresses, not evidence links.
  const apiHostOwners = new Set(["d2l-client.ts", "public-catalog.ts"]);
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of readdirSync(root).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(root, file), "utf8");
      const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      code.forEach((line, i) => {
        if (/polite\.edu\.sg/.test(line) && !apiHostOwners.has(file) && !/^\s*\/\//.test(line)) {
          // String literals in prose (descriptions) name the sites; only flag URL-shaped ones.
          if (/https?:\/\/[^\s"'`]*polite\.edu\.sg|["'`]\w*\.?polite\.edu\.sg["'`]/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
        if (/["'`]\/d2l\/(?!api\/)/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        if (/["'`]\/student\//.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
