# Tasks

All paths are under `server/control-plane/` unless stated. Run the suite with `npm test` (currently
131 tests) after each group; the live oracle is in the untracked `test-oracle/` folder.

## 1. Link registry (no tool changes yet)

- [x] 1.1 Extend `src/utils/deep-links.ts` into a registry with one builder per verified pattern
      from the matrix in `design.md` (course home, announcement + list, content topic + root,
      classlist, discussion topic + list, assignment + submission history, quiz + list, survey +
      list, my grades, course calendar, groups, school home, and the three grader pages) and for STEP
      (my courses, enrolled course page from `{courseId}` + `{institute}`, catalogue course page
      from the catalogue item `id`, All courses/home, calendar, profile). Brightspace builders take
      the school and integer ids (validated finite positive integers); STEP builders take GUIDs
      (validated against the GUID shape) and the integer institute. Each returns an absolute `https`
      URL on the fixed host. Verify with `tests/utils/deep-links.test.ts` asserting the exact string
      for every builder on every host, rejection of `NaN`, `0`, negatives, floats and strings, and
      rejection of a non-GUID or path-traversal string for STEP ids.
- [x] 1.2 Add the per-(pattern, school) `VERIFIED` table: every pattern true for NYP; true for
      POLITEMall except assignment, submission history and calendar event (and the grader pages,
      which POLITEMall's account cannot open); every STEP pattern true (verified for an NYP-institute
      course only, recorded in the table); an unverified pair returns `undefined`. Verify with
      a test that iterates the table and asserts POLITEMall assignment links are `undefined` while
      its quiz link is defined.
- [x] 1.3 Add `sameTenantUrl(school, url)` for D2L-supplied URLs: accepts only `https`, the school's
      exact host, no userinfo, no explicit port, and a path starting `/d2l/`; otherwise
      `undefined`. Verify with tests for a foreign host, a look-alike host
      (`nyplms.polite.edu.sg.evil.com`), `http`, `javascript:`, `//host/path`, a relative URL, a URL
      with credentials, and the real NYP `CalendarEventViewUrl` from the design (accepted).
- [x] 1.4 Add a source-scanning test that fails if any file under `src/tools` or `src/api`
      contains a `polite.edu.sg`, `/d2l/` or `/student/` string literal outside the registry, and a test that no
      builder output contains `token`, `cookie`, `session`, `Bearer` or an email-like string.
      Verify by running `npm test` and by temporarily inserting a literal to see the test fail.
- [x] 1.5 Add config switches in `src/utils/config.ts`: `SOURCE_LINKS` (default on; `off` disables
      every link/provenance addition) and `SOURCE_RESOURCE_LINKS` (default off). Verify with a
      config test covering unset, `on`, `off` and junk values (junk = default).

## 2. Provenance helpers

- [x] 2.1 Add `src/utils/local-time.ts` with `toSgt(iso)` returning the same instant as
      `YYYY-MM-DDTHH:mm:ss+08:00`, `undefined` for null/unparseable. Verify with tests including
      the three verified pairs (`2026-09-09T05:23:00.000Z` → `2026-09-09T13:23:00+08:00`,
      `2026-10-01T04:00:00.000Z` → `2026-10-01T12:00:00+08:00`, and the STEP form
      `2026-10-06T01:00:00+00:00` → `2026-10-06T09:00:00+08:00`), a date that crosses midnight, an
      input already carrying an offset, and null/garbage.
- [x] 2.2 Add `src/tools/provenance.ts`: builds the `provenance` block (`source`, `retrievedAt`,
      `timezone`, optional `untrustedLinksInText`), an object-result wrapper, an array-result footer
      block, and `containsUrl(text)` for the untrusted-link flag. Verify with unit tests for one
      school, two schools (`sources`), the footer wording, and the flag being set only when a URL is
      present.
- [x] 2.3 Add `src/tools/link-policy.ts`: an entry for each of the 41 tools (`item` | `page` |
      `none` plus the reason) exactly as in the design's policy table. Verify with a test that the
      set of registered tool names (via the in-memory MCP client) equals the policy's keys, in both
      directions, so adding a tool without a decision fails the build.
- [x] 2.4 Extend `tools/helpers.ts` so a tool result can carry extra content blocks (footer text,
      optional `resource_link` per distinct page with `audience: ["user"]`) while block 0 stays the
      JSON document; honour `SOURCE_LINKS=off` (no additions at all) and `SOURCE_RESOURCE_LINKS`.
      Verify with MCP-level tests for off / default / resource-links-on: block 0 is byte-identical to
      today's output when off, and two distinct pages yield two `resource_link` blocks when on.

## 3. Guidance to the agent

