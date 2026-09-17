# politemall-mcp

MCP server for the Singapore polytechnic/ITE learning systems: **POLITEMall** and
**NYP** (both D2L Brightspace) and **STEP** (SkillsFuture/short-course enrollment
and attendance). Talks directly to each system's own REST API, authenticated with
a browser session cookie — no institutional API key or app registration involved.

**Live server:** `https://13-212-182-50.sslip.io` — this is the primary way to use
this project: one shared server, each person connected with their own token. A
[local single-user variant](#local-single-user-alternative) also exists if you'd
rather run your own copy; see the bottom of this doc.

## The three systems

Each is a separate login with its own session cookie, even though they share SSO —
connect whichever you need, any combination:

- **POLITEMall** (`lms.polite.edu.sg`) — shared D2L Brightspace instance across
  polytechnics.
- **NYP** (`nyplms.polite.edu.sg`) — NYP's own dedicated D2L Brightspace instance.
- **STEP** (`stms.polite.edu.sg`) — a separate system entirely (not Brightspace):
  SkillsFuture/short-course enrollment, attendance, and certification records.

## Tools

**POLITEMall/NYP (D2L)** — `courseId` is an opaque string like `politemall:6606`
or `nyp:12345` returned by `list_courses`; it encodes which of the two schools the
course belongs to, so just pass it through as-is to the other tools.

| Tool | What it does |
|---|---|
| `list_courses` | Your enrolled courses, merged across POLITEMall and/or NYP |
| `get_due_items` | Content items with due dates across every course and connected school in one call — completed and pending |
| `get_overdue_items` | D2L-computed overdue items across every course and connected school — a filtered view distinct from `get_due_items` |
| `get_recent_updates` | Counts of unread/pending activity (discussions, feedback, quizzes) across every course and connected school — a "what's new" feed |
| `get_my_calendar_events` | Your calendar events across every course and connected school in one call, within a date window (default: 7 days ago to 60 days ahead) |
| `get_course_content` | Module/topic table of contents for a course |
| `get_content_topic` | Metadata for a single content topic — a drill-down from `get_course_content` |
| `get_course_overview` | The course description/overview content (the "Class Overview"/syllabus) |
| `get_grades` | Grade items and your scores |
| `get_my_final_grade` | Your calculated/adjusted final grade for a course |
| `get_announcements` | Course news posts |
| `get_calendar_events` | Course calendar events |
| `get_assignments` | Dropbox/assignment folders and due dates |
| `get_my_dropbox_submission` | Your own submission (files, dates, score, feedback) for an assignment folder |
| `get_quizzes` / `get_quiz_attempts` | Quiz list, then your attempt scores/status for one |
| `get_quiz_questions` | Questions defined for a quiz |
| `get_discussion_forums` / `get_discussion_topics` / `get_discussion_posts` | Drill down forums → topics → actual post content and authors |
| `get_classlist` | Students/instructors enrolled in a course |
| `get_rubrics` | Rubric criteria/levels — by `rubricId`, or list rubrics attached to a discussion/dropbox/etc. object |
| `get_surveys` / `get_survey_attempts` | Survey list, then your attempt history for one |
| `get_survey_questions` | Questions defined for a survey |
| `get_groups` | Group categories and groups, with member counts |
| `whoami` | Your identity on each connected school |

**POLITEMall/NYP (D2L), instructor/TA only** — same `courseId`s as above, but
these call grading-permission-gated endpoints. A student's cookie gets a clear
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
| `call_d2l_operation` | Invoke any cataloged operation by key — returns D2L's raw JSON response, unshaped. Course-scoped operations take `courseId`; operations not tied to one course take `school` instead. Read-only; routes that return binary file content are rejected |

**STEP** — `courseId` is a GUID string from `list_step_courses` /
`search_step_courses`; STEP tools are separate from the D2L ones above since it's
a different data model (training/attendance records, not course content/grades).

| Tool | What it does |
|---|---|
| `list_step_courses` | Your enrolled SkillsFuture/short courses |
| `search_step_courses` | Search/browse STEP's full public catalog (thousands of courses) — not just your enrollments |
| `get_step_course_detail` | Attendance %, grade, and enrolment status for a course |
| `get_step_timetable` | Class session timetable — dates, trainer, room, attendance status |
| `get_step_announcements` | Portal-wide announcements |

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

## Connecting

There's no per-person account system — a token is just a random key that maps to
a set of encrypted session cookies, generated by whoever wants to use the server.
Nothing ties a token to a name, email, or identity.

1. **[Install the cookie sync browser extension](extension/README.md)** — this is
   the intended way to connect and reconnect; use it rather than the manual
   DevTools flow on `/connect` unless your machine blocks extension installs.
2. Open the extension popup and click **Generate a new token** (same as
   `/connect`'s first step, just done from the extension). It's shown once —
   save it into your MCP client's config immediately. Lost it? Generate a new
   one; there's no recovery.
3. Log in normally in your own browser — on the polytechnic corporate
   network/VPN, since that's the only place SSO works — at whichever of
   `lms.polite.edu.sg`, `nyplms.polite.edu.sg`, `stms.polite.edu.sg` you want,
   then click the matching button in the extension popup (or **Sync all
   connected schools**) to send that cookie to the server.

If extension installs are blocked on your machine, fall back to
**[/connect](https://13-212-182-50.sslip.io/connect)**, which does the same
thing via DevTools copy-paste instead.

**Cookie expired later?** Reconnect that one school (via the extension, or
`/connect` with your existing token) — your MCP client's config never changes,
since it only holds the token, not the cookies. The server also pings every
connected session every 5 minutes to keep it alive via sliding-expiry, so this
should come up less often than you'd expect. Tokens themselves expire after 90
days regardless of use; that does need a fresh token afterward.

## Connecting your MCP client

### Claude Code

```bash
claude mcp add --transport http politemall https://13-212-182-50.sslip.io/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

Add `--scope user` to make it available in every project, not just the current one.

### Claude Desktop

Claude Desktop's built-in connector UI only supports OAuth, not a plain bearer
token, so you bridge it via [`mcp-remote`](https://github.com/punkpeye/mcp-remote)
in `claude_desktop_config.json` (`%APPDATA%\Claude\claude_desktop_config.json` on
Windows):

```json
{
  "mcpServers": {
    "politemall": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://13-212-182-50.sslip.io/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

Requires Node.js installed (for `npx`), but no admin rights. Fully quit and reopen
Claude Desktop after editing.

### Microsoft Copilot Studio

Your agent → **Tools** → **Add a tool** → **New tool** → **Model Context Protocol**:

- **Server URL**: `https://13-212-182-50.sslip.io/mcp`
- **Authentication**: API key → **Type**: Header → **Header name**: `Authorization`

The value isn't entered here — after saving, the tool shows as **"Not connected"**;
click it → **New connection** → enter just your raw token (no `Bearer ` prefix
needed — the server accepts either form) as the API key value → Create.

If Copilot Studio ever shows a stale "connection no longer valid" error after a
token change, delete and recreate the connection rather than editing it — this is
a known Copilot Studio rough edge with MCP connectors, not a server-side issue.

## Security notes

- Signup is open to anyone with the server URL, but a token alone is useless
  without a valid session cookie behind it — there's no data to leak until you
  connect one.
- Never put your token in a URL, chat message, or shared doc — `/connect`, the
  extension, and your MCP client config are the only places it should ever be
  typed.
- Each session cookie is encrypted at rest (AES-256-GCM) on the server and is
  only ever used server-side to call that school's API on your behalf.
- All `/signup`, `/sync`, and `/mcp` requests are rate-limited and logged (a
  short one-way hash of the token, plus timestamp and IP — never the raw token
  or cookie) for audit purposes.

## Architecture

```
server/
  control-plane/  the hosted multi-tenant MCP server (Streamable HTTP)
  docker-compose.yml, Caddyfile
deploy/           AWS provisioning notes/scripts for the hosted server
extension/        browser extension for one-click cookie sync
src/              local single-user MCP server (see below)
```

See [deploy/README.md](deploy/README.md) for how the server is provisioned and
operated on AWS.

## Local, single-user alternative

A stdio MCP server on your own machine, for your own POLITEMall account only —
no shared server, no token, just a local session file. Simpler if you're the only
user and don't need NYP/STEP or the fuller tool set above (this variant only has
the original 7 basic tools: `list_courses`, `get_course_content`, `get_grades`,
`get_announcements`, `get_calendar_events`, `get_assignments`, `whoami`).

```bash
npm install
npx playwright install chromium
npm run build
npm run login   # opens a real browser window for you to SSO through
```

A local `.mcp.json` at the repo root already points at `dist/index.js` — Claude
Code picks it up automatically when opened in this directory. For another
client, point it at `node <path-to-this-repo>/dist/index.js` as a stdio server.

Sessions expire periodically; re-run `npm run login` (or just use a tool — it
auto-relogs-in) when that happens.
