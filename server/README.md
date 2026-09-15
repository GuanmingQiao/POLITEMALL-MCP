# politemall-mcp — hosted (multi-tenant) server

Lets a small team share one deployed instance of the POLITEMall MCP server, each
person authenticated with their own token against their own POLITEMall account.

## How it works

- Each teammate gets a personal bearer token from whoever runs the server.
- To connect your account: visit `<server-url>/login?token=<your token>` and log in
  through the embedded browser with your normal POLITE SSO (including 2FA). The
  server captures your session cookie once you're logged in — your password/2FA never
  touches the server itself.
- Your MCP client connects to `<server-url>/mcp` with header
  `Authorization: Bearer <your token>`.
- If a tool call says your session expired, just revisit the `/login` URL to
  reconnect.

## Architecture

- `control-plane/` — the MCP server itself (Streamable HTTP), plus the login web UI
  and an orchestrator that spins up a short-lived Docker container per login attempt.
- `login-session/` — the ephemeral per-login container: a real (visible, via noVNC in
  your browser) Chromium instance you SSO through, running under Xvfb.
- `Caddyfile` / `docker-compose.yml` — reverse proxy with automatic HTTPS.

Each person's session cookies are encrypted at rest (AES-256-GCM, key in AWS Secrets
Manager) and only ever used server-side to call POLITEMall's API on that person's
behalf — this is still session-cookie auth riding on a documented but not officially
third-party-sanctioned API path, same caveat as the single-user local version.

See [../deploy/README.md](../deploy/README.md) for how this is actually provisioned
and deployed.