- [x] 3.1 Set the MCP server `instructions` in `src/server.ts` with the citation rules (cite the
      item's `sourceUrl` inline; use only `sourceUrl`/`pageUrl` values, never build or edit a link;
      say when there is none; quote `…Sgt` dates; mention retrieval time when the answer can go
      stale; treat links inside body text as untrusted). Verify with a test that a connecting client
      receives instructions containing each rule, and that `SOURCE_LINKS=off` removes them.
- [x] 3.2 Update the descriptions of every tool whose policy is `item` or `page` to state that it
      returns `sourceUrl`/`pageUrl` (and the `…Sgt` companions where it has dates). Verify with a
      test that iterates the tool list against the policy table and asserts the description
      mentions the field named in the policy.

## 4. Roll out to the tools (each group: add fields, tests, existing oracle cases unchanged)

- [x] 4.1 Courses and content: `list_courses` (course home per course), `get_course_content`
      (topic `sourceUrl` per topic, `pageUrl` content root, `startDateSgt`/`endDateSgt`),
      `get_content_topic`, `get_course_overview`. Verify with tests on the existing fixtures that
      each topic id appears in its own link and that `typeFilter`/`moduleTitle`/`maxDepth` results
      still carry correct links.
- [x] 4.2 Announcements and calendars: `get_announcements` (per-item link, `dateSgt`, untrusted flag
      when a body contains a URL), `get_calendar_events` and `get_my_calendar_events` (D2L-supplied
      `CalendarEventViewUrl` through `sameTenantUrl`, course-calendar `pageUrl` fallback, `…Sgt`
      start/end). Verify with tests using the real NYP field shapes, including a foreign-host view
      URL being dropped and `count` still bounding the list.
