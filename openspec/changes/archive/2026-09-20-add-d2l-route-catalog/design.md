# Design

## Context

See `proposal.md` - Why for motivation. Relevant current state:

- `server/control-plane/src/d2l.ts` hardcodes `LE_VERSION = "1.9"` / `LP_VERSION = "1.9"` and
  builds every request path as a template literal inline in whichever function needs it.
  `server/control-plane/src/mcp.ts` registers one `server.registerTool(...)` block per D2L
  workflow, each backed by a hand-written `d2l.ts` function.
- Two independent D2L tenants are in play: `lms.polite.edu.sg` (politemall) and
  `nyplms.polite.edu.sg` (nyp) — see `SCHOOL_HOSTS` in `d2l.ts`. They are upgraded
  independently by their own institutions, so "does D2L support LE 1.9" is a
  per-tenant question, not a global one.
- The server is a single long-lived Node process (`server/control-plane/src/index.ts`) that
  builds a fresh `McpServer` per `/mcp` request (`buildMcpServerForToken(token)`), but the
  process itself starts once — `await loadMasterKey()` at module top-level is the existing
  pattern for "do this once at boot, fail loudly if it doesn't work."
- Three existing wrapper patterns already solve session/permission/error handling and must be
  reused, not duplicated, by anything this change adds: `runForD2LCourse` (course-scoped,
  resolves `courseId` → school + numeric id), `runAcrossD2LSchools` (fans a call out across
  every connected D2L school), and the `SessionExpiredError` / `PermissionDeniedError` /
  `NotFoundError` exception classes thrown by `apiGet`.
- Per the answered scope questions: this change is **read-only** (`GET` only, no
  `POST`/`PUT`/`DELETE`), and D2L API versioning is a **pinned config value validated at
  startup**, not dynamic per-call negotiation.

## Goals / Non-Goals

**Goals:**
- One declarative catalog is the only place a D2L LE route's path template is written down.
- Every cataloged route is reachable from an MCP client — either via a curated tool or via
  the generic/discovery pair — without hand-writing a `registerTool` block per route.
- Total registered tool count stays in the low dozens (34 after this change), not 190+.
- Adding a new D2L route in the future is a catalog entry, not a new file; promoting a
  catalog entry to a curated tool is additive and doesn't require redesigning the catalog.
- A stale pinned API version is caught at deploy time, not by a user hitting a broken tool.
- Where D2L exposes both an own-scoped view and a class-wide view of the same workflow, the
  curated tool set covers **both** audiences (student and instructor/TA) rather than
  whichever one happened to get built first — see Decision 2.

**Non-Goals:**
- No write/mutating routes (`POST`/`PUT`/`DELETE`) — this change is read-only end to end,
  including the generic tool, which only ever issues `GET` requests.
- No dynamic version auto-upgrade — the pinned version is still a manual config bump; this
  change only adds a startup check that the pin is still valid.
- No changes to the local single-user server (`src/`), STEP tools, or
  `search_politemall_catalog`.
- No LP-product catalog population — the catalog's schema is product-agnostic (an entry
  declares `product: "le" | "lp"`), but this change only populates `le` entries. The three
  existing LP-backed tools (`list_courses`, `get_groups`, `whoami`) are left as
  hand-written code, unchanged, and are not migrated onto the catalog in this change.
- No binary content download (e.g. `content/topics/{topicId}/file`) through a curated tool —
  cataloged for completeness (reachable via the generic tool, which returns whatever D2L
  returns), but no response-shaping work goes into it here.

## Decisions

### 1. Catalog format: a typed TypeScript module, not JSON/YAML + a parallel schema

`server/control-plane/src/d2lRouteCatalog.ts` exports a `const` array of route descriptors,
each shaped roughly as:

```ts
interface D2lRouteDescriptor<Params extends z.ZodRawShape = z.ZodRawShape> {
  operation: string;              // stable key, e.g. "le.rubrics.list"
  product: "le" | "lp";
  method: "GET";                  // kept as a field (not narrowed away) so this shape
                                   // still works if a future change adds writes
  pathTemplate: string;            // "/{orgUnitId}/rubrics/" — product+version prefix applied by the caller
  scope: "course" | "user" | "global";
  pathParams: z.ZodObject<Params>; // e.g. { orgUnitId: z.number() }
  queryParams?: z.ZodObject<z.ZodRawShape>;
  pagination: "none" | "objectList" | "bookmark";
  category: string;                // "rubrics", "grades", "quizzes", ... — matches design.md appendix headings
  description: string;
  curatedTool?: string;            // set when a dedicated tool wraps this operation
}
```

