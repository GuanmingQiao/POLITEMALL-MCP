# Proposal

## Why

An answer built from this server's tools is only as trusted as the user's ability to check it.
Today the data comes back as bare JSON: a user who is told "your quiz is due on 25 Sep" has no
way to see where that came from, and a model that tries to help by pasting a link has to invent
one. Research on LLM citations (see `design.md`) says two things that shape this change:
citations raise trust *whether or not they are correct*, and users rarely click them — so more
links is not the goal; **links that are correct, attached to the exact fact they support, and
that match what the page shows when someone does check** are. A wrong link (a 404 page, or a
date eight hours off the page) costs more trust than no link.

We tested this against the real sites. On both `nyplms.polite.edu.sg` and `lms.polite.edu.sg`,
deep links to the exact announcement, assignment, quiz, survey, discussion topic, content topic,
gradebook, calendar and classlist open the right page, the page title carries the item's own
name, and a wrong ID lands on a visible error page. STEP (`stms.polite.edu.sg/student/`) is
different: it is a single-page app that answers HTTP 200 with a generic title for every address,
so a link there can only be proven by rendering the page and reading what it shows — and one of
its links (the catalogue course page) silently renders a blank page if given the wrong kind of ID.
That makes a verifiable-evidence feature buildable today on all three sites, on links we can prove
work, and makes the STEP rules stricter than the Brightspace ones.

## What Changes

- Add a **link registry**: one module that builds every deep link from a verified template, the
  tenant host (fixed allowlist) and integer IDs the server has just read from D2L. Nothing else
  in the codebase concatenates a URL. Where D2L supplies its own view URL (calendar events:
  `CalendarEventViewUrl`, whose ID differs from the event's own ID, so it cannot be constructed)
  the D2L-supplied URL is used after validation.
- Add **`sourceUrl` on every item that has a page** across the curated tools (announcements,
  assignments, quizzes, surveys, discussion topics, content topics, courses, calendar events, and
  STEP courses),
  and a **`pageUrl`** on tools that describe a page rather than an item (gradebook, classlist,
  groups, cross-course feeds, instructor-only tools). The link sits next to the data it supports,
  not in a list at the end, so a model cannot attribute a fact to the wrong source.
- Add **freshness and provenance**: each result says which system it came from (POLITEMall /
  NYP / STEP), when it was retrieved, and which page to open to compare.
- Add **times as the page shows them**: for the date fields users compare against the page,
  a companion value in Singapore time (verified on Brightspace: the API's `05:23Z` is displayed as
  "1:23 PM"; and on STEP: `01:00+00:00` is displayed as "09:00"), so a correct due date or session
  time never looks eight hours wrong.
- Tell the agent how to use it: server `instructions` and tool descriptions say to cite the
  `sourceUrl`/`pageUrl` values as inline links, never to build or edit a link, and to say so when
  an item has none. Links found inside announcement text are marked untrusted (they are written
  by other people) and are not evidence.
- Add **automated link verification** to the live test harness: every link the tools return is
  opened in a signed-in session and checked against the item's real name — by page title on
  Brightspace, by the rendered page content on STEP.
- Optional, off by default: also emit MCP `resource_link` content blocks for clients that
  render them.
- **Include STEP** with its own verified links: enrolled course details (which also shows the
  session timetable and attendance), catalogue course pages, the home page where the portal
  banner shows, and the profile page. STEP needs two small client changes so a link can be built
  from what a tool returns: keep the course's `institute` (my courses) and the catalogue item's
  `id` (browse results — the page keys on `id`, not `courseId`).
- Link **only to the page that actually shows the returned data**. STEP has two announcement
  feeds and `get_step_announcements` returns the banner feed shown on the home page, not the list
  on the Announcements page; the tool links the home page and the mismatch is recorded as a
  finding for a separate decision.
- All changes are **additive**: no existing field, tool name, input or error message changes,
  and the array-returning tools stay arrays.

## Capabilities

### New Capabilities
- `source-links`: how the server builds, validates and verifies deep links into the Brightspace
  and STEP sites — the verified link matrix, the fixed host allowlist, preference for D2L-supplied URLs,
  parent-page fallback where no item page exists, and the automated verification requirement.
- `response-provenance`: what every curated tool result must tell a user and an agent about where
  its data came from — `sourceUrl`/`pageUrl`, retrieval time, local times, trusted versus
  untrusted links, and the citation guidance the server gives the model.

### Modified Capabilities
<!-- None: openspec/specs/ holds no capabilities yet (add-d2l-route-catalog is not archived), so
     nothing here changes an existing requirement. Behavior is added, not altered. -->

## Impact

- **Code** (`server/control-plane/src`): extend `utils/deep-links.ts` into the link registry;
  `api/step-client.ts` (carry `institute` and the catalogue `id`); new `utils/local-time.ts`, `tools/link-policy.ts`, `tools/provenance.ts`; touch each of the 41
  tool files that returns items (mostly one added field); `server.ts` (server `instructions`);
  `tools/helpers.ts` (optional footer/resource-link blocks).
- **Response size**: about 100 characters per linked item. Measured impact and mitigation for the
  largest case (a 100-topic course tree) are in `design.md`.
- **Tests**: builder/validator unit tests, a test that every tool has a declared link policy,
  MCP-level tests for the additive fields, and a link-verification pass added to `test-oracle/`
  (runs against real sessions, so it is local-only like the rest of the oracle).
- **Dependencies**: none. **Security**: links carry only the site host and the item IDs (numeric on
  Brightspace, GUIDs on STEP) — never a token, cookie or user identifier.
- **Not covered**: item-level instructor pages (no items to test against), per-grade-item or
  per-rubric pages (none exist), STEP pages other than the ones above (applications, awards,
  transactions, tasks — no tool returns that data), and STEP courses at institutes other than NYP
  (only an NYP course was available to test).
