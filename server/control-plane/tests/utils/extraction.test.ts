import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { officeDocumentText, listZipEntries, extractZipEntry, MAX_ENTRY_BYTES } from "../../src/utils/zip-text.js";
import { extractPdfText } from "../../src/utils/pdf-text.js";
import { htmlToMarkdown } from "../../src/utils/html-to-markdown.js";
import { mapWithConcurrency } from "../../src/utils/concurrency.js";
import { assignmentUrl, quizUrl, gradebookUrl } from "../../src/utils/deep-links.js";
import { makeZip, docx, pdf } from "../helpers/fixtures.js";

test("DOCX text is read whether the entry is stored or deflated", () => {
  assert.equal(officeDocumentText(docx("Write a 500 word essay")), "Write a 500 word essay");
  assert.equal(officeDocumentText(docx("Write a 500 word essay", true)), "Write a 500 word essay");
});

test("XLSX shared strings and PPTX slides (in slide order) are read", () => {
  const xlsx = makeZip([{ name: "xl/sharedStrings.xml", data: "<sst><si><t>Item</t></si><si><t>Cost &amp; tax</t></si></sst>" }]);
  assert.equal(officeDocumentText(xlsx), "Item Cost & tax");
  const pptx = makeZip([
    { name: "ppt/slides/slide10.xml", data: "<p><a:t>Ten</a:t></p>" },
    { name: "ppt/slides/slide2.xml", data: "<p><a:t>Two</a:t></p>" },
  ]);
  assert.equal(officeDocumentText(pptx), "Two\n\nTen");
});

test("non-Office archives, garbage and truncated files give null instead of throwing", () => {
  assert.equal(officeDocumentText(makeZip([{ name: "readme.txt", data: "hi" }])), null);
  assert.equal(officeDocumentText(Buffer.from("this is not a zip at all")), null);
  assert.equal(officeDocumentText(docx("x").subarray(0, 40)), null);
  assert.equal(listZipEntries(Buffer.alloc(0)), null);
});

test("a zip bomb is refused: an entry that would inflate past the limit is not expanded", () => {
  const big = Buffer.alloc(MAX_ENTRY_BYTES + 1024, 0x41); // compresses to a few KB
  const bomb = makeZip([{ name: "word/document.xml", data: big, deflate: true }]);
  assert.ok(bomb.length < 100_000, "the archive itself is small");
  assert.equal(extractZipEntry(bomb, "word/document.xml"), null);
  assert.equal(officeDocumentText(bomb), null);
});

test("a lying uncompressed size can't smuggle a bomb past the limit either", () => {
  // Declare a tiny size but deflate something huge: the inflate call itself is capped.
  const zip = makeZip([{ name: "word/document.xml", data: "<w:t>ok</w:t>", deflate: true }]);
  const huge = deflateRawSync(Buffer.alloc(MAX_ENTRY_BYTES + 1024, 0x42));
  const lied = Buffer.from(zip);
  // splice the oversized deflate stream over the entry body and keep the (small) declared sizes
  const nameLen = "word/document.xml".length;
  const start = 30 + nameLen;
  const forged = Buffer.concat([lied.subarray(0, start), huge, lied.subarray(start + deflateRawSync(Buffer.from("<w:t>ok</w:t>")).length)]);
  assert.equal(officeDocumentText(forged), null);
});

test("PDF text is extracted; damaged PDFs give null", async () => {
  const r = await extractPdfText(pdf("Hello Assignment"));
  assert.ok(r, "pdf parsed");
  assert.match(r!.text, /Hello Assignment/);
  assert.equal(r!.totalPages, 1);
  assert.equal(await extractPdfText(Buffer.from("%PDF-1.4 not really")), null);
});

test("htmlToMarkdown keeps links and emphasis, and tolerates empty input", () => {
  assert.equal(htmlToMarkdown("<p>See <a href=\"http://x.example\">this</a> <b>now</b></p>"), "See [this](http://x.example) **now**");
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(htmlToMarkdown(null), "");
});

test("mapWithConcurrency preserves order and never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2, `peak ${peak}`);
});

test("deep links use the tenant origin and tolerate a trailing slash", () => {
  assert.equal(assignmentUrl("https://nyplms.polite.edu.sg/", 973535, 808471), "https://nyplms.polite.edu.sg/d2l/lms/dropbox/user/folder_submit_files.d2l?db=808471&grpid=0&ou=973535");
  assert.equal(quizUrl("https://nyplms.polite.edu.sg", 878537, 1412126), "https://nyplms.polite.edu.sg/d2l/lms/quizzing/user/quiz_summary.d2l?qi=1412126&ou=878537");
  assert.equal(gradebookUrl("https://nyplms.polite.edu.sg", 878537), "https://nyplms.polite.edu.sg/d2l/lms/grades/my_grades/main.d2l?ou=878537");
});
