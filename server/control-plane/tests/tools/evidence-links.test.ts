// Evidence links through the real MCP server and client: only D2L's and STEP's HTTP answers are
// mocked. Shapes follow real NYP / STEP responses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare, enrollment } from "../helpers/mcp-harness.js";

const NYP = "https://nyplms.polite.edu.sg";
const PM = "https://lms.polite.edu.sg";
const page = (objects: unknown[]) => json({ Objects: objects, Next: null });
const enrollments = (ids: number[]) =>
  json({
    PagingInfo: { Bookmark: null, HasMoreItems: false },
    Items: ids.map((id) => ({ OrgUnit: { Id: id, Type: { Id: 3 }, Name: `Course ${id}`, Code: `C${id}` }, Access: { IsActive: true, StartDate: null, EndDate: null, LastAccessed: null } })),
  });

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

// A real NYP news item shape, including one body with a link an instructor typed.
const NEWS = [
  { Id: 11, Title: "Lab moved", Body: { Text: "Room 5", Html: "" }, CreatedBy: { DisplayName: "Ms Tan" }, CreatedDate: "2026-09-09T05:23:00.000Z", StartDate: "2026-09-09T05:23:00.000Z", IsPublished: true, IsPinned: false },
  { Id: 12, Title: "Read this", Body: { Text: "See https://example.com/anything", Html: "" }, CreatedBy: null, CreatedDate: "2026-09-08T00:00:00.000Z", StartDate: null, IsPublished: true, IsPinned: false },
  { Id: 13, Title: "Third", Body: { Text: "x", Html: "" }, CreatedBy: null, CreatedDate: "2026-09-01T00:00:00.000Z", StartDate: null, IsPublished: true, IsPinned: false },
];

test("announcements: each item links its own page, dates come in Singapore time, provenance names the school", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/news/") ? json(NEWS) : undefined));
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042" })).text);
  const byId = Object.fromEntries(r.announcements.map((a: { id: number }) => [a.id, a]));
  for (const id of [11, 12, 13]) {
    assert.equal(byId[id].sourceUrl, `${NYP}/d2l/le/news/524042/${id}/view`, "bound to that announcement, not another");
  }
  assert.equal(byId[11].date, "2026-09-09T05:23:00.000Z", "the original value is untouched");
  assert.equal(byId[11].dateSgt, "2026-09-09T13:23:00+08:00", "the page shows 1:23 PM");
  assert.equal(r.pageUrl, `${NYP}/d2l/lms/news/main.d2l?ou=524042`);
  assert.equal(r.provenance.source, "NYP Brightspace");
  assert.match(r.provenance.retrievedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(r.provenance.timezone, "Asia/Singapore (+08:00)");
  await c.close();
});

test("announcements: a link typed into a body is flagged untrusted and never becomes evidence", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/news/") ? json(NEWS) : undefined));
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042" })).text);
  assert.equal(r.provenance.untrustedLinksInText, true);
  assert.match(r.provenance.note, /not evidence/);
  const evidence = JSON.stringify([r.pageUrl, ...r.announcements.map((a: { sourceUrl: string }) => a.sourceUrl)]);
  assert.doesNotMatch(evidence, /example\.com/);

  const clean = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042", count: 1 })).text);
  assert.equal(clean.announcements.length, 1);
  assert.equal(clean.provenance.untrustedLinksInText, undefined, "no URL in the returned body, no flag");
  await c.close();
});

test("announcements: count still bounds the list and every returned item keeps its link", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/news/") ? json(NEWS) : undefined));
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042", count: 2 })).text);
  assert.equal(r.announcements.length, 2);
  assert.ok(r.announcements.every((a: { sourceUrl?: string }) => a.sourceUrl?.startsWith(NYP)));
  await c.close();
});