**Why a TS module over JSON/YAML:** the codebase already expresses every tool's input schema
as inline `zod` (see every `registerTool` call in `mcp.ts`). A TS module lets `pathParams`/
`queryParams` be real `zod` schemas reused directly by both the generic tool's runtime
validation and (via `z.infer`) the curated tools' TypeScript types, with no second
schema-description format to keep in sync. JSON/YAML would need either a hand-rolled param
schema mini-language or a second zod-schema-per-operation file anyway, and loses compile-time
checking that `operation` keys referenced elsewhere (`curatedTool` lookups, tests) actually
exist. The cost is that the catalog isn't trivially hand-editable by a non-TS tool — acceptable
since this project has no non-engineer catalog maintainers.

**Alternative considered:** generate the catalog from D2L's published route table
programmatically (scrape `http-routingtable.html` at build time). Rejected: that page isn't a
machine-readable contract (no OpenAPI/JSON spec is published for Valence LE), and scraping HTML
into a build step is more fragile than reviewing a diff to a checked-in TS file when D2L changes
something.

### 2. Curated-tool selection: promote a route when it matches today's existing curation bar — and check both audiences

Today's 20 tools already apply an implicit bar: promote a route when it (a) is something a
student, instructor, or TA would plausibly ask for in plain language, and (b) benefits from
response shaping — id→name joins, pagination flattening, filtering hidden/internal fields, or
multi-school fan-out — the same kind of work `getGrades`, `getClassGrades`, and
`getDropboxSubmissions` already do. Routes that are purely administrative/config-facing
(grading scheme setup, org-unit auditing, course-copy job status, IPSIS/SIS plumbing,
continuing-education records), or that duplicate a shape another curated tool already covers,
stay catalog-only.

This project serves two audiences through the same tool set — a student looking at their own
record, and an instructor/TA looking at the whole class — and three D2L workflows already have
both a student-facing and instructor-facing route pair today (`get_grades`/`get_class_grades`,
`get_quiz_attempts`/`get_quiz_results`, and `get_dropbox_submissions`, which is instructor-only
because its student-facing pair was simply never added). Applying the curation bar above, a
**second check** is: for any newly-curated workflow, does D2L expose both an own-scoped route
and a class-wide route for it? If so, curate both, distinctly named, rather than shipping only
the half that happened to get noticed first.

Applying both checks to the full LE `GET` surface (catalog in
`specs/d2l-route-catalog/catalog.md`) selects **12 new curated tools**, bringing the curated
total to 32, plus 2 generic/discovery tools (34 total):

