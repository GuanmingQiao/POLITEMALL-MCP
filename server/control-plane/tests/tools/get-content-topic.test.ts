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

test("an unsupported format (.pptx) is unchanged", async (t) => {
  const pptx = makeZip([{ name: "ppt/slides/slide1.xml", data: "<a:t>Slide</a:t>" }]);
  const { body } = await call(t, file(pptx));
  assert.ok(!("extractedText" in body) && !("extractedTextUnavailable" in body));
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
});
