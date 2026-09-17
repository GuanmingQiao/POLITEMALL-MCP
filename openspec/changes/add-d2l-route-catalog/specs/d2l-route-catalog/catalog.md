# D2L Learning Environment Route Catalog (for inspection)

This is the concrete, exhaustive catalog `server/control-plane/src/d2lRouteCatalog.ts` gets
populated from (task 1.2 in `tasks.md`) — every `GET` route documented under Valence's
Learning Environment (LE) product, excluding `agents/*`, `locker/*`, `lti/*`, and
`ltiadvantage/*`, sourced directly from
[the Valence HTTP routing table](https://docs.valence.desire2learn.com/http-routingtable.html)
and cross-checked against each route's own resource documentation page (raw HTML, not just
AI-summarized fetches — see **Research methodology** below). Paths are relative to
`/d2l/api/le/{version}`; every method is `GET` (no write routes are in scope for this change —
see `proposal.md`).

**190 routes total.** This corrects two things from the first draft of this file: the original
count of "187" already undercounted by one (Content & Modules was tallied as 20 rows when the
file actually listed 21), and this research pass found 2 more genuinely new routes that weren't
in the original draft at all (`le.content.topicProgress`, `le.dropbox.submissionsAll` — see
**Corrections & additions** below).

## Columns

- **Operation key** — the proposed stable catalog key (`le.<category>.<action>`, or
  `le.<category>.global.<action>` for a cross-org/cross-course route).
- **Path** — relative to `/d2l/api/le/{version}`.
- **Scope** — `course` (needs `{orgUnitId}`, resolved from `courseId`), `user` (personal,
  cross-course, no `{orgUnitId}` in the path), or `global` (no `{orgUnitId}` and not
  caller-personal either — typically admin/auditor-facing).
- **Status** — `existing` (an already-shipped tool uses this route), `new curated` (this
  change adds a dedicated tool for it — tool name in parentheses), or `catalog-only`
  (reachable only via `call_d2l_operation`/`list_d2l_operations` after this change).
- **Path params** — path placeholders and their D2L type. `orgUnitId` is marked
  "auto-derived" wherever the scope is `course`: the generic tool resolves it from the
  caller's `courseId`, never from a caller-supplied value (see `design.md` Decision 3) — it is
  not a parameter the catalog schema should accept directly from a tool caller.
- **Query params** — optional/required query parameters with type and meaning; "none
  documented" where D2L's docs list none.
- **Response envelope** — one of:
  - `object` — a single JSON block
  - `objectListPage` — Valence's `Api.ObjectListPage` convention: `{ Next, Objects }`
  - `bookmarkPaged` — Valence's `Api.PagedResultSet` convention: `{ PagingInfo: { Bookmark, HasMoreItems }, Items }`
  - `bareArray` — a plain JSON array, no paging envelope
  - `binary` — non-JSON file content
- **Response block** — the D2L JSON block name (where documented) and its top-level fields.
  Repeated/nested composite types are named but not always fully expanded.
