# politemall-mcp

MCP server for the Singapore polytechnic/ITE learning systems on **POLITEMall**: the two
D2L Brightspace tenants **POLITEMall** and **NYP**. Talks directly to each tenant's own REST API as
the signed-in person — no institutional API key or app registration involved.

**Live server:** `https://<your-server-host>` — one shared server; each person signs in once with
their own Microsoft account. The exact same server (same tools, same code) can also
[run on your own machine](#running-it-locally).

## The two tenants

One sign-in covers both:

- **POLITEMall** (`lms.polite.edu.sg`) — shared D2L Brightspace instance across polytechnics.
- **NYP** (`nyplms.polite.edu.sg`) — NYP's own dedicated D2L Brightspace instance.

## Tools

**D2L (POLITEMall and NYP)** — `courseId` is an opaque string like `politemall:6606`
or `nyp:12345` returned by `list_courses`; it encodes which of the two schools the
course belongs to, so just pass it through as-is to the other tools.

| Tool | What it does |
|---|---|
| `list_courses` | Your enrolled courses, merged across POLITEMall and/or NYP |
| `get_due_items` | Content items with due dates across every course and connected school in one call — completed and pending |
| `get_overdue_items` | D2L-computed overdue items across every course and connected school — a filtered view distinct from `get_due_items` |
| `get_recent_updates` | Counts of unread/pending activity (discussions, feedback, quizzes) across every course and connected school — a "what's new" feed |
| `get_my_calendar_events` | Your calendar events across every course and connected school in one call, within a date window (default: 7 days ago to 60 days ahead) |
| `get_course_content` | The course's module/topic tree — one call — with `typeFilter` (file/link/html/video), `moduleTitle` and `maxDepth` to keep it small; rich text as Markdown |
| `get_content_topic` | A single content topic — a drill-down from `get_course_content`; for a PDF, DOCX, PPTX, HTML or text file topic it also returns the file's text as `extractedText` (HTML as Markdown), and a native page's description as `descriptionMarkdown`. Long text comes in parts: `maxChars` (default 20000) and `offset`, with `extractedTextTruncated` / `extractedTextNextOffset` saying how to continue (`extractedTextUnavailable` if the file is too large or unreadable) |
| `get_course_overview` | The course description/overview content (the "Class Overview"/syllabus) |
| `get_grades` | Grade items and your scores |
| `get_my_final_grade` | Your calculated/adjusted final grade for a course |
| `get_announcements` | Latest announcements, newest first, plain text, drafts excluded — for one course or (no `courseId`) across all your active courses; `count` limits it |
| `get_calendar_events` | Course calendar events |
| `get_assignments` | Assignments and quizzes, soonest due first — instructions, rubric, whether you've submitted, your files and feedback, quiz attempts, plus scored items that have no assignment behind them. One course, or all active courses |
| `get_assignment_files` | Read the files an instructor attached to an assignment (PDF, DOCX, XLSX, PPTX, text): list which assignments have attachments, then read one and get its text |
| `get_my_dropbox_submission` | Your own submission (files, dates, score, feedback) for an assignment folder |
| `get_quizzes` / `get_quiz_attempts` | Quiz list, then your attempt scores/status for one |
| `get_quiz_questions` | Questions defined for a quiz |
| `get_discussion_forums` / `get_discussion_topics` / `get_discussion_posts` | Drill down forums → topics → actual post content and authors |
| `get_classlist` | Who is in a course: headcount per role, plus the staff by default (students only with `includeStudents`, `searchTerm` to find someone) |
| `get_rubrics` | Rubric criteria/levels — by `rubricId`, or list rubrics attached to a discussion/dropbox/etc. object |
| `get_surveys` / `get_survey_attempts` | Survey list, then your attempt history for one |
| `get_survey_questions` | Questions defined for a survey |
| `get_groups` | Group categories and groups, with member counts |
| `whoami` | Your identity on each connected school |

**POLITEMall/NYP (D2L), instructor/TA only** — same `courseId`s as above, but
these call grading-permission-gated endpoints. A student's session gets a clear
permission error, not their own data, if they call one of these by mistake.

| Tool | What it does |
|---|---|
| `get_class_grades` | Every grade item and score for every student — the gradebook view |
| `get_all_final_grades` | Every student's calculated/adjusted final grade — the gradebook's final-grade column |
| `get_quiz_results` | Every student's attempts for a quiz (or one student's, by classlist Identifier) |
| `get_survey_results` | Every student's attempts for a survey (or one student's, by classlist Identifier) |
| `get_dropbox_submissions` | Every student's submission for an assignment folder — files, dates, score, grading status |