| New tool | Audience | Wraps | Why curate it |
|---|---|---|---|
| `get_rubrics` | Shared | `rubrics/`, `rubrics/{rubricId}` | Rubrics are referenced from grading/dropbox/discussion workflows; listing criteria/levels needs no join but is common enough to name directly. Not user-scoped, so no my/all split applies |
| `get_my_final_grade` | Student | `grades/final/values/myGradeValue` | "What's my grade in this course" is a distinct, very common ask from per-item `get_grades` |
| `get_all_final_grades` | Instructor/TA | `grades/final/values/` | Class-wide pair for `get_my_final_grade`, same shape as `get_class_grades` pairs `get_grades` — joins classlist names, requires the same grading permission `get_class_grades` already requires |
| `get_my_dropbox_submission` | Student | `submissions/mysubmissions/`, `feedback/{entityType}/{entityId}` | Student-facing counterpart to the existing instructor-only `get_dropbox_submissions` — fills a gap where the class-wide tool already existed but the student-facing one didn't |
| `get_survey_results` | Instructor/TA | `surveys/{surveyId}/attempts/` (class-wide, same route as `get_survey_attempts` under `quizzing:attempts:read`-equivalent permission) | Class-wide pair for the existing `get_survey_attempts` — fills the exact gap `get_quiz_results` already fills for quizzes, kept name-consistent with it |
| `get_quiz_questions` | Shared | `quizzes/{quizId}/questions/` | Natural extension of the existing quiz trio; visibility follows the quiz's own settings + caller permission, not a fixed student/instructor split |
| `get_survey_questions` | Shared | `surveys/{surveyId}/questions/` | Same rationale, kept consistent with the survey trio |
| `get_course_overview` | Shared | `overview` | Common "what is this course about" ask; today only reachable indirectly |
| `get_content_topic` | Shared | `content/topics/{topicId}` | Single-item drill-down that `get_course_content`'s table-of-contents naturally leads to |
| `get_my_calendar_events` | Student | cross-org `calendar/events/myEvents/` | Cross-course parity with `get_due_items`, which already fans out across courses/schools. Inherently personal — D2L has no "all students' calendar events" concept to pair against, since course events are already shared/visible to everyone via the existing per-course `get_calendar_events` |
| `get_overdue_items` | Student | cross-org `overdueItems/myItems` | D2L-computed "what's overdue", distinct filtered view from `get_due_items`. D2L's `overdueItems/` (no `myItems` suffix) is org-wide/admin-scoped rather than course-instructor-scoped, so it doesn't make a clean instructor pair and stays catalog-only |
| `get_recent_updates` | Student | cross-org `updates/myUpdates/` | "What's new across my courses" activity-feed ask, cross-course like `get_due_items`/`get_overdue_items`. Personal by nature — no class-wide equivalent exists in the LE API |

Curated tools become thin: each pulls its path template/params from the catalog entry (via
`operation` key) rather than a separately-hardcoded string, then applies the same kind of
response-shaping function `d2l.ts` already has for e.g. `getGrades`/`getClassGrades`. This
removes the current duplication where the path template is the only thing hardcoded per
function, without changing how shaping code is written. `get_all_final_grades` and
`get_survey_results` in particular follow `getClassGrades`'/`getQuizResults`' existing shape:
join against `getClasslist` for student names, and surface `PermissionDeniedError` distinctly
from `SessionExpiredError` exactly as those two already do.

**Naming convention for new pairs:** existing pairs use inconsistent conventions across
workflows (`get_grades`/`get_class_grades`, `get_quiz_attempts`/`get_quiz_results`) — this
change does not rename any existing tool (that would break the "existing tools are
behavior-preserving" requirement). For the one genuinely new pair introduced here (final
grades, which had no prior instructor-facing tool to be consistent with), it uses
`get_my_<thing>` / `get_all_<thing>`, since that's an unambiguous, self-explanatory pattern
with no existing precedent to conflict with. `get_survey_results` instead matches the existing
`get_quiz_results` name exactly (not `get_all_survey_attempts`), since it's filling the same
gap in an already-established quiz/survey naming pair and staying consistent with that
precedent outranks a mechanically uniform prefix.

**Alternative considered:** promote roughly everything reachable via a single course
(`{orgUnitId}`-scoped) to a curated tool, since those are the ones a course participant would
ask about. Rejected — that's still over 100 routes; several of them (rubric metadata edits'
read-side, checklist items, competencies structure, learning-outcome alignments) are used by
few POLITEMall/NYP courses in practice and add tool-selection noise without matching value.
They stay reachable via the generic tool instead.

### 3. Generic tool (`call_d2l_operation`): allow-listed operation key, not a raw path

Input schema: `{ operation: z.enum([...catalog operation keys...]), courseId: z.string().optional(), params: z.record(z.unknown()).optional() }`.
Dispatch:
1. Look up `operation` in the catalog — reject with an error result (no network call) if
   absent, per the `d2l-mcp-tool-surface` spec.
2. Parse `params` against that operation's `pathParams`/`queryParams` zod schemas — reject
   with a validation error result (no network call) on failure.
