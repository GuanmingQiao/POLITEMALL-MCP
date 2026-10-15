# Deploying the hosted (multi-tenant) server

`provision.ps1` records the one-time AWS setup (security group, IAM role, Secrets
Manager master key, EC2 instance). After the instance boots and `user-data.sh` has
cloned the repo (check via SSM: `test -f /opt/politemall-mcp-bootstrap-done`),
finish the deploy manually:

1. Write `server/.env` on the instance with `PUBLIC_HOST=<ip-with-dashes>.sslip.io`
   (e.g. `13-212-182-50.sslip.io` for IP `13.212.182.50`). **Do not use the AWS-assigned
   `*.compute.amazonaws.com` hostname** — Let's Encrypt refuses to issue certificates
   for it (it's on the public suffix "forbidden" list). sslip.io wildcard-resolves
   `<ip-with-dashes>.sslip.io` to the IP itself and works fine with Let's Encrypt.
2. `cd /opt/politemall-mcp/server && docker compose up -d --build`

There's no user list to seed. The server creates `server/data/sessions.json` (each person's encrypted
D2L sessions, access tokens and Microsoft sign-in state) and `server/data/oauth.json` (registered MCP
clients and hashed MCP tokens) the first time someone signs in, and both stay gitignored. The
container needs about 1.4 GB for Chromium during a sign-in (`mem_limit`/`shm_size` in
`docker-compose.yml`); the default is one sign-in at a time (`SIGNIN_MAX_CONCURRENT`).

All of this was done interactively via `aws ssm send-command` (no SSH — the security
group has no port 22; management is via SSM Session Manager / Run Command only).

## Redeploying after a code change

```
cd /opt/politemall-mcp && git pull
cd server && docker compose up -d --build
```

**D2L API versions are discovered, not pinned.** The server reads each school host's
anonymous `/d2l/api/versions/` list (see `server/control-plane/src/api/d2l-versions.ts`) and uses the newest supported
`le` and `lp` version for that tenant, cached for 6 hours and refreshed automatically. On boot
it logs what it resolved (`D2L API versions for <host>: le X, lp Y`); an unreachable host is
only a warning there and is retried on first use, so it never blocks startup. If a newer version
ever changes a response shape a curated tool depends on, pin that product back without a code
change by setting `D2L_LE_VERSION` and/or `D2L_LP_VERSION` (e.g. `D2L_LE_VERSION=1.75`) in the
container environment.

**Evidence links** (`sourceUrl` / `pageUrl`, `provenance`, `...Sgt` times, and the citation rules
sent to agents) are on by default. Both switches are read on every request, so changing one needs a
container restart only, not a rebuild:

| Variable | Default | Effect |
|---|---|---|
| `SOURCE_LINKS` | `on` | `off` removes every link, provenance block, `...Sgt` field, footer block, citation instruction and tool-description note, returning the exact previous result shapes. Anything other than `on`/`off` (also `1`/`0`, `true`/`false`) means the default. |
| `SOURCE_RESOURCE_LINKS` | `off` | `on` also appends one MCP `resource_link` content block per distinct page (addressed to the user, at most 25 per result). Ignored while `SOURCE_LINKS=off`. |
## Signing a person out

Self-service: a person calls `POST /signout` with their MCP access token (see the
[root README](../README.md)), which deletes everything held for them and revokes their tokens.
As an operator you can delete their entry from `server/data/sessions.json` (keyed by a random id,
not by anything identifying) — their MCP tokens then stop working at once. Microsoft sign-in state is
dropped automatically 30 days after its last successful use (`MS_STATE_RETENTION_DAYS`).

## How sign-in works (and what to check if it breaks)

Each sign-in runs a headless Chromium inside the control-plane container (installed from Debian in
the Dockerfile, `CHROMIUM_PATH=/usr/bin/chromium`) and streams it to the person's browser at a one-time
`/signin/<id>` link over a WebSocket. When the person reaches D2L's home, the server captures the D2L
session cookies and XSRF token and exchanges them at the tenant's `/d2l/lp/auth/oauth2/token` for a
Bearer token; renewal repeats that exchange, and only a lapsed D2L session relaunches Chromium to replay
the saved Microsoft state. If sign-in fails on the host, check `docker compose logs control-plane` for
`signin_failed`, that the container is not at its memory cap, and that Microsoft is not blocking the
host's IP. The sign-in endpoints must be reachable over HTTPS (Caddy proxies WebSockets by default).

## Known gotchas already fixed in the code

- Caddyfile env substitution is `{$VAR}`, not `{env.VAR}` (the latter is a per-request
  runtime placeholder, not a config-time substitution).
- Tokens are never accepted via URL query strings anywhere (only `Authorization:
  Bearer` headers; the sign-in link's id is not a token and grants only one browser view) — query strings end up in proxy/access logs, browser history, and
  `Referer` headers.