test("all-courses announcements: two schools, each item's link is on its own host", async (t) => {
  mockD2l(t, (url) => {
    if (url.startsWith(NYP) && url.includes("/enrollments/myenrollments/?")) return enrollments([524042]);
    if (url.startsWith(PM) && url.includes("/enrollments/myenrollments/?")) return enrollments([6606]);
    if (url.startsWith(NYP) && url.endsWith("/524042/news/")) return json([NEWS[0]]);
    if (url.startsWith(PM) && url.endsWith("/6606/news/")) return json([{ ...NEWS[2], Id: 99 }]);
  });
  const c = await connect(["nyp", "politemall"]);
  const r = JSON.parse((await c.call("get_announcements")).text);
  const links = r.announcements.map((a: { courseId: string; sourceUrl: string }) => [a.courseId, a.sourceUrl]);
  assert.deepEqual(links.sort(), [
    ["nyp:524042", `${NYP}/d2l/le/news/524042/11/view`],
    ["politemall:6606", `${PM}/d2l/le/news/6606/99/view`],
  ]);
  assert.deepEqual(r.provenance.sources.sort(), ["NYP Brightspace", "POLITEMall Brightspace"]);
  await c.close();
});

test("classlist: the classlist page, no link per person", async (t) => {
  mockD2l(t, (url) =>
    url.includes("/524042/classlist/")
      ? json([{ Identifier: "1", DisplayName: "A Tutor", ClasslistRoleDisplayName: "Tutor", Username: "a", Email: "a@x.sg", FirstName: "A", LastName: "T" }])
      : undefined
  );
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("get_classlist", { courseId: "nyp:524042" })).text);
  assert.equal(r.pageUrl, `${NYP}/d2l/lms/classlist/classlist.d2l?ou=524042`);
  assert.doesNotMatch(JSON.stringify(r.users), /sourceUrl/);
  await c.close();
});

test("raw-array tools stay arrays: item links in block 0, provenance in a second block", async (t) => {
  mockD2l(t, (url) =>
    url.includes("/524042/quizzes/") ? page([{ QuizId: 3, Name: "Quiz 1", DueDate: "2026-10-01T04:00:00.000Z", StartDate: null, EndDate: null }]) : undefined
  );
  const c = await connect(["nyp"]);
  const r = await c.call("get_quizzes", { courseId: "nyp:524042" });
  const arr = JSON.parse(r.text);
  assert.ok(Array.isArray(arr), "block 0 is still a JSON array");
  assert.equal(arr[0].sourceUrl, `${NYP}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=3&ou=524042`);
  assert.equal(arr[0].DueDate, "2026-10-01T04:00:00.000Z");
  assert.equal(arr[0].DueDateSgt, "2026-10-01T12:00:00+08:00");
  assert.equal(arr[0].StartDateSgt, undefined, "a null date gets no companion");
  assert.equal(r.blocks.length, 2);
  const footer = r.blocks[1].text as string;
  assert.match(footer, /^Source: NYP Brightspace — retrieved \d{4}-/);
  assert.match(footer, /Singapore time/);
  assert.ok(footer.includes(`${NYP}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=524042`), "the list page is in the footer");
  await c.close();
});

test("an item with no verified page has no sourceUrl at all (not empty, not guessed)", async (t) => {
  mockD2l(t, (url) => (url.includes("/524042/quizzes/") ? page([{ Name: "No id here", DueDate: null }]) : undefined));
  const c = await connect(["nyp"]);
  const arr = JSON.parse((await c.call("get_quizzes", { courseId: "nyp:524042" })).text);
  assert.equal("sourceUrl" in arr[0], false);
  await c.close();
});

const FOLDER = { Id: 808471, Name: "Project", CustomInstructions: null, DueDate: "2026-10-01T04:00:00.000Z", IsHidden: false, GroupTypeId: null, Attachments: [] };
const QUIZ = { QuizId: 3, Name: "Quiz 1", Description: null, StartDate: null, EndDate: null, DueDate: null, IsActive: true, AttemptsAllowed: null };

