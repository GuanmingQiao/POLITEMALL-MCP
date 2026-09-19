import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare } from "../helpers/mcp-harness.js";
import { effectiveDate, isPublishedNewsItem, newestFirst, mapNewsItem, type NewsItem } from "../../src/tools/get-announcements.js";

// Shaped like a real NYP /news/ answer: one unpublished draft, an empty CreatedBy object, an item
// with no StartDate, an item with only an HTML body.
const NEWS: NewsItem[] = [
  { Id: 1, Title: "Old", Body: { Text: "old text", Html: "<p>old text</p>" }, CreatedBy: {}, CreatedDate: "2026-01-01T00:00:00Z", StartDate: "2026-01-02T00:00:00Z", IsPublished: true, IsPinned: false, Attachments: [] },
  { Id: 2, Title: "Draft", Body: { Text: "draft", Html: "" }, CreatedBy: {}, CreatedDate: "2026-09-10T00:00:00Z", StartDate: "2026-09-10T00:00:00Z", IsPublished: false, IsPinned: false, Attachments: [] },
  { Id: 3, Title: "New", Body: { Text: "", Html: "<p>Hello <a href=\"http://x.example\">link</a></p>" }, CreatedBy: { DisplayName: "Ms Tan" }, CreatedDate: "2026-09-09T00:00:00Z", StartDate: null, IsPublished: true, IsPinned: true, Attachments: [{}] },
  { Id: 4, Title: "Undated", Body: { Text: "u", Html: "" }, CreatedBy: null, CreatedDate: null, StartDate: null, IsPublished: true, IsPinned: false },
];

const item = (over: Partial<NewsItem>): NewsItem => ({ Id: 9, Title: "t", Body: null, CreatedBy: null, CreatedDate: null, StartDate: null, ...over });

test("only an explicit false is a draft; a missing field is treated as published", () => {
  assert.equal(isPublishedNewsItem(item({ IsPublished: false })), false);
  assert.equal(isPublishedNewsItem(item({ IsPublished: true })), true);
  assert.equal(isPublishedNewsItem(item({})), true);
});

test("effectiveDate prefers the scheduled StartDate, falls back to CreatedDate, ignores unreadable dates", () => {
  assert.equal(effectiveDate(item({ StartDate: "2026-02-01T00:00:00Z", CreatedDate: "2026-03-01T00:00:00Z" })), "2026-02-01T00:00:00Z");
  assert.equal(effectiveDate(item({ StartDate: null, CreatedDate: "2026-03-01T00:00:00Z" })), "2026-03-01T00:00:00Z");
  assert.equal(effectiveDate(item({ StartDate: "not a date", CreatedDate: "2026-03-01T00:00:00Z" })), "2026-03-01T00:00:00Z");
  assert.equal(effectiveDate(item({})), null);
});

test("newestFirst puts undated items last and keeps equal dates in server order", () => {
  const rows = [{ date: null, n: "a" }, { date: "2026-01-01T00:00:00Z", n: "b" }, { date: "2026-05-01T00:00:00Z", n: "c" }, { date: "2026-01-01T00:00:00Z", n: "d" }];
  assert.deepEqual(rows.sort(newestFirst).map((r) => r.n), ["c", "b", "d", "a"]);
});

test("mapNewsItem: empty CreatedBy is null, plain text wins, HTML-only bodies become Markdown", () => {
  const old = mapNewsItem(NEWS[0]);
  assert.equal(old.createdBy, null);
  assert.equal(old.body, "old text");
  const html = mapNewsItem(NEWS[2]);
  assert.match(html.body, /Hello \[link\]\(http:\/\/x\.example\)/);
  assert.equal(html.createdBy, "Ms Tan");
  assert.equal(html.isPinned, true);
  assert.equal(html.hasAttachments, true);
  assert.equal(old.hasAttachments, undefined);
});

const enrollments = (items: { id: number; active: boolean }[]) =>
  json({
    PagingInfo: { Bookmark: null, HasMoreItems: false },
    Items: items.map((i) => ({ OrgUnit: { Id: i.id, Type: { Id: 3 }, Name: `Course ${i.id}`, Code: `C${i.id}` }, Access: { IsActive: i.active, StartDate: null, EndDate: null, LastAccessed: null } })),
  });

test("one course: drafts dropped, newest first, count limits the list but total reports the rest", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/news/") ? json(NEWS) : undefined));
  const c = await connect(["nyp"]);
  const all = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042" })).text);
  assert.equal(all.total, 3, "the draft is excluded");
  assert.deepEqual(all.announcements.map((a: { id: number }) => a.id), [3, 1, 4]);
  const two = JSON.parse((await c.call("get_announcements", { courseId: "nyp:524042", count: 2 })).text);
  assert.equal(two.returned, 2);
  assert.equal(two.total, 3, "total still says there are more");
  await c.close();
});

test("all courses: merges by date, labels each item with its course, skips inactive courses, names unreadable ones", async (t) => {
  const seen = mockD2l(t, (url) => {
    if (url.includes("/enrollments/myenrollments/?")) return enrollments([{ id: 524042, active: true }, { id: 111, active: false }, { id: 222, active: true }]);
    if (url.endsWith("/524042/news/")) return json(NEWS);
    if (url.endsWith("/222/news/")) return bare(403);
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_announcements", { count: 10 });
  assert.equal(r.isError, false);
  const body = JSON.parse(r.text);
  assert.deepEqual(body.announcements.map((a: { id: number }) => a.id), [3, 1, 4]);
  assert.equal(body.announcements[0].courseId, "nyp:524042");
  assert.equal(body.announcements[0].courseName, "Course 524042");
  assert.ok(!seen.some((u) => u.includes("/111/news/")), "inactive course not requested");
  assert.equal(body.skippedCourses.length, 1);
  assert.match(body.skippedCourses[0], /nyp:222.*403/);
  await c.close();
});

test("all courses: one school failing becomes a warning next to the other school's data", async (t) => {
  mockD2l(t, (url) => {
    if (url.includes("nyplms") && url.includes("/enrollments/myenrollments/?")) return enrollments([{ id: 524042, active: true }]);
    if (url.includes("nyplms") && url.endsWith("/524042/news/")) return json(NEWS);
    if (url.includes("lms.polite") && url.includes("/enrollments/myenrollments/?")) return bare(500);
  });
  const c = await connect(["nyp", "politemall"]);
  const r = await c.call("get_announcements");
  assert.equal(r.isError, false);
  const body = JSON.parse(r.text);
  assert.equal(body.total, 3);
  assert.match(body.warnings[0], /^politemall: /);
  await c.close();
});

test("all courses: an error only when every school failed", async (t) => {
  mockD2l(t, () => bare(500));
  const c = await connect(["nyp"]);
  const r = await c.call("get_announcements");
  assert.equal(r.isError, true);
  assert.match(r.text, /nyp: .*HTTP 500/);
  await c.close();
});

test("count is validated (1-50)", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  const r = await c.call("get_announcements", { courseId: "nyp:524042", count: 500 });
  assert.equal(r.isError, true);
  assert.match(r.text, /count/);
  await c.close();
});
