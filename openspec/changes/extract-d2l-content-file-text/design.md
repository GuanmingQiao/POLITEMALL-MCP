# Design

## Context

`le.content.topicFile` (`GET {orgUnitId}/content/topics/{topicId}/file`) is already in
`d2lRouteCatalog.ts`, tagged `pagination: "binary"`. Every current consumer of the catalog
goes through `apiGet`, which hardcodes `Accept: application/json` and unconditionally calls
`res.json()` — it cannot handle this route. `call_d2l_operation` explicitly rejects any
`binary`-paginated operation (`d2l.ts` `callD2lOperation`) rather than attempt to return raw
bytes as MCP text content. `getContentTopic` (`d2l.ts`) currently does a single `apiGet` to
`le.content.topicGet` and returns the raw JSON — `Url`, dates, title, etc. — with no
awareness of the attached file's content. See proposal.md for why this gap matters now.

## Goals / Non-Goals

**Goals:**
- Fetch the raw bytes behind `le.content.topicFile` using the same session cookie and the
  same error-classification conventions (`SessionExpiredError`/`PermissionDeniedError`) the
  rest of `d2l.ts` already uses, so callers see consistent error behavior.
- Detect `.docx`/`.pdf` from the response itself, not from the topic's `Url` field,
  which isn't a reliable format signal.
- Extract plain text for those two formats and surface it as an additive field on
  `getContentTopic`'s response.
- Never turn "this topic isn't a file" or "this file can't be extracted" into a tool-call
  error — only real session/permission failures should error.

**Non-Goals:**
- No change to `getCourseContent` (the table-of-contents listing) — extraction only happens
  on the single-topic drill-down (`get_content_topic`), so one TOC call never triggers N
  file downloads.
- No change to `call_d2l_operation`'s blanket rejection of `binary` operations — this stays
  scoped to the one curated tool. Other binary routes (dropbox submission/group-submission
  zip downloads, news attachment download) are out of scope; they return multi-file zips or
  arbitrary attachments, not a single document suited to "extract text."
- No OCR. A scanned/image-only PDF has no embedded text layer and will extract to little or
  nothing — reported via the explanatory note, not treated as a defect.
- No legacy binary `.doc` (pre-OOXML) support — only modern `.docx`/`.pdf`.
- No `.pptx` support in this change. Investigated and deliberately deferred: no
  actively-maintained, narrowly-scoped pptx text-extraction library exists, and building a
  hand-rolled extractor (originally planned as a small `jszip`-based slide-text reader)
  adds a new dependency and a new in-repo parser for a format this change doesn't need to
  cover yet. A `.pptx` attachment is treated exactly like any other unsupported format (see
  Decision 2) — metadata returned, no `extractedText`, no error. Can be added later as a
  separate increment without touching anything built here.
- No caching of fetched bytes or extracted text across calls — consistent with the rest of
  the server, which holds no per-request state beyond the session cookie.
- No Docker base image or Node version change (see Decision 3).

## Decisions

### 1. A dedicated binary-fetch helper, not a generalized `apiGet`
Add `apiGetBinary` in `d2l.ts` alongside `apiGet`: same `fetch` call shape and the same
401/403/404/redirect → `SessionExpiredError`/`PermissionDeniedError` classification, but it
reads `Content-Type` and `Content-Disposition` and returns raw bytes instead of calling
`res.json()`. Rejected alternative: generalizing `apiGet<T>` with a response-mode flag —
every other call site is JSON-only and gains nothing from the extra branch; a second small
function is clearer than a conditional in a function 25+ call sites depend on.

One deliberate deviation from `apiGet`'s existing 404 handling: `apiGet`'s 404 means "this
tool isn't enabled for this course" and is surfaced to the caller as an error (via
`D2LNotFoundError` in `mcp.ts`). For the file-fetch path, a 404 here is the normal, expected
outcome for every non-file topic (a link, a native HTML page, a quiz-as-topic, ...) — most
topics. `apiGetBinary` reports a 404 as "no file" through its own result type instead of
throwing, so `getContentTopic` can treat it as "nothing to extract," not an error. 401/403
and the redirect-based session check still throw `SessionExpiredError`/`PermissionDeniedError`
exactly like `apiGet`, since those genuinely are the same failure for both paths.

