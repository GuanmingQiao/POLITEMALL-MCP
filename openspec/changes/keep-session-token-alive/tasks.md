# Tasks

All paths are under `server/control-plane/`. Run tests with the project's existing test command
(`npm test` in that directory).

## 1. Recover a rejected token

- [x] 1.1 Add `recoverD2lAuth(userId, school, rejectedAuth)` to `src/auth/d2l-session.ts`: return the vault's current token without a request if it differs from the rejected one; otherwise clear the cached token and join the shared in-flight `renew`; return null when the result equals the rejected token. Verify with new cases in `tests/auth/d2l-session.test.ts`: already-renewed token reused with zero mints, one mint for several concurrent callers, null on an unchanged token.
- [x] 1.2 Cover the outcomes in the same test file: mint ok returns a new Bearer value; mint `sessionExpired` then silent re-login success then second mint; both failing raises `SessionExpiredError` and marks the school session lapsed (it is not cleared; see group 4); transient mint failure raises `TokenRenewalError`, starts no re-login and keeps the stored session. Verify the tests pass.
- [x] 1.3 Add optional `recoverD2lAuth(school, rejectedAuth)` to `ToolContext` in `src/types/tool-context.ts` and wire it in `src/auth/session-context.ts`. Verify `npm run build` type-checks.
- [x] 1.4 In `src/tools/helpers.ts`, make `runAcrossD2LSchools` and `runForD2LCourse` catch `SessionExpiredError` from `fn`, call `ctx.recoverD2lAuth`, and re-run `fn` once with the new credential; on null, a thrown recovery error, or a second `SessionExpiredError`, fall through to the existing `explainD2lError` path. Verify with cases in `tests/tools/error-handling.test.ts` (or a new helper test): recovery succeeds and returns data, recovery attempted only once, `TokenRenewalError` yields the temporary-failure message, no context method yields today's behaviour, and one school recovering does not affect the other in `runAcrossD2LSchools`.
- [x] 1.5 Emit `token_recovered` / `token_recovery_failed` audit events (school and outcome only) from `recoverD2lAuth`. Verify a test that the audit record contains no token, cookie or URL text.

## 2. Keep Microsoft state only when it improves

- [x] 2.1 Add `hasNewerMicrosoftState(previous, current)` and a helper reading the `ESTSAUTHPERSISTENT` expiry from a Playwright storage state (cookies on `login.microsoftonline.com` only) in `src/auth/microsoft-state.ts`. Verify with `tests/auth/microsoft-state.test.ts`: new cookie, later expiry, same expiry, earlier expiry, empty jar, undefined previous, session cookie (expiry -1).
- [x] 2.2 Add an optional `msPersistentExpiresAt` and a `touchBrowserState(userId)` to `src/auth/session-vault.ts`; make `saveBrowserState` record the expiry from the state it stores; make `getBrowserState` return null when the recorded expiry is in the past, and add `browserStateStatus(userId)` returning `ok`, `absent` or `expired` for the failure reasons in group 5. Verify in `tests/auth/session-vault.test.ts`: expired recorded cookie returns null, no recorded expiry falls back to the flat window, record without the new field still works, touch refreshes last-used time without changing the stored state.
- [x] 2.3 Change `silentRelogin` in `src/auth/signin-browser.ts` to compare the post-login state with the saved one and call `saveBrowserState` only when newer, otherwise `touchBrowserState`. Verify with a test of both branches using the existing launch stub in `tests/auth/signin-stream.test.ts` (or a new test beside it).
- [x] 2.4 Confirm a full streamed sign-in (`src/auth/signin-session.ts`) still always saves its state and records the expiry. Verify with the existing sign-in tests plus an assertion on the recorded expiry.

## 3. Lapse instead of delete

- [x] 3.1 Add optional `lapsedAt` and `reloginFailures` to `SchoolSession` in `src/auth/session-vault.ts`, and keep `connectedSchools` listing a lapsed school. Verify in `tests/auth/session-vault.test.ts`: a record with and without the fields round-trips, and a lapsed school is still listed.
- [x] 3.2 Change the dead-session branch of `renew` in `src/auth/d2l-session.ts` to mark the school session lapsed, increment `reloginFailures` and throw `SessionExpiredError` instead of clearing; skip the mint and browser path and throw immediately while `lapsedAt` is under 10 minutes old; clear the session when the count reaches 3 or `browserStateStatus` is `absent` or `expired`; reset both fields on any success. Verify in `tests/auth/d2l-session.test.ts`: first failure keeps the session and records the lapse, a call inside the pause makes zero mints and zero re-logins, a call after the pause tries again, the third failure clears, absent or expired state clears at once, success resets, and a `no_slot` transient error does not count as a failure.
- [x] 3.3 Reset the lapsed fields on a full streamed sign-in in `src/auth/signin-session.ts`. Verify with an assertion in `tests/auth/signin-stream.test.ts` that a previously lapsed school is clean after sign-in.
- [x] 3.4 Confirm tools report a lapsed school as "session expired" with a sign-in link rather than "No school connected yet". Verify with a case in `tests/tools/error-handling.test.ts`.

## 4. Re-login outcome events