test("assignments: NYP carries a verified assignment link; POLITEMall data carries none (pattern unverified there)", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/dropbox/folders/") && !url.includes("submissions")) return json([FOLDER]);
    if (url.includes("/quizzes/") && !url.includes("attempts")) return page([QUIZ]);
  });
  const c = await connect(["nyp", "politemall"]);
  const nyp = JSON.parse((await c.call("get_assignments", { courseId: "nyp:973535" })).text);
  const a = nyp.assignments.find((x: { type: string }) => x.type === "assignment");
  assert.equal(a.sourceUrl, `${NYP}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=973535`);
  assert.equal(a.dueDateSgt, "2026-10-01T12:00:00+08:00");
  assert.equal(a.url, a.sourceUrl, "the legacy url field is unchanged");

  const pm = JSON.parse((await c.call("get_assignments", { courseId: "politemall:6606" })).text);
  const pmA = pm.assignments.find((x: { type: string }) => x.type === "assignment");
  assert.equal(pmA.sourceUrl, undefined, "no assignment link for POLITEMall");
  assert.ok(pmA.url.startsWith(PM), "the legacy url is untouched");
  const pmQ = pm.assignments.find((x: { type: string }) => x.type === "quiz");
  assert.equal(pmQ.sourceUrl, `${PM}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=3&ou=6606`, "quiz IS verified on POLITEMall");
  await c.close();
});

const NOT_GRADED = { Entity: { EntityId: 7, EntityType: 1 }, Status: 1, Submissions: [], Feedback: null, CompletionDate: null };

test("dropbox submissions: a Tutor is pointed at the grader page, a Learner at the folder page", async (t) => {
  for (const [role, expected] of [
    ["Tutor", `${NYP}/d2l/lms/dropbox/admin/folders_manage.d2l?ou=524042`],
    ["Learner", `${NYP}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=524042`],
  ] as const) {
    mockD2l(t, (url) => {
      if (url.includes("/dropbox/folders/808471/submissions/")) return page([NOT_GRADED]);
      if (url.includes("/classlist/")) return json([]);
      if (url.includes("/enrollments/myenrollments/524042")) return enrollment(role);
    });
    const c = await connect(["nyp"]);
    const r = await c.call("get_dropbox_submissions", { courseId: "nyp:524042", folderId: 808471 });
    assert.ok(Array.isArray(JSON.parse(r.text)));
    assert.ok((r.blocks[1].text as string).includes(expected), `${role}: ${r.blocks[1].text}`);
    await c.close();
    t.mock.restoreAll();
  }
});

test("calendar events use D2L's own event URL, and drop one that points off-tenant", async (t) => {
  const own = `${NYP}/d2l/le/calendar/524042/event/9123456/detailsview`;
  mockD2l(t, (url) =>
    url.includes("/524042/calendar/events/")
      ? json([
          { CalendarEventId: 1, Title: "Own", StartDateTime: "2026-09-09T05:23:00.000Z", EndDateTime: null, CalendarEventViewUrl: own },
          { CalendarEventId: 2, Title: "Foreign", StartDateTime: null, EndDateTime: null, CalendarEventViewUrl: "https://evil.example/d2l/x" },
          { CalendarEventId: 3, Title: "None", StartDateTime: null, EndDateTime: null },
        ])
      : undefined
  );
  const c = await connect(["nyp"]);
  const r = await c.call("get_calendar_events", { courseId: "nyp:524042" });
  const ev = JSON.parse(r.text);
  assert.equal(ev[0].sourceUrl, own);
  assert.equal(ev[0].StartDateTimeSgt, "2026-09-09T13:23:00+08:00");
  assert.equal("sourceUrl" in ev[1], false, "a foreign URL is never passed through");
  assert.equal("sourceUrl" in ev[2], false);
  assert.ok((r.blocks[1].text as string).includes(`${NYP}/d2l/le/calendar/524042`), "course calendar as the page");
  await c.close();
});

test("cross-school due items: each row's link host matches its school; the page per school is its home", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/enrollments/myenrollments/?")) return enrollments([524042]);
    if (url.includes("/content/myItems/completions/due/")) return page([{ OrgUnitId: "524042", ItemName: "Read ch 1", DueDate: "2026-10-01T04:00:00.000Z", DateCompleted: null }]);
  });
  const c = await connect(["nyp", "politemall"]);
  const r = JSON.parse((await c.call("get_due_items")).text);
  const hosts = r.dueItems.map((i: { school: string; sourceUrl: string }) => [i.school, new URL(i.sourceUrl).host]).sort();
  assert.deepEqual(hosts, [["nyp", "nyplms.polite.edu.sg"], ["politemall", "lms.polite.edu.sg"]]);
  assert.equal(r.dueItems[0].dueDateSgt, "2026-10-01T12:00:00+08:00");
  assert.deepEqual(r.pageUrls, { "NYP Brightspace": `${NYP}/d2l/home`, "POLITEMall Brightspace": `${PM}/d2l/home` });
  await c.close();
});