**POLITEMall/NYP (D2L), long-tail escape hatch** — the tools above are a curated slice of the
~190 read (`GET`) routes Valence exposes under Learning Environment; the rest are reachable
without a dedicated tool for each one. Start with the curated tools above — they're
response-shaped and better-documented. Reach for these only when nothing above covers what you
need.

| Tool | What it does |
|---|---|
| `list_d2l_operations` | Search/browse the full route catalog by category or keyword, to find an operation's key and required parameters |
| `call_d2l_operation` | Invoke any cataloged operation by key — returns D2L's raw JSON response, unshaped. Course-scoped operations take `courseId`; operations not tied to one course take `school` instead. Read-only; a file route that returns a web page or text is read as text (HTML as Markdown, paged with `maxChars` / `offset`), and truly binary content is rejected |

**POLITEMall public catalog** — a third, separate system again: the marketing
site at `politemall.polite.edu.sg`, not Brightspace. No login required.

| Tool | What it does |
|---|---|
| `search_politemall_catalog` | Search/browse all ~300 modules in the public marketing catalog across every poly/ITE — not your enrollments |

Valence (the actual Brightspace/D2L API) has no endpoint for browsing courses
you're not enrolled in, for any non-admin role — confirmed by testing directly,
not just reading docs: even `GET /d2l/api/lp/(version)/courses/(orgUnitId)` for a
course we *are* enrolled in returns `403 Forbidden`, since it needs a
course-management permission regular students/staff don't have. The public
catalog above is the closest available substitute for "what modules exist" —
but note its `catalogCode` values (e.g. `D-NP-06030001`) are a completely
different ID space from Brightspace `courseId`s and can't be passed to
`get_grades`/`get_course_content`/etc.

## Evidence links

Tool results let you check what you were told. Where a result has a page on the school's site, it
carries the link next to the data:

