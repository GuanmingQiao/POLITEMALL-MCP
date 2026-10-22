## Why

`get_content_topic` only reads `.pdf` and `.docx` topic files. A topic whose file is HTML (Syllabus, Learning Plan, Assessment pages — [issue #1](https://github.com/GuanmingQiao/POLITEMALL-MCP/issues/1)) comes back as bare metadata with an empty `Description`, and `call_d2l_operation` refuses the same route as "binary", so an agent cannot read it at all. Separately, when a document *is* extracted, the whole text goes into one JSON string with no size control: a long lesson PDF can overflow the client's tool-result limit and get cut off or spilled to a file, with nothing telling the model what it missed or how to continue.

## What Changes

- `get_content_topic` extracts text from **HTML/HTM** topic files (and, cheaply, **PPTX** and plain text) in addition to PDF/DOCX. HTML is converted to Markdown with scripts/styles dropped and headings, lists, tables and links kept.
- A native-page topic's own `Description` HTML is also converted to Markdown (today it is returned raw or empty).
- Long text is **paged**: `get_content_topic` gains `maxChars` (default 20 000, max 100 000) and `offset`. The response states `totalChars`, `truncated`, and `nextOffset`, so a model can read a long document in consecutive calls instead of losing the tail. `get_assignment_files` gets the same `offset` and total/next fields (it already has `maxChars`).
- **BREAKING (response shape)**: `extractedText` is now the requested slice, no longer the entire document. Short documents (under the default) are unchanged; longer ones are truncated with explicit continuation fields.
- `call_d2l_operation` returns text-like responses (HTML, plain text, JSON) from otherwise-binary routes as text, still paged; true binaries are still rejected.
- HTML-derived text that contains links is flagged as untrusted (author-written), like other body text.
- The shared HTML-to-Markdown converter is hardened (strip `script`/`style`/`noscript`, GFM tables, embeds as links, D2L session parameters removed from links), improving every tool that uses it.

Answer to "how does it return documents today?": entirely inline — one text content block of JSON whose `extractedText` string holds the full document. There is no attachment, resource, cap or paging; the 25 MB limit applies to the *download*, not the returned text. The reference repo (`brightspace-mcp-server`) also returns inline text, capped by a `maxChars` + `truncated` flag with no offset; this change adopts that and adds `offset` so truncation is recoverable.

## Capabilities

### New Capabilities
- `d2l-text-paging`: a uniform contract for returning long extracted text in bounded, resumable slices.

### Modified Capabilities
- `d2l-content-file-text-extraction`: adds HTML/PPTX/plain-text topic files and native-page descriptions, and replaces "full text returned" with paged text.
- `d2l-mcp-tool-surface`: `call_d2l_operation` returns text-like responses as text instead of refusing them.

## Impact

- Code: `server/control-plane/src/tools/get-content-topic.ts`, `get-assignment-files.ts`, `call-d2l-operation.ts`, `api/d2l-client.ts` (expose content type from `apiGetBuffer`), `utils/html-to-markdown.ts`, a new shared paging helper, tests under `server/control-plane/tests/tools/`.
- Dependencies: none required (Turndown already present; table rule written by hand as in the reference repo).
- No new persisted state, no auth or network-scope change; same read-only GETs plus the existing download size cap.
- Needs live verification against the user's courses (example: the topic in nyplms course 1032338, and the issue's HTML topics), which needs a working signed-in session.
