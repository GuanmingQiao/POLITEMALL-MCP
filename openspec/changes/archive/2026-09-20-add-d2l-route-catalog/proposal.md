# Proposal

## Why

Today's 20 D2L tools in `server/control-plane/src/mcp.ts` cover the routes we happened to
build first, not a deliberate slice of the Valence Learning Environment (LE) API — of the
190 read (`GET`) routes under `/d2l/api/le/` (excluding `agents/*`, `locker/*`, `lti/*`,
`ltiadvantage/*`), only a handful are reachable today, and every new one currently means
hand-writing another `d2l.ts` function, another `registerTool` block, and another hardcoded
`/d2l/api/le/${LE_VERSION}/...` path string. That doesn't scale to the full route surface,
and it gives us no systematic way to keep pace as D2L adds or reversions routes. We also
carry a live correctness risk today: `LE_VERSION`/`LP_VERSION` are hardcoded constants
(`server/control-plane/src/d2l.ts:3-4`) with no check that POLITEMall's and NYP's tenants
(independently upgraded D2L instances) actually still support them.

This server also serves two distinct audiences through the same tool set — students looking
at their own record, and instructors/TAs looking at a whole class — and today's curation is
lopsided about it: grades and quiz results already have a student-facing/instructor-facing
pair (`get_grades`/`get_class_grades`, `get_quiz_attempts`/`get_quiz_results`), but dropbox
submissions only has the instructor side and final grades and survey results have neither
paired tool at all. Expanding coverage is a chance to fix that systematically rather than
carry the imbalance forward into 190 more routes.

## What Changes

- Add a declarative D2L route catalog (`server/control-plane/src/d2lRouteCatalog.ts`) as the
  single source of truth for every supported Valence route: operation key, path template, HTTP
  product (LE/LP), path/query parameter schema, pagination style, and scope
  (course/user/global). Initial population covers all `GET` routes under Learning Environment
  except `agents/*`, `locker/*`, `lti/*`, and `ltiadvantage/*` — the full, concrete catalog
  (all 190 routes — the initial 187-route estimate was itself off by one, and research found 2
  more genuinely missing routes — with proposed operation keys, path/query param shapes, and
  response envelopes) is now materialized at `specs/d2l-route-catalog/catalog.md` for review
  before implementation, researched and cross-checked against raw D2L documentation HTML
  (not just AI-summarized fetches) rather than left for the implementer to derive; `design.md`
  explains the curation rationale. Read-only for this change — no `POST`/`PUT`/`DELETE` routes
  are added to the catalog or exposed.
- Add a startup D2L version-compatibility check: on boot, query D2L's version-discovery route
  for each connectable school host and fail startup loudly if the pinned
  `LE_VERSION`/`LP_VERSION` isn't in that tenant's supported list, instead of discovering it
  later as a runtime 404/500.
- Promote 12 additional catalog routes to dedicated, response-shaped MCP tools, explicitly
  covering both audiences wherever D2L exposes both an own-scoped and a class-wide view of the
  same workflow — mirroring the `get_grades`/`get_class_grades` pattern that already exists:
  - **Student-facing ("my"):** `get_my_final_grade`, `get_my_dropbox_submission`,
    `get_my_calendar_events`, `get_overdue_items`, `get_recent_updates`
  - **Instructor/TA-facing (class-wide):** `get_all_final_grades` (new pair for
    `get_my_final_grade`), `get_survey_results` (new pair for the existing `get_survey_attempts`,
    matching how `get_quiz_results` already pairs with `get_quiz_attempts`) — plus
    `get_my_dropbox_submission` above pairs with the existing instructor-facing
    `get_dropbox_submissions`.
  - **Shared (not user-scoped, so no split applies):** `get_rubrics`, `get_quiz_questions`,
    `get_survey_questions`, `get_course_overview`, `get_content_topic` — these wrap course-level
    config/structure, not per-student data (visibility, where it varies, follows the quiz/
    survey/rubric's own settings and the caller's D2L permissions, not a fixed my/all split).
  - Full list, per-tool D2L route mapping, and rationale for why each one either got a pair or
    didn't, is in `design.md`.
- Add one generic, catalog-driven tool (`call_d2l_operation`) that can invoke any cataloged
  route by its operation key, for the long tail of routes that don't warrant a dedicated
  tool. It validates against the same catalog schema and reuses the existing session,
  permission, and error-handling wrappers (`runForD2LCourse`/`runAcrossD2LSchools`) — it does
  not accept arbitrary paths or URLs.
- Add a discovery tool (`list_d2l_operations`) that lists/describes cataloged operations
  (filterable by category/keyword), so an agent can find a long-tail operation without every
  route being a separate tool in context.
- Existing 20 tools keep their current names, input schemas, and output shapes — no breaking
  changes to what's already deployed. The curated wrapper functions in `d2l.ts` are
  refactored to source their path templates from the catalog instead of inline strings, which
  is an internal refactor with no observable behavior change.
- Mark every D2L/STEP tool (existing and new) with MCP read-only tool annotations
  (`readOnlyHint: true`, `destructiveHint: false`) so clients that surface these hints can
  treat this server as safe-by-default.
- Out of scope: the local single-user server (`src/`), STEP tools, write/mutating D2L routes,
  and LP-product route catalog population (the catalog schema supports LP, but this change
  only populates it with LE routes, per the explicit ask this proposal was scoped from).

## Capabilities

### New Capabilities

- `d2l-route-catalog`: A declarative, versioned catalog of D2L Valence API routes that the
  server can call, plus a startup check that the pinned API version is actually supported by
  each connected D2L tenant.
- `d2l-mcp-tool-surface`: How the D2L route catalog is exposed to MCP clients — curated
  per-workflow tools, a generic catalog-driven fallback tool, and a discovery tool — bounding
  total tool count while reaching the full cataloged route surface.

### Modified Capabilities

_(none — no existing `openspec/specs/` capabilities exist yet in this project; the 20
existing tools' observable behavior is preserved, so they're covered as part of the new
`d2l-mcp-tool-surface` capability rather than as a modification.)_

## Impact

- **Code**: `server/control-plane/src/d2l.ts` (refactor path templates onto the catalog),
  `server/control-plane/src/mcp.ts` (new curated tools + generic/discovery tools + read-only
  annotations), new `server/control-plane/src/d2lRouteCatalog.ts`, new
  `server/control-plane/src/d2lVersionCheck.ts` (or similar), `server/control-plane/src/index.ts`
  (run the startup check alongside `loadMasterKey()`), `server/control-plane/src/auditLog.ts`
  callers (log which tool/operation was invoked, not just the JSON-RPC method).
- **Deployment**: server now fails fast at boot if a tenant no longer supports the pinned D2L
  API version — an operational change worth calling out to whoever deploys
  `server/control-plane` (see `server/README.md`, `deploy/README.md`).
- **Docs**: `README.md` tool table grows by 14 rows (12 curated + 2 generic/discovery), split
  across its existing "student-facing" / "instructor/TA only" sections; needs a short
  explanation of `call_d2l_operation`/`list_d2l_operations` for the long tail.
- **No changes** to authentication, cookie storage/encryption, rate limiting, or the STEP/
  POLITEMall-catalog tools.
