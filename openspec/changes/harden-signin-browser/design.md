# Design

## Context

The control-plane (`server/control-plane`, Express behind Caddy on one Amazon Linux 2023 t3.small)
streams a headless Chromium to whoever opens a one-time `/signin/<id>` link. Links come from
`/authorize` (open to anyone with a dynamically registered OAuth client) or from an authenticated
user's own tool call. See proposal.md for what was found.

Observed today:
- `Dockerfile` is `node:20-bookworm-slim`, installs Debian Chromium, never sets `USER` (root) and
  sets `CHROMIUM_NO_SANDBOX=1`. `docker-compose.yml` adds no cap drops, no seccomp, no read-only
  filesystem; `./data` (sessions, OAuth, backups) is a bind mount owned by root.
- `launchBrowser` (`auth/signin-browser.ts`) creates a context with no request filtering. The only
  host logic is `onD2lHome` and `MICROSOFT_HOSTS`, used for recognising pages, not restricting them.
- Capacity is one Chromium (`SIGNIN_MAX_CONCURRENT=1`), shared with silent re-login and the hourly
  keep-alive. A started sign-in holds it up to `SIGNIN_TIMEOUT_MS` (5 minutes) plus, once the viewer
  disconnects, the reattach grace period.
- Rate limits: `/signin/:id` page is per-IP (30/min); the SDK limits `/authorize` (100 per 15
  minutes per IP) and `/register` (20 per hour). The WebSocket upgrade has none, and the
  pending-link registry has no size cap. The IMDS requires tokens (IMDSv2) with hop limit 2, which a
  plain browser navigation cannot satisfy.
- The IP the app sees for upgrades is Caddy's; Express's `trust proxy 1` setting does not apply to
  raw `upgrade` events. Caddy's `reverse_proxy` overwrites inbound `X-Forwarded-For` by default, so
  the header's value is the real client address.

The open change `keep-session-token-alive` (merged, live verification pending) added viewer
reattach, a 60 minute link lifetime and the keep-alive sweep. This change builds on them and adds a
separate capability so the two archive independently.

## Goals / Non-Goals

**Goals:**
- A page in the streamed browser, or a navigation it triggers, cannot take the browser anywhere
  except the sign-in sites, and cannot touch the server's own network.
- An exploit that does get code execution in Chromium or the Node process lands as an unprivileged
  user in a read-only container with no capabilities, not as root.
- An anonymous client costs the server a bounded amount of browser time and memory, and cannot keep
  real users or the keep-alive out for long.
- A supported Node release, and a deploy routine that refreshes the base image and browser.

**Non-Goals:**
- Restricting which OAuth redirect URIs dynamic registration accepts. It would block unknown MCP
  clients and needs its own compatibility study.
- Network egress filtering at the security group or host firewall. The host also needs GitHub, AWS
  APIs, D2L, Microsoft and package mirrors; the in-browser policy is the narrower tool.
- Moving state out of JSON files, adding a web application firewall, or alerting infrastructure.
- Blocking WebSocket connections opened by allowed pages (they originate only from the sign-in
  sites' own scripts).
- Auditing dependencies (`npm audit`); worth doing, but separate.

## Decisions

**1. Network policy in code, enforced with `context.route`.** `launchBrowser` installs one route
handler that classifies each request with a pure function `decideRequest(url, isNavigation, hosts)`
returning `allow`, `block` or `report`:
- non-HTTP(S) schemes other than `data:`, `blob:` and `about:blank` are blocked;
- hostnames that are IP literals in private, loopback, link-local, carrier-grade NAT, multicast or
  unspecified ranges (IPv4 and IPv6, including IPv4-mapped), `localhost`, `*.localhost`, `*.internal`
  and single-label names (which would resolve to Docker service names such as `control-plane` or
  `caddy`) are blocked for every request type;
- a host on the allowlist is allowed: the hosts of `origins` (so tests and the real tenants share
  one source) plus Microsoft's sign-in hosts (`login.microsoftonline.com`, `login.live.com`,
  `*.microsoftonline.com`, `*.msauth.net`, `*.msftauth.net`, `*.microsoft.com`, `*.live.com`);
