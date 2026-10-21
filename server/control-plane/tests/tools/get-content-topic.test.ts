import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare } from "../helpers/mcp-harness.js";
import { detectTopicFileFormat, MAX_TOPIC_FILE_BYTES } from "../../src/tools/get-content-topic.js";
import { docx, pdf, makeZip } from "../helpers/fixtures.js";

// spec: d2l-content-file-text-extraction — supported formats, non-file/unsupported topics left
// unchanged, oversized/corrupted files non-fatal, session errors propagate.

const METADATA = { Id: 1, Title: "Lesson 1", Url: "/d2l/common/viewFile.d2lfile/content/1/file.pdf" };
const file = (buf: Buffer, headers: Record<string, string> = {}) => new Response(new Uint8Array(buf), { status: 200, headers });

async function call(t: import("node:test").TestContext, fileResponse: Response) {
  mockD2l(t, (url) => {
    if (url.endsWith("/content/topics/1/file")) return fileResponse;
    if (url.endsWith("/content/topics/1")) return json(METADATA);
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_content_topic", { courseId: "nyp:973535", topicId: 1 });
  await c.close();
  return { r, body: r.isError ? null : JSON.parse(r.text) };
}

test("a PDF topic adds extractedText and keeps its metadata", async (t) => {
  const { body } = await call(t, file(pdf("Week one reading")));
  assert.match(body.extractedText, /Week one reading/);
  assert.equal(body.Title, "Lesson 1");
  assert.equal(body.extractedTextUnavailable, undefined);
});

test("a DOCX topic adds extractedText", async (t) => {
  const { body } = await call(t, file(docx("Lecture notes", true)));
  assert.equal(body.extractedText, "Lecture notes");
});

test("a non-file topic (404 on the file route) is unchanged", async (t) => {
  const { r, body } = await call(t, bare(404));
  assert.equal(r.isError, false, r.text);
  assert.equal(body.Title, "Lesson 1");
  assert.ok(!("extractedText" in body) && !("extractedTextUnavailable" in body));
});

test("a PPTX topic adds the slide text in order", async (t) => {
  const pptx = makeZip([
    { name: "ppt/slides/slide2.xml", data: "<a:t>Second</a:t>" },
    { name: "ppt/slides/slide1.xml", data: "<a:t>First</a:t>" },
  ]);
  const { body } = await call(t, file(pptx));
  assert.equal(body.extractedText, "First\n\nSecond");
});

test("an unsupported format (.xlsx) is unchanged", async (t) => {
  const xlsx = makeZip([{ name: "xl/sharedStrings.xml", data: "<sst><si><t>Cell</t></si></sst>" }]);
  const { body } = await call(t, file(xlsx));
  assert.ok(!("extractedText" in body) && !("extractedTextUnavailable" in body));
});

test("an HTML topic file comes back as Markdown without script or style", async (t) => {
  const html = "<!DOCTYPE html><html><head><style>p{}</style></head><body><h1>Learning Plan</h1><script>alert(1)</script><table><tr><th>Week</th><th>Topic</th></tr><tr><td>1</td><td>Intro</td></tr></table></body></html>";
  const { body } = await call(t, file(Buffer.from(html), { "content-type": "text/html; charset=utf-8" }));
  assert.match(body.extractedText, /^# Learning Plan/);
  assert.match(body.extractedText, /\| Week \| Topic \|\n\| --- \| --- \|\n\| 1 \| Intro \|/);
  assert.doesNotMatch(body.extractedText, /alert|p\{\}/);
});

test("HTML is recognised from its bytes even when mislabelled", async (t) => {
  const { body } = await call(t, file(Buffer.from("<html><body><p>Hello</p></body></html>"), { "content-type": "application/octet-stream" }));
  assert.equal(body.extractedText, "Hello");
});

test("a plain-text topic file is returned as text", async (t) => {
  const { body } = await call(t, file(Buffer.from("  Just notes\n"), { "content-type": "text/plain" }));
  assert.equal(body.extractedText, "Just notes");
});

test("links in extracted HTML mark the result untrusted", async (t) => {
  const { r } = await call(t, file(Buffer.from('<p><a href="https://evil.example">click</a></p>'), { "content-type": "text/html" }));
  assert.equal(JSON.parse(r.text).provenance.untrustedLinksInText, true);
});

test("binary content is not mistaken for text", async (t) => {
  const { body } = await call(t, file(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), { "content-type": "image/png" }));
  assert.ok(!("extractedText" in body) && !("extractedTextUnavailable" in body));
});

// spec: d2l-text-paging
test("long text is returned in slices that join back to the whole", async (t) => {
  const long = "word ".repeat(100).trim();
  const pages: string[] = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    mockD2l(t, (url) => {
      if (url.endsWith("/content/topics/1/file")) return file(Buffer.from(long), { "content-type": "text/plain" });
      if (url.endsWith("/content/topics/1")) return json(METADATA);
    });
    const c = await connect(["nyp"]);
    const body = JSON.parse((await c.call("get_content_topic", { courseId: "nyp:973535", topicId: 1, maxChars: 120, offset })).text);
    await c.close();
    assert.equal(body.extractedTextTotalChars, long.length);
    pages.push(body.extractedText);
    if (!body.extractedTextTruncated) {
      assert.ok(!("extractedTextNextOffset" in body));
      break;
    }
    offset = body.extractedTextNextOffset;
  }
  assert.ok(pages.length > 1);
  assert.equal(pages.join(""), long);
});

test("a native page's HTML description is also returned as Markdown", async (t) => {
  mockD2l(t, (url) => {
    if (url.endsWith("/content/topics/1/file")) return bare(404);
    if (url.endsWith("/content/topics/1")) return json({ ...METADATA, Description: { Text: "Hi", Html: "<h2>Overview</h2><p>Hi <b>there</b></p>" } });
  });
  const c = await connect(["nyp"]);
  const body = JSON.parse((await c.call("get_content_topic", { courseId: "nyp:973535", topicId: 1 })).text);
  await c.close();
  assert.equal(body.descriptionMarkdown, "## Overview\n\nHi **there**");
  assert.deepEqual(body.Description, { Text: "Hi", Html: "<h2>Overview</h2><p>Hi <b>there</b></p>" });
});

test("a corrupted PDF reports extractedTextUnavailable, not an error", async (t) => {
  const { r, body } = await call(t, file(Buffer.from("%PDF-1.4 garbage")));
  assert.equal(r.isError, false, r.text);
  assert.match(body.extractedTextUnavailable, /No readable text/);
});

test("an oversized file reports extractedTextUnavailable", async (t) => {
  const { r, body } = await call(t, file(Buffer.alloc(8), { "content-length": String(MAX_TOPIC_FILE_BYTES + 1) }));
  assert.equal(r.isError, false, r.text);
  assert.match(body.extractedTextUnavailable, /maximum size/);
});

test("an expired session on the file route surfaces as an error", async (t) => {
  const { r } = await call(t, bare(401));
  assert.equal(r.isError, true);
});

test("format detection", () => {
  assert.equal(detectTopicFileFormat(pdf("x")), "pdf");
  assert.equal(detectTopicFileFormat(docx("x")), "docx");
  assert.equal(detectTopicFileFormat(Buffer.from("hello")), null);
  assert.equal(detectTopicFileFormat(Buffer.from("hello"), "text/plain"), "text");
  assert.equal(detectTopicFileFormat(Buffer.from("﻿<!doctype html><p>x</p>")), "html");
  assert.equal(detectTopicFileFormat(makeZip([{ name: "ppt/slides/slide1.xml", data: "x" }])), "pptx");
});
