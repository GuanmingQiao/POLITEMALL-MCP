# Proposal

## Why

D2L course content topics often attach a `.docx` or `.pdf` file (e.g.
https://nyplms.polite.edu.sg/d2l/le/lessons/1032338/topics/15690454) rather than a native
HTML page. Today `get_content_topic` returns only that topic's metadata (title, dates,
`Url`) — never the attached file's content — so an MCP client has no way to read what's
actually in the lesson material; it can see *that* a file is attached, not what it says.
The route needed to fetch the raw file (`le.content.topicFile`) is already cataloged from
the prior `add-d2l-route-catalog` change but was explicitly left unwired to any tool
(design.md Non-Goal: "no binary content download through a curated tool"). This change
closes that gap for the two formats course material actually shows up in most often.
(`.pptx` is deferred — see design.md Non-Goals.)

## What Changes

- Add a binary-aware fetch path for `le.content.topicFile` (the existing catalog entry),
  distinct from the JSON-only `apiGet` every other tool uses — it must read raw bytes and
  the response's `Content-Type`/`Content-Disposition`, not call `res.json()`.
- Add text extraction for two formats: `.docx` (via `mammoth`) and `.pdf` (via
  `pdfjs-dist`, which needs Node >=20.16 — already satisfied by the `node:20` Docker base
  image's floating patch tag; no base image change). Format is detected from the response's
  `Content-Type`/`Content-Disposition`, not from the topic's `Url` field (which isn't
  reliable for this). `.pptx` is explicitly out of scope for this change.
- Extend `get_content_topic`'s response: when the topic is a file-type topic whose
  underlying file is one of the two supported formats, add an `extractedText` field
  containing the extracted plain text, fetched and parsed server-side. Every existing field
  in the current response is unchanged.
- An extraction failure (corrupt file, scanned/image-only PDF with no extractable text,
  oversized file, or an unsupported/undetected format) does not fail the tool call — the
  existing topic metadata is still returned, with an explanatory field in place of
  `extractedText` instead of a hard error.
- Investigated as part of this proposal: the server currently has **no existing
  attachment-returning behavior** anywhere (`call_d2l_operation` explicitly rejects every
  `binary`-paginated catalog operation, including `le.content.topicFile`, and no tool
  returns raw file bytes). There is nothing today to preserve for file-type topics beyond
  the metadata fields `get_content_topic` already returns — those are kept as-is.

## Capabilities

### New Capabilities
- `d2l-content-file-text-extraction`: fetching a file-type content topic's underlying
  `.docx`/`.pdf` file and extracting its plain text, including format detection,
  size limits, and non-fatal handling of extraction failures.

### Modified Capabilities
(none — `get_content_topic`'s existing fields and error semantics, and `d2l-mcp-tool-surface`'s
existing requirements, are unchanged; the new field is additive)

## Impact

- `server/control-plane/src/d2l.ts`: new binary-fetch helper alongside `apiGet`; `getContentTopic`
  gains the extraction step for file-type topics.
- `server/control-plane/src/mcp.ts`: `get_content_topic`'s description/response documentation
  updated to mention `extractedText`; tool name, input schema, and annotations unchanged.
- `server/control-plane/package.json`: two new dependencies (`mammoth`, `pdfjs-dist`).
- `server/README.md` / root `README.md`: note the new response field on `get_content_topic`.
- No change to `d2lRouteCatalog.ts` (the route is already cataloged) or to any other tool.
