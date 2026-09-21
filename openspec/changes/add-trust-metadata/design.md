# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- Tool results are `JSON.stringify`'d into one text content block (`tools/helpers.ts`). Some tools
  return objects (`get_announcements`, `get_assignments`, `get_classlist`, `get_course_content`,
  cross-school feeds); many return **raw D2L arrays** (`get_quizzes`, `get_calendar_events`,
  `get_discussion_*`, …) and the live test oracle asserts several of those are arrays, so their top
  level cannot change type.
- Deep links already exist for three item kinds (assignment, quiz, gradebook row in
  `get_assignments`), built in `utils/deep-links.ts` from a tenant base URL — the seed of the
  registry this change formalises.
- Times come from D2L in UTC (`…Z`); the pages show Singapore time.
- The two Brightspace tenants are `nyplms.polite.edu.sg` (NYP; the test account is a Tutor in one
  course and a Learner in eight) and `lms.polite.edu.sg` (POLITEMall; Learner in two).
- STEP is a different system: `stms.polite.edu.sg/student/`, a single-page app over
  `/studentapi/api/v1/...` (the paths the client already uses). Every address returns HTTP 200 and
  the document title barely changes, so a link can only be judged by what the rendered page shows.
  IDs are GUIDs. The test account has one enrolled course (an NYP course) and the public catalogue.

