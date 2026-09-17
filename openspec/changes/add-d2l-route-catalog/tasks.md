# Tasks

## 1. Route catalog module

- [x] 1.1 Define the `D2lRouteDescriptor` type and catalog array shape in
      `server/control-plane/src/d2lRouteCatalog.ts` (operation, product, method, pathTemplate,
      scope, pathParams, queryParams, pagination, category, description, curatedTool) and
      verify it compiles (`npm run build` in `server/control-plane`).
- [x] 1.2 Populate the catalog with all 190 `GET` Learning Environment routes from
      `specs/d2l-route-catalog/catalog.md` (the reviewed, authoritative route list — each entry
      already has a researched path/query-param shape, response envelope, and pagination style,
      cross-checked against raw D2L documentation HTML, so this is transcription into `zod`
      schemas rather than fresh research; entries marked `inferred` in that file, e.g.
      `le.content.global.completionsForUser`, are worth a live spot-check before locking in
      their schema). Verify by counting catalog entries against that file's per-category counts
      (no route silently dropped, no non-`GET` route included, every operation key matches the
      one proposed there, and the two routes flagged there as missing from the original draft —
      `le.content.topicProgress` and `le.dropbox.submissionsAll` — are both present).
- [x] 1.3 Add a path-resolution helper (`resolveD2lPath(operation, params)`) that substitutes
      validated params into a catalog entry's `pathTemplate` and prefixes the configured
      product version, and a unit test covering: a valid substitution, an unknown operation key
      rejected without a network call, and invalid params rejected without a network call (spec
      `d2l-route-catalog` — "resolving a path from an operation key", "rejecting an unknown
      operation key").
- [x] 1.4 Add unit tests asserting the catalog contains zero entries with method other than
      `GET` and zero entries whose `pathTemplate` starts with `agents/`, `locker/`, `lti/`, or
      `ltiadvantage/` (spec `d2l-route-catalog` — "mutating route absent", "excluded route
      family absent").

## 2. D2L API version compatibility check

- [x] 2.1 Implement `checkD2lVersionCompatibility()` in
      `server/control-plane/src/d2lVersionCheck.ts`: for each host in `SCHOOL_HOSTS` and each
      product (`le`, `lp`), call `GET https://{host}/d2l/api/(productCode)/versions/(version)`
      unauthenticated with the pinned version, and throw a descriptive error naming the host
      and version on an unsupported result.
- [x] 2.2 Distinguish "tenant reachable but reports the pinned version unsupported" from
      "tenant unreachable" in the thrown error message/type, and add a unit test for each case
      using a mocked fetch (spec `d2l-route-catalog` — "a tenant no longer supports the pinned
      version", "version check cannot reach a tenant").
- [x] 2.3 Call `await checkD2lVersionCompatibility()` at module top-level in
      `server/control-plane/src/index.ts` alongside `await loadMasterKey()`, before
      `app.listen`, and verify locally that a deliberately-wrong pinned version (e.g. bump
      `LE_VERSION` to an unsupported value) makes the server fail to start with a clear error.
      Verified both directions locally: booted the real server process (`MASTER_KEY_BASE64` env
      var bypasses AWS Secrets Manager for local dev) against the live `lms.polite.edu.sg` /
      `nyplms.polite.edu.sg` hosts — with the correct pin it reached `app.listen` and `/healthz`
      responded; with `LE_VERSION` deliberately set to a nonexistent version it threw
      `VersionUnsupportedError` and exited before binding the port. Reverted the deliberate
      breakage afterward; full suite (19/19) still passes.
- [ ] 2.4 Deploy to the live server and confirm in logs that the check passes against both
      `lms.polite.edu.sg` and `nyplms.polite.edu.sg` with the current pinned versions before
      proceeding to section 3. **Not done by the assistant — no AWS/SSM credentials available in
      this environment to reach the EC2 instance (see deploy/README.md). The local boot test in
      2.3 already exercised the identical check against both real hosts as a strong proxy; you
      still need to run the actual deploy (`git pull && docker compose up -d --build` per
      deploy/README.md) and confirm the container logs show a clean boot before/while relying on
      this in production.

## 3. Refactor existing tools onto the catalog (no behavior change)

- [x] 3.1 Update each existing `d2l.ts` function (`getCourseContent`, `getGrades`,
      `getClassGrades`, `getAnnouncements`, `getCalendarEvents`, `getAssignments`,
      `getDropboxSubmissions`, `listQuizzes`, `getQuizAttempts`, `getQuizResults`,
      `listDiscussionForums`, `listDiscussionTopics`, `listDiscussionPosts`, `getClasslist`,
      `listSurveys`, `getSurveyAttempts`, `getDueItems`) to resolve its path via
      `resolveD2lPath(operation, ...)` instead of an inline template literal, keeping every
      function's inputs/outputs unchanged. `listCourses`/`getGroups`/`whoami` deliberately left
      untouched — they're LP-product routes, out of scope for this LE-only catalog. Found and
      fixed one pre-existing inaccuracy while cross-referencing `catalog.md` against the real
      `getClassGrades` implementation: it was misattributed to `le.grades.valuesForItem`
      (per-item) when the code actually calls the bulk `le.grades.valuesAll`
      (`{orgUnitId}/grades/values/`) — corrected the catalog entry's status and `curatedTools`
      tag to match.
- [x] 3.2 Run the existing tool surface against a real connected session (or recorded
      fixtures) for at least one tool per category touched in 3.1 and confirm byte-for-byte
      identical response shape to before the refactor (spec `d2l-mcp-tool-surface` — "existing
      tools are behavior-preserving"). Two independent checks, both passing: (1) a pinned
      regression test suite (`d2lRefactorPaths.test.ts`) asserting `resolveD2lPath`/
      `resolveD2lQuery` reproduce the exact original hardcoded path/query strings for every
      refactored function; (2) a live snapshot against the currently-deployed (pre-refactor)
      server using the provided token, covering `get_course_content`, `get_grades`,
      `get_calendar_events`, `get_classlist`, `get_announcements`, `get_quizzes`, `get_surveys`,
      and `get_discussion_forums` against a real course (`nyp:524042`) — the real response field
      names (e.g. classlist's `Pronouns`, discussion forums' `AllowAnonymous`/`IsLocked`) matched
      `catalog.md`'s researched shapes exactly, which is corroborating evidence for the catalog
      itself, not just this refactor.
- [ ] 3.3 Deploy and verify `get_grades`, `get_class_grades`, `get_course_content`, and
      `get_classlist` against the live server with a real token before proceeding to section 4.
      **Not done by the assistant — requires deploying this change's code, which needs AWS/SSM
      access this environment doesn't have (see note on 2.4). The (1) and (2) checks under 3.2
      are the strongest verification available without a deploy; still recommend this exact
      live re-check once you deploy, since it's the only way to confirm the *refactored* code
      path (not just its request-path generation) behaves identically end-to-end.

## 4. New curated tools

- [x] 4.1 Add `get_rubrics(courseId, rubricId?)` wrapping `rubrics/` /
      `rubrics/{rubricId}`, registered in `mcp.ts`, and verify it returns rubric
      name/status (list) or full criteria/levels (single rubric) for a real course.
      **Deviation from the plan** (see the note at the end of this section): D2L has no
      "all rubrics in a course" route — listing requires `objectType`+`objectId` (the gradable
      object the rubric is attached to). Signature became
      `get_rubrics(courseId, rubricId?, objectType?, objectId?)`, documented in the tool
      description. Verified locally with mocked `fetch` (both modes, plus the
      neither-given-throws-with-no-network-call case) — not against a real course.
- [x] 4.2 Add `get_my_final_grade(courseId)` wrapping `grades/final/values/myGradeValue` and
      verify it returns the caller's own calculated final grade, distinct from `get_grades`'s
      per-item output. Implemented as-is; not verified against a real course (see section note).
- [x] 4.3 Add `get_all_final_grades(courseId)` wrapping `grades/final/values/`, joined against
      `getClasslist` for student names like `getClassGrades` already does, and verify: (a) it
      returns every enrolled student's final grade for an instructor/TA-permissioned session,
      and (b) a student-permissioned session gets a `PermissionDeniedError` result, not empty or
      partial data. **Deviation**: the route's response embeds a full `User` block per entry, so
      no separate `getClasslist` join is needed or done — simpler than planned, same output
      shape. (a)/(b) need a real instructor session to verify; not done (see section note).
- [x] 4.4 Add `get_my_dropbox_submission(courseId, folderId)` wrapping
      `submissions/mysubmissions/` and `feedback/{entityType}/{entityId}`, and verify it
      returns the caller's own submission files/dates and score/feedback for a folder they
      submitted to. **Deviation**: `submissions/mysubmissions/` already embeds `Feedback` per
      entry, so the separate `feedback/{entityType}/{entityId}` call is unnecessary — dropped it,
      one API call instead of two, same output. Verified with mocked `fetch`; not against a real
      submission.
- [x] 4.5 Add `get_survey_results(courseId, surveyId, studentUserId?)` wrapping
      `surveys/{surveyId}/attempts/` under the class-wide/instructor permission (mirroring
      `getQuizResults`'s use of the equivalent quiz route), joined against `getClasslist` for
      student names, and verify: (a) it returns every student's survey attempts for an
      instructor/TA-permissioned session, (b) the optional `studentUserId` filter scopes to one
      student, and (c) a student-permissioned session gets a `PermissionDeniedError` result.
      Implemented exactly as planned; (b) verified with mocked `fetch`, (a)/(c) need a real
      instructor session (see section note).
- [x] 4.6 Add `get_quiz_questions(courseId, quizId)` wrapping `quizzes/{quizId}/questions/`
      and verify it lists questions for a quiz the caller has access to. Implemented as-is; not
      verified against a real quiz.
- [x] 4.7 Add `get_survey_questions(courseId, surveyId)` wrapping
      `surveys/{surveyId}/questions/` and verify it lists questions for a survey. Implemented
      as-is; not verified against a real survey.
- [x] 4.8 Add `get_course_overview(courseId)` wrapping `overview` and verify it returns the
      course description/overview content for a real course. Implemented as-is; not verified
      against a real course.
- [x] 4.9 Add `get_content_topic(courseId, topicId)` wrapping `content/topics/{topicId}` and
      verify it returns single-topic metadata for a topic id obtained from
      `get_course_content`. Implemented as-is; not verified against a real topic.
- [x] 4.10 Add `get_my_calendar_events()` wrapping cross-org `calendar/events/myEvents/`,
      fanned out across connected schools like `get_due_items`, and verify it returns events
      across every connected course/school in one call. **Deviation**: this route requires
      `orgUnitIdsCSV` plus a `startDateTime`/`endDateTime` window (all non-optional) — a truly
      unbounded query isn't meaningful for a calendar anyway. Tool gained optional `startDate`/
      `endDate` params (default: 7 days ago to 60 days ahead); `orgUnitIdsCSV` is built
      internally per school via `listCourses`. Verified with mocked `fetch`, including the
      no-enrolled-courses short-circuit; not against real calendar data.
- [x] 4.11 Add `get_overdue_items()` wrapping cross-org `overdueItems/myItems`, fanned out like
      `get_due_items`, and verify its output differs from `get_due_items` by excluding
      not-yet-due pending items. Implemented as-is (`orgUnitIdsCSV` genuinely optional here, no
      CSV-building needed); the two tools' *field-level* output difference was verified logically
      (different D2L routes, different filtering) but not spot-checked side by side on a real
      overdue item.
- [x] 4.12 Add `get_recent_updates()` wrapping cross-org `updates/myUpdates/`, fanned out like
      `get_due_items`, and verify it returns a cross-course activity feed. Same `orgUnitIdsCSV`
      deviation as 4.10 — built internally via `listCourses` per school, no user-facing params
      needed since there's no natural date-range equivalent for "unread counts". Verified with
      mocked `fetch`; not against real update-count data.

**Section 4 verification note**: every tool above compiles, is registered, and has a passing
unit test against mocked `fetch` covering its request-shape and response-mapping logic
(`d2lNewTools.test.ts`) — the strongest verification possible without a deployed instance and a
real D2L session (see the note on 2.4/3.3: no AWS/SSM access in this environment). Recommend
exercising each tool once against a real course/instructor session after deploying, per each
subtask's original "verify..." clause.
- [x] 4.13 Update `README.md`'s D2L tool table with all 12 new tools, placing
      `get_all_final_grades` and `get_survey_results` under the existing "instructor/TA only"
      section alongside `get_class_grades`/`get_quiz_results`/`get_dropbox_submissions`, and the
      rest under the student-facing section.

## 5. Generic and discovery tools

- [x] 5.1 Implement `call_d2l_operation` in `mcp.ts`: `operation` (catalog key, validated by
      lookup rather than an inline `z.enum` — the operation set is too large/dynamic to hardcode
      into the input schema — with an explicit "unknown operation" error result on a miss),
      optional `courseId`, optional `params`; validates `operation` against the catalog and
      `params` against that operation's schema before any network call, resolves `courseId` the
      same way `runForD2LCourse` does (never trusting a caller-supplied `orgUnitId` over the
      one derived from `courseId`), and dispatches through `apiGet`/`fetchAllPages` per the
      catalog's declared pagination style. **Deviations**: (a) split the plan's single `params`
      into `pathParams` + `queryParams` — the catalog validates path and query params against
      two separate zod schemas, so a merged bag would need its own disambiguation logic for no
      real benefit; (b) added a `school` param, required for operations whose `scope` is
      `"global"`/`"user"` (no `courseId` to derive a tenant from — `list_courses`/`get_groups`/
      `whoami` show these operations exist and need a school picked some other way); (c) also
      added `fetchAllBookmarkPages` (Api.PagedResultSet, distinct from the existing
      `fetchAllPages`'s ObjectListPage convention) since ~20 catalog routes use it and nothing
      previously needed it — dispatch now covers all three declared pagination styles
      (`none`/`objectList`/`bookmark`), plus an explicit rejection for `binary` operations (file
      bytes can't be returned as MCP text content).
- [x] 5.2 Add tests: valid operation+params succeeds; unknown operation key is rejected with no
      network call; invalid params (e.g. non-numeric id) rejected with no network call; a
      course-scoped operation cannot be pointed at an `orgUnitId` other than the one implied by
      `courseId` (spec `d2l-mcp-tool-surface` — "generic tool invokes a cataloged operation",
      "generic tool rejects an operation not in the catalog", "generic tool rejects invalid
      parameters"). `d2lGenericTool.test.ts`, all passing, also covers `objectList`/`bookmark`
      pagination follow-through and the binary-rejection path. Writing the bookmark-pagination
      test caught a real bug: `le.ccb.logs` was misclassified `objectList` when its own declared
      `bookmark` query param means it's really `bookmark` (`Api.PagedResultSet`) — fixed in the
      catalog (both `d2lRouteCatalog.ts` and `catalog.md`); see that file's Corrections section
      for a related unresolved ambiguity across several `*/access/` routes this didn't fully
      settle.
- [x] 5.3 Implement `list_d2l_operations(category?, query?)` in `mcp.ts` returning matching
      catalog entries' operation key, category, description, and required params, and verify a
      category filter (e.g. `"rubrics"`) returns only matching entries (spec
      `d2l-mcp-tool-surface` — "discovering operations by category"). Rubrics live under the
      `assessment-rubrics` category (matching `catalog.md`'s "Assessment & Rubrics" section);
      verified `category: "checklists"` returns exactly its 6 entries and a keyword search for
      `"rubric"` matches all 3 assessment/rubric operations, via a direct smoke test against the
      compiled catalog (not through the MCP tool-call layer itself, which is a thin wrapper over
      the same filter logic).
- [ ] 5.4 Deploy and manually exercise `call_d2l_operation` against at least one catalog-only
      route from each of 3 different categories (e.g. `checklists`, `auditing`,
      `learning-outcomes`) with a real token, confirming each returns real D2L data. **Not done
      by the assistant — no deploy access (see 2.4/3.3).** `d2lGenericTool.test.ts`'s mocked-fetch
      coverage is the substitute; this is the one task in the whole change most worth doing
      yourself once deployed, since it's the only check that exercises genuinely new,
      previously-unreachable D2L routes end to end — recommend picking one route per category
      from `catalog.md` rather than skipping straight to "looks fine."
- [x] 5.5 Add a short `README.md` section explaining `list_d2l_operations` /
      `call_d2l_operation` as the long-tail escape hatch, pointing at the curated tools first.

## 6. Tool annotations and audit logging

- [x] 6.1 Add `{ readOnlyHint: true, destructiveHint: false, openWorldHint: false }` annotations
      to every D2L tool registration in `mcp.ts` (existing, new curated, generic, discovery) and
      verify via an MCP client's tool listing that the annotations are present (spec
      `d2l-mcp-tool-surface` — "annotation present on a new tool"). Extended to all 40 tools
      (including STEP and `search_politemall_catalog`, matching `proposal.md`'s broader "every
      D2L/STEP tool" framing) — the 26 pre-existing tools were missing it entirely and got it
      inserted programmatically (mechanical transform, not hand-edited one by one, to avoid
      transcription errors across 26 near-identical edits). Verified for real, not just by
      inspecting source: `mcp.annotations.test.ts` spins up an actual `McpServer` +
      `Client` over the SDK's in-memory transport, calls `listTools()`, and asserts
      `readOnlyHint: true`/`destructiveHint: false` on all 40 returned tools — passing.
- [x] 6.2 Extend the `auditLog("mcp_call", ...)` call site in `index.ts` (or the tool dispatch
      path) to include the tool name, and for `call_d2l_operation` specifically the `operation`
      key, then verify by grepping a local run's log output for a `call_d2l_operation` call and
      confirming the operation key appears. Verified against a real running local instance (not
      just a unit test): booted the server, issued a token via `/signup`, connected a real MCP
      client, called `call_d2l_operation` with `operation: "le.checklists.list"`, and confirmed
      the log line reads `{"event":"mcp_call","method":"tools/call","tool":"call_d2l_operation","operation":"le.checklists.list",...}`
      — exactly as designed. (The tool call itself correctly errored with "session isn't
      connected," as expected with no real D2L cookie on a throwaway local token — irrelevant to
      what this task verifies, since the audit line is written before D2L dispatch.)

## 7. Final verification

- [x] 7.1 Run the full existing test suite plus new tests from sections 1-6 and confirm all
      pass (`npm run build` / test command in `server/control-plane`). 47/47 passing
      (`npm test`, which runs `npm run build` first via `pretest`).
- [x] 7.2 Confirm total registered MCP tool count is 34 (20 existing + 12 new curated +
      `call_d2l_operation` + `list_d2l_operations`) via a live tool-list call. **Correction**:
      "34" only ever counted the D2L-Brightspace-specific tools (proposal.md's "20 D2L tools"
      explicitly excludes the 5 STEP tools and `search_politemall_catalog`) — the actual total
      registered tool count, all systems included, is **40** (26 pre-existing + 14 new), which
      is what a real tool-list call returns and is what `mcp.annotations.test.ts` asserts
      (`assert.equal(tools.length, 40, ...)`, passing) via a genuine MCP client `listTools()`
      call over the SDK's in-memory transport.
- [x] 7.3 Re-read `README.md` end to end and confirm the tool table, architecture section, and
      any version/deployment notes are consistent with the shipped change. Root `README.md`'s
      tool table, "Security notes" (still accurate — audit logging never includes the raw token
      or cookie, only now also the tool/operation name), and "Architecture" directory tree all
      check out with no further changes needed. `server/README.md` just redirects, nothing to
      update. Added the one thing that was missing: a note in `deploy/README.md` about the new
      startup version-compatibility check, since that's a genuine new way a redeploy can fail
      that whoever operates the live server needs to know to interpret correctly.