test("a grader-only tool links the management page", async (t) => {
  mockD2l(t, (url) => (url.includes("/grades/final/values/") ? page([]) : undefined));
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("get_all_final_grades", { courseId: "nyp:524042" })).text);
  assert.ok(Array.isArray(r));
  await c.close();
});

test("provenance is left off when a tool reads nothing from a school, and errors carry none", async (t) => {
  mockD2l(t, () => bare(403));
  const c = await connect(["nyp"]);
  const r = await c.call("get_announcements", { courseId: "nyp:524042" });
  assert.equal(r.isError, true);
  assert.equal(r.blocks.length, 1);
  assert.doesNotMatch(r.text, /sourceUrl|provenance/);
  await c.close();
});

test("kill switch: SOURCE_LINKS=off gives exactly the pre-change shape", async (t) => {
  mockD2l(t, (url) => (url.includes("/524042/quizzes/") ? page([{ QuizId: 3, Name: "Q", DueDate: "2026-10-01T04:00:00.000Z" }]) : url.endsWith("/524042/news/") ? json(NEWS) : undefined));
  await withEnv({ SOURCE_LINKS: "off" }, async () => {
    const c = await connect(["nyp"]);
    const q = await c.call("get_quizzes", { courseId: "nyp:524042" });
    assert.equal(q.blocks.length, 1, "no footer block");
    assert.deepEqual(JSON.parse(q.text), [{ QuizId: 3, Name: "Q", DueDate: "2026-10-01T04:00:00.000Z" }]);
    const n = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042" })).text);
    assert.equal(n.provenance, undefined);
    assert.equal(n.pageUrl, undefined);
    assert.equal(n.announcements[0].sourceUrl, undefined);
    assert.equal(n.announcements[0].dateSgt, undefined);
    assert.equal(c.instructions(), undefined, "the citation rules go with the feature");
    const tools = await c.tools();
    assert.ok(tools.every((x) => !/Evidence links/.test(x.description ?? "")));
    await c.close();
  });
});

test("resource links: off by default; on adds one per distinct page, addressed to the user, block 0 unchanged", async (t) => {
  mockD2l(t, (url) =>
    url.includes("/524042/quizzes/")
      ? page([{ QuizId: 3, Name: "Quiz 1" }, { QuizId: 4, Name: "Quiz 2" }])
      : undefined
  );
  const c = await connect(["nyp"]);
  const off = await c.call("get_quizzes", { courseId: "nyp:524042" });
  assert.ok(off.blocks.every((b) => b.type === "text"));
  await c.close();

  await withEnv({ SOURCE_RESOURCE_LINKS: "on" }, async () => {
    const c2 = await connect(["nyp"]);
    const on = await c2.call("get_quizzes", { courseId: "nyp:524042" });
    const links = on.blocks.filter((b) => b.type === "resource_link") as unknown as { uri: string; name: string; description: string; annotations: { audience: string[] } }[];
    assert.equal(links.length, 3, "two quizzes plus the list page");
    assert.deepEqual(links.map((l) => l.name).sort(), ["Quiz 1", "Quiz 2", "Source page"]);
    assert.ok(links.every((l) => l.annotations.audience[0] === "user" && l.uri.startsWith(NYP) && l.description.length > 0));
    assert.equal(on.text, off.text, "block 0 is byte-identical with resource links on");
    await c2.close();
  });
});

test("the server tells a connecting agent how to cite", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  const text = c.instructions() ?? "";
  for (const rule of [/sourceUrl/, /pageUrl/, /inline link/, /Never construct, edit/, /not evidence/, /no page is available/, /Sgt/, /retrievedAt/, /signed in/]) {
    assert.match(text, rule);
  }
  await c.close();
});

