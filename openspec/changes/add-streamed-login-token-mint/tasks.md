# Tasks

> **2026-10-15:** the verification gate (1.1-1.5) was skipped at the user's explicit instruction; those
> tasks stay unchecked and the assumptions they would have tested are recorded in design.md ("Implementation
> notes"). Task 3.1's image-build smoke test ran at deploy (6.2): Chromium starts inside the container on the host and
> streams frames. Full suite: 223/223 passing, including a real-Chromium
> sign-in, silent re-login, and the OAuth flow.

## 1. Verification gate (nothing in sections 2+ starts until 1.5 says GO)

- [ ] 1.1 Confirm the streamed Chromium test browser can sign in to both `lms.polite.edu.sg` and `nyplms.polite.edu.sg` from the AWS host, completing MFA; verify and record, per host, whether it reaches `/d2l/home` and which MFA prompts appear.
- [ ] 1.2 From the signed-in session, record the Microsoft cookie names and expiry dates (`ESTSAUTH`, `ESTSAUTHPERSISTENT`, `ESTSAUTHLIGHT`) and the D2L cookies' expiry, with values excluded; verify by writing them into `design.md`. (Needs the user's permission rule or DevTools readout; reading cookie values is not required.)
- [ ] 1.3 Find where the page exposes the XSRF token, then call `POST /d2l/lp/auth/oauth2/token` (scope `*:*:*`) with the session cookies and that token on both hosts; verify a Bearer token comes back and works on `GET /d2l/api/lp/{ver}/users/whoami` and a course-list route.
- [ ] 1.4 Close the session, start a fresh headless Chromium with the saved storage state, and verify whether it reaches D2L without any prompt (silent re-login) and whether MFA is demanded again; repeat after the D2L session has been idle past its timeout.
- [ ] 1.5 Write the results and an explicit GO / NO-GO into `design.md` (including how long silent re-login works). On NO-GO stop and ask the user whether to archive; make no code changes.

## 2. Session vault and token mint

- [x] 2.1 Replace the cookie store with an encrypted per-user session vault (Playwright storage state, Bearer token, expiry, last-used time) using the existing master key and file location; verify with tests for round-trip, corruption handling, retention expiry, and delete-on-sign-out.
- [x] 2.2 Implement the token mint module (`POST /d2l/lp/auth/oauth2/token` with cookies and XSRF token) classifying results as ok, session-expired (401, login redirect, expired-session stub), or transient; verify with mocked-fetch tests for each branch, including that a 5xx is never reported as session-expired.
- [x] 2.3 Change `ToolContext`/`session-context.ts` to supply a Bearer token and `d2l-client.ts` (including `apiGetBuffer`) to send `Authorization: Bearer`, keeping the 401/403/404 error mapping; verify with the existing client tests adapted plus a header assertion.
- [x] 2.4 Add single-flight renewal on expiry or 401 with the order cached token, mint, silent re-login, user link; verify with tests for concurrent calls producing one mint and for each fallback step.

## 3. Streamed sign-in

- [x] 3.1 Add Playwright and Chromium to the server image and a session manager that starts an isolated, memory-capped Chromium per sign-in with a concurrency cap and hard timeout; verify with tests that the cap rejects the extra session, timeouts kill it, and a build of the image runs a headless smoke test.
- [x] 3.2 Implement the one-time sign-in link and streaming endpoint (CDP screencast frames out, mouse and keyboard events in over WebSocket, no credentials or tokens in logs); verify with tests that links work once, expire, and that a captured log of a simulated typed password contains neither it nor any input event payload.
- [x] 3.3 Detect sign-in completion (D2L home reached, XSRF token available), save storage state, mint the first token, close Chromium, and report success to the page; verify with a test that drives a stub login page through to a stored vault entry.
- [x] 3.4 Implement silent re-login: launch headless with saved state, detect "reached D2L" versus "needs interaction", and either re-mint or return a session-expired result with a fresh link; verify with tests for both outcomes.

## 4. MCP authorization for clients

- [x] 4.1 Add MCP authorization endpoints (protected-resource and authorization-server metadata, client registration, authorize, token) using the SDK, with PKCE, exact redirect matching and short-lived single-use codes; verify an unauthenticated `/mcp` call returns 401 with discovery metadata and a full code exchange yields a working token.
- [x] 4.2 Wire the authorize step to start the streamed sign-in and complete the code issue when it finishes; verify with negative tests (wrong redirect URI, wrong verifier, replayed code) and an end-to-end test against the stub login.
- [x] 4.3 Add sign-out (delete vault entry and revoke MCP tokens); verify later tool calls require a new sign-in and the stored state is gone.

## 5. Remove cookie path and STEP

- [x] 5.1 Delete `/signup`, `/sync`, the cookie `connect-page.ts`, `auth/keep-alive.ts`, cookie helpers, and the `extension/` directory; verify the build passes and the old endpoints answer 404 in a test.
- [x] 5.2 Delete `api/step-client.ts`, the five STEP tools and tests, narrow the school types, and remove STEP branches from `whoami`, `list-courses`, `helpers`, `link-policy`, `provenance`, `deep-links`, `local-time`; verify build passes and a tool-list test asserts none of the five STEP names exist.
- [x] 5.3 Adapt the test harness (`tests/helpers/mcp-harness.ts`) to create vault-backed sessions and verify the full existing D2L tool suite passes with unchanged expectations, including `get_content_topic` returning `extractedText`.

## 6. Docs and deploy

- [x] 6.1 Rewrite `README.md` and `deploy/README.md` for URL-only connection in Claude Code and Claude Desktop, the trust model (server stores Microsoft sign-in state), capacity limits, and sign-out; verify by grep that no cookie-paste or STEP instructions remain.
- [x] 6.2 Back up `server/data/tokens.json`, deploy with `git pull` and `docker compose up -d --build`, remove the saml-test container and its temporary security group rule if still present, and verify startup logs and image memory use.

## 7. Live verification

- [x] 7.1 Connect Claude Code by URL only, sign in through the streamed page, and verify `whoami` and `list_courses` return both tenants.
- [ ] 7.2 (partly done 2026-10-15: `get_content_topic` on a known PDF returned `extractedText` through the new auth; the wait-past-token-lifetime renewal check and the silent-renewal duration are still open) Verify a representative read on each tenant (for example `get_content_topic` on a known PDF returns `extractedText`), then wait past the token lifetime and verify a call renews without any prompt; record how long silent renewal lasts.
- [ ] 7.3 Verify a second colleague account connects independently, cannot see the first user's data, and that a pre-change bearer token and the STEP tools are rejected or absent.
