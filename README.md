# politemall-mcp

MCP server for POLITEMall (D2L Brightspace, `lms.polite.edu.sg`). Talks directly to
the same Valence REST API the POLITEMall web app itself uses, authenticated with a
browser session cookie — there's no institutional API key involved, and none of this
needs an app registered with the institution.

There are two ways to run this:

- **[Local, single-user](#local-single-user)** — a stdio MCP server on your own
  machine, for your own account only. Simplest option if you're the only user.
- **[Hosted, shared by a team](server/README.md)** — one server your whole team
  points their MCP clients at, each person authenticated with their own token. See
  [server/README.md](server/README.md) to connect, or
  [deploy/README.md](deploy/README.md) to run/operate the server itself.

## Repo layout

```
src/              local single-user MCP server (this README)
server/
  control-plane/  the hosted multi-tenant MCP server
  docker-compose.yml, Caddyfile
deploy/           AWS provisioning notes/scripts for the hosted server
```

## Local, single-user

### Setup

```bash
npm install
npx playwright install chromium
npm run build
```

### Login

```bash
npm run login
```

Opens a real browser window. Log in through your normal POLITE SSO flow (including 2FA).
The session cookie is captured and saved to `~/.politemall-mcp/session.json` (local file,
`0600` permissions where the OS supports it). The MCP server will also trigger this
automatically if it discovers the saved session has expired.

### Tools

- `list_courses` — your enrolled course offerings
- `get_course_content(courseId)` — module/topic table of contents
- `get_grades(courseId)` — grade items merged with your scores
- `get_announcements(courseId)` — course news posts
- `get_calendar_events(courseId)` — course calendar events
- `get_assignments(courseId)` — dropbox/assignment folders
- `whoami` — currently authenticated user

`courseId` is the `orgUnitId` returned by `list_courses`.

### Register with an MCP client

A local `.mcp.json` at the repo root already points at `dist/index.js` — Claude Code
picks it up automatically when opened in this directory. For another client, point it
at `node <path-to-this-repo>/dist/index.js` as a stdio server.

### Notes

- This uses documented Valence API paths, but authenticates the way the browser SPA does
  (session cookies) rather than via a registered OAuth app — the latter needs an
  institution-issued App ID/Key that students/staff can't self-register. Treat this as a
  personal tool for your own account's data only.
- Sessions expire periodically; re-run `npm run login` (or just use a tool — it
  auto-relogs-in) when that happens.

## Hosted, shared by a team

See [server/README.md](server/README.md) for how to connect (Claude Code, Claude
Desktop, Microsoft Copilot Studio) and [deploy/README.md](deploy/README.md) for how
the server itself is provisioned and operated on AWS.