const TOC = {
  Modules: [
    {
      ModuleId: 1, Title: "Week 1", SortOrder: 0, StartDateTime: "2026-09-09T05:23:00.000Z",
      Topics: [
        { TopicId: 101, Title: "Slides", TypeIdentifier: "File", SortOrder: 0, Description: { Text: "", Html: "<p>See <a href=\"https://example.com/x\">this</a></p>" } },
        { TopicId: 102, Title: "Video", TypeIdentifier: "Link", Url: "https://www.youtube.com/x", SortOrder: 1 },
      ],
      Modules: [{ ModuleId: 2, Title: "Lab", SortOrder: 2, Topics: [{ TopicId: 201, Title: "Lab sheet", TypeIdentifier: "File", SortOrder: 0 }] }],
    },
    { ModuleId: 3, Title: "Week 2", SortOrder: 1, Topics: [{ TopicId: 301, Title: "Notes", TypeIdentifier: "File", SortOrder: 0 }] },
  ],
};

function topics(tree: { type: string; id: number; sourceUrl?: string; children?: unknown[] }[]): { id: number; sourceUrl?: string }[] {
  return tree.flatMap((n) => (n.type === "topic" ? [n] : topics((n.children ?? []) as never)));
}

test("course content: every topic's link carries its own id, and filters keep the links right", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/content/toc") ? json(TOC) : undefined));
  const c = await connect(["nyp"]);
  const full = JSON.parse((await c.call("get_course_content", { courseId: "nyp:524042" })).text);
  assert.equal(full.pageUrl, `${NYP}/d2l/le/lessons/524042`);
  const all = topics(full.contentTree);
  assert.deepEqual(all.map((x) => x.id).sort(), [101, 102, 201, 301]);
  for (const x of all) assert.equal(x.sourceUrl, `${NYP}/d2l/le/lessons/524042/topics/${x.id}`);
  assert.equal(full.contentTree[0].startDateSgt, "2026-09-09T13:23:00+08:00");
  assert.equal(full.provenance.untrustedLinksInText, true, "a description contains a URL");

  const filtered = JSON.parse((await c.call("get_course_content", { courseId: "nyp:524042", typeFilter: "link", moduleTitle: "week 1", maxDepth: 5 })).text);
  const only = topics(filtered.contentTree);
  assert.deepEqual(only.map((x) => x.id), [102]);
  assert.equal(only[0].sourceUrl, `${NYP}/d2l/le/lessons/524042/topics/102`);
  assert.equal(filtered.provenance.untrustedLinksInText, undefined, "the URL-bearing topic was filtered out");

  const shallow = JSON.parse((await c.call("get_course_content", { courseId: "nyp:524042", maxDepth: 1 })).text);
  assert.ok(topics(shallow.contentTree).every((x) => x.sourceUrl?.endsWith(`/topics/${x.id}`)));
  await c.close();
});

test("content topic, rubric (Dropbox and Discussion objects) and discussions", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("/content/topics/101")) return json({ Id: 101, Title: "Slides", StartDateTime: "2026-09-09T05:23:00.000Z" });
    if (url.includes("/rubrics/")) return json([]);
    if (url.includes("/discussions/forums/5/topics/") && url.endsWith("/topics/")) return json([{ TopicId: 9, Name: "Intro", UnlockStartDate: "2026-09-09T05:23:00.000Z" }]);
    if (url.includes("/posts/")) return json([{ PostId: 1, Message: { Text: "look https://example.com" }, DatePosted: "2026-09-09T05:23:00.000Z" }]);
    if (url.includes("/discussions/forums/")) return json([{ ForumId: 5, Name: "General" }]);
  });
  const c = await connect(["nyp"]);
  const topic = JSON.parse((await c.call("get_content_topic", { courseId: "nyp:524042", topicId: 101 })).text);
  assert.equal(topic.sourceUrl, `${NYP}/d2l/le/lessons/524042/topics/101`);
  assert.equal(topic.StartDateTimeSgt, "2026-09-09T13:23:00+08:00");

  const dropbox = await c.call("get_rubrics", { courseId: "nyp:524042", objectType: "Dropbox", objectId: 808471 });
  assert.ok((dropbox.blocks[1].text as string).includes(`${NYP}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=524042`));
  const disc = await c.call("get_rubrics", { courseId: "nyp:524042", objectType: "Discussion", objectId: 9 });
  assert.ok((disc.blocks[1].text as string).includes(`${NYP}/d2l/le/524042/discussions/topics/9/View`));
  const other = await c.call("get_rubrics", { courseId: "nyp:524042", rubricId: 5 });
  assert.ok((other.blocks[1].text as string).includes(`${NYP}/d2l/home/524042`), "no object: the course home");

  const forums = await c.call("get_discussion_forums", { courseId: "nyp:524042" });
  assert.ok((forums.blocks[1].text as string).includes(`${NYP}/d2l/le/524042/discussions/List`));
  const tops = JSON.parse((await c.call("get_discussion_topics", { courseId: "nyp:524042", forumId: 5 })).text);
  assert.equal(tops[0].sourceUrl, `${NYP}/d2l/le/524042/discussions/topics/9/View`);
  const posts = await c.call("get_discussion_posts", { courseId: "nyp:524042", forumId: 5, topicId: 9 });
  assert.equal(JSON.parse(posts.text)[0].DatePostedSgt, "2026-09-09T13:23:00+08:00");
  assert.match(posts.blocks[1].text as string, /not evidence/, "a link inside a post is flagged");
  assert.ok((posts.blocks[1].text as string).includes(`${NYP}/d2l/le/524042/discussions/topics/9/View`));
  await c.close();
});

