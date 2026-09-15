# Deploying the hosted (multi-tenant) server

`provision.ps1` records the one-time AWS setup (security group, IAM role, Secrets
Manager master key, EC2 instance). After the instance boots and `user-data.sh` has
built the `login-session` image (check via SSM: `test -f /opt/politemall-mcp-bootstrap-done`),
finish the deploy manually:

1. Generate per-teammate tokens into `server/data/users.json` (gitignored — see
   `server/data/users.json.example` for the shape).
2. Write `server/.env` on the instance with `PUBLIC_HOST=<ip-with-dashes>.sslip.io`
   (e.g. `13-212-182-50.sslip.io` for IP `13.212.182.50`). **Do not use the AWS-assigned
   `*.compute.amazonaws.com` hostname** — Let's Encrypt refuses to issue certificates
   for it (it's on the public suffix "forbidden" list). sslip.io wildcard-resolves
   `<ip-with-dashes>.sslip.io` to the IP itself and works fine with Let's Encrypt.
3. `cd /opt/politemall-mcp/server && docker compose up -d --build`

All of this was done interactively via `aws ssm send-command` (no SSH — the security
group has no port 22; management is via SSM Session Manager / Run Command only).

## Redeploying after a code change

```
cd /opt/politemall-mcp && git pull
cd server && docker compose up -d --build
```

## Known gotchas already fixed in the code

- `login-session/Dockerfile` must set `DEBIAN_FRONTEND=noninteractive` before
  `apt-get install` — otherwise the `tzdata` package prompts interactively and the
  build hangs forever.
- `login-session/package.json` pins `playwright` to the **exact** version baked into
  the `mcr.microsoft.com/playwright` base image tag — a caret range lets npm install a
  newer version with no matching browser binary in the image.
- Caddyfile env substitution is `{$VAR}`, not `{env.VAR}` (the latter is a per-request
  runtime placeholder, not a config-time substitution).
- The noVNC WebSocket reverse proxy is mounted at the Express app root (not via an
  `app.use('/vnc/:id', ...)` path pattern), because Express strips a matched mount
  prefix from `req.url` for regular requests but the raw `'upgrade'` event (used for
  WebSocket handshakes) bypasses Express entirely and always sees the untouched URL —
  mounting at the root keeps both code paths seeing the same URL format.
- Strip the `Sec-WebSocket-Extensions` header before proxying to websockify — it
  doesn't support `permessage-deflate`, and forwarding the browser's compression offer
  as-is causes it to drop the connection.
