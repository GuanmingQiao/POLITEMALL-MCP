# Design

## Context

The server (`server/control-plane`, Express behind Caddy on a t3.small, 2 GB RAM) authenticates MCP
clients with a self-issued bearer token (`/signup`) and talks to D2L with a per-user encrypted
cookie uploaded through `/sync`. `ToolContext` (`types/tool-context.ts`) hands tools a cookie via
`getCookieHeader(school)`, and `api/d2l-client.ts` sends it as `Cookie:`. `auth/keep-alive.ts`
pings D2L to defer idle expiry. See proposal.md for motivation and findings.

Observed facts this design rests on:
- Both tenants redirect signed-out users to the same Entra tenant via SAML 2.0.
- A streamed Chromium on the EC2 host (LinuxServer Chromium container, KasmVNC) let the user
  complete the Microsoft sign-in and reach the D2L home page from the AWS IP.
- The public `brightspace-mcp-server` (MIT) drives Entra login with Playwright, saves browser
  state including Entra's persistent cookies, then POSTs `/d2l/lp/auth/oauth2/token` with the
  session cookies and an XSRF token to get a Bearer token. We implement our own code from that
  behavior; no code is copied.

Not yet observed: the token mint on our tenants, the Entra persistent-cookie lifetime, and MFA
frequency. The cookie value inspection that would answer the last two was blocked in this
session by the auto-mode classifier and is still open.

## Goals / Non-Goals

**Goals:**
- A user signs in once by typing into a streamed real login page; renewal is automatic until the
  Microsoft state genuinely expires or MFA is demanded again.
- Colleagues connect Claude Code with a URL only.
- Replace cookie paste and drop STEP without changing any D2L tool's contract.

**Non-Goals:**
- Writing to D2L (stays read-only), new D2L tools, other schools.
- Storing or ever handling users' passwords on the server beyond transit through the streamed
  browser (no saved passwords, no automated credential typing).
- Keeping the cookie path as a fallback.

## Decisions

**1. Verification gate (go/no-go).** A throwaway script plus the existing test browser establish,
on both hosts from the AWS IP: (a) the Entra sign-in completes in the streamed browser, (b) the
token mint returns a Bearer token accepted by `GET /d2l/api/lp/{ver}/users/whoami` and a
course-list route, (c) the lifetime of Entra's persistent cookies, (d) whether MFA is demanded on
every fresh Chromium sign-in, (e) the XSRF token's source on the page. NO-GO on (b), or on (a)
with no workable alternative, ends the change. A short persistent-cookie lifetime in (c) is not a
no-go by itself; it just means users re-sign-in more often, and the result is recorded.
*Alternative:* build first. Rejected: the mint endpoint and Microsoft's behavior are untested on
our tenants.

**2. Streaming mechanism: headless Chromium driven by Playwright, streamed over CDP screencast.**
The server sends screencast frames to the user's page over a WebSocket and applies the user's
mouse/keyboard events to the page. This needs no desktop session or VNC, uses less memory, and is
easy to scope to one user per one-time URL. *Alternative:* a per-user KasmVNC/noVNC container as
in the test. Rejected for the product: heavier (about 700 MB each), needs a container per sign-in,
and exposes a general desktop. It remains the fallback if CDP input handling is too flaky for
Microsoft's page (e.g. number-matching, FIDO prompts).

**3. Session vault replaces cookie vault.** Per user store, encrypted with the existing AES-256-GCM
master key: Playwright storage state (Microsoft and D2L cookies), the current Bearer token and
its expiry. Retention limit on the Microsoft state (default 30 days since last successful use,
shorter if the persistent cookie expires sooner). Sign-out deletes it.

**4. Renewal order, cheapest first.** (1) Use the cached Bearer token. (2) On expiry/401, mint a
new one from the stored D2L session cookies and XSRF token (single-flight per user). (3) If the
mint reports the session expired, relaunch headless Chromium with the saved storage state (silent
Entra re-login) and re-mint. (4) If that needs interaction, return a session-expired error with a
fresh one-time link. The 5-minute keep-alive sweep is removed; renewal on use replaces it.

**5. MCP authorization server for clients.** Use the MCP SDK's server auth helpers for metadata,
client registration, authorize and token endpoints (PKCE, exact redirect matching, short-lived
codes). The authorize step opens our streamed sign-in page for that request. MCP access tokens
are opaque, mapped to the user's vault entry, and independent of D2L tokens. *Alternative:* keep
bearer tokens. Rejected: clients cannot connect by URL alone, and Claude Desktop's connector UI
needs OAuth.