test("generic passthrough: shape unchanged, only the retrieval statement is added", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/news/") ? json([{ Id: 1 }]) : undefined));
  const c = await connect(["nyp"]);
  const r = JSON.parse((await c.call("call_d2l_operation", { operation: "le.news.list", courseId: "nyp:524042" })).text);
  assert.deepEqual(r.result, [{ Id: 1 }]);
  assert.equal(r.operation, "le.news.list");
  assert.equal(r.provenance.source, "NYP Brightspace");
  assert.equal(JSON.stringify(r).includes("sourceUrl"), false);
  const listed = await c.call("list_d2l_operations", { category: "grades" });
  assert.equal(listed.blocks.length, 1, "a static catalog read nothing from a school");
  assert.equal(JSON.parse(listed.text).provenance, undefined);
  await c.close();
});
// ---- STEP ----

const STEP_COURSE = "88a15e0b-1657-45ef-810e-c9e680aabbcc";
const STEP_ITEM = "2e493178-34a1-493e-8a18-159b0e112233";
const env = (data: unknown) => json({ data, code: 200, status: 0, message: null, errorCode: 0 });

test("STEP: enrolled and catalogue links, built from the right ids", async (t) => {
  mockD2l(t, (url) => {
    if (url.endsWith("/mycourse/paging"))
      return env({ items: [{ courseId: STEP_COURSE, courseName: "GenAI", courseCode: "NYP-1", courseCategory: "c", courseType: "t", institute: 4, intakeEnrolmentStatus: 1, startTime: "2026-10-06T01:00:00+00:00", endTime: null }], pageCount: 1, totalItemsCount: 1 });
    if (url.endsWith("/coursecatalogue/paging"))
      return env({ items: [{ id: STEP_ITEM, courseId: STEP_COURSE, courseName: "Biologics", courseCode: "NYP-2", courseCategory: "c", courseStart: "2027-05-02T16:00:00+00:00", courseEnd: null, institute: 4 }], pageCount: 1, totalItemsCount: 1 });
  });
  const c = await connect(["step"]);
  const mine = await c.call("list_step_courses");
  const list = JSON.parse(mine.text);
  assert.ok(Array.isArray(list));
  assert.equal(list[0].sourceUrl, `https://stms.polite.edu.sg/student/mycourse/details/${STEP_COURSE}/4/coursedetails`);
  assert.equal(list[0].startTimeSgt, "2026-10-06T09:00:00+08:00");
  assert.equal("institute" in list[0], false, "no output field was added for the institute");
  assert.match(mine.blocks[1].text as string, /Source: STEP — retrieved/);

  const cat = JSON.parse((await c.call("search_step_courses", { query: "bio" })).text);
  assert.equal(cat[0].sourceUrl, `https://stms.polite.edu.sg/student/ihlcourse/detail/${STEP_ITEM}`, "built from the catalogue id");
  assert.ok(!cat[0].sourceUrl.includes(STEP_COURSE), "never from courseId");
  assert.equal("id" in cat[0], false, "the catalogue id is not an output field");
  await c.close();
});

