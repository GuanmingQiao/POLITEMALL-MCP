# Tasks

> **Port note (2026-10-13):** `origin/main` was restructured (api/auth/tools/utils, plus
> `apiGetBuffer`, `unpdf`-based `pdf-text.ts` and `zip-text.ts`) while this change was in
> progress. Sections 1-4 below describe the original implementation; it was re-done on the new
> structure **without `mammoth`/`pdfjs-dist`/`apiGetBinary`**: `topicFileText` in
> `src/tools/get-content-topic.ts` reuses `apiGetBuffer` (25 MB cap), `extractPdfText` and
> `officeDocumentText`, and detects the format from file bytes (`%PDF-`, ZIP containing
> `word/document.xml`) because `apiGetBuffer` exposes no headers. A `.pptx`/`.xlsx` is left
> unchanged. Tests: `tests/tools/get-content-topic.test.ts`; full suite 187/187.

## 1. Dependencies and interop spike

- [x] 1.1 Add `mammoth` and `pdfjs-dist` to `server/control-plane/package.json` and
      verify `npm install` succeeds and `npm run build` compiles with no type errors under
      the project's `NodeNext`/`esModuleInterop` TypeScript config. **Deviation**: `pdfjs-dist`
      is pinned to an exact version (`5.4.624`), not a caret range — its 5.5.x+ and 6.x
      releases raise the Node engine floor back to >=22.13, which would silently break the
      `node:20` production image on a routine `npm install`/lockfile update; 5.4.624 is the
      newest release still satisfying >=20.16.0 (confirmed via `npm view pdfjs-dist@5 engines`
      across the 5.x line). Also added a top-level `overrides.argparse: "^2.0.1"`: `mammoth`
      hard-depends on `argparse@~1.0.3` (used only by its unused CLI binary, not its JS API),
      which pulls a `sprintf-js` version with a known moderate DoS advisory; the override
      replaces it tree-wide. `npm install` and `npm run build` both succeed; `npm audit` now
      shows only the pre-existing, unrelated `@modelcontextprotocol/sdk` advisory.
- [x] 1.2 Spike each library's import/usage shape under this config with a throwaway script
      (not shipped): load a trivial in-memory `.docx` via `mammoth`, and a trivial `.pdf` via
      `pdfjs-dist`'s Node-compatible (non-worker) entry point. Verify each produces output
      without a module-resolution or worker-thread error before building real code on top
      (design.md Risk: unverified CJS/ESM interop). Both compiled and ran cleanly under
      `NodeNext`/`esModuleInterop` with no interop issue. Two concrete findings carried into
      tasks 3.2-3.3: (a) `pdfjs-dist`'s `getDocument` rejects a Node `Buffer` outright
      ("provide binary data as `Uint8Array`") — must wrap with `new Uint8Array(buffer)`; (b)
      without `standardFontDataUrl`/`cMapUrl` pointed at the font/cmap data `pdfjs-dist` ships
      in its own package (`node_modules/pdfjs-dist/standard_fonts/`, `.../cmaps/`), it logs an
      `UnknownErrorException` warning on documents using non-embedded standard fonts — wire
      both options rather than leaving the warning in place. Import path used:
      `pdfjs-dist/legacy/build/pdf.mjs` (the `legacy` build, not the browser-targeted default
      `build/pdf.mjs`). Spike script and its compiled output deleted after verification.

## 2. Binary fetch helper

- [x] 2.1 Implement `apiGetBinary` in `d2l.ts` alongside `apiGet`: same `fetch` call and
      session/permission classification (401/403/redirect → `SessionExpiredError`/
      `PermissionDeniedError`), but on 200 returns `{ found: true, bytes, contentType,
      fileName }` (bytes as `Buffer`, `contentType`/`fileName` parsed from the
      `Content-Type`/`Content-Disposition` response headers) instead of parsing JSON, and on
      404 returns `{ found: false }` rather than throwing (design.md Decision 1). Verify with
      unit tests covering each status branch via a mocked `fetch`, including that a 404 does
      not throw. **Deviation**: used a `{ status: "ok" | "not-found" | "too-large" }`
      discriminated union instead of `{ found: boolean }`, since task 2.2's size cap needed a
      third non-throwing outcome anyway — one result type for both tasks rather than two
      overlapping ones. `d2lBinaryFetch.test.ts`, 7/7 passing.
- [x] 2.2 Add a fixed maximum size (25 MB) to `apiGetBinary`: reject before reading the body
      if `Content-Length` exceeds it, and stop reading and reject if the actual byte count
      exceeds it even without a trustworthy `Content-Length` (design.md Decision 4). Verify
      with unit tests for both the `Content-Length`-based and streamed-bytes-based rejection
      paths, each returning a distinct "too large" result rather than throwing. Covered by
      the same `d2lBinaryFetch.test.ts` as 2.1 (two of its 7 tests target this specifically).

## 3. Format detection and per-format extraction

- [x] 3.1 Implement a format-detection helper that maps a fetched file's `contentType`/
      `fileName` to `"docx" | "pdf" | null` (recognizing both the standard OOXML/PDF
      MIME types and, as a fallback, the `.docx`/`.pdf` file extension from
      `Content-Disposition`). Verify with unit tests for each MIME type, the
      filename-extension fallback, and an unrecognized type/extension (including `.pptx`)
      returning `null`. Implemented as `detectFileFormat` in new file `d2lContentExtract.ts`.
