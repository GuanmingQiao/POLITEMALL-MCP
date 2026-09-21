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

## Still to do (needs the deployed server)

- 5.1 `run-oracle.mjs --collect-links` against the deployed server, then the same checks on the
  links actually returned.
- 5.4 the six new oracle cases (T087–T092) run together with the previous 86.