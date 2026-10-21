## Context

`get_content_topic` (`src/tools/get-content-topic.ts`) fetches `le.content.topicGet` metadata, then always tries `le.content.topicFile` through `apiGetBuffer` (25 MB cap), sniffs the bytes (`%PDF-` or a ZIP with `word/document.xml`), extracts text, and puts the whole string in `extractedText`. The result is one JSON text block (`provenance.buildContent`). Nothing limits or pages the returned string. `get_assignment_files` already has `maxChars` + `truncated`, but no way to continue. `utils/html-to-markdown.ts` (Turndown) exists and is used by other tools, but not by this one. `call_d2l_operation` rejects any `binary`-paginated route, which includes `le.content.topicFile`. `apiGetBuffer` discards the response `Content-Type`.

## Goals / Non-Goals

**Goals:** read HTML topics (issue #1); make long text safe to return and resumable; reuse what exists.

**Non-Goals:** OCR; legacy `.doc`/`.ppt`; returning files as MCP attachments/resources (see Decision 1); caching; fetching linked/embedded pages inside an HTML topic; changing `get_course_content`.

## Decisions

### 1. Keep returning text inline; add paging instead of attachments
MCP clients feed tool results to the model; a base64 `resource`/attachment block of a PDF is not readable by most models and the hosted server has no filesystem to point at. The reference repo also returns inline text with a cap. We add `maxChars` (default 20 000 ≈ 5k tokens, max 100 000) and `offset` and report `totalChars`, `truncated`, `nextOffset`. Alternative rejected: raising the cap only — still loses the tail with no signal. Alternative rejected: a separate "read page N" tool — an `offset` on the existing tool is simpler and the model re-calls the same tool.

Default 20 000 (vs 12 000 in `get_assignment_files`) because lesson pages are the main use; both stay overridable. Slicing is by UTF-16 characters, backing off one unit if the cut would split a surrogate pair.

### 2. One shared helper, `utils/text-page.ts`
`pageText(text, offset, maxChars) → { text, totalChars, offset, truncated, nextOffset? }`, pure and unit-tested. Used by `get_content_topic`, `get_assignment_files` (adds `offset`, `totalChars`, `nextOffset`; existing `truncated`/`maxChars` kept) and `call_d2l_operation`. Response fields sit beside `extractedText` (`extractedTextTotalChars`, `extractedTextTruncated`, `extractedTextNextOffset`) so existing field names are unchanged.

### 3. Format detection from content type, then bytes
`apiGetBuffer` returns `{ bytes, contentType }` (callers updated; a small wrapper keeps a bytes-only variant for existing callers). `detectTopicFileFormat` order: `%PDF-` → pdf; ZIP with `word/document.xml` → docx; ZIP with `ppt/slides/` → pptx; else if the content type is `text/html` or the bytes begin (after BOM/whitespace) with `<!doctype html`/`<html`/`<body`/other tag → html; else if content type is `text/plain` (or other `text/*`) and the bytes are valid UTF-8 with no NUL bytes → text; else none. Bytes win over headers because the existing design found no usable filename, and D2L may mislabel types. The 404-means-no-file and `FileTooLargeError` behavior are unchanged.

### 4. HTML via the existing Turndown converter, hardened
Strip `script`, `style`, `noscript` entirely; GFM pipe-table rule (cells flattened, `|` escaped); `iframe/object/embed/video/audio` become links to their source; drop `javascript:`/`data:` hrefs; remove `d2lSessionVal`/`d2lSecureSessionVal` and cache-buster params from link/image URLs (they are session secrets and noise). Approach follows the reference repo's `html-converter.ts` (already credited in `THIRD_PARTY_NOTICES.md`). Decoding: UTF-8, honoring a `<meta charset>`/BOM only for UTF-16 BOMs; other charsets are decoded as UTF-8 with replacement (accepted limitation). Because the same converter backs other tools, the added rules also improve announcements/assignments; tests guard existing output for simple inputs.

### 5. Native-page `Description`
If `topicGet` metadata has an HTML `Description` (or `Description.Html`, to be confirmed live), add it as Markdown in `descriptionMarkdown` and leave the raw field alone. It is not paged separately but counts toward nothing else; if over `maxChars` it is cut with a note. (Assumption: descriptions are small relative to files.)

### 6. Untrusted marking
`untrusted` is set when the returned slice, the Markdown description, or the original description contains a URL (existing `containsUrl`). Markdown preserves link targets, so HTML pages with links are flagged. Content is still data, not instructions; the tool description says so.

### 7. `call_d2l_operation` text routes
For `binary`-paginated operations it now fetches bytes with the cap, classifies with Decision 3, and returns `{ contentType, text… paging }` for html/text/json; for anything else it throws the existing "binary not supported" error. It accepts `maxChars`/`offset` only for this case. Risk: a model using it as an escape hatch could pull large files; the 25 MB cap and paging bound this.

## Risks / Trade-offs

- **Breaking `extractedText` semantics** for documents over 20 000 chars → mitigated by explicit `truncated`/`nextOffset` and a tool description that says so; clients that want everything pass `maxChars: 100000` and page.
- **Unverified live behavior**: what D2L returns on `topicFile` for HTML topics (content type, redirects, or 404 for "native" pages) and the shape of `Description` are not confirmed. Detection is outcome-based (as in the earlier change) and a task verifies it live against the issue's topics and the user's example before archive.
- **Extra download for every `get_content_topic`** is unchanged (already always attempted).
- Text truncated mid-table/mid-word at a boundary is acceptable; slices are character-exact so concatenation is lossless.

## Migration Plan

Additive fields; one semantic change (slice not whole). Deploy as with prior changes (build, push to the instance, `/healthz`, live calls). Rollback: redeploy previous commit; no state.

## Open Questions

- Is 20 000 the right default? Revisit after live use; it is a constant plus a schema default.
