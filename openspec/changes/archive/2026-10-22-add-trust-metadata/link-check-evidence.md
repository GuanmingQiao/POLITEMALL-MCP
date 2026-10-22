# Link check evidence

Links below were **built by the compiled registry** (`dist/utils/deep-links.js`) from ids read live
from each school, then opened in a signed-in browser tab with `test-oracle/verify-links.js` (title /
preserved-id rule, plus one deliberately wrong id per item kind). This is the pre-deployment run;
the post-deployment run (task 5.5, links as returned by the deployed tools via
`run-oracle.mjs --collect-links`) is still to do.

Run date: 2026-09-20. Sessions: NYP as the test account (Tutor in 524042, Learner in the others);
POLITEMall as a Learner; STEP anonymous (its signed-in session had expired, see below).

## NYP Brightspace (`nyplms.polite.edu.sg`) — 64 pass, 1 fail, 0 unverified

| Kind | Links opened | Result |
|---|---|---|
| Announcement | 4 (3 courses) | pass, title = announcement title |
| Content topic | 9 (4 courses, both content UIs) | pass, topic id kept in final address |
| Discussion topic | 3 | pass, title = topic name |
| Quiz | 3 | pass, title contains quiz name |
| Assignment | 1 | pass, title = folder name |
| Survey | 1 | pass, title contains survey name |
| Calendar event (D2L-supplied `CalendarEventViewUrl`, via `sameTenantUrl`) | 1 | pass |
| Course home, announcements list, content root, classlist, discussions list, quiz list, survey list, my grades, course calendar, groups | 3 courses × 10 | pass |
| School home | 1 | pass |
| Grader pages (gradebook, assignments, quizzes) as a Tutor in 524042 | 3 | pass |
| Submission history (`folders_history.d2l`) opened for 524042 | 3 courses | 2 pass; **1 fail: HTTP 403 "Not authorised" in 524042, where the account is a Tutor** |
| Wrong-id controls | 7 (announcement, content topic, discussion topic, quiz, assignment, survey, course home) | all fail visibly: 404 / 404 / 404 / 500 / 403 / 403 / 404 |

**Finding:** the submission-history page is a learner page; a Tutor is refused. No tool emits it
today (it is in the registry only), so nothing wrong is being returned. If a tool ever links it,
it must be gated on the caller's role like the dropbox management page.

## POLITEMall (`lms.polite.edu.sg`) — 41 pass, 0 fail, 0 unverified

35 links (14 item links: 6 content topics, 2 announcements, 2 quizzes, 2 discussion topics, 2 surveys;
plus 10 page kinds × 2 courses, and the school home) and 6 wrong-id controls (content topic 404, announcement 404, quiz 500, discussion
topic 404, survey 403, course home 404): all pass.

Not emitted on POLITEMall, by the `VERIFIED` table, and confirmed by the registry returning
`undefined`: assignment, submission history, calendar event, and the three grader pages (no
assignment folder, calendar event or staff role in the account's POLITEMall courses).

## STEP (`stms.polite.edu.sg/student/`) — partial

| Link | Result |
|---|---|
| Catalogue course built from the catalogue item `id` (3 courses) | pass: course name rendered |
| **Control:** catalogue link built from `courseId` | fails as required (no course rendered; this anonymous view also matched a not-found phrase, which the snippet reports as its failure reason) |
| Home `/student/` | renders (title "All courses", portal banner) |
| Enrolled course details, my courses, calendar, profile | **unverified in this run**: the STEP session had expired (redirected to the Singpass sign-in; `mycourse/paging` answered 401), and sign-in needs the user. These were verified in the earlier session on 2026-09-20 (see `design.md`) |
| Institutes covered | 4 (NYP) only |

Re-run the enrolled-course rows (and the bad-course-id control, expected "The MyCourse doesn't
exist.") after signing in to STEP again, following `test-oracle/verify-step-links.md`.

## Still to do (superseded by the post-deployment section below)

- 5.1 `run-oracle.mjs --collect-links` against the deployed server, then the same checks on the
  links actually returned.
- 5.4 the six new oracle cases (T087–T092) run together with the previous 86.
## Post-deployment run (2026-09-21, commit 02cb5e0)

Deployed to the EC2 instance; boot log clean (both tenants resolve to le 1.97, lp 1.63).

- **Live oracle:** 91 of 92 cases pass (the previous 86 plus the new T087–T092). The one failure,
  T053 (`get_classlist` for `nyp:48915`), is data drift: the class now has 2743 learners, the oracle
  recorded 2746. Not a code regression; the expectation needs re-reading from D2L directly.
- **Links returned:** `run-oracle.mjs --collect-links` collected 446 links (200 unique): NYP 46 page +
  380 item, POLITEMall 6 page + 14 item, none on an unknown host. T087–T092 assert each row's host,
  the page URL, the source name and that every `...Sgt` equals its UTC value.
- **Link check on those returned links: NOT DONE.** The browser sessions were reset and are signed out
  (Microsoft sign-in), and signing in needs the user. Run `verify-links.js` on the 61-link sample
  once signed in. Note for that run: `get_assignments` grade-only rows link the *grades page*, so their
  item name must not be used as the title check.
- **Response size** (real output, 102-topic course and 10 announcements): `get_course_content`
  48,155 chars against the design's 37 KB baseline (about +30%; estimate was +25%);
  `get_announcements` (10) 8,865 chars against about 7 KB (about +27%, including the provenance block and
  the `dateSgt` fields). Decision: keep per-topic links by default; `maxDepth`, `moduleTitle`,
  `typeFilter` already narrow a tree, and `SOURCE_LINKS=off` is the escape hatch.
- **Kill switch on the live server (6.4): not exercised**; it would switch evidence links off for real
  users while running. Covered by the automated test that compares off-state results with the
  pre-change shape.