- [x] 3.2 Implement `.docx` text extraction using `mammoth`'s raw-text API. Verify with a unit
      test against a real small sample `.docx` fixture checked into the test directory,
      asserting the known text it contains is returned. Fixture: `testFixtures/sample.docx`
      (copied from `mammoth`'s own MIT-licensed test fixtures — "Apple"/"Banana" list items).
- [x] 3.3 Implement `.pdf` text extraction using `pdfjs-dist`'s Node-compatible build with the
      worker disabled, joining each page's text items in page order. Verify with a unit test
      against a real small sample `.pdf` fixture, asserting the known text it contains is
      returned. Fixture: `testFixtures/sample.pdf` (hand-written minimal single-page PDF,
      text "Hello World" — the same file used in the 1.2 interop spike). Wired
      `standardFontDataUrl`/`cMapUrl` per the spike's finding. Residual, non-fatal observation:
      pdfjs-dist still logs one `Unable to load font data ... LiberationSans-Regular.ttf`
      warning for this fixture (a font-substitution path distinct from the standard_fonts/
      cmaps data just wired in) — text extraction is unaffected and exactly correct
      (`"Hello World"`), so left as-is rather than chasing a cosmetic log line.
- [x] 3.4 Implement a single `extractText(bytes, format)` dispatcher over 3.2-3.3 that catches
      any parser exception (corrupted/unparsable file, or a well-formed-but-empty text layer
      such as a scanned PDF) and returns a `{ ok: true, text } | { ok: false, reason }` result
      rather than throwing. Verify with unit tests feeding a deliberately corrupted buffer for
      each of the two formats and asserting a non-throwing `{ ok: false, reason }` result.
      `d2lContentExtract.test.ts`, 8/8 passing (covers 3.1-3.4 together); full suite 62/62.

## 4. Wire extraction into `get_content_topic`

- [x] 4.1 Update `getContentTopic` in `d2l.ts` to type its return (currently `unknown`), call
      `apiGetBinary` for `le.content.topicFile` after the existing metadata fetch, and run the
      result through the size cap (2.2), format detection (3.1), and `extractText` (3.4),
      adding an `extractedText` field on success or an explanatory `extractedTextUnavailable`
      reason on a skip/failure — leaving every existing field untouched (spec
      `d2l-content-file-text-extraction` — "existing topic metadata and behavior are
      preserved"). Verify with unit tests (mocked `fetch`) covering: a non-file topic (`found:
      false`) leaves the response unchanged; a file-type topic in an unsupported format (e.g.
      a `.pptx`) leaves the response unchanged; a successful `.docx`/`.pdf` extraction adds
      `extractedText`; an oversized file and a corrupted file each add the explanatory reason
      without an error result; a session-expired file fetch surfaces the same
      `SessionExpiredError` behavior other D2L tools use (spec — all eight scenarios in
      `d2l-content-file-text-extraction`). Return type changed from `Promise<unknown>` to
      `Promise<Record<string, unknown>>` to allow the additive spread. `d2lContentTopic.test.ts`,
      7/7 passing (one test per scenario); full suite 69/69.
- [x] 4.2 Update the `get_content_topic` tool registration's description in `mcp.ts` to mention
      the new `extractedText` field for file-type topics in a supported format, leaving the
      tool name, input schema, and annotations unchanged. Verify by reading the updated
      description string.

## 5. Live verification

- [x] 5.1 Deploy and call `get_content_topic` against a real course containing a known
      `.docx` and `.pdf` lesson topic (e.g. the `nyplms.polite.edu.sg` lesson topic
      referenced in `proposal.md`) with a real token, confirming each returns the attached
      file's real extracted text. Verified 2026-10-13 on the EC2 host: PDF topics (nyp:524042/9767706, 28,333 chars; nyp:1032348/15691220) and a DOCX topic (politemall:48909/4155378, 34,109 chars) each returned `extractedText` with all original metadata fields intact.
- [ ] 5.2 Against the same or another real course, call `get_content_topic` on a non-file
      topic (a link or native page) and, if one is available, a file-type topic in an
      unsupported format (e.g. a `.pptx` lesson attachment), confirming the response is
      byte-for-byte identical in its existing fields to what it returned before this change
      (no `extractedText`, no error). Partial 2026-10-13: a `.pptx` topic (nyp:524042/8806566) and an `.html` file topic (politemall:48909/2135727) returned only their metadata (no `extractedText`, no error). No true link/native-page topic has been tried live yet; the 404 path is covered by unit test only.

## 6. Final verification

- [x] 6.1 Run the full test suite (`npm test` in `server/control-plane`) and confirm all tests,
      existing and new, pass. 69/69 passing (47 pre-existing + 22 new across
      `d2lBinaryFetch.test.ts`, `d2lContentExtract.test.ts`, `d2lContentTopic.test.ts`).
- [x] 6.2 Update `README.md`'s `get_content_topic` entry to document the new `extractedText`
      field and the two supported formats.