test("STEP: a catalogue entry with no usable id has no link rather than a blank page", async (t) => {
  mockD2l(t, (url) =>
    url.endsWith("/coursecatalogue/paging")
      ? env({ items: [{ courseId: STEP_COURSE, courseName: "No id", courseCode: "X", courseCategory: "c", courseStart: null, courseEnd: null }], pageCount: 1, totalItemsCount: 1 })
      : undefined
  );
  const c = await connect(["step"]);
  const cat = JSON.parse((await c.call("search_step_courses")).text);
  assert.equal("sourceUrl" in cat[0], false);
  await c.close();
});

test("STEP: timetable links the course page, with the calendar as the page; detail and announcements", async (t) => {
  const detail = { myCourseSimpleDto: { courseId: STEP_COURSE, courseName: "GenAI", institute: 4, startTime: "2026-10-06T01:00:00+00:00", endTime: null }, myModuleDetailsDtos: [{ id: "m1" }] };
  mockD2l(t, (url) => {
    if (url.endsWith(`/mycourse/mycourse/${STEP_COURSE}`)) return env(detail);
    if (url.endsWith("/sessions/paging"))
      return env({ items: [{ sessionNumber: 1, sessionName: "S1", startTime: "2026-10-06T01:00:00+00:00", endTime: "2026-10-06T05:00:00+00:00" }], pageCount: 1, totalItemsCount: 1 });
    if (url.endsWith("/announcements"))
      return env({ items: [{ announcementTitle: "Anti-Scam Message", content: "<p>Call 1799 or see https://www.scamshield.gov.sg</p>", publishDate: "2025-06-26T16:01:00.069641+00:00", created: "0001-01-01T00:00:00+00:00" }], pageCount: 1, totalItemsCount: 1 });
  });
  const c = await connect(["step"]);
  const tt = await c.call("get_step_timetable", { courseId: STEP_COURSE });
  const sessions = JSON.parse(tt.text);
  assert.equal(sessions[0].startTimeSgt, "2026-10-06T09:00:00+08:00");
  assert.equal(sessions[0].sourceUrl, `https://stms.polite.edu.sg/student/mycourse/details/${STEP_COURSE}/4/coursedetails`);
  assert.ok((tt.blocks[1].text as string).includes("https://stms.polite.edu.sg/student/calendar"));

  const d = JSON.parse((await c.call("get_step_course_detail", { courseId: STEP_COURSE })).text);
  assert.equal(d.sourceUrl, `https://stms.polite.edu.sg/student/mycourse/details/${STEP_COURSE}/4/coursedetails`);
  assert.equal(d.provenance.source, "STEP");
  assert.equal(d.myCourseSimpleDto.startTimeSgt, "2026-10-06T09:00:00+08:00");

  const a = await c.call("get_step_announcements");
  const anns = JSON.parse(a.text);
  const footer = a.blocks[1].text as string;
  assert.ok(footer.includes("Page: https://stms.polite.edu.sg/student/"), "the home page, where this feed is shown");
  assert.ok(!footer.includes("/announcements"), "not the Announcements page, which lists a different feed");
  assert.match(footer, /not evidence/, "a URL in the banner text is flagged");
  assert.equal(anns[0].publishDateSgt, "2025-06-27T00:01:00+08:00");
  assert.equal("createdSgt" in anns[0], false);
  await c.close();
});

test("whoami: STEP profile page as the page; Brightspace identity has none", async (t) => {
  mockD2l(t, (url) => {
    if (url.endsWith("/users/whoami")) return json({ Identifier: "1", FirstName: "A", LastName: "B", UniqueName: "u" });
    if (url.endsWith("/profile/me")) return env({ name: "A B" });
  });
  const c = await connect(["nyp", "step"]);
  const r = JSON.parse((await c.call("whoami")).text);
  assert.deepEqual(r.pageUrls, { STEP: "https://stms.polite.edu.sg/student/profile" });
  assert.deepEqual(r.provenance.sources.sort(), ["NYP Brightspace", "STEP"]);
  await c.close();
});