**What the research says (why the design is shaped this way).** A controlled study found citations
raised trust even when random, and lowered it when participants checked them
([arXiv 2501.01303](https://arxiv.org/abs/2501.01303)); a larger study found hover/click rates
under 25% while satisfaction stayed high ([arXiv 2602.06718](https://arxiv.org/html/2602.06718v1)).
Work on MCP agents names the failure "cross-source conflation": a claim is supported somewhere but
credited to the wrong source ([arXiv 2606.18037](https://arxiv.org/abs/2606.18037)). Consequences:
(1) a link must survive being clicked, so we only emit *verified* patterns and prove them; (2) the
link must be bound to the item it supports; (3) absence must be honest; (4) do not add decorative
links — every link must let the user confirm a specific fact.

### Verified link matrix (tested 2026-09-20 in a signed-in session on both sites)

Method: real IDs discovered through the API for the account's own courses; each candidate opened
with the session, redirects followed; verdict = HTTP 200, not a D2L error page, no sign-in redirect,
and the page `<title>` contains the item's name (or, where the page is a single-page app titled
"Loading…", the item id survives in the final address). A deliberately wrong id was opened for each
kind ("NEG") to see how a bad link fails.

| Kind | Pattern (`{ou}` = org unit) | NYP | POLITEMall | Identity signal | Wrong id → |
|---|---|---|---|---|---|
| Course home | `/d2l/home/{ou}` | ✅ | ✅ | title has course name (some courses redirect to `/d2l/le/sequenceLauncher/{ou}/View`) | 404 page |
| Announcement | `/d2l/le/news/{ou}/{newsId}/view` | ✅ | ✅ | title = announcement title | 404 page |
| Announcements list | `/d2l/lms/news/main.d2l?ou={ou}` | ✅ | ✅ | "Announcements – course" | — |
| Content topic | `/d2l/le/lessons/{ou}/topics/{topicId}` | ✅ both UIs | ✅ | id kept in final URL: Lessons UI keeps the path; the sequence viewer redirects to `/d2l/le/enhancedSequenceViewer/{ou}?redirect=true&url=…` containing it. Title is "Loading…" so title cannot identify it | 404 page |
| Content root | `/d2l/le/lessons/{ou}` | ✅ | ✅ | "Loading… – course" | — |
| Classlist | `/d2l/lms/classlist/classlist.d2l?ou={ou}` | ✅ | ✅ | "Classlist – course" | — |
| Discussion topic | `/d2l/le/{ou}/discussions/topics/{topicId}/View` | ✅ | ✅ | title = topic name | 404 page |
| Discussions list | `/d2l/le/{ou}/discussions/List` | ✅ | ✅ | "Discussions List – course" | — |
| Assignment | `/d2l/lms/dropbox/user/folder_submit_files.d2l?db={id}&grpid=0&ou={ou}` | ✅ | ⚠️ not tested (no folder in the account's POLITEMall courses) | title = folder name | 403 "Not authorised" |
| Submission history | `/d2l/lms/dropbox/user/folders_history.d2l?ou={ou}` | ✅ as a Learner (**403 as a Tutor** — learner page; no tool emits it) | ⚠️ not tested | "Submission History – course" | — |
| Quiz | `/d2l/lms/quizzing/user/quiz_summary.d2l?qi={id}&ou={ou}` | ✅ | ✅ | title = "Summary – quiz name" | 500 "Internal Error" page |
| Quiz list | `/d2l/lms/quizzing/user/quizzes_list.d2l?ou={ou}` | ✅ | ✅ | "Quiz List – course" | — |
| Survey | `/d2l/lms/survey/user/survey_activities.d2l?si={id}&ou={ou}` | ✅ | ✅ | title = "Assessments – survey name" | 403 "Not authorised" |
| Survey list | `/d2l/lms/survey/user/surveys_list.d2l?ou={ou}` | ✅ | ✅ | "Survey List – course" | — |
| My grades | `/d2l/lms/grades/my_grades/main.d2l?ou={ou}` | ✅ | ✅ | "Grades – course" | 500 (not enrolled) |
| Course calendar | `/d2l/le/calendar/{ou}` | ✅ | ✅ | "Calendar Agenda View – course" | — |
| Calendar event | **D2L-supplied** `CalendarEventViewUrl` = `/d2l/le/calendar/{ou}/event/{occurrenceId}/detailsview` | ✅ | ⚠️ not tested | title "Course Schedule – course" + event in page | — |
| Groups | `/d2l/lms/group/user_group_list.d2l?ou={ou}` | ✅ page opens (course has none) | ✅ | "Groups – course" | — |
| School home | `/d2l/home` | ✅ | ✅ | "Homepage – school" | — |
| Grader: gradebook | `/d2l/lms/grades/admin/enter/user_list_view.d2l?ou={ou}` | ✅ as Tutor | — no staff role | "User List – course" | **403 as a Learner** |
| Grader: assignments | `/d2l/lms/dropbox/admin/folders_manage.d2l?ou={ou}` | ✅ as Tutor | — | "Assignments – course" | **403 as a Learner** |
| Grader: quizzes | `/d2l/lms/quizzing/admin/quizzes_manage.d2l?ou={ou}` | ✅ as Tutor | — | "Manage Quizzes – course" | — |

Findings that drive decisions:

1. **Calendar event ids differ.** Building `/calendar/{ou}/event/{CalendarEventId}/detail|view`
   gave 404; D2L's own `CalendarEventViewUrl` uses a different (occurrence) id and works. → use
   D2L-supplied URLs where they exist (Decision 2).
2. **A wrong link is visibly an error, not a wrong item** (404/403/500 pages) — good, but it means a
   bad link *looks* like a broken server. → only emit ids read in the same request.
3. **Survey pages**: guessed `survey_summary` / `survey_submit` routes 404. The real route was read
   from the survey list page's own script (`GoToSurvey` → `survey_activities.d2l?si=`).
4. **Instructor pages enforce permission** (403 for a Learner), so a link cannot widen access.
5. **Two content UIs** exist; the same link pattern works in both but the verification signal
   differs (title vs preserved id).
6. **Times**: API `2026-09-09T05:23:00.000Z` ↔ page "09 September 2026 1:23 PM" → UTC+8.
7. **Not verified, so not emitted**: item-level grader pages (folder submissions, quiz attempts,
   survey results — no items exist in the Tutor course), per-grade-item and per-rubric pages (none
   exist), a course-overview page (the candidate route 404s). POLITEMall assignment/history/calendar-event links are unverified because no such item
   exists in its accessible courses.

### STEP (`stms.polite.edu.sg/student/`), tested 2026-09-20 in the same signed-in browser

Method differs because STEP is a single-page app: each address was **navigated to in the
browser**, allowed to render, and the visible page text read. HTTP status and title are useless
here (200 and "Course details" for everything, including a missing course).

| Kind | Pattern | Result | Identity signal | Wrong id → |
|---|---|---|---|---|
| My courses list | `/student/mycourse` | ✅ | lists "[NYP-CE1510] Demystify Generative Artificial Intelligence" | — |
| Enrolled course (details **and** timetable/attendance) | `/student/mycourse/details/{courseId}/{institute}/coursedetails` | ✅ | page shows course name, "Session timetable details" with each session, "Current attendance percentage" | bad `courseId` → visible message "The MyCourse doesn't exist." (still HTTP 200, title unchanged) |
| Catalogue (browse) course | `/student/ihlcourse/detail/{id}` | ✅ **only with the catalogue item's `id`** | page shows the course name and Apply / interest buttons | using the item's `courseId` → **blank render, no error** |
| All courses / catalogue home | `/student/` | ✅ | "All courses" list; also shows the portal **banner** announcement | — |
| Calendar | `/student/calendar` | ✅ month view (no per-course deep link) | month grid | — |
| Profile | `/student/profile` | ✅ | "Personal particular" | — |
| Announcements page | `/student/profile/announcements` | ✅ opens, but lists a **different** feed (finding 3) | "Student Portal — Welcome to STEP!" | — |

STEP findings that drive decisions:

1. **The `{institute}` segment is the course's `institute` field** (NYP = 4 in the API and in the
   URL). A different number still resolved the right course, so the page keys on `courseId`; we
   pass the real value anyway. Only an NYP course could be tested, so other institutes are an
   explicit gap.
2. **The catalogue page keys on the catalogue item's `id` (an intake id), not its `courseId`.** The
   current `search_step_courses` mapper keeps `courseId` and drops `id`, so it cannot build a working
   link today. Wrong id → blank page with no error — the worst failure mode, and the reason a blank
   render must count as a failure in verification.
3. **STEP has two announcement feeds.** `get_step_announcements` calls `POST /announcements` and
   returns the home-page banner ("Anti-Scam Message", 26 Jun 2025); the Announcements page calls
   `POST /announcements/paging` and lists a different item ("Student Portal", 23 May 2024). Linking
   the Announcements page would make a correct answer look wrong. → link the home page, where the
   returned banner is displayed (verified), and record the mismatch for a separate decision.
4. **One page serves two tools.** The enrolled-course page shows both the course detail
   (attendance, enrolment status) and the session timetable, so `get_step_course_detail` and
   `get_step_timetable` share a link.
5. **Times**: STEP shows `DD/MM/YYYY HH:mm` in Singapore time; the API sends `+00:00`
   (`2026-10-06T01:00:00+00:00` ↔ "06/10/2026 09:00").
6. **Not linked**: the calendar has no course or session deep link; applications, awards,
   transactions and tasks pages exist but no tool returns their data.

### Link policy per tool (all 41 decided, so none is silently forgotten)

| Tool | Link |
|---|---|
| `list_courses` | item `sourceUrl` = course home, per course |
| `get_course_content` | item `sourceUrl` per topic (content topic); `pageUrl` = content root |
| `get_content_topic` | `sourceUrl` = content topic |
| `get_course_overview` | `pageUrl` = course home |
| `get_grades`, `get_my_final_grade` | `pageUrl` = my grades |
| `get_class_grades`, `get_all_final_grades` | `pageUrl` = gradebook (grader-only) |
| `get_announcements` | item `sourceUrl` per announcement; `pageUrl` = announcements list |
| `get_calendar_events`, `get_my_calendar_events` | item `sourceUrl` = D2L `CalendarEventViewUrl`; else course calendar `pageUrl` |
| `get_assignments` | item `sourceUrl` per assignment/quiz (exists); grade-only rows → my grades |
| `get_assignment_files` | `pageUrl` = the assignment |
| `get_my_dropbox_submission` | `pageUrl` = the assignment (the result is a list of submissions, not linkable items) |
| `get_dropbox_submissions` | dual-audience: grader → assignments management; otherwise the assignment |
| `get_quizzes` | item `sourceUrl` per quiz; `pageUrl` = quiz list |
| `get_quiz_attempts`, `get_quiz_questions` | `pageUrl` = the quiz (attempts and questions are not separately linkable) |
| `get_quiz_results` | `pageUrl` = quizzes management (grader-only) |
| `get_surveys` | item `sourceUrl` per survey; `pageUrl` = survey list |
| `get_survey_attempts`, `get_survey_questions` | `pageUrl` = the survey |
| `get_survey_results` | `pageUrl` = survey list (grader-only; item grader page unverified) |
| `get_discussion_forums` | `pageUrl` = discussions list |
| `get_discussion_topics` | item `sourceUrl` per topic |
| `get_discussion_posts` | `pageUrl` = the topic (posts are not separately linkable) |
| `get_classlist` | `pageUrl` = classlist; no per-person links |
| `get_groups` | `pageUrl` = groups |
| `get_rubrics` | `pageUrl` = page of the object the rubric is attached to (assignment / discussion topic), else course home |
| `get_due_items`, `get_overdue_items`, `get_recent_updates` | per-row `sourceUrl` = that course's home; `pageUrl` = school home |
| `list_d2l_operations`, `call_d2l_operation` | none (raw catalog/passthrough) — provenance statement only |
| `list_step_courses` | item `sourceUrl` = enrolled course page, per course (needs `institute`); `pageUrl` = my courses |
| `search_step_courses` | item `sourceUrl` = catalogue course page (needs the catalogue `id`); `pageUrl` = All courses |
| `get_step_course_detail` | `sourceUrl` = enrolled course page; `pageUrl` = my courses |
| `get_step_timetable` | per-session `sourceUrl` = enrolled course page (lists the sessions); `pageUrl` = calendar |
| `get_step_announcements` | `pageUrl` = STEP home (banner feed); **not** the Announcements page |
| `whoami` | Brightspace identity has no page; the STEP part links the profile page as `pageUrl` |
| `search_politemall_catalog` | none — its own marketing site, no per-item verified page |

## Goals / Non-Goals

**Goals:** every link a tool returns opens the page it claims; a model never has to invent one; a
date never looks wrong against the page; the guarantee is checkable by re-running a script, not
asserted.

**Non-Goals:**
- Verifying that a model's *statements* match the data (post-hoc claim checking such as the
  ProvenanceGuard approach). We supply correct evidence; we do not police the answer.
- Quoting screenshots or page excerpts as evidence (possible later; not needed to make links work).
- Item-level grader pages, per-person or per-grade-item links, and STEP pages no tool returns data for
  (applications, awards, transactions, tasks).
- Making a link work for someone who is not signed in (they reach the school's sign-in first).
- Changing any existing field, error message, tool name or array/object shape.

## Decisions

### 1. One link registry; nothing else builds a URL

`utils/deep-links.ts` becomes a typed registry: one function per verified pattern, taking the
school and integer ids (validated finite positive integers), returning an absolute `https` URL on
the school's fixed host. A lint-style unit test greps `src/tools` and `src/api` for `polite.edu.sg`
and `d2l/` string literals outside the registry. A `VERIFIED` table records, per pattern and per
system (NYP, POLITEMall, STEP), whether it has been verified; an unverified pair returns `undefined` (no link). Today that
means POLITEMall assignment/history/calendar-event links are off until someone verifies them.
*Alternative rejected:* build URLs ad hoc in each tool (what three tools do now) — drift and no
single place to switch a pattern off.

### 2. Prefer D2L-supplied URLs; validate them

For calendar events use `CalendarEventViewUrl`. `sameTenantUrl(school, url)` accepts only `https`,
the school's exact host, no userinfo, no port, a path beginning `/d2l/`; anything else yields no link
(and is never passed through). *Alternative rejected:* construct from `CalendarEventId` (404s).

### 3. Bind evidence to the item, plus a small provenance statement

- Object results: each item gets `sourceUrl`; the object gets `pageUrl` where applicable and a
  `provenance` block `{ source: "NYP Brightspace", retrievedAt, timezone: "Asia/Singapore (+08:00)" }`
  (cross-school results: `sources: [...]`, one `retrievedAt`).
- **Raw-array results stay arrays** (compatibility with the oracle and current clients): `sourceUrl`
  is added to each element, and provenance travels in a **second text content block**
  (`Source: NYP Brightspace — retrieved 2026-09-20T05:12Z; times in Singapore time. Page: <url>`).
  This mirrors the existing convention that content block 0 stays a pure JSON document.
*Alternatives rejected:* a list of links at the end only (invites cross-source conflation);
wrapping arrays in objects (breaking); MCP `structuredContent`/`outputSchema` (forces every agent
to learn a schema and would change shapes).

### 4. Times as the page shows them

`toSgt(iso)` returns the same instant with an explicit `+08:00`; Singapore has no DST so a fixed
offset is exact. Added as `<field>Sgt` beside `dueDate`, `startDate`, `endDate`, announcement
`date`, `submittedDate`, event start/end, due/overdue `dueDate`, and the raw quiz/topic date fields.
Original UTC stays. Null/invalid → no companion. *Alternative rejected:* replace UTC with local
(breaking, and loses precision for downstream use).

### 5. Tell the agent how to cite, in the two places it reads

`server.ts` sets the MCP server `instructions` (delivered at initialize), and each linking tool's
description says it returns `sourceUrl`/`pageUrl`. The text: cite each fact with the
item's `sourceUrl` as an inline link; use only links from those fields, never build or edit one;
say when an item has none; quote the `…Sgt` value for dates; mention retrieval time when the
answer can go stale; treat links inside body text as untrusted. *Alternative rejected:* teaching a
URL template ("`/d2l/le/news/{ou}/{id}/view`") — that is exactly the model-built link that goes
wrong.

### 6. Trusted vs untrusted links

Items whose text can contain links written by other people (announcement bodies, discussion posts,
topic descriptions) add a single flag in the provenance block — `untrustedLinksInText: true` —
when any such text contains a URL (cheap regex). Together with the instructions this marks the
prompt-injection-adjacent surface; it does not sanitise the text.

### 7. Optional `resource_link` blocks, off by default

`SOURCE_RESOURCE_LINKS=on` appends one `resource_link` per distinct page with
`annotations.audience = ["user"]`. Off by default because client rendering varies and the spec
says `https` resource URIs are intended for resources clients can fetch themselves (these need the
user's login). The JSON fields remain the reliable channel. A separate kill switch
`SOURCE_LINKS=off` removes all link/provenance additions (rollback without a redeploy of code).

### 8. Verification is a first-class artefact

- **Unit level** (CI, no sessions): builders produce exact strings; ids validated; host allowlist;
  no secret-looking parameters; every one of the 41 tools has an entry in a `link-policy` table
  (`item` / `page` / `none` + reason) — adding a tool without deciding fails the build.
- **Live level, STEP** cannot use `fetch`: the check navigates the browser to each collected STEP
  link, waits for the render and reads the visible text — item name present, no "doesn't exist"
  message, and a **blank render counts as a failure**. It is a documented procedure plus a small
  DOM-reading snippet, run in the same browser sessions as the Brightspace check.
- **Live level** (local, needs sessions): `run-oracle.mjs --collect-links` records each link a
  tool returns with its item name/type/school; `test-oracle/verify-links.js` (run in a signed-in tab
  per school, like the manual check above) opens each, applies the title / preserved-id rule, and
  opens a deliberately wrong id per kind. Output is a pass/fail table; a school with no session
  reports "unverified", never pass. This is the check that produced the matrix above, made
  repeatable.

### 9. Sizing

An absolute link is ~65–90 characters; with key and punctuation ~100 per item. Measured baselines:
`get_announcements` 10 items ≈ +1 KB on 7 KB; `get_course_content` for a 102-topic course ≈ +9 KB
on 37 KB (+25%). Accepted: existing filters (`count`, `moduleTitle`, `typeFilter`, `maxDepth`)
already let an agent narrow, and the kill switch exists. Task 6.3 re-measures on real output.

### 10. STEP client carries the ids the pages need

`api/step-client.ts` keeps the enrolled course's `institute` and the catalogue item's `id`
internally (they are already in the API responses it reads) so the tool layer can build the link
from what it just read. No output field is added: the link is the only consumer. *Alternative
rejected:* build the link from `courseId` alone (catalogue pages then render blank).

### 11. Link to where the data is shown, not where it is named

Where a system has two feeds a user would call by the same name (STEP announcements), the link
follows the feed the tool actually returned (home page banner). Whether the tool should *also*
return the Announcements-page feed is a separate behaviour change and stays out of this change
(Open Questions).

## Risks / Trade-offs

- **D2L changes a page route** (two content UIs already coexist) → the live check is one command;
  the `VERIFIED` table lets one pattern be switched off instantly; the kill switch disables all.
- **A verified pattern fails for one course type** (e.g. content topics in a third interface) →
  identity check for content topics is "id preserved", weaker than a title match; documented, and
  the check reports the observed final address so drift is visible.
- **Links raise trust regardless of quality** (the research) → we restrict to verified patterns,
  bind per item, omit rather than guess, and re-verify; we also avoid decorative links (no per-person
  or per-grade-item links).
- **User not signed in** → they land on the Microsoft sign-in; guidance tells the agent to say the
  link needs a school login. No data is exposed by the link itself.
- **Timezone assumption** → both tenants are Singapore institutions and the page offset was
  verified; a user whose D2L profile uses another zone would see a different page time. D2L's API
  exposes no user timezone (the probe returned 404), so the companion is labelled `Sgt` and never
  replaces the UTC value.
- **Trust theatre in the other direction** → a link to a page the user cannot open (no access) reads
  as a broken answer. Mitigated: links are only emitted for items the tool returned, i.e. items the
  caller can already read.
- **POLITEMall coverage gap** (assignment/history/event links unverified) → those emit nothing on
  POLITEMall until verified; recorded as an open question with the unblocking condition.
- **STEP is a single-page app** (200 and a generic title for any address) → verification renders
  the page and reads content; a wrong id is either a visible message or a blank page, both handled.
- **STEP blank-render failure** (catalogue link built with `courseId`) → the link is built only from
  the catalogue `id`, a unit test pins that, and a blank render fails the live check.
- **STEP institutes other than NYP untested** → the link uses the course's own `institute`; the
  verification report lists the institutes it covered so the gap is visible.
- **STEP feed mismatch** → link the page that shows the data returned; see Decision 11.
- **Text-body links remain a prompt-injection channel** → flagged and instructed against, not
  removed.

## Migration Plan

1. Land registry, policy table and tests with no tool changes (no behaviour change).
2. Add links + `Sgt` fields tool group by tool group; each group's existing oracle cases must pass
   unchanged (the oracle already tolerates extra fields).
3. Add instructions and provenance blocks; deploy with `SOURCE_LINKS` default on.
4. Run the live oracle and the link check on both schools; fix or switch off failing patterns.
5. Rollback: set `SOURCE_LINKS=off` in the container environment (no code revert); results return
   to today's shape.

## Open Questions

- Which POLITEMall course will provide an assignment folder and a calendar event so those patterns
  can be verified there? (Until then they emit nothing on POLITEMall; enabling is one table entry.)
- Is `resource_link` rendered usefully by the clients this server is used with (Claude, Copilot
  Studio, others)? Decide after trying `SOURCE_RESOURCE_LINKS=on`; does not affect the fields.
- Should `get_step_announcements` also return the Announcements-page feed (`/announcements/paging`,
  currently a different item) so both feeds a user can see are covered? It changes tool behaviour,
  so it is deliberately not part of this change; the link plan is correct either way.
- Should very large content trees (> ~60 topics) drop per-topic links by default? Decide from the
  measurement in task 6.3; either answer keeps the specs true.
