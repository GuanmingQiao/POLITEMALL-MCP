import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare, enrollment } from "../helpers/mcp-harness.js";
import { primeD2lVersions } from "../../src/api/d2l-versions.js";
import { SCHOOL_HOSTS } from "../../src/api/d2l-client.js";
import { getCourseContent, buildTree, matchesTypeFilter, topicKind, countTopics, countModules } from "../../src/tools/get-course-content.js";

for (const host of Object.values(SCHOOL_HOSTS)) primeD2lVersions(host, { le: "1.97", lp: "1.63" });

// Shaped like a real NYP /content/toc answer: topics are File/Link/ContentService, sub-modules and
// topics share one SortOrder, and Description is {Text, Html}.
const TOC = {
  Modules: [
    {
      ModuleId: 1,
      Title: "Overview",
      SortOrder: 0,
      IsHidden: false,
      IsLocked: false,
      Description: { Text: "", Html: "" },
      Modules: [
        {
          ModuleId: 2,
          Title: "Week 1",
          SortOrder: 1,
          Modules: [],
          Topics: [{ TopicId: 22, Title: "Lecture video", TypeIdentifier: "Link", Url: "https://www.youtube.com/watch?v=abc", SortOrder: 0, Description: { Text: "", Html: "" } }],
        },
      ],
      Topics: [
        { TopicId: 11, Title: "Syllabus", TypeIdentifier: "File", Url: "/content/enforced/1/syllabus.pdf", SortOrder: 0, Description: { Text: "", Html: "" } },
        { TopicId: 12, Title: "Intro page", TypeIdentifier: "ContentService", Url: null, SortOrder: 2, Description: { Text: "Welcome", Html: "<p>Welcome to <b>class</b></p>" } },
      ],
    },
    {
      ModuleId: 3,
      Title: "Labs",
      SortOrder: 1,
      Modules: [],
      Topics: [{ TopicId: 31, Title: "Lab 1", TypeIdentifier: "File", Url: "/content/enforced/1/lab1.pdf", SortOrder: 0, Description: { Text: "", Html: "" } }],
    },
  ],
};

const opts = (o: Partial<Parameters<typeof getCourseContent>[3]> = {}) => ({ typeFilter: "all" as const, ...o });

function serve(t: import("node:test").TestContext, progress?: Response) {
  return mockD2l(t, (url) => {
    if (url.endsWith("/524042/content/toc")) return json(TOC);
    if (url.includes("/content/userprogress/")) return progress;
  });
}

test("builds the tree in D2L's display order, one request for the whole course", async (t) => {
  const seen = serve(t);
  const r = await getCourseContent("nyp", "cookie", 524042, opts());
  assert.equal(seen.filter((u) => u.includes("/content/toc")).length, 1, "one toc request, not one per module");
  assert.equal(r.moduleCount, 3);
  assert.equal(r.topicCount, 4);
  const overview = r.contentTree[0];
  assert.equal(overview.type, "module");
  // topic 11 (SortOrder 0), Week 1 (1), topic 12 (2)
  assert.deepEqual(
    (overview as { children: { id: number }[] }).children.map((c) => c.id),
    [11, 2, 12]
  );
});

test("maps topic types and keeps the raw type name only for 'other'", () => {
  const tree = buildTree(TOC.Modules, opts(), null);
  const topics = (tree[0] as { children: any[] }).children;
  const syllabus = topics.find((c) => c.id === 11);
  const intro = topics.find((c) => c.id === 12);
  assert.equal(syllabus.topicType, "file");
  assert.equal(syllabus.url, "/content/enforced/1/syllabus.pdf");
  assert.equal(syllabus.typeIdentifier, undefined);
  assert.equal(intro.topicType, "other");
  assert.equal(intro.typeIdentifier, "ContentService");
  assert.equal(intro.description, "Welcome to **class**", "HTML body is converted to Markdown");
});