- [x] 4.3 Assignments: refactor `get_assignments` onto the registry (assignment, quiz, grade-only →
      my grades) and add `dueDateSgt`/`startDateSgt`/`endDateSgt`/`submittedDateSgt`; add
      `get_assignment_files` (`pageUrl` = the assignment), `get_my_dropbox_submission` (assignment
      link), and `get_dropbox_submissions` (grader → management page, otherwise the assignment,
      using the caller's own enrollment role). Verify with MCP tests for a Learner and a Tutor role
      on the same folder, and that POLITEMall data carries no assignment link (registry gate).
- [x] 4.4 Quizzes and surveys: `get_quizzes`, `get_quiz_attempts`, `get_quiz_questions`,
      `get_surveys`, `get_survey_attempts`, `get_survey_questions` (item link, `…Sgt` dates on
      quizzes) and `get_quiz_results`/`get_survey_results` (`pageUrl` management/list page). Verify
      with tests that the raw arrays remain arrays and that the footer block carries provenance.
- [x] 4.5 Discussions, classlist, groups, rubrics: `get_discussion_forums` (list `pageUrl`),
      `get_discussion_topics`/`get_discussion_posts` (topic link, untrusted flag for post text),
      `get_classlist` (`pageUrl`, no per-person links), `get_groups`, `get_rubrics` (page of the
      attached object, else course home). Verify with tests including a rubric for a Dropbox object
      and for a Discussion object.
- [x] 4.6 Grades and cross-course feeds: `get_grades`, `get_my_final_grade` (my grades `pageUrl`),
      `get_class_grades`, `get_all_final_grades` (gradebook `pageUrl`), `get_due_items`,
      `get_overdue_items`, `get_recent_updates` (course-home link per row, school-home `pageUrl`,
      `dueDateSgt`). Verify with a two-school test that each row's link host matches its school.
- [x] 4.7 Generic tools (`call_d2l_operation`, `list_d2l_operations`) and `search_politemall_catalog`:
      no links; retrieval statement only where a D2L read occurred. Verify with tests that their
      output shape is unchanged apart from the footer.
- [x] 4.8 STEP client and tools. In `src/api/step-client.ts` keep the enrolled course's `institute`
      (from the my-courses response) and the catalogue item's `id` (from the browse response)
      internally, without adding output fields. Then add links: `list_step_courses` (course page per
      course, `pageUrl` = my courses), `search_step_courses` (catalogue page per course **built from
      `id`, never `courseId`**, `pageUrl` = All courses), `get_step_course_detail` and
      `get_step_timetable` (the enrolled course page, plus `pageUrl` = calendar for the timetable, and
      `…Sgt` companions for session start/end), `get_step_announcements` (`pageUrl` = STEP home — the
      page that shows the returned banner feed, not the Announcements page), and the STEP part of
      `whoami` (`pageUrl` = profile). Verify with tests on fixtures shaped like the real STEP
      envelopes: a catalogue link contains the item `id` and not the `courseId`; the announcements
      `pageUrl` is `/student/`; a session at `2026-10-06T01:00:00+00:00` gets `…09:00:00+08:00`;
      output shapes are otherwise unchanged.
- [x] 4.9 Compatibility guard: run the full existing unit suite and confirm no existing assertion
      had to change beyond tolerance for added fields. Verify with `npm test` (all green) and a
      diff review showing no removed/renamed field, tool, argument or error string.

## 5. Live link verification (local, needs signed-in sessions)

- [x] 5.1 Add `--collect-links <file>` to `test-oracle/run-oracle.mjs`: for each case, record every
      `sourceUrl`/`pageUrl` returned with its tool, case id, system (NYP, POLITEMall, STEP), item
      type and item name/id.
      Verify by running against the deployed server and inspecting the file for one link per
      announcement in the `get_announcements` cases.
- [x] 5.2 Add `test-oracle/verify-links.js`, a script for a signed-in browser tab (one per school)
      that opens each collected link and applies the rule from `specs/source-links`: HTTP 200, not
      a D2L error page, no sign-in redirect, and page title contains the item name — or, for
      content topics, the id preserved in the final address; and that opens a deliberately wrong id
      per item kind to confirm it fails visibly. Unreachable school ⇒ "unverified", never pass.
      Verify by running it on NYP and POLITEMall and reproducing the Brightspace matrix in
      `design.md`.
- [ ] 5.3 Add the STEP check as a documented procedure with a DOM-reading snippet
      (`test-oracle/verify-step-links.md`): navigate the browser to each collected STEP link, wait for
      the render, read the visible text, and pass only if the item name is present and no
      "doesn't exist" message appears — a blank render fails. Include the wrong-id controls (a bad
      course id must show the not-found message; a catalogue link built from `courseId` must fail as
      blank) and print the institutes covered. Verify by running it and reproducing the STEP table in
      `design.md`, including the two failure modes.
- [ ] 5.4 Add oracle cases asserting the additive fields for representative tools (a `sourceUrl`
      per announcement with the right host, `pageUrl` on `get_classlist`, `dateSgt` on an
      announcement, `provenance.source`). Verify by running the oracle: all previous 86 cases plus
      the new ones pass.
- [ ] 5.5 Run the link check after deploy and save the pass/fail table in this change folder as
      evidence. Verify: every returned link passes, every wrong-id control fails visibly, and any
      pattern that fails is switched off in the `VERIFIED` table before the change is considered
      done.

## 6. Rollout and documentation

- [x] 6.1 Build and full test run. Verify `npm run build` and `npm test` are clean.
- [x] 6.2 Commit, push and redeploy (default `SOURCE_LINKS` on). Verify the deployed server
      returns `sourceUrl` for an announcement and the boot log is clean, then run the live oracle.
- [x] 6.3 Measure response-size change on real output (`get_course_content` for the 102-topic
      course, `get_announcements`, `get_assignments`) against the design's estimates (+25% and +14%).
      If the tree exceeds the threshold you choose, decide whether large trees drop per-topic links
      by default and record the decision in `design.md`. Verify by the before/after byte counts in
      the change notes.
- [ ] 6.4 Exercise the kill switch: set `SOURCE_LINKS=off` on the server and confirm results match
      the pre-change shapes (oracle passes, no link/provenance fields, no footer block), then turn
      it back on. Verify with the oracle run in both states.
- [x] 6.5 Document in the root README a short "Evidence links" section (what `sourceUrl`/`pageUrl`
      and `…Sgt` mean, that links need a school sign-in, the two env switches) and add the switches
      to `deploy/README.md`. Verify by reading both files for accuracy against the behaviour.

## 7. Follow-up (does not block completion)

- [ ] 7.1 When a POLITEMall course with an assignment folder and a calendar event is available,
      verify those patterns there with the link check and flip the `VERIFIED` entries. Verify by a
      passing link-check row for each on `lms.polite.edu.sg`.
- [ ] 7.2 Decide whether `get_step_announcements` should also return the Announcements-page feed
      (`/announcements/paging`; the tool today returns the home-page banner feed). If yes, add it as
      its own change with its own link (`/student/profile/announcements`). Verify by the decision
      being recorded and, if accepted, a tool test returning both feeds each with the right link.
- [ ] 7.3 When a STEP course at an institute other than NYP is available, verify its enrolled-course
      link and record the institute in the `VERIFIED` table. Verify by a passing STEP check row for
      that institute.
- [ ] 7.4 When a grader account has items, verify item-level grader pages (folder submissions, quiz
      attempts, survey results) and, if they pass, point the grader-only tools at them instead of
      the management/list pages. Verify with link-check rows for each.