- [x] 4.1 Make `silentRelogin` in `src/auth/signin-browser.ts` return `{session}` or `{reason}` with reasons `no_state`, `state_expired`, `no_slot`, `microsoft_prompt`, `timeout`, `no_session`, `error`, keeping the existing behaviour for each exit (a missing slot still surfaces as the transient `TokenRenewalError`). Verify with tests for each exit using the launch stub.
- [x] 4.2 Emit one `silent_relogin` audit event per attempt from `d2l-session.ts` with school, `ok`, reason and `elapsedMs`. Verify with a test that the serialized event contains none of: the cookie header, XSRF token, access token, a URL, or exception text, even when the stub throws an error containing those strings.

## 5. Answer "Stay signed in?"

- [x] 5.1 Add detection and a single Yes click for Microsoft's "Stay signed in?" page (Microsoft host only, once per page, failures ignored) to the polling loop in `src/auth/signin-session.ts`. Verify with a local stub page that serves the prompt: the click happens once and the sign-in continues; on a non-Microsoft host nothing is clicked.
- [x] 5.2 Add `hasPersistentMicrosoftCookie(state)` to `src/auth/microsoft-state.ts`; record `persistent` on the `signin_ok` audit event and send a status warning when it is false. Verify in `tests/auth/microsoft-state.test.ts` and `tests/auth/signin-stream.test.ts`.
- [x] 5.3 Add one sentence to the sign-in page in `src/auth/signin-stream.ts` explaining that Yes is chosen so re-sign-in is rarely needed. Verify with a page-content assertion in `tests/auth/signin-stream.test.ts`.

## 6. Background keep-alive

- [x] 6.1 In `src/auth/token-mint.ts` read `Set-Cookie` on the token response and return a merged `cookieHeader` when `d2lSessionVal` or `d2lSecureSessionVal` is replaced. Verify in `tests/auth/token-mint.test.ts`: replaced value returned, unrelated cookies ignored, no header means no `cookieHeader`, value never appears in an error.
- [x] 6.2 In `src/auth/d2l-session.ts` save a returned `cookieHeader` with the new token in `renew`, and export `refreshD2lSession(userId, school)` sharing the in-flight map with `getD2lAuth`. Verify in `tests/auth/d2l-session.test.ts`: rotated cookies are stored, and a sweep call and a tool call at once cause one mint.
- [x] 6.3 Add `listSessionTargets()` to `src/auth/session-vault.ts` returning every user and school with a stored session, with the lapse pause visible. Verify in `tests/auth/session-vault.test.ts`.
- [x] 6.4 Add `src/auth/keep-alive.ts` (`runKeepAliveSweep`, `startKeepAlive`, interval from `KEEPALIVE_INTERVAL_MS` defaulting to 60 minutes in `src/utils/config.ts`) and start it from `src/index.ts` only. Verify in `tests/auth/keep-alive.test.ts` with injected dependencies: every session visited once and in order, sessions in their pause skipped, one failure does not stop the rest, overlapping sweeps skipped, the timer is unref'd, nothing starts on import, and the `keepalive_sweep` event holds counts only.

## 7. Sign-in links that keep working

- [x] 7.1 In `src/auth/signin-registry.ts` treat `running` and finished-with-undelivered-outcome as usable, return a refusal reason (`expired`, `finished`, `unknown`), track the attached viewer and when it left, and raise the `SIGNIN_LINK_TTL_MS` default to 60 minutes with a new `SIGNIN_REATTACH_GRACE_MS` default of 2 minutes in `src/utils/config.ts`. Verify in `tests/auth/signin-stream.test.ts` registry cases.
- [x] 7.2 In `src/auth/signin-stream.ts` keep one live session per link, accept the page and WebSocket for a running link with no viewer, refuse a second concurrent viewer, hold the grace timer on disconnect and stop the sign-in with `viewer_left` at its end, and hold and deliver an outcome that arrives while detached. Emit `signin_link_refused {reason}` and show the reason in the 410 page. Verify with new tests (stubbed browser): reload during sign-in shows the same browser, reconnect within grace keeps it, grace expiry closes it and refuses the link, success while detached is delivered on reattach, each refusal reason has its own text, and the audit event never contains the link id.
- [x] 7.3 Add `SigninSession.attach(io)` in `src/auth/signin-session.ts` that swaps the output channel and restarts the screencast. Verify with a Chromium test (skipped when none is installed) that frames resume after reattach.
- [x] 7.4 Make the page script in `src/auth/signin-stream.ts` reconnect on close and when the tab becomes visible, until the sign-in ends. Verify with a page-content assertion and the manual phone check in 8.3.
- [x] 7.5 Update the tests whose meaning changed: "abandoned: a viewer who leaves ends the browser" now ends it after the grace period, and "a second viewer cannot attach" now holds only while a viewer is attached. Verify the full `tests/auth/signin-stream.test.ts` passes.

## 8. Spec and live verification

- [x] 8.1 Run `openspec validate keep-session-token-alive --strict` and verify it passes.
- [x] 8.2 Run the full control-plane test suite and `npm run build` and verify both are clean.
- [ ] 8.3 On the live server, force a rejection (clear or corrupt the stored token's value, keep the session) and verify the next tool call succeeds with no sign-in link; then record the first observed `ESTSAUTHPERSISTENT` expiries for both tenants in `design.md` Open Questions, then confirm a `keepalive_sweep` event appears each hour, a `silent_relogin` event appears after the next lapse and that the sign-in page now answers "Stay signed in?". Also reload the sign-in page mid-sign-in and background then reopen the phone browser, and verify the same streamed browser is shown.