- any other navigation (main frame or subframe, including each redirect hop) is blocked;
- any other public host for a non-navigation request (scripts, images, telemetry) is allowed and
  counted as `report`.
Navigations are what deliver an attacker-controlled page, so they are enforced strictly; page
resources are only reported because Microsoft's pages pull from CDNs whose names are not fully
known, and refusing one could break everyone's sign-in. `SIGNIN_NET_MODE=report` turns blocking
into reporting without a rebuild, as a break-glass for the first deployments. Counts per host (max
20 hosts) are written once when the sign-in ends as `signin_net_summary {blocked, reported}`; only
host names are recorded. The same context also sets `acceptDownloads: false`, blocks service
workers, and grants no permissions. *Alternative:* Chromium `--host-resolver-rules` to resolve only
allowlisted names. Rejected as the primary control: it would cut off unlisted CDNs for everyone
with no report-only mode and no readable log. A public name that resolves to an internal address
needs an attacker-controlled page to name it, and navigations to such pages are already blocked.

**2. Unprivileged container, sandbox on.** The image sets `USER node` (uid 1000) and
`CHROMIUM_NO_SANDBOX` is no longer set. `docker-compose.yml` adds `user: "1000:1000"`,
`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true, seccomp=./chromium-seccomp.json]`,
`read_only: true`, and `tmpfs: [/tmp]` with `HOME=/tmp` so Chromium's profile and Playwright's
scratch files have somewhere to live; `./data` stays the only persistent writable mount.
Chromium's sandbox uses unprivileged user namespaces, which Docker's default seccomp profile blocks,
so `chromium-seccomp.json` is Docker's default profile with the namespace-creating syscalls
(`clone`, `unshare`, `setns`) permitted for unprivileged use, as Playwright documents for running
Chromium in Docker. Amazon Linux 2023 allows unprivileged user namespaces by default. If the
sandbox still cannot start on the host, the fallback is the same container with
`CHROMIUM_NO_SANDBOX=1`, which `launchBrowser` logs once at start-up (`chromium_sandbox
enabled|disabled`); it is still non-root, capability-less and read-only. *Alternative:* add
`SYS_ADMIN` and keep the default seccomp. Rejected: that hands the container the very privilege
this change removes.

**3. Data ownership and a loud failure.** Files under `./data` are root-owned today, so the
non-root user would find an unreadable vault, and `readVault` turns any read error into an empty
vault, which looks like every user being signed out. The migration chowns `./data` to 1000:1000
before the restart, and a new boot check in `index.ts` verifies read and write access to the
directory holding `SESSION_FILE`, `OAUTH_FILE` and `STORE_FILE` and exits with a clear message if
not, so a missed chown stops the deploy instead of hiding as data loss.