- **`sourceUrl`** on an item (an announcement, quiz, assignment, content topic, discussion topic,
  calendar event, ...) opens that item. **`pageUrl`** on a result opens the page that
  shows the whole result (the classlist, "my grades", a course's quiz list). An
  item with no verified page has no link at all, not a guessed one.
- **`provenance`** (or, for results that are plain lists, a second text block) says which system the
  data came from (NYP Brightspace, POLITEMall Brightspace) and when it was read.
- **`...Sgt`** fields (`dueDateSgt`, `dateSgt`, ...) give the same instant as the original UTC value in
  Singapore time (`+08:00`), which is what the sites display. The original value is never changed.
- Links inside announcement, discussion or description text were written by other people; results
  flag them (`untrustedLinksInText`) and they are never used as evidence.

The server also sends citation rules to the connecting agent (cite the `sourceUrl`, never build or
edit a link, say when there is none). A link opens only for someone signed in to that school in
their browser, and it can show only what that person is already allowed to see. Every
pattern is opened in a real session before it is emitted, and `test-oracle/verify-links.js`
re-checks them.

Two environment switches (see [deploy/README.md](deploy/README.md)): `SOURCE_LINKS=off` removes all
of the above and returns the previous result shapes; `SOURCE_RESOURCE_LINKS=on` additionally
returns MCP `resource_link` blocks for clients that display them.
## Connecting

You connect with only the server URL. The first time, your MCP client opens a sign-in page in
your browser; you type your own Microsoft account and approve MFA there, and you're connected.
Nothing to install, no cookies or tokens to copy.

**How the sign-in works.** The page shows a live view of a browser running on the server, at the
real Microsoft sign-in page. What you type goes only to Microsoft's page: it isn't stored or
logged. When you reach POLITEMall (and NYP, which signs in automatically from the same Microsoft
session), the server keeps your D2L session, exchanges it for an access token, and renews that
token itself. If the session ever lapses it first tries to renew it silently from your saved
Microsoft sign-in; only if Microsoft asks for something again will a tool reply with a fresh
one-time sign-in link.

**What the server keeps about you** (all encrypted at rest): your D2L session for each tenant,
your current access token, and your Microsoft sign-in state, which is deleted after
30 days without use. By connecting you trust this server with that state, so only connect to a
server you trust. To delete everything and revoke every token your MCP clients hold:

```bash
curl -X POST https://<your-server-host>/signout -H "Authorization: Bearer <your MCP access token>"
```

Sign-ins are limited to a few at a time; if the server is busy, try again in a minute.

## Connecting your MCP client

### Claude Code

```bash
claude mcp add --transport http politemall https://<your-server-host>/mcp
```

Add `--scope user` to make it available in every project, not just the current one. Then run
`/mcp` in Claude Code, choose **politemall** and **Authenticate**; your browser opens the sign-in page.

### Claude Desktop

Settings → Connectors → **Add custom connector**, name it, and enter
`https://<your-server-host>/mcp`. Claude Desktop opens the sign-in page in your browser.

### Microsoft Copilot Studio

Your agent → **Tools** → **Add a tool** → **New tool** → **Model Context Protocol**, server URL
`https://<your-server-host>/mcp`, authentication **OAuth 2.0** with dynamic discovery (the
server publishes its OAuth metadata and supports dynamic client registration and PKCE).

## Security notes

- There is no signup and no shared secret: an MCP access token is only issued after a completed
  Microsoft sign-in, and it identifies a person, nothing more.
- Sign-in links are unguessable, single-use and short-lived; each runs in its own isolated browser
  that is closed as soon as the sign-in ends, fails, times out or you leave the page.
- D2L sessions, access tokens and Microsoft sign-in state are encrypted at rest (AES-256-GCM) and
  used only server-side to call D2L on your behalf. Typed credentials, cookies and tokens are never
  logged; `/mcp` and `/signin` requests are rate-limited and audit-logged with a short one-way hash
  of your id, a timestamp and IP.
- OAuth endpoints enforce PKCE and exact redirect-URI matching; authorization codes work once.

## Architecture

```
server/
  control-plane/            the MCP server (Streamable HTTP) — the only server in this repo
    src/
      index.ts, local.ts    hosted entry point / local entry point; app.ts builds the HTTP app
      server.ts             builds the MCP server for one caller
      api/                  D2L client: version discovery, routes, pagination, errors
      auth/                 OAuth server, streamed sign-in, session vault, token mint/renewal, encryption, rate limiting
      tools/                one file per tool (+ shared helpers and schemas)
      utils/                config, audit log, HTML→Markdown, PDF/Office text extraction, deep links
      types/                shared types, incl. ToolContext
    tests/                  mirrors src/ (api/, auth/, tools/, utils/); run with `npm test`
  docker-compose.yml, Caddyfile
deploy/                     AWS provisioning notes/scripts for the hosted server
```

Tools never know where a caller's sessions live: they receive a `ToolContext`
(`types/tool-context.ts`), so the hosted server and a local run expose the identical
tool set. See [deploy/README.md](deploy/README.md) for how the server is provisioned
and operated on AWS.

## Running it locally

There is one server, and it runs the same tools locally as in the cloud:

```bash
cd server/control-plane
npm install
npm run local        # builds, then starts on http://localhost:3000 (no AWS needed)
```

`npm run local` generates a master key into `server/control-plane/data/` on first start and
keeps encrypted sessions there. It needs a Chromium for the streamed sign-in: set
`CHROMIUM_PATH` to a Chrome, Edge or Chromium executable. Add `http://localhost:3000/mcp` to your MCP
client the same way as above; the sign-in page opens on `http://localhost:3000`.

Tests: `npm test` (compiles `src/` and `tests/`, then runs everything with Node's test runner).

## Contributing and releases

Changes go through pull requests with a Conventional Commit title (`feat: ...`, `fix: ...`); CI must pass. Versions, tags and `CHANGELOG.md` are produced by release-please: merge the Release PR to cut a release. A release does not deploy; see [deploy/README.md](deploy/README.md) for deploying. Full rules for people and agents: [.claude/rules/cicd.md](.claude/rules/cicd.md).
