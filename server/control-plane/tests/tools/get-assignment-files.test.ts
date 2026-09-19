import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json, bare, enrollment } from "../helpers/mcp-harness.js";
import { fileKind, extractFileText } from "../../src/tools/get-assignment-files.js";
import { docx, pdf, makeZip } from "../helpers/fixtures.js";

const FOLDERS = [
  { Id: 1, Name: "Essay", DueDate: "2026-10-01T04:00:00.000Z", IsHidden: false, Attachments: [
      { FileId: 7, FileName: "brief.pdf", Size: 999 },
      { FileId: 8, FileName: "template.docx", Size: 500 },
      { FileId: 9, FileName: "scan.pdf", Size: 400 },
      { FileId: 10, FileName: "diagram.png", Size: 300 },
      { FileId: 11, FileName: "huge.pdf", Size: 50 * 1024 * 1024 },
    ], LinkAttachments: [{ LinkId: 1, LinkName: "Reading list", Href: "https://example.com/reading" }] },
  { Id: 2, Name: "No files", DueDate: null, IsHidden: false, Attachments: [], LinkAttachments: [] },
  { Id: 3, Name: "Hidden", DueDate: null, IsHidden: true, Attachments: [{ FileId: 20, FileName: "x.pdf", Size: 1 }] },
];
const file = (buf: Buffer, headers: Record<string, string> = {}) => new Response(new Uint8Array(buf), { status: 200, headers });

function serve(t: import("node:test").TestContext, attachments: (id: number) => Response | undefined = () => undefined) {
  return mockD2l(t, (url) => {
    if (url.endsWith("/973535/dropbox/folders/")) return json(FOLDERS);
    const m = /\/dropbox\/folders\/1\/attachments\/(\d+)$/.exec(url);
    if (m) return attachments(Number(m[1]));
  });
}
const call = async (t: import("node:test").TestContext, args: Record<string, unknown>, attachments?: (id: number) => Response | undefined) => {
  const seen = serve(t, attachments);
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignment_files", { courseId: "nyp:973535", ...args });
  await c.close();
  return { r, seen, body: r.isError ? null : JSON.parse(r.text) };
};

test("discovery lists assignments that have attachments or links, opening nothing", async (t) => {
  const { r, seen, body } = await call(t, {});
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(body.assignments.map((a: { folderId: number }) => a.folderId), [1], "no-file and hidden assignments are left out");
  assert.deepEqual(body.assignments[0].attachments.map((a: { kind: string }) => a.kind), ["pdf", "docx", "pdf", "image", "pdf"]);
  assert.deepEqual(body.assignments[0].links, [{ name: "Reading list", url: "https://example.com/reading" }]);
  assert.ok(!seen.some((u) => u.includes("/attachments/")), "no file downloaded");
});

test("a course with no attachments says so", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/973535/dropbox/folders/") ? json([FOLDERS[1]]) : undefined));
  const c = await connect(["nyp"]);
  const body = JSON.parse((await c.call("get_assignment_files", { courseId: "nyp:973535" })).text);
  assert.deepEqual(body.assignments, []);
  assert.match(body.note, /No assignment in this course has an attached file/);
  await c.close();
});

test("reads a PDF attachment and returns its text", async (t) => {
  const { body } = await call(t, { folderId: 1, fileId: 7 }, (id) => (id === 7 ? file(pdf("Write a report on cloud costs")) : undefined));
  assert.equal(body.folderName, "Essay");
  assert.equal(body.file.kind, "pdf");
  assert.match(body.file.text, /Write a report on cloud costs/);
  assert.equal(body.file.truncated, false);
  assert.match(body.url, /folder_submit_files\.d2l\?db=1&grpid=0&ou=973535$/);
});

test("reads a DOCX attachment", async (t) => {
  const { body } = await call(t, { folderId: 1, fileId: 8 }, () => file(docx("Use this template", true)));
  assert.equal(body.file.text, "Use this template");
});

test("maxChars truncates and says so", async (t) => {
  const { body } = await call(t, { folderId: 1, fileId: 8, maxChars: 5 }, () => file(docx("abcdefghij")));
  assert.equal(body.file.text, "abcde");
  assert.equal(body.file.truncated, true);
});

test("a PDF with no text layer, and a non-text file, come back with a note instead of an error", async (t) => {
  const scan = await call(t, { folderId: 1, fileId: 9 }, () => file(Buffer.from("%PDF-1.4 scanned image only")));
  assert.equal(scan.body.file.text, null);
  assert.match(scan.body.file.note, /No text layer/);
  const img = await call(t, { folderId: 1, fileId: 10 }, () => file(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  assert.equal(img.body.file.text, null);
  assert.match(img.body.file.note, /Cannot extract text from a image file/);
});

test("a file over the size limit is not downloaded into memory", async (t) => {
  const { body } = await call(t, { folderId: 1, fileId: 11 }, () => file(Buffer.alloc(16), { "content-length": String(50 * 1024 * 1024) }));
  assert.equal(body.file.text, null);
  assert.match(body.file.note, /larger than 10 MB/);
});

test("extractText=false lists the file without downloading it", async (t) => {
  const { body, seen } = await call(t, { folderId: 1, fileId: 7, extractText: false });
  assert.equal(body.file.text, null);
  assert.match(body.file.note, /not requested/);
  assert.ok(!seen.some((u) => u.includes("/attachments/")));
});

test("bad ids give an error that says what to do next", async (t) => {
  const noFolder = await call(t, { fileId: 7 });
  assert.equal(noFolder.r.isError, true);
  assert.match(noFolder.r.text, /folderId is required/);
  const wrongFolder = await call(t, { folderId: 99 });
  assert.match(wrongFolder.r.text, /No visible assignment with id 99.*get_assignments/);
  const wrongFile = await call(t, { folderId: 1, fileId: 5 });
  assert.match(wrongFile.r.text, /No attachment with id 5.*7 \(brief\.pdf\)/);
  const hidden = await call(t, { folderId: 3 });
  assert.match(hidden.r.text, /No visible assignment with id 3/);
});

test("a refused download is a permission message naming the role", async (t) => {
  mockD2l(t, (url) => {
    if (url.endsWith("/973535/dropbox/folders/")) return json(FOLDERS);
    if (url.includes("/attachments/")) return bare(403);
    if (url.includes("/enrollments/myenrollments/973535")) return enrollment("Learner");
  });
  const c = await connect(["nyp"]);
  const r = await c.call("get_assignment_files", { courseId: "nyp:973535", folderId: 1, fileId: 7 });
  assert.equal(r.isError, true);
  assert.match(r.text, /Your role in this course is "Learner"/);
  await c.close();
});

test("fileKind and extractFileText", async () => {
  assert.equal(fileKind("Brief.PDF"), "pdf");
  assert.equal(fileKind("notes.csv"), "text");
  assert.equal(fileKind("legacy.doc"), "other");
  assert.equal(fileKind("noextension"), "other");
  assert.deepEqual(await extractFileText("text", Buffer.from("  hello  ")), { text: "hello" });
  assert.equal((await extractFileText("xlsx", makeZip([{ name: "other.txt", data: "x" }]))).text, null);
});