### 2. Detecting a file-type topic: attempt the fetch, branch on the result — don't pre-filter by `TopicType`
The Valence `ToC.Topic`/`Content.ContentObject` schema has a `TopicType` field that
presumably distinguishes "file" from "link" from other topic kinds, but the authoritative
enum values aren't confirmed in `catalog.md` or in Valence's own docs as surfaced during
proposal research. Rejected alternative: hardcode a guessed `TopicType` value (e.g. `1` for
"file") and only call `le.content.topicFile` when it matches — this risks silently skipping
real file topics (or attempting the fetch for topics that aren't files) if the guess is
wrong, with no test able to catch the mistake short of a live course.

Chosen approach: `getContentTopic` always attempts `le.content.topicFile` after fetching the
topic's metadata (one extra authenticated `GET`, not expensive), and decides purely from the
outcome:
- 404 ("no file") → no extraction attempted, response unchanged from today.
- 200 with a `Content-Type`/filename extension that isn't `.docx`/`.pdf` (e.g. a
  native HTML page topic, or an attached `.pptx`/spreadsheet/image) → no extraction
  attempted, response unchanged from today.
- 200 with a recognized format → extract and add `extractedText`.
- 401/403/session-redirect → the existing session/permission error, same as any other tool.

This also sidesteps needing to know in advance whether D2L serves a native HTML-page topic's
content through this same route (returning `text/html`) or 404s it — either way, the result
lands in "no extraction attempted," so the exact behavior doesn't need to be confirmed before
implementation; the first live call against a real course settles it either way, consistent
with how the prior `add-d2l-route-catalog` change verified ambiguous route behavior live
rather than guessing.

### 3. Extraction libraries: `mammoth` (docx), `pdfjs-dist` (pdf) — no single unified package, no Node/base-image bump
Researched the available single-package options (e.g. `officeparser`, which covers several
office formats through one API). Rejected: `officeparser`'s current major version requires
Node >=22.13, and this project's `Dockerfile` pins `node:20-bookworm-slim` — adopting it
would mean bumping the production base image as a side effect of this change, a bigger and
riskier move than the feature itself warrants.

Chosen instead, two narrowly-scoped pieces that both run on the existing `node:20` image
(whose floating tag already satisfies `pdfjs-dist`'s `>=20.16.0` floor):
- **`.docx` → `mammoth`**: the long-established, pure-JS raw-text extractor for `.docx`; no
  native dependencies.
- **`.pdf` → `pdfjs-dist`**: Mozilla's own PDF.js build, zero runtime dependencies, actively
  maintained, typed. Rejected `pdf-parse` (2.x pulls in `@napi-rs/canvas`, a native
  dependency, for a feature this change doesn't need) in favor of this lower-level but
  dependency-clean option; the extra glue code (iterating pages, joining text items) is
  small and self-contained.

(`.pptx` extraction — originally planned as a small hand-rolled `jszip`-based slide-text
extractor — is deferred; see Non-Goals.)

### 4. A fixed maximum fetched-file size, enforced before and during download
A configurable constant (25 MB) caps the file size this capability will attempt to extract.
Checked against `Content-Length` when D2L supplies it, and enforced as a hard stop on bytes
read even if that header is absent or wrong. Rejected: no limit — a single MCP tool call
blocking on an arbitrarily large download/parse is a worse failure mode than the capped
"here's the metadata, extraction was skipped" outcome the spec already requires for this
case. 25 MB comfortably covers normal lesson slide decks/PDFs/documents while bounding
worst-case memory and CPU for one request; it's a plain constant in code, not an MCP-exposed
parameter, since no caller-facing use case needs to change it.

## Risks / Trade-offs

- **Unconfirmed `TopicType` enum** → mitigated entirely by Decision 2 (behavior derived from
  the fetch outcome, not a hardcoded guess); no residual risk beyond "first live call
  confirms the common cases," matching this project's established pattern of verifying
  router behavior against a real course during `tasks.md`.
- **`pdfjs-dist` is lower-level than a one-call text extractor** → accepted; the alternative
  (`pdf-parse`) trades that convenience for a native dependency this project doesn't
  otherwise need.
- **CJS/ESM interop for `mammoth`/`pdfjs-dist` under this project's `NodeNext` +
  `esModuleInterop` TypeScript config** is unverified until actually compiled → flagged for
  an early implementation task (import each library, compile, and run a trivial smoke
  extraction) before building the rest of the feature on top, rather than discovering an
  interop problem late.
- **A single large/slow file could make one `get_content_topic` call noticeably slower** →
  bounded, not eliminated, by the size cap (Decision 4); no streaming or background-job
  mechanism is introduced in this change.

## Migration Plan

Purely additive — no data migration, no schema change, no new persisted state. Deploys the
same way the prior `add-d2l-route-catalog` change did: build, push via `aws ssm
send-command` to the running EC2 instance, confirm `/healthz` and a live `get_content_topic`
call against a real file-type topic. Rollback is redeploying the previous commit; there is
nothing stateful to unwind.