- **Confidence** — `verified` (path/params/fields confirmed against raw HTML, not just an
  AI-summarized fetch) or `inferred` (best-effort from sibling routes or partial docs — flagged
  explicitly with why, and worth a spot-check before finalizing that entry's zod schema).

## Research methodology

Six research passes covered all 26 categories in parallel, each required to (a) re-derive its
route list from the live routing table rather than trust the seed list handed to it, and (b)
verify path/param/field details against raw HTML (`curl` + parsing `id="get--..."` anchors and
`<dt>`/`<code>` blocks), not solely an AI-summarized `WebFetch` call — a mid-task check caught
`WebFetch` hallucinating invented path segments on more than one occasion (e.g. a phantom
`topics/{topicId}/exemptions/` in place of the real `topics/{topicId}/exemption`), so every
entry below was produced or re-checked against raw source. Entries marked `inferred` are the
exception: cases where even the raw doc page was ambiguous, incomplete, or (in one case)
genuinely never returned by the fetch tool across five attempts.

## Corrections & additions since the first draft

1. **New route — `le.content.topicProgress`**: `GET {orgUnitId}/content/userprogress/{topicId}`
   (single-topic, single-user progress; distinct from the already-cataloged
   `le.content.userProgress`, which lists progress across all topics/users you have access to).
   Missing from the original draft; confirmed present and correctly typed against
   `res/content.html`.
2. **New route — `le.dropbox.submissionsAll`**: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/`
   (the **unpaged** submissions list). D2L's own docs actively discourage this route for
   folders with many submissions and recommend `le.dropbox.submissionsPaged` instead — kept in
   the catalog for completeness (it's a real GET route, matching this change's "mirror every
   route" scope) but flagged with that caution; **not** used internally by the existing
   `get_dropbox_submissions` tool, which already uses the paged route.
3. **Independently re-confirmed, not new** — three routes were researched twice by different
   batches (their doc pages overlapped two assigned categories) and came back consistent both
   times, which is useful cross-validation rather than a gap:
   - The three Auditing routes (`le.auditing.auditeeGet`/`auditorGet`/`auditeesForAuditor`) —
     confirmed by both the Discussions/Classlist batch and the CPD/Auditing batch.
   - `le.dropbox.global.orgUnitsFeedback` — confirmed by both the Content/Checklists batch and
     the Dropbox/Calendar batch.
   - `le.news.global.forUser` — confirmed by both the Quizzes/Surveys/News batch and the
     CPD/Auditing/Cross-Org batch.
4. **Scope correction**: the three Auditing routes and `le.dropbox.global.orgUnitsFeedback` have
   **no `{orgUnitId}` in the path at all** — not just "auto-derived," genuinely absent. Their
   catalog `scope` is `global` with zero path-param injection from `courseId`, unlike every
   other `global`/`user` route in this file, which at least takes a `userId` or CSV of org unit
   IDs. Flagging because it's the one place the catalog schema needs a third real shape, not
   just "course vs. not-course."
5. **Envelope note**: `le.news.access` is `objectListPage`, not `bookmarkPaged` — one research
   pass initially mis-tagged it via a summarized fetch and self-corrected against the raw HTML
   anchor (`Api.ObjectListPage`, not `Api.PagedResultSet`), despite return-text prose that
   loosely mentions "bookmark."
6. **Doc-quality flags to carry into the zod schemas, not fix** (these are genuine
   inconsistencies in D2L's own documentation, not extraction errors):
   - `le.import.importLogs`'s path literally uses lowercase `orgUnitid` in both the routing
     table and its resource doc — the same org-unit id, auto-derived from `courseId` as usual,
     just an inconsistent capitalization in D2L's own source.
   - `le.grades.statistics`'s `gradeObjectId` path param is documented with no type link
     (every sibling route types it `D2LID`) — treat as `D2LID` by inference, not fact.
   - `le.grades.definitionAccess`'s prose mentions a `bookmark` parameter that isn't listed in
     its own formal Query Parameters table (`bookmark` *is* formally listed on the sibling
     `courseCompletionList` route) — likely copy-paste boilerplate; treat as
     likely-supported-but-undocumented.
   - **Cross-route envelope ambiguity, not fully resolved**: several structurally-identical
     `*/access/` routes across different resources (`le.discussions.forumAccess`,
     `le.grades.definitionAccess`, `le.dropbox.folderAccess`, `le.calendar.eventAccess`) all
     return the same `Access.UserAccess` block behind the same ambiguous "object list page ...
     for the segment following your bookmark parameter" prose — but different research passes
     classified different ones as `objectListPage` (verified) vs. `bookmarkPaged` (inferred),
     and a single raw-HTML href check (done for `le.news.access` specifically, which turned out
     genuinely `objectListPage` despite similar prose) isn't enough evidence to resolve the
     other four confidently either way. `le.ccb.logs` (see below) turned out to be a real bug
     from this exact ambiguity, caught by a failing unit test — the `*/access/` routes carry the
     same latent risk since none of them back a curated tool (so nothing currently exercises
     them) and would only surface if `call_d2l_operation` is used against one with more than one
     page of results. Left as originally classified rather than guessed differently; worth a
     deliberate raw-HTML recheck before removing this note.
7. **Out of scope, found in passing — LP-namespace org-structure routes**: the research pass
   for "Course Structure & Org Units" found that `le.ccb.logs` (course-copy job logs) is the
   *only* real `/d2l/api/le/` route matching that category name — the actual org-unit hierarchy
   API (`orgstructure/*`, `organization/*`, `outypes/*`, 18 more `GET` routes) lives entirely
   under the **`lp` (Learning Platform)** product at `/d2l/api/lp/`, documented on
   `res/orgunit.html`. Per `design.md`'s explicit Non-Goal ("No LP-product catalog population"),
   these are **not** added to the 190-route count or the catalog below — listed in the
   **LP-namespace routes found (out of scope)** appendix at the end of this file so a future
   change populating LP routes doesn't have to re-discover them.
8. **Status-count correction**: the original draft's "27 existing, 15 new curated (12 tools),
   145 catalog-only" summary was an unverified estimate, not counted against the actual table.
   The real breakdown, counted directly from the table below: **18 routes back at least one
   pre-existing tool** (one of those, `le.surveys.attempts`, now *also* backs a new curated
   tool), **13 more routes are newly promoted to curated tools** (12 distinct new tools — two
   of them, `get_my_dropbox_submission` and `get_all_final_grades`/`get_my_final_grade` split
   across routes as shown in the table), and **159 routes are catalog-only**.
   `18 + 13 + 159 = 190`.

---

## Assessment & Rubrics

### le.assessment.get
- Method/Path: `GET {orgUnitId}/assessment`
- Description: Retrieve a rubric-based assessment (evaluation outcome) for a specific object and user in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `assessmentType` (ASSESSMENT_T, required); `objectType` (EVAL_T, required, e.g. "Discussion"); `objectId` (D2LID, required); `rubricId` (D2LID, required); `userId` (D2LID, required)
- Response envelope: `object`
- Response block: `Rubric.RubricAssessment` — RubricId (D2LID), UserId (D2LID), ObjectType (string), ObjectId (D2LID), OverallOutcome (composite: LevelId, Score, ScoreIsOverridden, Feedback, FeedbackIsOverridden, AssessorId, AutoCalculate), CriteriaOutcome (array of criterion outcome composites)
- Source: `res/assessment.html`
- Confidence: verified
- Status: **catalog-only**

### le.rubrics.list
- Method/Path: `GET {orgUnitId}/rubrics/`
- Description: Retrieve all rubrics that apply to a specified object in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `objectType` (EVAL_T, required, e.g. "Discussion"); `objectId` (D2LID, required)
- Response envelope: `bareArray`
- Response block: `Rubric.Rubric` — RubricId (D2LID), Name (string), Description (RichText), RubricType (RUBRIC_T: 0=Holistic,1=Analytic), RubricStateId (0=Published,1=Archived,2=Draft), ScoringMethod (0=TextOnly,1=Points,2=TextAndNumeric,3=CustomPoints), Visibility (0=AlwaysVisible,1=VisibleOnceFeedbackPosted,2=NeverVisible), IsScoreVisibleToAssessedUsers (bool), ReverseLevelDisplayOrder (bool), CriteriaGroups (array), OverallLevels (array)
- Source: `res/assessment.html`
- Confidence: verified
- Status: **new curated** (`get_rubrics`)

### le.rubrics.get
- Method/Path: `GET {orgUnitId}/rubrics/{rubricId}`
- Description: Retrieve a single rubric by ID.
- Path params: `orgUnitId` (D2LID, auto-derived), `rubricId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Rubric.Rubric` (same as `le.rubrics.list`)
- Source: `res/assessment.html`
- Confidence: verified
- Status: **new curated** (`get_rubrics`)

## Calendar & Events (course-scoped)

### le.calendar.eventGet
- Method/Path: `GET {orgUnitId}/calendar/event/{eventId}`
- Description: Retrieve a calendar event from a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `eventId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Calendar.EventDataInfo` — CalendarEventId, OrgUnitId, Title, Description, StartDateTime/EndDateTime (UTCDateTime|null), IsAllDayEvent, StartDay/EndDay (LocalDateTime|null), GroupId, IsRecurring, RecurrenceInfo (composite), LocationId, LocationName, OrgUnitName, OrgUnitCode, IsAssociatedWithEntity, AssociatedEntity (composite), HasVisibilityRestrictions, VisibilityRestrictions (composite), CalendarEventViewUrl, EventType (v1.94+), Presenters (array)
- Source: `res/calendar.html`
- Confidence: verified
- Status: **catalog-only**

### le.calendar.eventAccess
- Method/Path: `GET {orgUnitId}/calendar/event/{eventId}/access/`
- Description: Retrieve the list of users with access to a specified calendar event.
- Path params: `orgUnitId` (D2LID, auto-derived), `eventId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional); `bookmark` (string, optional — implied by return text, not in the formal Query Parameters table)
- Response envelope: `bookmarkPaged`
- Response block: `Access.UserAccess` (fields defined on `res/apiprop.html`, not detailed on this page)
- Source: `res/calendar.html`
- Confidence: inferred (envelope classified from "segment following bookmark" return-text phrasing, same ambiguity as `le.dropbox.folderAccess`)
- Status: **catalog-only**

### le.calendar.eventOccurrences
- Method/Path: `GET {orgUnitId}/calendar/event/{eventId}/occurrences`
- Description: Retrieve a calendar event's occurrences.
- Path params: `orgUnitId` (D2LID, auto-derived), `eventId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Calendar.EventWithOccurrencesInfo` — EventDataInfo (composite), Occurrences (array of Calendar.OccurrenceInfo)
- Source: `res/calendar.html`
- Confidence: verified (route first appears API v1.94+)
- Status: **catalog-only**

### le.calendar.list
- Method/Path: `GET {orgUnitId}/calendar/events/`
- Description: Retrieve all calendar events for the calling user within the provided org unit context.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `associatedEventsOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Calendar.EventDataInfo` (array; see `le.calendar.eventGet`)
- Source: `res/calendar.html`
- Confidence: verified
- Status: **existing** (`get_calendar_events`)

### le.calendar.itemCountForUser
- Method/Path: `GET {orgUnitId}/calendar/events/{userId}/itemCount`
- Description: Retrieve a filtered count of a user's calendar events within one org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: `association` (ASSOCIATION_T, optional, default Any); `eventType` (EVENTTYPE_T, optional); `startDateTime` (UTCDateTime, inclusive); `endDateTime` (UTCDateTime, exclusive)
- Response envelope: `object`
- Response block: `Calendar.EventCountInfo` — OrgUnitId, UserId, EventCount
- Source: `res/calendar.html`
- Confidence: inferred for start/endDateTime required-ness (Input text lists only association/eventType as "optional"); route first appears v1.94+
- Status: **catalog-only**

### le.calendar.myEvents
- Method/Path: `GET {orgUnitId}/calendar/events/myEvents/`
- Description: Retrieve the calling user's events for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `association` (ASSOCIATION_T, optional); `eventType` (EVENTTYPE_T, optional); `startDateTime`/`endDateTime` (UTCDateTime, optional filters)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventDataInfo`
- Source: `res/calendar.html`
- Confidence: verified
- Status: **catalog-only**

### le.calendar.myEventsItemCount
- Method/Path: `GET {orgUnitId}/calendar/events/myEvents/itemCount`
- Description: Retrieve a count of the calling user's calendar events within the org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `association`/`eventType` (optional); `startDateTime`/`endDateTime` (optional)
- Response envelope: `object`
- Response block: `Calendar.EventCountInfo`
- Source: `res/calendar.html`
- Confidence: verified
- Status: **catalog-only**

### le.calendar.occurrences
- Method/Path: `GET {orgUnitId}/calendar/events/occurrences/`
- Description: Retrieve all calendar event occurrences for the calling user within the org unit, in a required time window.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `association`/`eventType` (optional); `startDateTime` (UTCDateTime, required, inclusive); `endDateTime` (UTCDateTime, required, exclusive)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventWithOccurrencesInfo`
- Source: `res/calendar.html`
- Confidence: verified (v1.94+)
- Status: **catalog-only**

### le.calendar.orgUnits
- Method/Path: `GET {orgUnitId}/calendar/events/orgunits/`
- Description: Retrieve all calendar events for the calling user across a provided set of org units.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `orgUnitIdsCSV` (CSV of D2LID, required); `startDateTime`/`endDateTime` (UTCDateTime, required); `bookmark` (string, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Calendar.EventDataInfo`
- Source: `res/calendar.html`
- Confidence: verified (`bookmark` formally listed for this route, unlike the "access" routes)
- Status: **catalog-only**

### le.calendar.userEvents
- Method/Path: `GET {orgUnitId}/calendar/events/user/`
- Description: Retrieve all calendar events for a specified user's explicit enrollments within the organization containing the given org unit. Requires calendar-management permission in that org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `userId` (D2LID, required); `startDateTime`/`endDateTime` (UTCDateTime, required); `bookmark` (string, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Calendar.EventDataInfo`
- Source: `res/calendar.html`
- Confidence: verified
- Status: **catalog-only**

## Checklists

### le.checklists.list
- Method/Path: `GET {orgUnitId}/checklists/`
- Description: Retrieve all checklists belonging to an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Checklist.ChecklistReadData` — Id (D2LID), Name (string), Description (RichText)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

### le.checklists.get
- Method/Path: `GET {orgUnitId}/checklists/{checklistId}`
- Description: Retrieve a specific checklist belonging to an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `checklistId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Checklist.ChecklistReadData` (same as list)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

### le.checklists.categoriesList
- Method/Path: `GET {orgUnitId}/checklists/{checklistId}/categories/`
- Description: Retrieve all categories belonging to a checklist.
- Path params: `orgUnitId` (D2LID, auto-derived), `checklistId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Checklist.ChecklistCategoryReadData` — CategoryId (D2LID), Name (string), Description (RichText), SortOrder (number, ≥1)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

### le.checklists.categoryGet
- Method/Path: `GET {orgUnitId}/checklists/{checklistId}/categories/{categoryId}`
- Description: Retrieve a specific category belonging to a checklist.
- Path params: `orgUnitId` (D2LID, auto-derived), `checklistId` (D2LID), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Checklist.ChecklistCategoryReadData` (same as list)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

### le.checklists.itemsList
- Method/Path: `GET {orgUnitId}/checklists/{checklistId}/items/`
- Description: Retrieve all items belonging to a checklist.
- Path params: `orgUnitId` (D2LID, auto-derived), `checklistId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Checklist.ChecklistItemReadData` — ChecklistItemId (D2LID), CategoryId (D2LID), ChecklistId (D2LID), Name (string), Description (RichText), SortOrder (number, ≥1), DueDate (UTCDateTime|null, optional)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

### le.checklists.itemGet
- Method/Path: `GET {orgUnitId}/checklists/{checklistId}/items/{checklistItemId}`
- Description: Retrieve a specific item belonging to a checklist.
- Path params: `orgUnitId` (D2LID, auto-derived), `checklistId` (D2LID), `checklistItemId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Checklist.ChecklistItemReadData` (same as list)
- Source: `res/checklist.html`
- Confidence: verified
- Status: **catalog-only**

## Content & Modules

### le.content.bookmarks
- Method/Path: `GET {orgUnitId}/content/bookmarks`
- Description: Retrieve a list of topics that have been bookmarked by the calling user.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `ToC.Topic` — TopicId (D2LID), Identifier (D2LID string), TypeIdentifier (string), Title (string), Bookmarked (bool), Unread (bool), Url (string), SortOrder (number), StartDateTime (UTCDateTime|null), plus EndDateTime/DueDate/IsHidden/IsLocked/LastModifiedDate (not fully enumerated, nested composite)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.completionsList
- Method/Path: `GET {orgUnitId}/content/completions/`
- Description: Retrieve the count of completed and required content topics in an org unit for each user in a supplied CSV list.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `userIdsCSV` (CSV of D2LID, required, ≤100); `ignoreInvalid` (bool, optional — silently drops unauthorized/nonexistent ids)
- Response envelope: `bareArray`
- Response block: `ContentCompletions.ContentLearnerProgress` — UserId (D2LID string), OrgUnitId (D2LID string), RequiredItems (number), CompletedItems (number)
- Source: `res/content.html`
- Confidence: inferred for envelope (docs' phrasing doesn't say "ObjectListPage" the way sibling paged routes do; classified `bareArray` on that basis — worth a spot-check against a live response)
- Status: **catalog-only**

### le.content.completionsMyCount
- Method/Path: `GET {orgUnitId}/content/completions/mycount/`
- Description: Retrieve the aggregate count of completed and required content topics in an org unit for the calling user.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `level` (CONTENTCOMPLETIONLEVEL_T, required)
- Response envelope: `objectListPage`
- Response block: `ContentCompletions.ContentAggregateCompletion` — UserId, OrgUnitId, ObjectId, Title, RequiredItems, CompletedItems
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.moduleGet
- Method/Path: `GET {orgUnitId}/content/modules/{moduleId}`
- Description: Retrieve a specific content module for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `moduleId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Content.ContentObject` (Type=0, Module variant) — Structure (array of ContentObject), ModuleStartDate/EndDate/DueDate (UTCDateTime|null), IsHidden, IsLocked, Id, Title, ShortTitle, Color, Type, Description (RichText|null), ParentModuleId, Duration, LastModifiedDate
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.moduleAccess
- Method/Path: `GET {orgUnitId}/content/modules/{moduleId}/access/`
- Description: Retrieve the list of users with access to a specified module.
- Path params: `orgUnitId` (D2LID, auto-derived), `moduleId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess` — UserId (D2LID), HasAccess (bool)
- Source: `res/content.html` (block defined on `res/apiprop.html`)
- Confidence: verified
- Status: **catalog-only**

### le.content.moduleStructure
- Method/Path: `GET {orgUnitId}/content/modules/{moduleId}/structure/`
- Description: Retrieve the structure (child modules/topics) for a specific module.
- Path params: `orgUnitId` (D2LID, auto-derived), `moduleId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Content.ContentObject` (mixed array of Module/Topic variants)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.myItems
- Method/Path: `GET {orgUnitId}/content/myItems/`
- Description: Retrieve the calling user's scheduled content items for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `completion` (COMPLETION_T, optional); `startDateTime`/`endDateTime` (UTCDateTime, optional)
- Response envelope: `objectListPage`
- Response block: `Content.ScheduledItem` — UserId, OrgUnitId, ItemId, ItemName, ItemType, ItemUrl, StartDate/EndDate/DueDate, CompletionType, DateCompleted, ActivityType, IsExempt
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.myItemsDue
- Method/Path: `GET {orgUnitId}/content/myItems/due/`
- Description: Retrieve the calling user's scheduled items still due for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `completion`/`startDateTime`/`endDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `Content.ScheduledItem`
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.myItemsDueCount
- Method/Path: `GET {orgUnitId}/content/myItems/due/itemCount`
- Description: Retrieve the quantity of the calling user's scheduled items still due for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `completion`/`startDateTime`/`endDateTime` (optional)
- Response envelope: `object`
- Response block: `Content.ScheduledItemCount` — OrgUnitId, UserId, ItemCount
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.myItemsCount
- Method/Path: `GET {orgUnitId}/content/myItems/itemCount`
- Description: Retrieve the quantity of the calling user's scheduled items for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `completion`/`startDateTime`/`endDateTime` (optional)
- Response envelope: `object`
- Response block: `Content.ScheduledItemCount`
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.pacing
- Method/Path: `GET {orgUnitId}/content/pacing`
- Description: Retrieve pacing dates (course/semester start & end) for content.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Pacing.PacingInfo` — StartDate (ISODate|null), EndDate (ISODate|null)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.recent
- Method/Path: `GET {orgUnitId}/content/recent`
- Description: Retrieve a list of the most recently visited topics for the calling user.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `ToC.Topic` (same as `le.content.bookmarks`)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.root
- Method/Path: `GET {orgUnitId}/content/root/`
- Description: Retrieve the root module(s) for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Content.ContentObject` (Type=0 array; same fields as `le.content.moduleGet`)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.toc
- Method/Path: `GET {orgUnitId}/content/toc`
- Description: Retrieve the table of course content for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `ignoreDateRestrictions` (bool, optional); `ignoreModuleDateRestrictions` (bool, optional, superseded by the former as of v1.67); `userId` (D2LID, optional — view ToC as another user would see it); `moduleId` (D2LID, optional); `title` (string, optional)
- Response envelope: `object`
- Response block: `ToC.TableOfContents` — Modules (array of nested Module blocks: ModuleId, Title, SortOrder, StartDateTime, EndDateTime, Modules[], Topics[], IsHidden, IsLocked, PacingStartDate, PacingEndDate, DefaultPath, LastModifiedDate)
- Source: `res/content.html`
- Confidence: verified
- Status: **existing** (`get_course_content`)

### le.content.topicGet
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}`
- Description: Retrieve a specific content topic for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Content.ContentObject` (Type=1, Topic variant) — TopicType, Url, StartDate/EndDate/DueDate, IsHidden, IsLocked, IsBroken, OpenAsExternalResource, Id, Title, ShortTitle, Type, Description (RichText|null), ParentModuleId, ActivityId, Duration, IsExempt, ToolId, ToolItemId, ActivityType, GradeItemId, LastModifiedDate, AssociatedGradeItemIds
- Source: `res/content.html`
- Confidence: verified
- Status: **new curated** (`get_content_topic`)

### le.content.topicAccess
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}/access/`
- Description: Retrieve the list of users with access to a specified content topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess`
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.topicCaptions
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}/captions`
- Description: Retrieve metadata for all caption files associated with an audio/video content topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage` (sorted by LanguageCode/LanguageCulture ascending)
- Response block: `Captions.CaptionsMetadata` — Filename, LanguageCode, LanguageCulture (optional), LanguageName
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.topicCompletionsList
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}/completions/`
- Description: Retrieve a list of content topic completions for a topic, for users the caller has access to.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: `userId` (D2LID, optional); `isAscendingSort` (bool, optional, default true); `userBookmark` (D2LID, optional); `pageSize` (integer, optional, default 20)
- Response envelope: `objectListPage`
- Response block: `ContentCompletions.ContentTopicCompletion` — UserId, OrgUnitId, TopicId, CompletionType, CompletionDate
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.topicCompletionForUser
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}/completions/users/{userId}`
- Description: Retrieve a content topic completion for a topic, for a particular user.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `ContentCompletions.ContentTopicCompletion` (same as list)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.topicFile
- Method/Path: `GET {orgUnitId}/content/topics/{topicId}/file`
- Description: Retrieve the underlying file for a file-type content topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: `stream` (bool, optional — inline vs. attachment `Content-Disposition`)
- Response envelope: `binary`
- Response block: n/a — raw file bytes
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only** (binary; see `design.md` Non-Goals)

### le.content.userProgress
- Method/Path: `GET {orgUnitId}/content/userprogress/`
- Description: Retrieve user progress items in an org unit for specific users or content topics (only users with recorded progress are returned).
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `userId` (D2LID, optional, repeatable); `objectId` (D2LID, optional, repeatable); `pageSize` (integer, optional, default 20)
- Response envelope: `objectListPage`
- Response block: `UserProgress.UserProgressData` — ObjectId, UserId, CompletedDate, IsRead, NumVisits, TotalTime, LastVisited, Visited, Completed, IsExempt
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.topicProgress — *new, added by this research pass*
- Method/Path: `GET {orgUnitId}/content/userprogress/{topicId}`
- Description: Retrieve one user's progress within an org unit for a particular content topic (includes users at the default/no-progress state, unlike `le.content.userProgress`'s list).
- Path params: `orgUnitId` (D2LID, auto-derived), `topicId` (D2LID)
- Query params: `userId` (D2LID, optional — report on this user's progress)
- Response envelope: `object`
- Response block: `UserProgress.UserProgressData` (same fields as `le.content.userProgress`)
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

## Competencies

### le.competencies.structure
- Method/Path: `GET {orgUnitId}/competencies/structure`
- Description: Retrieve the structure of course competencies and objectives visible to the calling user (a graph with a virtual, non-returned root node).
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `parentObjectId` (D2LID, optional, default = root); `depth` (integer, optional, default 2, min 0); `pageSize` (integer, optional, default 25, min 1 — sibling "breadth"); `bookmark` (integer, optional); `forUserId` (D2LID, optional — filter to items viewable by this user)
- Response envelope: `objectListPage`
- Response block: `Competency.CompetencyObjectsPage` — Objects (array of Competency.CompetencyObject), Next. CompetencyObject: Id (D2LID), ObjectTypeId (1=Competency, 2=Objective), Name, Description, ChildrenPage (composite, nested page), MoreChildren (APIURL|null)
- Source: `res/competency.html`
- Confidence: verified
- Status: **catalog-only**

## Discussions & Forums

### le.discussions.deletedList
- Method/Path: `GET {orgUnitId}/discussions/deleted`
- Description: Retrieve deleted discussion forums and topics for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.DeletedDiscussionsData` — DeletedForums (array: ForumId, Name, DeletedDate, DeletedByUserId, TopicCount), DeletedTopics (array: TopicId, ParentForumId, Name, DeletedDate, DeletedByUserId)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.forumsList
- Method/Path: `GET {orgUnitId}/discussions/forums/`
- Description: Retrieve a list of all discussion forums for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Discussions.Forum` — ForumId, StartDate/EndDate (UTCDateTime|null), PostStartDate/PostEndDate (unused v1.56+), Name, Description (RichText), ShowDescriptionInTopics, AllowAnonymous, IsLocked (always false v1.56+), IsHidden, RequiresApproval, DisplayInCalendar, DisplayPostDatesInCalendar (unused v1.56+), StartDateAvailabilityType/EndDateAvailabilityType, EventType
- Source: `res/discuss.html`
- Confidence: verified
- Status: **existing** (`get_discussion_forums`)

### le.discussions.forumGet
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}`
- Description: Retrieve a particular discussion forum for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.Forum` (same as list)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.forumAccess
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/access/`
- Description: Retrieve a list of users with access to a specified forum.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional); `bookmark` (implicit, standard paging cursor)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess`
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.forumStatistics
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/statistics`
- Description: Retrieve discussion statistics for a specific forum within an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.ForumStats` — TotalThreadsAllForums, TotalRepliesAllForums, TotalThreadsThisForum, TotalRepliesThisForum, PinnedThreads, UnapprovedPosts, TopicIds (array)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicsList
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/`
- Description: Retrieve topics from the provided discussion forum in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Discussions.Topic` — ForumId, TopicId, Name, Description (RichText), StartDate/EndDate/UnlockStartDate/UnlockEndDate, IsLocked, AllowAnonymousPosts, RequiresApproval, UnApprovedPostCount, PinnedPostCount, ScoringType, IsAutoScore, ScoreOutOf, IncludeNonScoredValues, ScoredCount, RatingsSum, RatingsCount, IsHidden, MustPostToParticipate, RatingType, ActivityId, GroupTypeId, StartDateAvailabilityType/EndDateAvailabilityType, DueDate (v1.90+)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **existing** (`get_discussion_topics`)

### le.discussions.topicGet
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}`
- Description: Retrieve a particular topic from the provided discussion forum in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.Topic` (same as list)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicAccess
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/access/`
- Description: Retrieve a list of users with access to a specified topic within a forum.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess`
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicExemption
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/exemption`
- Description: Retrieve the list of users currently exempted from a discussion topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: none named — plain array of D2LID user ids currently exempted; empty if none
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicGroupRestrictions
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/groupRestrictions/`
- Description: Retrieve the group restrictions for a discussion forum topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Discussions.GroupRestriction` — GroupId (D2LID)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postsList
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/`
- Description: Retrieve all posts (including threads) in a discussion forum topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: `pageSize` (integer, optional, max 1000); `pageNumber` (integer, optional, default 1); `threadsOnly` (bool, optional, default false); `threadId` (D2LID, optional); `sort` (string, optional, default "-creationdate" — creationdate/rating/votes/upvotes/threaded, "-" prefix = descending)
- Response envelope: `bareArray`
- Response block: `Discussions.Post` — ForumId, PostId, TopicId, PostingUserId, PostingUserDisplayName, ThreadId, ParentPostId, Message (RichText), Subject, DatePosted, IsAnonymous, RequiresApproval, IsDeleted, LastEditedDate, LastEditedBy, CanRate, ReplyPostIds (array), WordCount, AttachmentCount, IsRead (v1.45+), Attachments (array, v1.95+), ThreadIsPinned (v1.95+)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **existing** (`get_discussion_posts`)

### le.discussions.postGet
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}`
- Description: Retrieve a particular post in a discussion forum topic.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.Post` (same as list)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postApproval
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Approval`
- Description: Retrieve the approval status for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.ApprovalData` — IsApproved (bool)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postFlag
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Flag`
- Description: Retrieve the flagged status for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.FlagData` — IsFlagged (bool)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postRating
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Rating`
- Description: Retrieve the rating data for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.RatingData` — CanRate, RatingsSum, RatingsCount, RatingsAverage, UserRating (composite)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postMyRating
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Rating/MyRating`
- Description: Retrieve the current user's rating data for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.UserRatingData` — Rating (number|null; 1-5, 0/null = unrated)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postReadStatus
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/ReadStatus`
- Description: Retrieve the current read status for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.ReadStatusData` — IsRead (bool)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postVotes
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Votes`
- Description: Retrieve all the vote data for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.VotesData` — NumUpVotes, NumDwnVotes, UserVote (composite)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postMyVote
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/Votes/MyVote`
- Description: Retrieve the current user's vote data for a particular post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.UserVoteData` — Vote (1=UpVote, 0=NoVote, -1=DownVote)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.postAttachment
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/posts/{postId}/attachments/{fileId}`
- Description: Retrieve a specific file attachment from a discussion forum post.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID), `postId` (D2LID), `fileId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — raw file stream
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicStatistics
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/statistics`
- Description: Retrieve discussion statistics for a specific topic within a forum.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.TopicStats` — TotalThreads, TotalReplies, PinnedThreads, UnapprovedPosts, TotalUpVotes (int|null, rating type dependent), TotalDownVotes (int|null), AverageFiveStarRating (decimal|null)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.topicUserStatistics
- Method/Path: `GET {orgUnitId}/discussions/forums/{forumId}/topics/{topicId}/userstatistics`
- Description: Retrieve per-user discussion statistics for a specific topic within a forum, sorted by last name ascending.
- Path params: `orgUnitId` (D2LID, auto-derived), `forumId` (D2LID), `topicId` (D2LID)
- Query params: `pageSize` (integer, optional, max 1000); `pageNumber` (integer, optional, default 1)
- Response envelope: `bareArray`
- Response block: `Discussions.TopicUserStats` — UserId, DisplayName, ThreadsPosted, RepliesPosted, PostsReadCount, UnapprovedPostCount, ScoredPostCount, UpVotes, DownVotes, StarRating, StarRatingsCount
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.forumTopicStatistics
- Method/Path: `GET {orgUnitId}/discussions/forumtopicstatistics`
- Description: Retrieve discussion statistics for an org unit, broken down by forum and topic. Pagination applies to the forum list; all topics for returned forums are included.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `pageSize` (integer, optional, max 1000); `pageNumber` (integer, optional, default 1)
- Response envelope: `bareArray`
- Response block: `Discussions.OrgUnitForumStats` — ForumId, Name, Threads, Replies, Pinned, Unapproved, Scored, TopicStatistics (array of `Discussions.OrgUnitTopicStats`: TopicId, Name, Threads, Replies, Pinned, Unapproved, Scored, UpVotes, DownVotes, AverageStarRating, NumberOfRatings)
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.statistics
- Method/Path: `GET {orgUnitId}/discussions/statistics`
- Description: Retrieve overall discussion statistics for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Discussions.OrgUnitOverallStats` — TotalThreads, TotalReplies, TotalPinned, UnapprovedPosts
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

### le.discussions.userStatistics
- Method/Path: `GET {orgUnitId}/discussions/userstatistics`
- Description: Retrieve per-user discussion statistics for an org unit, sorted by last name ascending.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `pageSize` (integer, optional, max 1000); `pageNumber` (integer, optional, default 1)
- Response envelope: `bareArray`
- Response block: `Discussions.OrgUnitUserStats` — UserId, DisplayName, ThreadsPosted, RepliesPosted, PostsReadCount, UnapprovedPostCount, ScoredPostCount
- Source: `res/discuss.html`
- Confidence: verified
- Status: **catalog-only**

## Dropbox & Assignments

### le.dropbox.categoriesList
- Method/Path: `GET {orgUnitId}/dropbox/categories/`
- Description: Retrieve all dropbox folder categories for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Dropbox.DropboxCategory` — Id, Name, LastModifiedByUserId, LastModifiedDate
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.categoryGet
- Method/Path: `GET {orgUnitId}/dropbox/categories/{categoryId}`
- Description: Retrieve a specific dropbox folder category, including the folders that belong to it.
- Path params: `orgUnitId` (D2LID, auto-derived), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Dropbox.DropboxCategoryWithFolders` — Id, Name, Folders (array of Dropbox.DropboxFolder), LastModifiedByUserId, LastModifiedDate
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.foldersList
- Method/Path: `GET {orgUnitId}/dropbox/folders/`
- Description: Retrieve all dropbox folders for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `onlyCurrentStudentsAndGroups` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Dropbox.DropboxFolder` — Id, CategoryId, Name, CustomInstructions (RichText), Attachments (array), TotalFiles, UnreadFiles, FlaggedFiles, TotalUsers, TotalUsersWithSubmissions, TotalUsersWithFeedback, Availability (composite|null), GroupTypeId, DueDate, DisplayInCalendar, Assessment (composite|null), NotificationEmail, IsHidden, LinkAttachments (array), ActivityId, IsAnonymous, DropboxType, SubmissionType, CompletionType, SubmissionRule (v1.98+), GradeItemId, AllowOnlyUsersWithSpecialAccess
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **existing** (`get_assignments`)

### le.dropbox.folderGet
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}`
- Description: Retrieve a specific dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Dropbox.DropboxFolder` (same as list)
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.folderAccess
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/access/`
- Description: Retrieve the list of users with access to a specified dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional); `bookmark` (string, optional — implied by return text, not in the formal Query Parameters table)
- Response envelope: `bookmarkPaged`
- Response block: `Access.UserAccess`
- Source: `res/dropbox.html`
- Confidence: inferred (same "segment following bookmark" phrasing ambiguity noted for calendar's "access" routes)
- Status: **catalog-only**

### le.dropbox.folderAttachment
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/attachments/{fileId}`
- Description: Retrieve a file attachment from a specific dropbox folder (not for link attachments).
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `fileId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.feedbackGet
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/feedback/{entityType}/{entityId}`
- Description: Retrieve the feedback entry from a dropbox folder for a given entity (user or group).
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `entityType` (string: "user"|"group"), `entityId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Dropbox.DropboxFeedbackOut` — Score (decimal|null), Feedback (RichText), RubricAssessments (array), IsGraded (bool), Files (array), Links (array), GradedSymbol (string|null)
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **new curated** (`get_my_dropbox_submission`)

### le.dropbox.feedbackAttachment
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/feedback/{entityType}/{entityId}/attachments/{fileId}`
- Description: Retrieve a feedback entry's file attachment.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `entityType` (string), `entityId` (D2LID), `fileId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.feedbackLink
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/feedback/{entityType}/{entityId}/links/{linkId}`
- Description: Retrieve a feedback entry's linked media-content attachment (audio/video recorded feedback only).
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `entityType` (string), `entityId` (D2LID), `linkId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.groupSubmissionDownload
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/group-submissions/{groupId}/download`
- Description: Download a zip of all files submitted by users in a group for a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `groupId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — zip file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.specialAccessList
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/specialaccess/`
- Description: Retrieve special access rules for users in a specified dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: none documented
- Response envelope: `bookmarkPaged`
- Response block: `Dropbox.SpecialAccessUserData` — UserId, SpecialAccess (composite: Dropbox.SpecialAccessData)
- Source: `res/dropbox.html`
- Confidence: inferred (return text lacks the explicit "bookmark/segment" phrasing used elsewhere for this envelope; could alternatively be `objectListPage` — worth a spot-check)
- Status: **catalog-only**

### le.dropbox.specialAccessGet
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/specialaccess/{userId}`
- Description: Retrieve the special access rule for a specific user in a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Dropbox.SpecialAccessData` — StartDate, EndDate, DueDate (all UTCDateTime|null)
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.submissionsPaged
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/paged/`
- Description: Retrieve a page of submissions (with feedback if present) for a specific dropbox folder. D2L's recommended route over the unpaged `submissions/` route.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: `activeOnly` (bool, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Dropbox.EntityDropbox` — Entity (composite: Dropbox.Entity), Status (ENTITYDROPBOXSTATUS_T), Feedback (composite: Dropbox.DropboxFeedbackOut), Submissions (array: Id, SubmittedBy, SubmissionDate, Comment, Files), CompletionDate
- Source: `res/dropbox.html`
- Confidence: inferred for `bookmark` param specifically (same boilerplate phrasing issue as `folderAccess`; not formally listed in the Query Parameters table)
- Status: **existing** (`get_dropbox_submissions`)

### le.dropbox.submissionsAll — *new, added by this research pass*
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/`
- Description: Retrieve **all** submissions for a dropbox folder, unpaged. D2L's docs explicitly warn: "A dropbox folder could contain a very large number of submissions... We strongly recommend you use the paged version of this call instead" (`le.dropbox.submissionsPaged`).
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: `activeOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Dropbox.EntityDropbox` (same as `le.dropbox.submissionsPaged`)
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only** — flag with D2L's own caution against unbounded use in the catalog entry's description

### le.dropbox.submissionFile
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/{submissionId}/files/{fileId}`
- Description: Retrieve one file from a submission in a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `submissionId` (D2LID), `fileId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.submissionDownload
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/{userId}/download`
- Description: Download a zip of all files submitted by a user for a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — zip file stream
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.groupSubmissionGet
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/group/{groupId}`
- Description: Retrieve all submissions made by a specific group in a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `groupId` (D2LID)
- Query params: `ignoreFeedback` (bool, optional)
- Response envelope: `object` (docs say "a JSON block", singular, despite the plural endpoint name)
- Response block: `Dropbox.EntityDropbox`
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

### le.dropbox.mySubmissions
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/mysubmissions/`
- Description: Retrieve all submissions made by the current user to a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Dropbox.EntityDropbox` (array)
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **new curated** (`get_my_dropbox_submission`)

### le.dropbox.submissionForUser
- Method/Path: `GET {orgUnitId}/dropbox/folders/{folderId}/submissions/user/{userId}`
- Description: Retrieve all submissions for a specific user in a dropbox folder.
- Path params: `orgUnitId` (D2LID, auto-derived), `folderId` (D2LID), `userId` (D2LID)
- Query params: `ignoreFeedback` (bool, optional)
- Response envelope: `object`
- Response block: `Dropbox.EntityDropbox`
- Source: `res/dropbox.html`
- Confidence: verified
- Status: **catalog-only**

## Enrollment & Classlist

### le.classlist.list
- Method/Path: `GET {orgUnitId}/classlist/`
- Description: Retrieve the enrolled users in the classlist for an org unit (unbounded result set — docs recommend the paged version instead).
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Enrollment.ClasslistUser` — Identifier (string:D2LID), ProfileIdentifier, DisplayName, Username, OrgDefinedId, Email, FirstName, LastName, RoleId, LastAccessed, IsOnline, ClasslistRoleDisplayName, Pronouns (added LMS v20.25.2)
- Source: `res/enroll.html`
- Confidence: verified
- Status: **existing** (`get_classlist`)

### le.classlist.paged
- Method/Path: `GET {orgUnitId}/classlist/paged/`
- Description: Retrieve the enrolled users in the classlist for an org unit, paged; sorted by first name then last name then Identifier.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `onlyShowShownInGrades` (bool, optional, default false); `searchTerm` (string, optional — filters Username/OrgDefinedId/FirstName/LastName); `roleId` (D2LID, optional, requires privilege)
- Response envelope: `objectListPage`
- Response block: `Enrollment.ClasslistUser` (same as list)
- Source: `res/enroll.html`
- Confidence: verified
- Status: **catalog-only** (correction: the existing `get_classlist` tool does **not** actually use this route internally — it calls `le.classlist.list` directly — so this is plain catalog-only, not "used internally")

### le.auditing.auditeeGet
- Method/Path: `GET auditing/auditees/{auditeeId}`
- Description: Retrieve information for an auditee, including the list of auditors monitoring that user.
- Path params: `auditeeId` (D2LID) — **no `orgUnitId` at all**; this route is org-unit-independent
- Query params: none documented
- Response envelope: `object`
- Response block: `Audit.AuditedUser` — AuditeeId, DisplayName, Auditors (array of `Audit.UsersAuditor`: AuditorId, DisplayName)
- Source: `res/enroll.html`
- Confidence: verified (independently confirmed by two research batches)
- Status: **catalog-only**

### le.auditing.auditorGet
- Method/Path: `GET auditing/auditors/{auditorId}`
- Description: Retrieve information for an auditor, including the list of auditees being monitored.
- Path params: `auditorId` (D2LID) — no `orgUnitId`
- Query params: none documented
- Response envelope: `object`
- Response block: `Audit.Auditor` — AuditorId, DisplayName, Auditees (array of `Audit.Auditee`: AuditeeId, DisplayName)
- Source: `res/enroll.html`
- Confidence: verified (independently confirmed by two research batches)
- Status: **catalog-only**

### le.auditing.auditeesForAuditor
- Method/Path: `GET auditing/auditors/{auditorId}/auditees/`
- Description: Retrieve the list of users an auditor is auditing.
- Path params: `auditorId` (D2LID) — no `orgUnitId`
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Audit.Auditee` — AuditeeId, DisplayName
- Source: `res/enroll.html`
- Confidence: verified (independently confirmed by two research batches)
- Status: **catalog-only**

## Grades & Grading

### le.grades.definitionsList
- Method/Path: `GET {orgUnitId}/grades/`
- Description: Retrieve all the current grade objects for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Grade.GradeObject` — Id, Name, ShortName, GradeType ("Numeric"|"PassFail"|"SelectBox"|"Text"), CategoryId, Description (RichText), AssociatedTool, IsHidden; Numeric/PassFail variants add MaxPoints, IsBonus, ExcludeFromFinalGradeCalculation, GradeSchemeId, GradeSchemeUrl, Weight; Numeric adds CanExceedMaxPoints
- Source: `res/grade.html`
- Confidence: verified
- Status: **existing** (`get_grades`)

### le.grades.definitionGet
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}`
- Description: Retrieve a specific grade object for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeObject` (same as list)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.definitionAccess
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/access/`
- Description: Retrieve a list of users with access to a specified grade.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional); `bookmark` (undocumented but plausible — see Corrections #6)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess` — UserId, HasAccess
- Source: `res/grade.html`, `res/apiprop.html`
- Confidence: verified for path/params; the `bookmark` note is a doc-quality flag, not an extraction uncertainty
- Status: **catalog-only**

### le.grades.exemptionsList
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/exemptions/`
- Description: Retrieve all the exempt users for a provided grade.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `User.User` — Identifier, DisplayName, EmailAddress, OrgDefinedId, ProfileBadgeUrl, ProfileIdentifier, UserName
- Source: `res/grade.html`, `res/user.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.exemptionGet
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/exemptions/{userId}`
- Description: Determine if a user is exempt from a grade.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `User.User` (same as exemptionsList)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.ipsis
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/ipsis`
- Description: Retrieve the IPSIS (SIS integration) details for a grade object.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `IPSIS.GradeObjectDetails` — AcademicSessionOrgUnitId, EndOfCourse, PowerSchoolGradeType, SectionOrgUnitId
- Source: `res/ipsis.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.statistics
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/statistics`
- Description: Get statistics for a specified grade item.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID — untyped in D2L's own docs, inferred by sibling-route consistency; see Corrections #6)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeStatisticsInfo` — OrgUnitId, GradeObjectId, Minimum, Maximum, Average, Mode (array), Median, StandardDeviation
- Source: `res/grade.html`
- Confidence: verified except the `gradeObjectId` type note above
- Status: **catalog-only**

### le.grades.valuesForItem
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/values/`
- Description: Retrieve each user's grade value for a particular grade object.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: `sort` (string, optional — firstname/lastname/grade/lastmodified); `pageSize` (number, optional); `isGraded` (bool, optional); `searchText` (string, optional)
- Response envelope: `objectListPage`
- Response block: `Grade.UserGradeValue` — User (composite User.User), GradeValue (composite Grade.GradeValue|null)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only** — correction: `get_class_grades` actually uses the bulk `le.grades.valuesAll` (`{orgUnitId}/grades/values/`) route, not this single-item one; this was misattributed in an earlier draft of this file

### le.grades.valueForUser
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/values/{userId}`
- Description: Retrieve a specific grade value for a particular user assigned in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeValue` — DisplayedGrade, GradeObjectIdentifier, GradeObjectName, GradeObjectType, GradeObjectTypeName, Comments (RichText), PrivateComments (RichText), LastModified, LastModifiedBy, ReleasedDate; computable variant adds PointsNumerator/PointsDenominator/WeightedNumerator/WeightedDenominator
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.myValueForItem
- Method/Path: `GET {orgUnitId}/grades/{gradeObjectId}/values/myGradeValue`
- Description: Retrieve a specific grade value for the current user context assigned in a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeObjectId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeValue` (same as valueForUser)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.categoriesList
- Method/Path: `GET {orgUnitId}/grades/categories/`
- Description: Retrieve a list of all grade categories for a provided org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Grade.GradeObjectCategory` — Id, Grades (array of Grade.GradeObject), Name, ShortName, CanExceedMax, ExcludeFromFinalGrade, Description (RichText|null), ShowDescription, several DisplayXToUsers booleans, StartDate/EndDate, Weight, MaxPoints, AutoPoints, WeightDistributionType, NumberOfHighestToDrop/NumberOfLowestToDrop
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.categoryGet
- Method/Path: `GET {orgUnitId}/grades/categories/{categoryId}`
- Description: Retrieve a specific grade category for a provided org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeObjectCategory` (same as list)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.categoryIpsis
- Method/Path: `GET {orgUnitId}/grades/categories/{categoryId}/ipsis`
- Description: Retrieve the IPSIS (SIS integration) details for a grade category.
- Path params: `orgUnitId` (D2LID, auto-derived), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `IPSIS.GradeCategoryInfo` — ExportToSIS, AcademicSessionOrgUnitId
- Source: `res/ipsis.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.courseCompletionList
- Method/Path: `GET {orgUnitId}/grades/courseCompletion/`
- Description: Retrieve all the course completion records for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `userId` (D2LID, optional); `startExpiry`/`endExpiry` (UTCDateTime, optional); `bookmark` (string, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Grade.CourseCompletion` — OrgUnitId, CompletionId, UserId, CompletedDate, ExpiryDate
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.exemptionsForUser
- Method/Path: `GET {orgUnitId}/grades/exemptions/{userId}`
- Description: Retrieve all the grade objects for a provided user in a provided org unit with exemption status included.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.BulkGradeObjectExemptionResult` — Items (array of `Grade.BulkGradeObjectExemption`: GradeObjectCategory, GradeObjectId, GradeObjectName, GradeObjectType, GradeValue, IsExempt), ExemptionAccessDate
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.finalValuesAll
- Method/Path: `GET {orgUnitId}/grades/final/values/`
- Description: Retrieve each user's final grade value for a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `sort` (optional); `pageSize` (optional); `isGraded` (optional); `searchText` (optional) — same as `valuesForItem`
- Response envelope: `objectListPage`
- Response block: `Grade.UserGradeValue` (same as `valuesForItem`)
- Source: `res/grade.html`
- Confidence: verified
- Status: **new curated** (`get_all_final_grades`)

### le.grades.finalValueForUser
- Method/Path: `GET {orgUnitId}/grades/final/values/{userId}`
- Description: Retrieve the final grade value for a particular user.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: `gradeType` (string, optional — force calculated vs. adjusted grade)
- Response envelope: `object`
- Response block: `Grade.GradeValue`
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.finalValueMy
- Method/Path: `GET {orgUnitId}/grades/final/values/myGradeValue`
- Description: Retrieve the final grade value for the current user context.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeValue`
- Source: `res/grade.html`
- Confidence: verified
- Status: **new curated** (`get_my_final_grade`)

### le.grades.schemesList
- Method/Path: `GET {orgUnitId}/grades/schemes/`
- Description: Retrieve all the grade schemes for a provided org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Grade.GradeScheme` — Id, Name, ShortName, Ranges (array: PercentStart, Symbol, AssignedValue, Colour)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.schemeGet
- Method/Path: `GET {orgUnitId}/grades/schemes/{gradeSchemeId}`
- Description: Retrieve a particular grade scheme.
- Path params: `orgUnitId` (D2LID, auto-derived), `gradeSchemeId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeScheme` (same as list)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.schemeDefault
- Method/Path: `GET {orgUnitId}/grades/schemes/default`
- Description: Retrieve the default grade scheme for a provided org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeScheme`
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.setup
- Method/Path: `GET {orgUnitId}/grades/setup/`
- Description: Retrieve the grades configuration for the org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Grade.GradeSetupInfo` — GradingSystem, IsNullGradeZero, DefaultGradeSchemeId
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.valuesAll
- Method/Path: `GET {orgUnitId}/grades/values/`
- Description: Retrieve all grade values in bulk for every user in a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `gradeObjectTypeId` (string, optional); `modifiedSince` (UTCDateTime, optional); `pageSize` (number, optional, 1-200)
- Response envelope: `objectListPage`
- Response block: `Grade.GradeValue`, bulk variant (adds UserId, OrgUnitId as string:D2LID)
- Source: `res/grade.html`
- Confidence: verified
- Status: **existing** (used by `get_class_grades`)

### le.grades.valuesForUser
- Method/Path: `GET {orgUnitId}/grades/values/{userId}/`
- Description: Retrieve all the grade values for a particular user assigned in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Grade.GradeValue`
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.valuesDescendants
- Method/Path: `GET {orgUnitId}/grades/values/descendants/`
- Description: Retrieve all grade values in bulk for every user in a group of org units (an org unit and its descendants).
- Path params: `orgUnitId` (D2LID, auto-derived — root of the org unit group)
- Query params: `courseEndDate`/`courseStartDate` (UTCDateTime, optional); `gradeObjectTypeId` (string, optional); `includeInactiveCourses` (bool, optional); `modifiedSince` (UTCDateTime, optional); `pageSize` (number, optional, 1-200)
- Response envelope: `objectListPage`
- Response block: `Grade.GradeValue`, bulk variant
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.myValues
- Method/Path: `GET {orgUnitId}/grades/values/myGradeValues/`
- Description: Retrieve all the grade values for the current user context assigned in a particular org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Grade.GradeValue`
- Source: `res/grade.html`
- Confidence: verified
- Status: **existing** (used by `get_grades`)

## Learning Outcomes (course-scoped)

### le.learningOutcomes.alignmentsList
- Method/Path: `GET {orgUnitId}/lo/alignments/`
- Description: Retrieve all the alignments in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `assessableOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Outcomes.BulkAlignment` — OutcomeSetId (D2LID|0), OutcomeId (GUID), Activities (array of AlignedActivity)
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.activityAlignments
- Method/Path: `GET {orgUnitId}/lo/alignments/activity/{activityType}/{objectId}`
- Description: Retrieve all the alignments to a given activity.
- Path params: `orgUnitId` (D2LID, auto-derived), `activityType` (ALIGNEDACTIVITYTYPE_T), `objectId` (D2LID or string; rubric criteria use `"{rubricId}_R_{criterionId}"`)
- Query params: `directOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Outcomes.Alignment` — OutcomeSetId, OutcomeId, Direct
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.outcomeAlignments
- Method/Path: `GET {orgUnitId}/lo/alignments/outcome/{outcomeId}`
- Description: Retrieve all the alignments to a given outcome in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `outcomeId` (GUID)
- Query params: `assessableOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Outcomes.BulkAlignment`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.outcomeSetAlignments
- Method/Path: `GET {orgUnitId}/lo/alignments/outcomeSet/{outcomeSetId}`
- Description: Retrieve all the alignments to outcomes in an outcome set in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `outcomeSetId` (D2LID|0 — 0 = primary "My Learning Outcomes" set)
- Query params: `assessableOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Outcomes.BulkAlignment`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.outcomeSetsList
- Method/Path: `GET {orgUnitId}/lo/outcomeSets/`
- Description: Retrieve all outcome sets in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Outcomes.OutcomeSet` — OutcomeSetId, Name, Outcomes (array)
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.outcomeSetGet
- Method/Path: `GET {orgUnitId}/lo/outcomeSets/{outcomeSetId}`
- Description: Retrieve a specific outcome set from an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `outcomeSetId` (D2LID|0)
- Query params: none documented
- Response envelope: `object`
- Response block: `Outcomes.OutcomeSet`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

## News & Announcements

### le.news.list
- Method/Path: `GET {orgUnitId}/news/`
- Description: Retrieve a list of news items for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `since` (UTCDateTime, optional)
- Response envelope: `bareArray`
- Response block: `News.NewsItem` — Id, IsHidden, Attachments (array: FileId, FileName, FileSize), Title, Body (RichText), CreatedBy/LastModifiedBy, CreatedDate/LastModifiedDate, StartDate/EndDate, IsGlobal, IsPublished, ShowOnlyInCourseOfferings, IsAuthorInfoShown, IsPinned, PinnedDate, IsStartDateShown, SortOrder
- Source: `res/news.html`
- Confidence: verified
- Status: **existing** (`get_announcements`)

### le.news.get
- Method/Path: `GET {orgUnitId}/news/{newsItemId}`
- Description: Retrieve a single news item for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `newsItemId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `News.NewsItem` (same as list)
- Source: `res/news.html`
- Confidence: verified
- Status: **catalog-only**

### le.news.access
- Method/Path: `GET {orgUnitId}/news/{newsItemId}/access/`
- Description: Retrieve users with access to a specified news item.
- Path params: `orgUnitId` (D2LID, auto-derived), `newsItemId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage` (corrected — see Corrections #5; not `bookmarkPaged` despite prose mentioning "bookmark")
- Response block: `Access.UserAccess`
- Source: `res/news.html`
- Confidence: verified (raw-HTML anchor cross-check performed specifically for this route)
- Status: **catalog-only**

### le.news.attachment
- Method/Path: `GET {orgUnitId}/news/{newsItemId}/attachments/{fileId}`
- Description: Download an attachment file for a news item.
- Path params: `orgUnitId` (D2LID, auto-derived), `newsItemId` (D2LID), `fileId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — raw file stream
- Source: `res/news.html`
- Confidence: verified
- Status: **catalog-only**

### le.news.sharing
- Method/Path: `GET {orgUnitId}/news/{newsItemId}/sharing/`
- Description: Retrieve the org-unit sharing rules for a news item.
- Path params: `orgUnitId` (D2LID, auto-derived), `newsItemId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `News.OrgUnitSharingRuleData` — SharingOrgUnitId, ShareWithOrgUnit, ShareWithDescendants, ShareWithDescendantsOfType
- Source: `res/news.html`
- Confidence: verified
- Status: **catalog-only**

### le.news.deletedList
- Method/Path: `GET {orgUnitId}/news/deleted/`
- Description: Retrieve deleted news items for an org unit (includes hidden ones).
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `global` (bool, optional — if true, show only global news items; otherwise no global items)
- Response envelope: `bareArray`
- Response block: `News.NewsItem`
- Source: `res/news.html`
- Confidence: verified
- Status: **catalog-only**

### le.news.forUser
- Method/Path: `GET {orgUnitId}/news/user/{userId}/`
- Description: Retrieve news items from a specific org unit visible to a specific user. Subject to User Information Privacy permission controls.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `News.NewsItem`
- Source: `res/news.html`
- Confidence: verified
- Status: **catalog-only**

## Quizzes

### le.quizzes.list
- Method/Path: `GET {orgUnitId}/quizzes/`
- Description: List quizzes belonging to an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Quiz.QuizReadData` — QuizId, Name, IsActive, SortOrder, AutoExportToGrades, GradeItemId, IsAutoSetGraded, Instructions/Description/Header/Footer ({Text:RichText, IsDisplayed}), StartDate/EndDate/DueDate, DisplayInCalendar, AttemptsAllowed (composite), LateSubmissionInfo (composite), SubmissionTimeLimit (composite), SubmissionGracePeriod, Password, AllowHints, DisableRightClick, DisablePagerAndAlerts, NotificationEmail, CalcTypeId, RestrictIPAddressRange, CategoryId, PreventMovingBackwards, Shuffle, ActivityId, AllowOnlyUsersWithSpecialAccess, IsRetakeIncorrectOnly, PagingTypeId, IsSynchronous, DeductionPercentage, HideQuestionPoints, IsSingleSession, AnnotationToolsEnabled
- Source: `res/quiz.html`
- Confidence: verified
- Status: **existing** (`get_quizzes`)

### le.quizzes.get
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}`
- Description: Retrieve a single quiz by ID.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Quiz.QuizReadData` (same as list)
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.access
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/access/`
- Description: Retrieve users with access to a specified quiz.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess`
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.attempts
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/attempts/`
- Description: Retrieve a list of attempts for a quiz.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID)
- Query params: `userId` (D2LID, optional — "retrieve attempts for a single user"; confirmed as the exact param the instructor-facing per-student scoping already relies on)
- Response envelope: `objectListPage`
- Response block: `Quiz.QuizAttemptData` — AttemptId, QuizId, UserId, AttemptNumber, Score, Started, Completed, AttemptFeedback, FeedbackLastModified, IsPublished, plus mirrored attempt-config fields
- Source: `res/quiz.html`
- Confidence: verified
- Status: **existing** (`get_quiz_attempts` own-scoped / `get_quiz_results` class-wide — both use this route)

### le.quizzes.attemptGet
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/attempts/{attemptId}`
- Description: Retrieve a single quiz attempt.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID), `attemptId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Quiz.QuizAttemptData`
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.questions
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/questions/`
- Description: Retrieve all questions in a quiz.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Quiz.QuestionData` — QuestionId, QuestionTypeId, Name, QuestionText (RichText), Points, Difficulty, Bonus, Mandatory, Hint (RichText), Feedback (RichText), LastModified, LastModifiedBy, SectionId, QuestionTemplateId, QuestionTemplateVersionId, QuestionInfo (composite; shape varies by question type — MultipleChoice/TrueFalse/FillInTheBlank/MultiSelect/LongAnswer/ShortAnswer/Likert/MultipleShortAnswer each differ)
- Source: `res/quiz.html`
- Confidence: verified
- Status: **new curated** (`get_quiz_questions`)

### le.quizzes.specialAccessList
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/specialaccess/`
- Description: Retrieve special access rules for users on a quiz.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Quiz.SpecialAccessUserData` — UserId, SpecialAccess (composite: Quiz.SpecialAccessData)
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.specialAccessGet
- Method/Path: `GET {orgUnitId}/quizzes/{quizId}/specialaccess/{userId}`
- Description: Retrieve one user's special access rule for a quiz.
- Path params: `orgUnitId` (D2LID, auto-derived), `quizId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Quiz.SpecialAccessData` — StartDate/EndDate/DueDate, SubmissionTimeLimit (composite|null), AttemptsAllowed (composite|null)
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.categoriesList
- Method/Path: `GET {orgUnitId}/quizzes/categories/`
- Description: Retrieve quiz categories for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Quiz.QuizCategoryReadData` — CategoryId, Name, SortOrder
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

### le.quizzes.categoryGet
- Method/Path: `GET {orgUnitId}/quizzes/categories/{categoryId}`
- Description: Retrieve a single quiz category.
- Path params: `orgUnitId` (D2LID, auto-derived), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Quiz.QuizCategoryReadData`
- Source: `res/quiz.html`
- Confidence: verified
- Status: **catalog-only**

## Surveys

*(structure fully parallels Quizzes)*

### le.surveys.list
- Method/Path: `GET {orgUnitId}/surveys/`
- Description: Retrieve all surveys for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Surveys.SurveyReadData` — SurveyId, Name, SortOrder, HasInstantFeedback, IsAnonymous, Description/Footer ({Text:RichText, IsDisplayed}), Submission (RichText), IsActive, StartDate/EndDate, DisplayInCalendar, UserResponses (composite), CategoryId, PreventMovingBackwards, Shuffle, ActivityId, AllowOnlyUsersWithSpecialAccess
- Source: `res/survey.html`
- Confidence: verified
- Status: **existing** (`get_surveys`)

### le.surveys.get
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}`
- Description: Retrieve a single survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Surveys.SurveyReadData` (same as list)
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.access
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/access/`
- Description: Retrieve users with access to a specified survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID)
- Query params: `userId` (D2LID, optional); `roleId` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Access.UserAccess`
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.attempts
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/attempts/`
- Description: Retrieve a list of attempts for a survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID)
- Query params: `userId` (D2LID, optional — same name/semantics as `le.quizzes.attempts`; D2L returns **400 Bad Request** if the survey's `IsAnonymous` is true and `userId` is supplied, since anonymous attempts have no UserId to filter by — the instructor-facing tool needs to handle this case distinctly from a permission error)
- Response envelope: `objectListPage`
- Response block: `Surveys.SurveyAttemptData` — AttemptId, SurveyId, UserId (null if anonymous), AttemptNumber, Started, Completed
- Source: `res/survey.html`
- Confidence: verified
- Status: **existing** (`get_survey_attempts`, own-scoped) + **new curated** (`get_survey_results`, class-wide — both use this route)

### le.surveys.attemptGet
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/attempts/{attemptId}`
- Description: Retrieve a single survey attempt.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID), `attemptId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Surveys.SurveyAttemptData`
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.questions
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/questions/`
- Description: Retrieve all questions in a survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `SurveyQuestion.QuestionData` — docs state this is "identical to the quiz questions structure" (`Quiz.QuestionData`, see `le.quizzes.questions`)
- Source: `res/survey.html`
- Confidence: verified
- Status: **new curated** (`get_survey_questions`)

### le.surveys.specialAccessList
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/specialaccess/`
- Description: Retrieve special access rules for a survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Surveys.SpecialAccessUserData` — UserId, SpecialAccess (composite: Surveys.SpecialAccessData)
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.specialAccessGet
- Method/Path: `GET {orgUnitId}/surveys/{surveyId}/specialaccess/{userId}`
- Description: Retrieve one user's special access rule for a survey.
- Path params: `orgUnitId` (D2LID, auto-derived), `surveyId` (D2LID), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Surveys.SpecialAccessData` — StartDate, EndDate
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.categoriesList
- Method/Path: `GET {orgUnitId}/surveys/categories/`
- Description: Retrieve survey categories for an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `objectListPage`
- Response block: `Surveys.SurveyCategoryReadData` — CategoryId, Name, SortOrder
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

### le.surveys.categoryGet
- Method/Path: `GET {orgUnitId}/surveys/categories/{categoryId}`
- Description: Retrieve a single survey category.
- Path params: `orgUnitId` (D2LID, auto-derived), `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Surveys.SurveyCategoryReadData`
- Source: `res/survey.html`
- Confidence: verified
- Status: **catalog-only**

## Course Overview

### le.overview.get
- Method/Path: `GET {orgUnitId}/overview`
- Description: Retrieve the content overview for a course offering.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Overview.Overview` — Description (RichText), HasAttachment (bool)
- Source: `res/content.html`
- Confidence: verified
- Status: **new curated** (`get_course_overview`)

### le.overview.attachment
- Method/Path: `GET {orgUnitId}/overview/attachment`
- Description: Retrieve the content overview's file attachment for a course offering.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a — raw file stream
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

## Accommodations

### le.accommodations.forUser
- Method/Path: `GET accommodations/{orgUnitId}/users/{userId}`
- Description: Retrieve a specific user's accommodations profile in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived), `userId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Accommodations.UserAccommodations` — OrgUnitId, UserId, QuizzingAccommodations (composite: QuizzingControlAccommodation {AlwaysAllowRightClick}, QuizzingTimeLimitAccommodation {TimeLimitOperation, TimeMultiplier, AdditionalTime})
- Source: `res/accommodations.html`
- Confidence: verified
- Status: **catalog-only**

### le.accommodations.my
- Method/Path: `GET accommodations/{orgUnitId}/myaccommodations`
- Description: Retrieve the calling user's own accommodations profile in an org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: none documented
- Response envelope: `object`
- Response block: `Accommodations.UserAccommodations` (same as forUser)
- Source: `res/accommodations.html`
- Confidence: verified
- Status: **catalog-only**

## Cross-Org Calendar

### le.calendar.global.itemCountsForUser
- Method/Path: `GET calendar/events/{userId}/itemCounts`
- Description: Retrieve a count of a user's calendar events across their active enrolments (one EventCountInfo per org unit).
- Path params: `userId` (D2LID) — caller-supplied, not org-unit-scoped
- Query params: `association`/`eventType` (optional); `orgUnitIdsCSV` (CSV of D2LID, optional — defaults to all active enrolments); `startDateTime` (required, inclusive); `endDateTime` (required, exclusive)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventCountInfo`
- Source: `res/calendar.html`
- Confidence: verified (v1.94+)
- Status: **catalog-only**

### le.calendar.global.myEvents
- Method/Path: `GET calendar/events/myEvents/`
- Description: Retrieve the calling user's calendar events across a specified set of org units.
- Path params: none
- Query params: `association`/`eventType` (optional); `orgUnitIdsCSV` (required); `startDateTime`/`endDateTime` (required)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventDataInfo`
- Source: `res/calendar.html`
- Confidence: verified
- Status: **new curated** (`get_my_calendar_events`)

### le.calendar.global.myEventsItemCounts
- Method/Path: `GET calendar/events/myEvents/itemCounts/`
- Description: Retrieve a count of the calling user's calendar events across a specified set of org units.
- Path params: none
- Query params: `association`/`eventType` (optional); `orgUnitIdsCSV` (required); `startDateTime`/`endDateTime` (optional filters)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventCountInfo`
- Source: `res/calendar.html`
- Confidence: verified
- Status: **catalog-only**

### le.calendar.global.myEventsWithOccurrences
- Method/Path: `GET calendar/events/myEventsWithOccurrences/`
- Description: Retrieve the calling user's calendar events, with their occurrences, across a specified set of org units.
- Path params: none
- Query params: `association`/`eventType` (optional); `orgUnitIdsCSV` (required); `startDateTime` (required, inclusive); `endDateTime` (required, exclusive)
- Response envelope: `objectListPage`
- Response block: `Calendar.EventWithOccurrencesInfo`
- Source: `res/calendar.html`
- Confidence: verified (v1.94+)
- Status: **catalog-only**

## Cross-Org Content

### le.content.global.completionsForUser
- Method/Path: `GET content/completions/{userId}/`
- Description: Retrieve the count of completed and required content topics for a user, per org unit, across a supplied list of org units.
- Path params: `userId` (D2LID)
- Query params: `orgUnitIdsCSV` (CSV of D2LID, required, ≤100); `ignoreInvalid` (bool, optional — silently drops unauthorized/nonexistent org unit ids from `orgUnitIdsCSV` instead of erroring)
- Response envelope: `bareArray`
- Response block: `ContentCompletions.ContentLearnerProgress` — UserId, OrgUnitId, RequiredItems, CompletedItems
- Source: `res/content.html`
- Confidence: verified — an initial pass couldn't get this route's text out of a summarized fetch across 5 attempts and inferred `objectListPage`; a follow-up raw-HTML check confirmed the docs' return text has no hyperlink to either paging block (unlike every genuinely-paged sibling route on the same page), so the correct envelope is `bareArray`, and it surfaced the `ignoreInvalid` param that was missing from the first pass entirely.
- Status: **catalog-only**

### le.content.global.itemsForUser
- Method/Path: `GET content/items/{userId}`
- Description: Retrieve the scheduled items for a particular user, within a number of org units.
- Path params: `userId` (D2LID)
- Query params: `completion` (COMPLETION_T, optional); `orgUnitIdsCSV` (CSV of D2LID, required, ≤100); `startDateTime`/`endDateTime` (UTCDateTime, optional); `exemption` (EXEMPTION_T, optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItem` — UserId, OrgUnitId, ItemId, ItemName, ItemType, ItemUrl, StartDate, EndDate, DueDate, CompletionType, DateCompleted, ActivityType, IsExempt
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only** (requires permission to view another user's scheduled items, plus classlist access)

### le.content.global.myItems
- Method/Path: `GET content/myItems/`
- Description: Retrieve the calling user's scheduled items.
- Path params: none
- Query params: `completion` (optional); `orgUnitIdsCSV` (required, ≤100); `startDateTime`/`endDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItem`, sorted by earliest of start/end/due date
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.global.myItemsCompletions
- Method/Path: `GET content/myItems/completions/`
- Description: Retrieve the calling user's completed scheduled items.
- Path params: none
- Query params: `orgUnitIdsCSV` (required); `completedFromDateTime`/`completedToDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItem` (completed variant), sorted by completion date
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.global.myItemsCompletionsDue
- Method/Path: `GET content/myItems/completions/due/`
- Description: Retrieve the calling user's completed scheduled items that have a due date. Exempted items are considered not due and won't appear.
- Path params: none
- Query params: `orgUnitIdsCSV` (required); `completedFromDateTime`/`completedToDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItem`, sorted by completion date
- Source: `res/content.html`
- Confidence: verified
- Status: **existing** (`get_due_items`)

### le.content.global.myItemsDue
- Method/Path: `GET content/myItems/due/`
- Description: Retrieve the calling user's scheduled items still due, sorted by due date.
- Path params: none
- Query params: `completion` (optional); `orgUnitIdsCSV` (required); `startDateTime`/`endDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItem`
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.global.myItemsDueCounts
- Method/Path: `GET content/myItems/due/itemCounts/`
- Description: Retrieve the quantities of the calling user's scheduled items still due.
- Path params: none
- Query params: `completion` (optional); `orgUnitIdsCSV` (required); `startDateTime`/`endDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItemCount` — OrgUnitId, UserId, ItemCount
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.global.myItemsCounts
- Method/Path: `GET content/myItems/itemCounts/`
- Description: Retrieve the quantities of the calling user's scheduled items, organized by org unit.
- Path params: none
- Query params: `completion` (optional); `orgUnitIdsCSV` (required); `startDateTime`/`endDateTime` (optional)
- Response envelope: `objectListPage`
- Response block: `ScheduledItemCount`
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only**

### le.content.global.overdueItemsAll
- Method/Path: `GET overdueItems/`
- Description: Retrieve the overdue items for a particular user in a particular org unit. Exempted items are considered not due.
- Path params: none
- Query params: `userId` (D2LID, required); `orgUnitIdsCSV` (CSV of D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `OverdueItem` — UserId, OrgUnitId, ItemId, ItemName, DueDate
- Source: `res/content.html`
- Confidence: verified
- Status: **catalog-only** — org-wide/admin-scoped: docs describe self-access, auditor-of-auditee access, or instructor access to enrolled students in managed courses — broader than a plain course-instructor scope, distinct from `overdueItemsMy`

### le.content.global.overdueItemsMy
- Method/Path: `GET overdueItems/myItems`
- Description: Retrieve the calling user's overdue items, within a number of org units. Exempted items are considered not due.
- Path params: none
- Query params: `orgUnitIdsCSV` (CSV of D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `OverdueItem`
- Source: `res/content.html`
- Confidence: verified
- Status: **new curated** (`get_overdue_items`) — standard self-only scope, filtered to org units where the caller has Manage Content privileges

## CPD (Continuing Professional Development)

### le.cpd.categoryGet
- Method/Path: `GET cpd/category/{categoryId}`
- Description: Retrieve a category.
- Path params: `categoryId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Cpd.Category` — Id, Name, SortOrder, InUse
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only**

### le.cpd.methodGet
- Method/Path: `GET cpd/method/{methodId}`
- Description: Retrieve a method.
- Path params: `methodId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Cpd.Method` — Id, Name, SortOrder, InUse
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only**

### le.cpd.questionGet
- Method/Path: `GET cpd/question/{questionId}`
- Description: Retrieve a question.
- Path params: `questionId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Cpd.Question` — Id, QuestionText, SortOrder, InUse
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only**

### le.cpd.recordGet
- Method/Path: `GET cpd/record/{recordId}`
- Description: Retrieve a CPD record.
- Path params: `recordId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Cpd.Record` — RecordId, Name, UserId, Category (composite), Method (composite), IsStructured, IssuedId, DateCompleted, Grade, GradeObjectId, CreditMinutes, Attachments (null|{FileSetId, Files[]}), Answers (array), RecordStateId
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only**

### le.cpd.recordAttachment
- Method/Path: `GET cpd/record/{recordId}/attachment/{attachmentId}`
- Description: Retrieve an attachment from a CPD record.
- Path params: `recordId` (D2LID), `attachmentId` (D2LID)
- Query params: none documented
- Response envelope: `binary`
- Response block: n/a
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only**

### le.cpd.recordsForUser
- Method/Path: `GET cpd/record/user/{userId}`
- Description: Retrieve a paged list of CPD records for a user.
- Path params: `userId` (D2LID)
- Query params: `methodId`/`categoryId` (D2LID, optional); `recordName` (string, optional); `startDate`/`endDate` (UtcDateTime, optional); `recordStateId` (RECORDSTATE_T, optional); `sortDateAscending` (bool, optional, default false); `limit` (number, optional, default 20); `recordIdBookmark` (D2LID, optional)
- Response envelope: `objectListPage`
- Response block: `Cpd.RecordSummary` — RecordId, RecordName, CategoryName, MethodName, IsStructured, RecordStateId, CreditMinutes, DateCompleted
- Source: `res/cpd.html`
- Confidence: verified
- Status: **catalog-only** — likely elevated (manager/system-admin-level) CPD permission when fetching another user's records; not explicitly stated admin-only in the docs text extracted

### le.cpd.targetProgressForUser
- Method/Path: `GET cpd/target/progress/user/{userId}`
- Description: Retrieve a user's overall progress and their current progress for each category.
- Path params: `userId` (D2LID)
- Query params: `methodId`/`categoryId` (optional); `recordName` (optional); `startDate`/`endDate` (optional)
- Response envelope: `object`
- Response block: `Cpd.TargetProgress` — StartDate/EndDate, Structured ({Numerator, Denominator}), Unstructured ({Numerator, Denominator}), CategoryProgress (array)
- Source: `res/cpd.html`
- Confidence: verified — docs explicitly document a 403 "No permission to view this user's progress" response, confirming this is permission-gated when `userId` ≠ caller
- Status: **catalog-only**

## Cross-Org Dropbox

### le.dropbox.global.orgUnitsFeedback
- Method/Path: `GET dropbox/orgUnits/feedback/`
- Description: Retrieve the list of org units for which the current user has an assessment role on their dropbox folders (can see submissions and give feedback).
- Path params: none — **no `{orgUnitId}` in the path**, genuinely global
- Query params: `type` (integer, optional — 0 = all org units, 1 = active org units only)
- Response envelope: `bareArray`
- Response block: `OrgUnit.OrgUnitCoreInfo` (defined on `res/orgunit.html`, explicitly noted there as "for use by other services, for example, the Dropbox related actions") — Identifier (D2LID string), TypeIdentifier, Name, Code, Path, IsActive, StartDate, EndDate
- Source: `res/dropbox.html` (block defined on `res/orgunit.html`)
- Confidence: verified (independently confirmed by two research batches)
- Status: **catalog-only**

## Cross-Org Grades

### le.grades.global.courseCompletionForUser
- Method/Path: `GET grades/courseCompletion/{userId}/`
- Description: Retrieve all the course completion records for a user, across org units.
- Path params: `userId` (D2LID)
- Query params: `startExpiry`/`endExpiry` (UTCDateTime, optional); `bookmark` (string, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Grade.CourseCompletion`
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.global.myFinalValues
- Method/Path: `GET grades/final/values/myGradeValues/`
- Description: Retrieve a list of final grade values for the current user context across a number of org units.
- Path params: none
- Query params: `orgUnitIdsCSV` (CSV of D2LID, required, ≤100 — must be some or all of the caller's active enrolments)
- Response envelope: `objectListPage`
- Response block: `Grade.GradeValue` (final calculated grade values)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

### le.grades.global.valuesForUser
- Method/Path: `GET grades/values/{userId}`
- Description: Retrieve all the grade values in bulk for a particular user, across org units.
- Path params: `userId` (D2LID)
- Query params: `modifiedSince` (UTCDateTime, optional); `pageSize` (number, optional, 1-200)
- Response envelope: `objectListPage`
- Response block: `Grade.GradeValue` (Text-type grade values omit computable fields)
- Source: `res/grade.html`
- Confidence: verified
- Status: **catalog-only**

## Course Imports & Copying

### le.import.copyStatus
- Method/Path: `GET import/{orgUnitId}/copy/{jobToken}`
- Description: Retrieve the status of a queued course copy job request.
- Path params: `orgUnitId` (D2LID, auto-derived — target course offering), `jobToken` (string)
- Query params: none documented
- Response envelope: `object`
- Response block: `Course.GetCopyJobResponse` — Status (COPYJOBSTATUS_T, string enum)
- Source: `res/course.html` (not `res/import.html` — flagging as a non-obvious doc location)
- Confidence: verified
- Status: **catalog-only** — course-offering-scoped (course management/import permission), not necessarily system-admin

### le.import.importStatus
- Method/Path: `GET import/{orgUnitId}/imports/{jobToken}`
- Description: Retrieve the status of a queued course import job request.
- Path params: `orgUnitId` (D2LID, auto-derived), `jobToken` (string)
- Query params: none documented
- Response envelope: `object`
- Response block: `Course.GetImportJobResponse` — JobToken, TargetOrgUnitId, Status (COI_IMPORTJOBSTATUS_T)
- Source: `res/course.html`
- Confidence: verified
- Status: **catalog-only**

### le.import.importLogs
- Method/Path: `GET import/{orgUnitId}/imports/{jobToken}/logs/` (D2L's own docs literally spell the path param `orgUnitid`, lowercase `id` — a documentation typo, not a different parameter; see Corrections #6)
- Description: Retrieve the logs for a course import job.
- Path params: `orgUnitId` (D2LID, auto-derived), `jobToken` (string)
- Query params: `bookmark` (string, optional)
- Response envelope: `bookmarkPaged`
- Response block: `Course.ImportCourseLog` — LogId, ConversionImportJobId, OperationTypeId, LogDateTime, Message, TypeId
- Source: `res/course.html`
- Confidence: verified
- Status: **catalog-only**

## Cross-Org Learning Outcomes

### le.learningOutcomes.global.outcomeAlignments
- Method/Path: `GET lo/alignments/outcome/{outcomeId}`
- Description: Retrieve the org units that contain alignments to a given outcome.
- Path params: `outcomeId` (GUID)
- Query params: `assessableOnly` (bool, optional); `activeOnly` (bool, optional — only active org units)
- Response envelope: `bareArray`
- Response block: `Outcomes.OutcomeAlignment` — OutcomeId, AlignedOrgUnits (array of D2LID)
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.global.outcomeSetAlignments
- Method/Path: `GET lo/alignments/outcomeSet/{outcomeSetId}`
- Description: Retrieve the org units that contain alignments to a given outcome set.
- Path params: `outcomeSetId` (D2LID)
- Query params: `assessableOnly`/`activeOnly` (bool, optional)
- Response envelope: `bareArray`
- Response block: `Outcomes.OutcomeAlignment`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.global.outcomeSetsList
- Method/Path: `GET lo/outcomeSets/`
- Description: Retrieve all organization-level outcome sets.
- Path params: none
- Query params: none documented
- Response envelope: `bareArray`
- Response block: `Outcomes.OutcomeSet`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

### le.learningOutcomes.global.outcomeSetGet
- Method/Path: `GET lo/outcomeSets/{outcomeSetId}`
- Description: Retrieve a specific organization-level outcome set.
- Path params: `outcomeSetId` (D2LID)
- Query params: none documented
- Response envelope: `object`
- Response block: `Outcomes.OutcomeSet`
- Source: `res/outcomes.html`
- Confidence: verified
- Status: **catalog-only**

## Course Copy Logs (`ccb`)

*(renamed from "Course Structure & Org Units" — the research pass found this category name doesn't
match any real `/d2l/api/le/` section; `le.ccb.logs` is a course-copy job log route, not an
org-structure route. See Corrections #7 for the real org-structure API, which lives under `lp`
and is out of scope for this change.)*

### le.ccb.logs
- Method/Path: `GET ccb/logs`
- Description: Retrieve logs for course-copy ("Course Copy Block") jobs, org-wide and filterable — distinct from `le.import.importLogs`, which is scoped to one specific job/org unit.
- Path params: none
- Query params: `bookmark` (string, optional); `pageSize` (number, optional, default 20, max 100); `sourceOrgUnitId`/`destinationOrgUnitId` (number, optional); `subOrganizationOrgUnitId` (D2LID, optional — both source and destination must be descendants of it); `startDate`/`endDate` (UTCDateTime, optional)
- Response envelope: `bookmarkPaged` — corrected during implementation: the original research
  reported `objectListPage`, which is internally inconsistent with this route's own documented
  `bookmark` query param (every other route in this catalog with a `bookmark` param uses the
  `Api.PagedResultSet` convention). A unit test against the implementation's `objectList`
  handling failed exactly this way (`Objects is not iterable`), which is what surfaced it.
- Response block: `Course.CopyCourseLogMessage` — LogId, CopyCourseJobId, LogDateTime, Message
- Source: `res/course.html`
- Confidence: verified path/params; envelope corrected as above
- Status: **catalog-only**

## Cross-Org News

### le.news.global.forUser
- Method/Path: `GET news/user/{userId}/`
- Description: Retrieve news items for a specific user across the entire organization (all org units, not scoped to one course). Subject to User Information Privacy permission controls.
- Path params: `userId` (D2LID) — no `orgUnitId`
- Query params: `since`/`until` (UTCDateTime, optional)
- Response envelope: `objectListPage`
- Response block: `News.NewsFeed` — OrgUnitId (D2LID), Resource (composite: `News.NewsItem`, see `le.news.list`)
- Source: `res/news.html`
- Confidence: verified (independently confirmed by two research batches)
- Status: **catalog-only**

## Updates & Activity

### le.updates.myUpdates
- Method/Path: `GET {orgUnitId}/updates/myUpdates`
- Description: Retrieve counts of unread/pending updates for the current user, scoped to one org unit.
- Path params: `orgUnitId` (D2LID, auto-derived)
- Query params: `updateTypesCSV` (CSV of UPDATETYPES_T, optional — restrict to specific types; all types returned if omitted)
- Response envelope: `object`
- Response block: `Updates.OrgUnitUpdates` — OrgUnitId, UserId, UnreadDiscussions, UnapprovedDiscussions, UnreadAssignmentFeedback, UnattemptedQuizzes, UnreadAssignmentSubmissions, UngradedQuizzes (a type not requested via `updateTypesCSV` is returned as `-1`)
- Source: `res/updates.html`
- Confidence: verified
- Status: **catalog-only**

### le.updates.global.myUpdates
- Method/Path: `GET updates/myUpdates/`
- Description: Retrieve update counts for the current user across several org units in one call.
- Path params: none
- Query params: `orgUnitIdsCSV` (CSV of D2LID, **required**, max 100); `updateTypesCSV` (CSV of UPDATETYPES_T, optional)
- Response envelope: `objectListPage`
- Response block: `Updates.OrgUnitUpdates` (array, same shape as `le.updates.myUpdates`)
- Source: `res/updates.html`
- Confidence: verified
- Status: **new curated** (`get_recent_updates`)

---

## LP-namespace routes found (out of scope)

Found while researching "Course Structure & Org Units" — the real org-unit hierarchy API. **Not
counted in the 190-route total, not added to the catalog, per `design.md`'s explicit LP Non-Goal.**
Listed here so a future change populating LP routes doesn't have to rediscover them. All are
`GET`, relative to `/d2l/api/lp/{version}`, documented on `res/orgunit.html`:

- `orgstructure/` — list all org units (filterable by type/code/name), `bookmarkPaged`, `OrgUnit.OrgUnitProperties`
- `orgstructure/{orgUnitId}` — one org unit's properties, `object`, `OrgUnit.OrgUnit`
- `orgstructure/{orgUnitId}/ancestors/` — ancestor org units, `bareArray`
- `orgstructure/{orgUnitId}/children/` — immediate children, `bareArray` (docs recommend the paged variant for large results)
- `orgstructure/{orgUnitId}/children/paged/` — immediate children, `bookmarkPaged`
- `orgstructure/{orgUnitId}/colours` — branding colour scheme, `object`, `OrgUnitEditor.ColourScheme`
- `orgstructure/{orgUnitId}/descendants/` — all descendants, `bareArray` (docs recommend the paged variant)
- `orgstructure/{orgUnitId}/descendants/paged/` — all descendants, `bookmarkPaged`
- `orgstructure/{orgUnitId}/parents/` — immediate parents, `bareArray`
- `orgstructure/childless/` — org units with no children, `bookmarkPaged`
- `orgstructure/orphans/` — org units with no parents, `bookmarkPaged`
- `orgstructure/recyclebin/` — archived/recycled org units, `bookmarkPaged`
- `organization/info` — root organization identifier/name/timezone, `object`, callable anonymously
- `organization/primary-url` — root organization's primary URL, `binary` (`text/plain`), callable anonymously
- `outypes/` — all org unit types, `bareArray`, `OrgUnit.OrgUnitType`
- `outypes/{orgUnitTypeId}` — one org unit type, `object`
- `outypes/department` — the built-in "Department" type, `object`
- `outypes/semester` — the built-in "Semester" type, `object`

---

## Notes for whoever populates `d2lRouteCatalog.ts` from this file

- Every route above now has a documented (or explicitly `inferred`) path-param and query-param
  shape — translating each into a `zod` schema (task 1.1/1.2) is now largely mechanical
  transcription rather than research. The handful marked `inferred` (see per-route
  "Confidence" lines, and `le.content.global.completionsForUser` in particular) are worth a
  live spot-check against a real response before locking in their schema, since they weren't
  confirmed against raw doc text the way every `verified` entry was.
- `orgUnitId` path params are consistently `D2LID`, i.e. `z.number()` (D2L's numeric org unit
  id) — the catalog should coerce/validate accordingly and never accept it as a direct tool
  input for `scope: "course"` routes (see Decision 3 in `design.md`).
- Three routes have genuinely no `{orgUnitId}` at all (the Auditing trio) and one more has none
  despite being dropbox-related (`le.dropbox.global.orgUnitsFeedback`) — these need
  `scope: "global"` with zero implicit param injection, distinct from every other
  `global`/`user`-scoped route in this file, which takes at least a `userId` or an
  `orgUnitIdsCSV`.
- IPSIS integration (`POST /d2l/api/le/{version}/ipsis/upload/{sourceSystemId}/signedurl`) has
  no `GET` route and is correctly absent from this catalog.
- `RichText`, `Access.UserAccess`, and a handful of other composite types recur across dozens
  of routes — worth defining once as shared `zod` fragments in `d2lRouteCatalog.ts` rather than
  redeclaring per route, mirroring how this file reuses "(same as X)" instead of re-listing
  fields.
