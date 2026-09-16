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

There's no user list to seed — `server/data/tokens.json` is created automatically
the first time someone signs up via `/connect`, and stays gitignored (it holds
encrypted session cookies).

All of this was done interactively via `aws ssm send-command` (no SSH — the security
group has no port 22; management is via SSM Session Manager / Run Command only).

## Redeploying after a code change

```
cd /opt/politemall-mcp && git pull
cd server && docker compose up -d --build
```

## Revoking a token

There's no admin-side revocation UI — tokens are self-issued and self-service by
design (see the [root README](../README.md)). To kill one, delete its entry from
`server/data/tokens.json` on the instance (keyed by a SHA-256 hash of the token, so
you can't reverse-lookup which entry belongs to whom), or just let it expire
(90 days from issuance). Whoever holds that token reconnects by generating a new one.

## Why there's no automated login

POLITEMall's SSO only works from inside the polytechnic's corporate network/VPN, so
a server sitting in AWS can never complete it — no proxy or embedded-browser trick
gets around a network-level restriction enforced by the identity provider itself.
An earlier version of this server tried a server-side headless-Chromium-plus-noVNC
flow; it's been removed in favor of having each person paste their own
already-authenticated session cookie (copied from their own browser's DevTools,
or via the [cookie sync extension](../extension/README.md)) through the
`/connect` page — see the [root README](../README.md).

## Known gotchas already fixed in the code

- Caddyfile env substitution is `{$VAR}`, not `{env.VAR}` (the latter is a per-request
  runtime placeholder, not a config-time substitution).
- Tokens are never accepted via URL query strings anywhere (only `Authorization:
  Bearer` headers) — query strings end up in proxy/access logs, browser history, and
  `Referer` headers.
