# politemall-mcp

MCP server for POLITEMall (D2L Brightspace, `lms.polite.edu.sg`). Talks directly to the
same Valence REST API the POLITEMall web app itself uses, authenticated with your
ordinary browser session cookies — there's no institutional API key involved.

## Setup

```bash
npm install
npx playwright install chromium
npm run build
```

## Login

```bash
npm run login
```

Opens a real browser window. Log in through your normal POLITE SSO flow (including 2FA).
The session cookie is captured and saved to `~/.politemall-mcp/session.json` (local file,
`0600` permissions where the OS supports it). The MCP server will also trigger this
automatically if it discovers the saved session has expired.

## Tools

- `list_courses` — your enrolled course offerings
- `get_course_content(courseId)` — module/topic table of contents
- `get_grades(courseId)` — grade items merged with your scores
- `get_announcements(courseId)` — course news posts
- `get_calendar_events(courseId)` — course calendar events
- `get_assignments(courseId)` — dropbox/assignment folders
- `whoami` — currently authenticated user

`courseId` is the `orgUnitId` returned by `list_courses`.

## Register with Claude Code / Claude Desktop

Point an MCP client at:

```json
{
  "command": "node",
  "args": ["C:/Users/QIAOGUANMI/Claude Code/Own MCP/dist/index.js"]
}
```

## Notes

- This uses documented Valence API paths, but authenticates the way the browser SPA does
  (session cookies) rather than via a registered OAuth app — the latter needs an
  institution-issued App ID/Key that students/staff can't self-register. Treat this as a
  personal tool for your own account's data only.
- Sessions expire periodically; re-run `npm run login` (or just use a tool — it
  auto-relogs-in) when that happens.