3. For `scope: "course"` operations, resolve `courseId` the same way `runForD2LCourse` does
   today (split `school:numericId`, look up that school's cookie) and inject `orgUnitId` from
   the parsed numeric id rather than trusting a caller-supplied `orgUnitId` — this closes off
   a class of bug/abuse where a valid session for one course is used to probe another course's
   `orgUnitId` the caller was never enrolled in. For `scope: "global"`/`"user"` operations, use
   `runAcrossD2LSchools` or a single-school cookie as appropriate to the operation.
4. Build the request path by substituting the *validated* params into `pathTemplate` (values
   are typed/coerced by zod, e.g. `z.number()` for `{rubricId}` — never raw string
   concatenation of unvalidated input), apply the configured product version prefix, and call
   through the existing `apiGet`/`fetchAllPages` machinery keyed off the catalog's declared
   `pagination` style.
5. Return the raw (unshaped) JSON response, tagged with the operation key, wrapped in the same
   `toolResult`/`errorResult`/exception-to-message translation curated tools use.

This is the core "MCP proxy best practice" this design leans on: never let a client-controlled
string reach a URL unvalidated. The generic tool's attack surface is exactly the same as the
catalog's allow-list, no larger — structurally identical to how `parseCourseId` already
prevents a `courseId` string from being anything other than a known school + number.

**Alternative considered:** accept a raw D2L path (`"/d2l/api/le/1.9/6606/rubrics/"`) and just
forward it. Rejected outright — that's an open proxy to `SCHOOL_HOSTS[school]` with a live
session cookie attached, and defeats the entire purpose of the catalog as an allow-list.

### 4. Discovery tool (`list_d2l_operations`): keeps the generic tool usable without registering 190 tools

Input: `{ category: z.string().optional(), query: z.string().optional() }`. Returns cataloged
operations (key, category, description, required params, whether it's also available as a
named curated tool) filtered by category/keyword. This directly answers the tool-count vs.
discoverability tension from the "best practice for MCP proxies" ask: instead of every route
being its own tool (bad for context budget and tool-selection accuracy) or a single opaque
`call_d2l_operation` with no way to learn what's callable (bad for the agent actually using
it), the model can query for e.g. "checklists" and get back the operation keys/params it needs,
then call `call_d2l_operation` with that key — a two-step discovery pattern rather than a
tool-per-route or fully-opaque proxy.

### 5. Versioning: pinned config + startup compatibility check, per school host

`config.ts` keeps (or gains, if not already there) explicit `LE_VERSION`/`LP_VERSION` values.
At module top-level in `index.ts`, alongside `await loadMasterKey()`, add
`await checkD2lVersionCompatibility()`: for each host in `SCHOOL_HOSTS` and each product
(`le`, `lp`), call `GET https://{host}/d2l/api/(productCode)/versions/(version)`. Valence
documents this whole route family (`/d2l/api/versions/`, `/d2l/api/(productCode)/versions/`,
`/d2l/api/(productCode)/versions/(version)`) as callable anonymously — "You can make all of
these calls anonymously" — confirmed directly against the docs during design, not assumed, so
the check needs no session cookie and can run once at process boot rather than per connected
token. The per-product-and-version form returns a `SupportedVersion` block directly indicating
support, avoiding a manual list-membership check against the broader `/versions/` response. On
a missing version,
throw synchronously so the process never reaches `app.listen` — same fail-fast shape
`loadMasterKey()` already establishes. On an unreachable host, throw a distinctly-worded error
(see spec scenario "version check cannot reach a tenant") so an ops person can tell "D2L is down"
from "D2L deprecated our pinned version" from the log line alone.

**Alternative considered (rejected per your answer):** dynamic per-request negotiation against
`/d2l/api/versions/`. Rejected because this is an unofficial, cookie-based integration with no
support contract with D2L — a response shape silently shifting under an already-fragile
integration is a worse failure mode than a loud, deploy-time-only startup failure.

### 6. Tool annotations + audit logging for the broader surface