test("typeFilter keeps only matching topics and drops modules with nothing left", async (t) => {
  serve(t);
  const video = await getCourseContent("nyp", "c", 524042, opts({ typeFilter: "video" }));
  assert.equal(video.topicCount, 1);
  assert.equal(video.moduleCount, 2, "Overview > Week 1 survive; Labs has no video and is dropped");
  const html = await getCourseContent("nyp", "c", 524042, opts({ typeFilter: "html" }));
  assert.deepEqual(flatIds(html.contentTree), [12]);
  const file = await getCourseContent("nyp", "c", 524042, opts({ typeFilter: "file" }));
  assert.deepEqual(flatIds(file.contentTree).sort(), [11, 31]);
});

test("moduleTitle filters top-level modules case-insensitively and keeps their children", async (t) => {
  serve(t);
  const r = await getCourseContent("nyp", "c", 524042, opts({ moduleTitle: "LAB" }));
  assert.equal(r.moduleCount, 1);
  assert.deepEqual(flatIds(r.contentTree), [31]);
  assert.equal(r.moduleTitle, "LAB");
});

test("maxDepth 1 shows top-level modules with their direct children and reports what it left out", async (t) => {
  serve(t);
  const r = await getCourseContent("nyp", "c", 524042, opts({ maxDepth: 1 }));
  const overview = r.contentTree[0] as { children: any[] };
  const week1 = overview.children.find((c) => c.id === 2);
  assert.deepEqual(week1.children, []);
  assert.equal(week1.childrenOmitted, 1);
  assert.equal(r.topicCount, 3, "the video inside Week 1 is not counted at depth 1");
});

test("without progress data (NYP answers 404) completion fields are absent, not false", async (t) => {
  serve(t);
  const r = await getCourseContent("nyp", "c", 524042, opts());
  assert.equal(r.progressAvailable, false);
  const topic = (r.contentTree[0] as { children: any[] }).children.find((c) => c.id === 11);
  assert.ok(!("isCompleted" in topic));
});

test("with progress data topics carry isCompleted and completedDate", async (t) => {
  serve(t, json({ Objects: [{ ContentObjectId: 11, IsRead: true, DateCompleted: "2026-02-01T00:00:00Z" }], Next: null }));
  const r = await getCourseContent("nyp", "c", 524042, opts());
  assert.equal(r.progressAvailable, true);
  const kids = (r.contentTree[0] as { children: any[] }).children;
  assert.equal(kids.find((c) => c.id === 11).isCompleted, true);
  assert.equal(kids.find((c) => c.id === 11).completedDate, "2026-02-01T00:00:00Z");
  assert.equal(kids.find((c) => c.id === 12).isCompleted, false);
});

test("topicKind / matchesTypeFilter / counts are consistent", () => {
  assert.equal(topicKind({ TopicId: 1, Title: "x", TypeIdentifier: "FILE" }), "file");
  assert.equal(topicKind({ TopicId: 1, Title: "x", TypeIdentifier: null }), "other");
  assert.equal(matchesTypeFilter({ TopicId: 1, Title: "x", TypeIdentifier: "Link", Url: "https://example.com/a" }, "video"), false);
  const tree = buildTree(TOC.Modules, opts(), null);
  assert.equal(countTopics(tree), 4);
  assert.equal(countModules(tree), 3);
});

test("through the MCP server: a course the caller isn't in is reported as such", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  const r = await c.call("get_course_content", { courseId: "nyp:99999999" });
  assert.equal(r.isError, true);
  assert.match(r.text, /aren't enrolled/);
  await c.close();
});

test("through the MCP server: returns the courseId, filters and tree", async (t) => {
  serve(t);
  mockD2lEnrollmentNotNeeded();
  const c = await connect(["nyp"]);
  const r = await c.call("get_course_content", { courseId: "nyp:524042", typeFilter: "file", moduleTitle: "labs" });
  assert.equal(r.isError, false);
  const body = JSON.parse(r.text);
  assert.equal(body.courseId, "nyp:524042");
  assert.equal(body.typeFilter, "file");
  assert.equal(body.topicCount, 1);
  await c.close();
  void bare;
  void enrollment;
});

function mockD2lEnrollmentNotNeeded() {}

function flatIds(tree: any[]): number[] {
  return tree.flatMap((n) => (n.type === "topic" ? [n.id] : flatIds(n.children)));
}
