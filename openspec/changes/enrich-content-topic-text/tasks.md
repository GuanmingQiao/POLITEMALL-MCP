## 1. Paging helper

- [x] 1.1 Add `src/utils/text-page.ts` with `pageText(text, offset, maxChars)` returning slice, `totalChars`, `truncated`, `nextOffset`; avoid splitting surrogate pairs; offset past end returns empty, not an error
- [x] 1.2 Unit tests: fits, cut, continue with `nextOffset` (concatenation equals original), last slice, offset beyond end, emoji at boundary
- [x] 1.3 Shared zod fields for `maxChars` (default 20000, max 100000) and `offset` (>= 0) in `tools/schemas.ts`

## 2. HTML to Markdown

- [x] 2.1 Harden `utils/html-to-markdown.ts`: drop script/style/noscript, GFM table rule, embeds as links, remove `javascript:`/`data:` hrefs, strip D2L session/cache-buster params
- [x] 2.2 Tests for each rule, plus regression tests that existing simple-input output is unchanged for announcements/assignments

## 3. Fetching and detection

- [x] 3.1 Make `apiGetBuffer` also expose the response `Content-Type` (keep a bytes-only path for existing callers); update tests
- [x] 3.2 Extend `detectTopicFileFormat` to pdf, docx, pptx, html, text (Decision 3); tests with fixture bytes including BOM, mislabelled content type, binary with NULs, xlsx (still unsupported)
- [x] 3.3 Decode HTML/text bytes (UTF-8, UTF-16 BOM) and extract via `htmlToMarkdown` / `officeDocumentText`

## 4. get_content_topic

- [x] 4.1 Add `maxChars` and `offset` inputs; page `extractedText` and add `extractedTextTotalChars`, `extractedTextTruncated`, `extractedTextNextOffset`
- [x] 4.2 Add `descriptionMarkdown` when metadata has an HTML description (confirm exact field shape in task 7)
- [x] 4.3 Mark `untrusted` when slice or description contains a URL
- [x] 4.4 Update the tool description (formats, paging, untrusted text, how to continue) and `README.md` tool docs
- [x] 4.5 Extend `tests/tools/get-content-topic.test.ts`: HTML topic, PPTX, plain text, long PDF paged across two calls, native description, oversize, unsupported format, 404, session error

## 5. get_assignment_files and call_d2l_operation

- [x] 5.1 Add `offset` to `get_assignment_files`; report `totalChars` and `nextOffset` alongside existing `truncated`; keep default 12000
- [x] 5.2 `call_d2l_operation`: return text-like responses from binary routes (HTML as Markdown) with paging; keep refusing true binaries; update description and tests
- [x] 5.3 Update `list_d2l_operations` / catalog wording if it says binary routes are unsupported

## 6. Verify code

- [x] 6.1 `npm run build` and the full test suite pass in `server/control-plane`
- [x] 6.2 `openspec validate enrich-content-topic-text`

## 7. Live verification (needs a signed-in session)

- [ ] 7.1 Read the issue #1 HTML topics (Syllabus, Learning Plan, Assessment, Assessment Components in course 1032348) and confirm Markdown output; record the observed `topicFile` content type and `Description` shape, adjusting detection if they differ
- [ ] 7.2 Read topic 15145379 in course 1032338 and confirm a long document pages correctly end to end via `nextOffset`
- [ ] 7.3 Confirm `.docx`/`.pdf` topics still work and `call_d2l_operation` refuses a real binary
- [ ] 7.4 Deploy and reply on issue #1 with the result