**4. Per-IP start budget and a strike pause.** New `auth/start-limits.ts` (the rate limiter in
`rate-limit.ts` generalised to a reusable `allow(key, limit, windowMs)` plus a strike table). At the
WebSocket upgrade, after the link is validated and before a browser starts, the client IP is
checked against `SIGNIN_STARTS_PER_WINDOW` (default 20 per 10 minutes) and against an active pause.
A sign-in that ends without success (viewer left, timed out, or no input) records a strike for the
IP that started it; `SIGNIN_STRIKES_BEFORE_PAUSE` strikes (default 5) within the window pause new
starts from that IP for `SIGNIN_PAUSE_MS` (default 5 minutes). A successful sign-in clears the IP's
strikes. A refused start is answered by accepting the socket and sending the page a
`{type:"fail", reason}` message ("Too many sign-in attempts from your network, try again in N
minutes"), then closing, so the page shows it and does not reconnect (an HTTP-level refusal would
make the page's reconnect loop hammer the server). The client IP is the `X-Forwarded-For` value set
by Caddy, falling back to the socket address, through one helper shared with the page limiter. The
defaults are generous on purpose: the users are polytechnic students and staff, often behind one
campus NAT.

**5. Cap on open links.** `createSignin` records the creating IP for anonymous links (from
`/authorize`, via `res.req.ip`). Open, never-started anonymous links are capped at
`SIGNIN_MAX_PENDING_PER_IP` (default 10) per IP and `SIGNIN_MAX_PENDING` (default 200) overall;
beyond that, `authorize` answers 429 with a plain message instead of redirecting to a new link.
Links created for an authenticated user (`connectUrl`) are exempt: they are bound to a known
identity and already limited by the `/mcp` per-user limit, and exempting them keeps an attacker from
filling the cap to lock real users out of re-signing in.

**6. First-input timeout.** A started browser must receive an accepted input message within
`SIGNIN_FIRST_INPUT_MS` (default 60 seconds) of starting, or `SigninSession` stops it with reason
`no_input` (a strike, decision 4) and tells the viewer "No input received". After the first input
the existing five-minute limit applies, so a person waiting on a push approval is not cut off. This
turns "hold the slot for five minutes by connecting and doing nothing" into one minute, and a
bot that sends one event per minute is stopped by the strike rule.

**7. Node 22.** `Dockerfile` becomes `node:22-bookworm-slim`, `package.json` gains
`"engines": {"node": ">=22"}`, and the test suite is run under Node 22 (the developer machine runs
Node 24, production ran 20). The deploy notes switch to `docker compose build --pull` so the base
image and the Debian Chromium package are refreshed on each deploy.

**8. Observability.** Audit events: `signin_net_summary` (host names only), `signin_rate_limited
{kind: start|paused|pending_ip|pending_total}`, `signin_failed {reason: no_input}`, and one
`chromium_sandbox` line at start-up. None includes URLs, paths, cookies or content.

## Risks / Trade-offs

- [The allowlist is too tight and breaks Microsoft sign-in] -> only navigations are enforced,
  page resources are reported not blocked, `SIGNIN_NET_MODE=report` is a no-rebuild break-glass,
  and a real sign-in on the deployed host is a task before the change is called done.
- [The sandbox does not start on the host] -> documented fallback to non-root with the sandbox off
  (decision 2); the rest of the hardening still applies.
- [Campus NAT: many legitimate users share one IP and hit the per-IP limits] -> generous defaults;
  only one browser runs at a time anyway, so a class cannot sign in at once regardless; limits are
  environment settings and the refusal message says when to retry.
- [A missed `chown` makes the vault unreadable] -> the boot check refuses to start (decision 3); the
  backup `sessions.json.bak-pre-keepalive` exists; rollback needs no chown because the old image
  runs as root.
- [Read-only root filesystem breaks something that wrote to disk by accident] -> the test run and
  the live sign-in exercise Chromium's profile, Playwright scratch files and the vault; only `/tmp`
  and `/data` are writable.
- [A dedicated attacker with many IPs still takes the slot now and then] -> bounded to the
  first-input minute per start, the per-IP strike pause, and the pending-link caps; it is no longer
  five minutes per connection, and keep-alive's silent re-login simply retries next hour.
- [The seccomp profile drifts from Docker's default] -> it is derived from the default profile with
  a documented diff, and refreshed when Docker is upgraded.

## Migration Plan

1. Merge and build; run the full tests under Node 22.
2. On the host: take a backup of `server/data`, `git pull`, then `chown -R 1000:1000 server/data`.
3. `docker compose build --pull && docker compose up -d`.
4. Verify: `docker compose exec control-plane id` shows uid 1000; the start-up log shows
   `chromium_sandbox enabled` (or, on the fallback, `disabled`); the boot check passes; a real
   sign-in completes with "Stay signed in?" answered; `signin_net_summary` shows no blocked hosts
   beyond what is expected and its reported hosts are reviewed to extend the allowlist.
5. Rollback: check out the previous commit and rebuild. The old image runs as root and can read
   files owned by uid 1000. Re-run the `chown` before going forward again.

## Open Questions

- Which additional Microsoft or school hosts real sign-ins contact is answered by the first
  `signin_net_summary` events and only extends the allowlist, not the approach.