Every D2L tool registration (existing, curated-new, generic, discovery) adds MCP tool
annotations `{ readOnlyHint: true, destructiveHint: false, openWorldHint: false }` (SDK
`@modelcontextprotocol/sdk@^1.12.0` supports `ToolAnnotations` on `registerTool`). Since
`call_d2l_operation` can reach 190 routes instead of 20, `auditLog("mcp_call", ...)` in
`index.ts` — which today only logs the JSON-RPC envelope method (`"tools/call"`), not which
tool or D2L operation — is extended to also log the tool name, and for `call_d2l_operation`
specifically, the `operation` key, so a broader read surface stays as auditable per-operation as
the curated tools already implicitly are (each curated tool's name *is* its audit trail today).

## Route Catalog Appendix

The full, concrete route catalog — every one of the 190 `GET` routes under Valence Learning
Environment (excluding `agents/*`, `locker/*`, `lti/*`, `ltiadvantage/*`), each with a proposed
operation key, category, scope, status, and a researched path/query-param shape and response
envelope (cross-checked against raw D2L documentation HTML, not just an AI-summarized fetch) —
is materialized at [`specs/d2l-route-catalog/catalog.md`](specs/d2l-route-catalog/catalog.md)
for direct inspection ahead of implementation. That file is the source `d2lRouteCatalog.ts`
(Decision 1) gets populated from; the summary below is just the roll-up. (190 corrects two
things from an earlier pass: the original "187" estimate had already undercounted Content &
Modules by one row, and research surfaced 2 more genuinely missing routes —
`le.content.topicProgress` and `le.dropbox.submissionsAll` — not present in the initial draft.)

Status breakdown, counted directly against the table: **18 routes** already back at least one
existing tool (one of those, `le.surveys.attempts`, now *also* backs the new
`get_survey_results`; several other catalog rows are shared internal plumbing behind one
existing tool, e.g. `grades/values/myGradeValues/` and `grades/values/` both back
`get_grades`/`get_class_grades`), **13 more routes** are newly promoted to curated tools (12
distinct new tools — `get_my_dropbox_submission` covers 2 rows, `get_rubrics` covers 2 rows),
and the remaining **159 routes** are catalog-only, reachable via
`call_d2l_operation`/`list_d2l_operations`. `18 + 13 + 159 = 190`.

## Risks / Trade-offs

- **[Risk]** The generic tool makes 159 previously-unreachable routes callable at once,
  widening what a compromised token or a confused agent could pull (e.g. `auditing/*`,
  `accommodations/*` — accessibility/disability data if the caller's role can see it).
  → **Mitigation**: catalog is read-only for this change (no risk of *mutation*); per-operation
  audit logging (Decision 6) makes any broad-surface pull visible after the fact; D2L's own
  permission model still gates every route server-side — the generic tool doesn't grant any
  access the caller's session didn't already have.
- **[Trade-off]** Curated tools now have an extra indirection (catalog lookup by operation key,
  then shaping) instead of one hardcoded path string. Slightly more moving parts per tool.
  → Accepted: the alternative (every curated tool *and* the catalog each hardcoding the same
  path) is exactly the duplication this change exists to remove.
- **[Trade-off]** `call_d2l_operation`'s response is raw/unshaped D2L JSON, inconsistent with
  curated tools' cleaned-up shapes. An agent using it has to understand Valence's response
  format directly.
  → Accepted as inherent to a long-tail fallback; `list_d2l_operations`' description field is
  the mitigation, and any operation that turns out to be high-value can be promoted to a
  curated (shaped) tool later without a catalog change.

## Migration Plan

1. Add the catalog module and version-check module with no wiring into `index.ts`/`mcp.ts` yet
   (dead code, type-checked, unit-testable in isolation).
2. Wire the startup version check into `index.ts` behind the existing `await loadMasterKey()`
   pattern; deploy and confirm it passes against both live tenants before proceeding (a false
   positive here would take the whole server down at boot).
3. Refactor existing curated `d2l.ts` functions to source their path templates from the catalog
   (no behavior change — covered by the `d2l-mcp-tool-surface` spec's "existing tools are
   behavior-preserving" requirement). Ship and verify before adding anything new.
4. Add the 12 new curated tools one at a time (each is independent) — for the two new
   instructor-facing tools (`get_all_final_grades`, `get_survey_results`), verify against a real
   instructor/TA-permissioned session, not just a student one — then the generic tool, then the
   discovery tool.
5. Add tool annotations across all D2L tools in one pass.
6. Update `README.md`'s tool table.

**Rollback:** every step ships as an independent, revertible commit/deploy; the version check
(step 2) is the only step with blast radius beyond "a tool is missing/misbehaving" (it can
block server startup entirely), so it gets its own verification step before anything is layered
on top.
