# Deploying the hosted (multi-tenant) server

`provision.ps1` records the one-time AWS setup (security group, IAM role, Secrets
Manager master key, EC2 instance). After the instance boots and `user-data.sh` has
cloned the repo (check via SSM: `test -f /opt/politemall-mcp-bootstrap-done`),
finish the deploy manually:

1. Generate tokens for each teammate with `manage-tokens.ps1` (see its header
   comment) and assemble `server/data/users.json` (gitignored — see
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

## Rotating or revoking a teammate's token

Edit `server/data/users.json` on the instance (via SSM) and push the new content —
no restart needed, it's re-read from disk on every request. Removing an entry or
changing its `token` immediately invalidates the old one.

## Why there's no automated login

POLITEMall's SSO only works from inside the polytechnic's corporate network/VPN, so
a server sitting in AWS can never complete it — no proxy or embedded-browser trick
gets around a network-level restriction enforced by the identity provider itself.
An earlier version of this server tried a server-side headless-Chromium-plus-noVNC
flow; it's been removed in favor of having each person paste their own
already-authenticated session cookie (copied from their own browser's DevTools)
through the `/connect` page — see [../server/README.md](../server/README.md).

## Known gotchas already fixed in the code

- Caddyfile env substitution is `{$VAR}`, not `{env.VAR}` (the latter is a per-request
  runtime placeholder, not a config-time substitution).
- Tokens are never accepted via URL query strings anywhere (only `Authorization:
  Bearer` headers) — query strings end up in proxy/access logs, browser history, and
  `Referer` headers.
