# politemall-mcp — hosted (multi-tenant) server

Lets a small team share one deployed MCP server, each person authenticated with
their own access token against their own POLITEMall account.

## Why cookie-paste instead of an automated login

POLITEMall's SSO only works from inside the polytechnic corporate network/VPN, so
the login itself has to happen in a browser that's actually on that network — it
can't happen on the hosted server. Rather than requiring teammates to install
Node/Playwright locally (which needs downloading a ~150MB Chromium and doesn't work
on machines without admin rights), you connect by copying your session cookie
straight out of your own browser's DevTools. No install, no admin rights needed —
just a browser you're already using.

## Connecting your account

1. Go to `<server-url>/connect`.
2. Follow the on-page instructions: log in to `lms.polite.edu.sg` normally in your
   own browser (on the corporate network), open DevTools' Network tab, copy the
   `Cookie` request header for any request to that domain.
3. Paste your access token and that cookie value into the form and submit.
4. If a tool call later says your session expired, just repeat this — cookies
   naturally expire after a while and there's no way around re-pasting a fresh one
   periodically, since there's no automated way to renew it without a browser on
   the corporate network.

## Connecting your MCP client

Point your MCP client at `<server-url>/mcp` with header
`Authorization: Bearer <your token>`.

## Security notes

- Tokens are per-person, expire automatically (default 90 days), and are checked on
  every request — ask whoever runs the server to rotate yours if you think it leaked.
- Never put your token in a URL, chat message, or shared doc — the `/connect` page
  and MCP client config are the only places it should ever be typed.
- Your session cookie is encrypted at rest (AES-256-GCM) on the server and is only
  ever used server-side to call POLITEMall's API on your behalf.
- All `/mcp` and `/sync` requests are rate-limited per token and logged (token id
  hash + timestamp + IP only, never the raw token or cookie) for audit purposes.

## Architecture

- `control-plane/` — the MCP server (Streamable HTTP) plus the `/connect` page and
  `/sync` endpoint that receives a pasted cookie.
- `Caddyfile` / `docker-compose.yml` — reverse proxy with automatic HTTPS.

See [../deploy/README.md](../deploy/README.md) for how this is provisioned/deployed,
and [../deploy/manage-tokens.ps1](../deploy/manage-tokens.ps1) for issuing/rotating
teammate tokens.
