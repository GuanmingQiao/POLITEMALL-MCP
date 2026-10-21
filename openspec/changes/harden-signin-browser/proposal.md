# Proposal

## Why

The streamed sign-in puts a real Chromium on the server in front of anyone who can obtain a sign-in
link, and obtaining one needs no account: OAuth dynamic client registration and `/authorize` are
open by design. A review of the deployed system found three gaps in that path:

- The browser can go anywhere. It starts at the school's page, but any link on a page it loads can
  take it to an arbitrary site, and it runs as root in its container with `--no-sandbox`. A browser
  exploit delivered that way would land in a container that holds the encrypted session vault and
  can read the vault's master key from Secrets Manager, which is every user's D2L session.
- One anonymous client can hold the only browser slot. The server runs one Chromium at a time. The
  SDK limits `/authorize` (100 per 15 minutes per IP) and `/register` (20 per hour), but nothing
  limits the WebSocket that actually starts the browser, and a started browser stays up for the full
  five minutes whether or not anyone types. While it is held, real users get "try again" and the
  hourly keep-alive cannot silently re-login anyone.
- The runtime is end of life. The image is `node:20-bookworm-slim`; Node 20 stopped receiving
  security fixes in April 2026, and the AWS SDK already warns at boot that it will require Node 22.

## What Changes

- The streamed browser may only talk to the sign-in sites: the two school hosts and Microsoft's
  sign-in hosts. Navigations to anything else are refused. Requests to private, loopback,
  link-local and other non-public addresses are refused for every request type. Other public hosts
  contacted for page resources (Microsoft's CDNs and telemetry) are allowed but counted, so a
  missing host shows up in the log rather than silently breaking sign-in.
- The control-plane container stops running as root: a non-root user, no added Linux capabilities,
  no privilege escalation, a read-only root filesystem with a writable temp area and the data
  volume, and a seccomp profile that lets Chromium use its own sandbox. Chromium's sandbox is turned
  on by default (`--no-sandbox` becomes an explicit opt-out), verified on the real host before it is
  relied on.
- Anonymous clients cannot monopolise sign-in capacity:
  - starting a streamed browser is rate-limited per IP address, and an IP whose recent sign-ins
    keep ending without success is paused for a while;
  - the number of open (never-started) sign-in links is capped overall and per IP;
  - a started browser that receives no input from its viewer within a short time is closed, long
    before the five-minute limit.
- The Docker base image moves to `node:22-bookworm-slim` (and `engines` records the minimum), and
  the deploy notes say to rebuild with `--pull` so Chromium and the base image pick up fixes.

## Capabilities

### New Capabilities

- `signin-browser-hardening`: what the streamed browser may reach, what privileges its container
  has, how anonymous clients are kept from monopolising it, and the supported runtime.

### Modified Capabilities

None. The existing `streamed-login-session` requirements are left as they are on purpose: the open
change `keep-session-token-alive` also edits that capability, and this change only adds a separate
one, so the two can be archived in either order.

## Impact

- `server/control-plane/Dockerfile`, `server/docker-compose.yml`, a new seccomp profile file, and
  `deploy/README.md`: image, user, capabilities, filesystem, upgrade steps.
- `server/control-plane/src/auth/signin-browser.ts`: the network allowlist, the sandbox default.
- `server/control-plane/src/auth/signin-stream.ts`, `signin-session.ts`, `signin-registry.ts`,
  `oauth-provider.ts`, `rate-limit.ts`, `utils/config.ts`: start limits, pending-link caps,
  first-input timeout.
- `server/control-plane/package.json`: `engines`.
- Tests under `server/control-plane/tests/auth`.
- Deployment: the data directory on the host must be owned by the new non-root user before the
  container restarts, otherwise the vault cannot be read and every user appears signed out.
- No change to tools, to the MCP surface, or to what users see when they sign in.
