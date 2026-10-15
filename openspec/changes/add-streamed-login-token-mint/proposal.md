# Proposal

## Why

Every user must copy a D2L session cookie to the server (extension or DevTools). It silently
dies, so the server runs a keep-alive sweep, yet the live logs showed 12 of 19 stored cookies
already dead (`keepalive_sweep pinged 7, failed 12`), and each death means a manual reconnect. A
sign-in the server can perform and renew itself removes that step and lets colleagues connect
Claude Code with only a URL.

Findings that shape this change (anonymous probing, the test browser, and the public
`brightspace-mcp-server` source, 2026-10-13):
- Both tenants (`lms.polite.edu.sg`, `nyplms.polite.edu.sg`) sign in through **SAML 2.0 to one
  Microsoft Entra tenant** (`243ebaed-...`); the login is not OAuth, and no OAuth client was
  available to us. The Entra login worked from the AWS host's IP in a streamed Chromium.
- D2L itself exposes `POST /d2l/lp/auth/oauth2/token` (scope `*:*:*`), which turns a session
  cookie plus an XSRF token into a Bearer access token, so renewing a token is one cheap call.
- **Not yet verified**: that this mint works on our two tenants, that Microsoft keeps its
  persistent sign-in cookie valid long enough to re-login silently, and that MFA policy does not
  force a prompt on every sign-in. The change is gated on these (design.md, Decision 1).

## What Changes

- **Verification gate first**: from the AWS host, sign in through a streamed Chromium on both
  tenants, run the token mint, and record the Entra persistent-cookie lifetime and MFA behavior.
  Go/no-go before any replacement work.
- If go: a **streamed-Chromium sign-in**. The server starts an isolated Chromium for one user and
  streams it to the user's browser at a one-time URL; the user types their own Microsoft
  credentials and MFA into the real login page. The server captures the resulting session.
- **Token mint renewal**: the server exchanges the D2L session cookies and XSRF token for a
  Bearer token via `/d2l/lp/auth/oauth2/token`, calls D2L with `Authorization: Bearer`, and renews
  by repeating the mint. Chromium relaunches only when the D2L session itself lapses, replaying the
  saved Microsoft cookies for a silent re-login; the user is asked to sign in again only when that
  fails.
- **MCP OAuth for clients**: MCP clients (Claude Code, Claude Desktop) connect by URL via the
  MCP authorization flow, whose authorize step is the streamed sign-in page.
- Retire the cookie paste path (`/signup`, `/sync`, `/connect` cookie page, `extension/`) and the
  keep-alive sweep.
- Drop STEP entirely (five `*_step_*` tools, client, `whoami` branch); serve the two D2L tenants.
- **BREAKING**: existing bearer tokens and stored cookies stop working; users reconnect once. STEP
  tools disappear.
- If no-go: ship nothing, keep the cookie flow and STEP, record the findings.

## Capabilities

### New Capabilities
- `streamed-login-session`: how a user signs in through a streamed browser, how the server holds
  and renews the resulting session, and what it never exposes or logs.
- `politemall-only-scope`: the supported scope is the POLITEMall D2L tenants only; STEP is not
  exposed and existing D2L tools are behavior-preserving.

### Modified Capabilities
<!-- None: no existing spec covers authentication or STEP. -->

## Impact

- `server/control-plane`: `src/index.ts` (replace `/signup`, `/sync`, bearer check with MCP OAuth
  routes and the stream endpoint), `src/auth/*` (new session vault holding Microsoft browser
  state and the D2L token; `keep-alive.ts` and cookie helpers removed), `src/api/d2l-client.ts`
  (Bearer header, token-expiry handling), `src/types/tool-context.ts` and `session-context.ts`
  (supply a token/session instead of a cookie), `src/connect-page.ts`, STEP files, `whoami`,
  `list-courses`, helpers, link/provenance/deep-link utilities, and their tests.
- New dependency: Playwright + Chromium and a browser-streaming layer; Docker image grows by
  roughly 1 GB.
- Infrastructure: the t3.small (about 1.3 GB free RAM) cannot run more than one or two
  Chromium sign-ins at once, so concurrency is capped, and a larger instance may be needed.
- Removes `extension/` and cookie/STEP sections of README and `deploy/`.
- Trust: the server will hold each user's Microsoft sign-in cookies, which are more sensitive
  than D2L cookies; colleagues must agree to this.
- Supersedes the unimplemented `add-nyp-oauth-drop-step` change.