**6. One tool seam.** `ToolContext` supplies `getD2lAuth(school)` (a Bearer token string)
instead of `getCookieHeader`; `d2l-client.ts` sends `Authorization: Bearer`. 401 maps to the same
`SessionExpiredError`, so tools and their tests keep their contract. Calls that cannot use a Bearer
token (if any route proves cookie-only in the gate) keep a cookie option on the same seam.

**7. STEP removal is mechanical and follows the gate.** Delete `api/step-client.ts`, five tools,
STEP branches in `whoami`, `list-courses`, `helpers`, `link-policy`, `provenance`, `deep-links`,
`local-time`, narrow `School`/`D2LSchool` to the two tenants, update `tool-set` and annotation tests.

**8. Capacity.** A small semaphore limits concurrent Chromium sessions (default 1 on the current
instance, configurable), each with a memory cap and hard timeout. Chromium is not kept running
between sign-ins or renewals longer than needed. A larger instance is an option if more
colleagues join.

**9. Credentials never persisted.** Keystrokes are forwarded to the page and never logged or
stored; the streamed page and its WebSocket carry no tokens in URLs beyond the one-time id;
audit records identify users only by the existing short hash.

## Risks / Trade-offs

- [Entra blocks or challenges headless Chromium or the AWS IP] → Gate (a)/(d); fall back to the
  KasmVNC-style stream; record outcome.
- [Microsoft's page changes break scripted silent re-login] → Silent re-login only replays saved
  state and detects "needs interaction", it does not script credential entry; failure falls back
  to the user link.
- [Stored Microsoft cookies are a high-value target] → Encryption at rest, retention limit, per-user
  deletion, isolated Chromium, no logging, explicit colleague consent; document in README.
- [Mint endpoint is undocumented and may change] → Gate (b); a mint failure surfaces as
  session-expired, never as wrong data; keep the mint call isolated in one module with tests.
- [Capacity: Chromium is memory-heavy] → Concurrency cap, timeouts, instance upsizing path.
- [Breaking change strands users] → Announce, one-time reconnect, keep the previous commit
  deployable for rollback.
- [Abuse of the public stream endpoint (bots opening links)] → One-time unguessable ids, short
  expiry, rate limits per IP and per user.

## Migration Plan

1. Gate. 2. Implement behind the existing deploy path (git pull + `docker compose up -d --build`,
the Docker image gains Chromium). 3. Back up `server/data/tokens.json`, deploy, verify live with a
real sign-in on both tenants and `get_content_topic` on a known PDF. 4. Rollback: redeploy the
previous commit and restore the token file. The superseded change `add-nyp-oauth-drop-step` is
left untouched for the user to archive or delete.

## Open Questions

- Which instance size and concurrency cap to run in production (depends on how many colleagues
  join; does not change specs or tasks).
- Where the XSRF token is exposed on D2L pages for these tenants (settled in the gate, task 1.3).

## Implementation notes (2026-10-15)

- **The verification gate (tasks 1.1-1.5) was skipped at the user's explicit instruction** and the
  build proceeded on the stated assumptions. Still unverified on the real tenants: that
  `/d2l/lp/auth/oauth2/token` accepts our session cookies and XSRF token, how long Microsoft's
  persistent sign-in state lasts, and whether MFA is demanded on every fresh Chromium sign-in. The
  code isolates each of these (one mint module, one silent re-login function, fallbacks that send the
  person to a fresh sign-in link), so a negative finding degrades to "sign in again" rather than
  wrong data. Task 7 (live verification) is where they get answered.
- Chromium comes from `playwright-core` driving the Debian `chromium` package (`CHROMIUM_PATH`),
  not Playwright's own browser download; tests find Edge/Chrome locally and skip if none exists.
- PKCE is verified in the provider (`skipLocalPkceValidation`) so that an authorization code is
  spent by any attempt, including one with a wrong verifier; the SDK's own check would have let the
  same code be retried.
- `trust proxy` is set to 1 (Caddy) instead of `true`, so IP rate limits cannot be dodged with a
  spoofed `X-Forwarded-For`.
- Sign-out is `POST /signout` (bearer-authenticated), not an MCP tool: a tool would be the only
  non-read-only tool in a server whose tool set is pinned as read-only.
- One sign-in covers both tenants: after the first tenant's home is reached, the other is opened in
  the same browser so the Microsoft session signs in there automatically (60 s grace); a person with
  only one tenant just ends up with one.
- The streamed view sends mouse and keyboard events as CDP input; a text box on the page
  (`Input.insertText`) covers phones and pasted codes. Tenant buttons on the page let a person open
  either D2L home if the automatic redirect lands somewhere unhelpful.
