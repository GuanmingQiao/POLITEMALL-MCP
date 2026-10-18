# Design

## Context

Renewal lives in `auth/d2l-session.ts`: `getD2lAuth` serves the cached Bearer token while it is more
than 2 minutes from expiry, otherwise one shared `renew` per user and school mints from the stored
D2L cookies, falls back to `silentRelogin` (a headless Chromium replaying the saved Microsoft
state, `auth/signin-browser.ts`) when D2L says the session is dead, and otherwise raises
`SessionExpiredError`. See proposal.md for why this is not enough.

What the reference (`brightspace-mcp-server`, `src/auth/token-manager.ts`, `src/api/client.ts`,
`src/auth/microsoft-session.ts`) does that we do not:
- On a 401 it marks the rejected access token, asks the token manager for a token again (which
  mints over HTTP and refuses to hand back the rejected one), retries, and only then runs one
  browser login. A transient mint failure propagates as an error and never opens a browser.
- It saves refreshed Microsoft browser state only when the jar has an Entra sign-in cookie the old
  one lacked or one that expires later, and records the persistent cookie's expiry in a small
  plain summary.
- It has no background keep-alive. Everything happens on use.

Our tools receive the credential as a plain string (`authFor`) and pass it into 47 `apiGet` /
`fetchAllPages` call sites, so the retry cannot sit inside `apiGet`. Every tool already funnels
through two helpers in `tools/helpers.ts`: `runAcrossD2LSchools` and `runForD2LCourse`.

## Goals / Non-Goals

**Goals:**
- A token D2L rejects before its stated expiry costs the user nothing when the session is alive.
- Saved Microsoft state is replayed while Microsoft would still accept it and not after.
- Same shape as the reference for renewal: recover-once, transient failures never escalate to a
  browser. A background keep-alive is added on top (decision 9), which the reference lacks.
- A sign-in link that keeps working through the whole sign-in, including a reload or a phone
  browser sent to the background.

**Non-Goals:**
- Surviving a server restart mid-sign-in: pending sign-ins stay in memory (the user asks for a new link).
- Measuring D2L's real idle limit or absolute session cap; the 60 minute interval is fixed by the
  requester, and the audit events (decision 9) will show whether it is enough.
- Changing how users first sign in, the OAuth layer, or any tool's input or output.
- Ticking Microsoft's MFA "Don't ask again" box, as the reference optionally does.
- An MFA cooldown like the reference's. There is no unattended MFA prompt here: silent re-login
  gives up the moment Microsoft asks for anything. The pause in decision 6 serves the same purpose
  of not hammering a state that cannot recover on its own.
- Retrying anything other than the whole read-only tool operation, once.

## Decisions

**1. Recover at the two helper chokepoints, not in `apiGet`.** `runAcrossD2LSchools` and
`runForD2LCourse` catch `SessionExpiredError` from `fn`, ask the context for a recovered credential
for that school, and re-run `fn` once with it. All D2L tools are read-only GETs, so replaying the
operation is safe. `ToolContext` gains an optional `recoverD2lAuth(school, rejectedAuth)`, next to
`invalidateD2lAuth`, so the tools stay free of the vault. If the second run also throws
`SessionExpiredError`, the existing message path runs unchanged. *Alternative:* retry inside
`apiGet`. Rejected: the credential is a string captured before the call, and 47 call sites would
need to change.

**2. `recoverD2lAuth` in `d2l-session.ts` reuses `renew`.** Given the rejected `Bearer` value:
- If the vault's current token differs from the rejected one, another call already renewed; return
  the current one without a request.
- Otherwise clear the cached token (what `invalidateD2lAuth` does today) and join the existing
  per-user-and-school in-flight `renew`, so concurrent rejections cause one mint. `renew` already
  gives the right outcomes: mint ok, or session dead then silent re-login then mint, or
  `SessionExpiredError`, or `TokenRenewalError` for transient trouble. Decision 6 replaces the
  immediate clearing of the school session in the dead-session branch.
- If the token it returns equals the rejected one, return null so the caller does not replay
  against a token D2L has just refused.
Transient failures surface as the existing "temporary, try again" message; no browser starts and
the stored session is untouched. *Alternative:* a separate recovery path. Rejected: it would
duplicate the classification in `token-mint.ts` that keeps a changed endpoint from looking like a
dead session.

**3. Newer-state-only save for Microsoft state.** `silentRelogin` today saves the state after every
success. New `hasNewerMicrosoftState(previous, current)` compares the Entra sign-in cookies
(`ESTSAUTH`, `ESTSAUTHPERSISTENT`, `ESTSAUTHLIGHT` on `login.microsoftonline.com`) as the reference
does: a cookie the old jar lacked, or a later expiry. Only then is the state replaced. A successful
silent re-login without newer state still refreshes the record's last-used time, so the existing
"retention since last successful use" meaning holds; only the stored jar is left alone. A full
streamed sign-in always saves.

**4. Record the persistent cookie's expiry and honour it.** When state is saved, store the
`ESTSAUTHPERSISTENT` expiry (epoch seconds, or none) on the user record next to
`browserStateSavedAt`. It is not a secret. `getBrowserState` returns null when either the existing
retention window since last use has passed or a recorded persistent expiry is in the past. No
recorded expiry (absent cookie, session cookie, or a record written before this change) means the
flat window alone, so existing users are unaffected. *Alternative:* parse the cookie jar on every
read. Rejected: it means decrypting the most sensitive blob just to check a date.

**5. Observability without secrets.** Audit `token_recovered` / `token_recovery_failed` with the
school and outcome only, the same shape as the existing `signin_ok` events. No token, cookie or
state content is logged.

**6. Lapse, don't delete.** Today `renew` calls `clearSchoolSession` the first time a mint says the
session is dead and silent re-login returns nothing. That destroyed the user's record of ever having
signed in (tools then said "No school connected yet") and made one flaky re-login final. Instead
`SchoolSession` gains `lapsedAt` and `reloginFailures`. On a failed silent re-login `renew` sets
`lapsedAt`, increments the count, saves, and throws `SessionExpiredError`. While `lapsedAt` is
within 10 minutes of now, `renew` skips the mint-then-browser path and throws immediately, so a
broken state costs one HTTPS-free check per call, not a Chromium launch. After the pause, the next
call tries the mint again and, if the session is still dead, one silent re-login. The school
session is cleared when the count reaches 3, or `getBrowserState` returns null (absent or expired,
decision 4) at the point of a re-login. A successful sign-in or silent re-login resets both fields.
`connectedSchools` keeps listing a lapsed school so the message is "session expired", with the
sign-in link. *Alternative:* keep clearing and fix only the message. Rejected: it still turns one
transient failure into a forced sign-in. *Alternative:* never clear. Rejected: a permanently dead
state would keep triggering a browser every 10 minutes.

**7. Silent re-login reports why it gave up.** `silentRelogin` returns a result carrying a reason
category instead of null, and the wrapper in `d2l-session.ts` emits one `silent_relogin` audit event:
`{school, ok, reason?, elapsedMs}`. Categories map to the existing exits: `no_state` and
`state_expired` (from `getBrowserState`, which must distinguish absent from expired), `no_slot`
(today a thrown `TokenRenewalError`, which stays transient and does not count as a failure under
decision 6), `microsoft_prompt` (the 12 second Microsoft-host exit), `timeout` (the 30 second
exit), `no_session` (home reached but cookies or XSRF missing), `error` (the catch-all, which today
hides launch failures). Only the category is logged; no URL, page text or exception message.
*Alternative:* log exception text. Rejected: it could carry page or token content.

**8. Answer "Stay signed in?" in the streamed browser.** Without it Microsoft issues only a
session cookie, and the replayed state can stop working within about a day, which matches the live
failure. While `waitForSessions` polls, it also looks for Microsoft's prompt (a page on the
Microsoft host whose primary button is the "Yes" button, `#idSIButton9`, with the prompt heading
present) and clicks Yes once per page. This is a click on a button, not typing; nothing the user
entered is read. The sign-in page copy gains one sentence explaining that Yes is chosen so
re-sign-in is rarely needed. After harvest, `hasPersistentMicrosoftCookie(state)` (decision 3/4
helper) decides the `persistent` field on `signin_ok` and whether the status message warns that a
new sign-in may be needed soon. The click is matched on the Microsoft host only, and a failed click
is ignored so it can never block a sign-in. *Alternative:* only tell the user to pick Yes. Rejected:
the live case shows users either miss it or decline it, and the page is shown at phone size.
*Alternative:* tick Microsoft's "Don't ask again" for MFA as the reference does. Out of scope here:
it is a separate consent and the tenant may not offer it.

**9. A 60 minute keep-alive sweep over every stored school session.** New `auth/keep-alive.ts`
exports `runKeepAliveSweep()` and `startKeepAlive()`, started from `index.ts` only (never from
tests): a first sweep 2 minutes after boot, then every `KEEPALIVE_INTERVAL_MS` (default 60 minutes),
on an unref'd timer, skipped if the previous sweep is still running. The sweep lists every
`(user, school)` that has a stored session (`listSessionTargets()` in the vault), skips any inside
its post-failure pause (decision 6), and renews each one at a time through a new
`refreshD2lSession(userId, school)` in `d2l-session.ts`. That function is `renew` behind the same
per-user-and-school in-flight map, so a sweep and a tool call never double-mint. Each session
therefore gets the full ladder: mint, then silent re-login, then lapse (and the sign-in link the
next time a tool needs it). It also leaves a fresh Bearer token in the vault. Errors are caught per
session; one failure never stops the sweep. One `keepalive_sweep` audit event per sweep records
counts only: sessions seen, renewed, recovered by silent re-login, lapsed, transient failures.
*Alternative:* ping `whoami` as the old build did. Rejected: the mint carries the cookies and also
refreshes the token, so one request does both jobs. *Alternative:* a per-user timer. Rejected: many
timers and no ordering; a single sequential sweep also keeps the one Chromium slot uncontended.

**10. Save rotated session cookies.** `mintAccessToken` reads `Set-Cookie` on the token response
and, when it contains replacement `d2lSessionVal` or `d2lSecureSessionVal` values, returns the
merged `cookieHeader` in its result; `renew` saves it with the new token. Values are never logged.
It costs nothing when D2L does not rotate, and it stops a sliding session whose cookie value changes
from being kept alive on a value that stops working. *Alternative:* ignore them, as the reference
does. Rejected: the reason for the sweep is to keep the cookies usable for a long time.

**11. Re-attachable sign-in links.** The registry no longer treats `running` as used. A link is
usable while its sign-in is `open` and unexpired, or `running`, or finished with an undelivered
outcome. Link lifetime (`SIGNIN_LINK_TTL_MS`) becomes 60 minutes and only governs the time before
the browser first starts; after that the existing 5 minute sign-in limit governs. `signin-stream.ts`
keeps one live `SigninSession` per link id. The page and the WebSocket upgrade accept a running
link when no viewer is attached and refuse a second concurrent viewer (the previous guarantee). On
viewer disconnect the session is not stopped; a grace timer (`SIGNIN_REATTACH_GRACE_MS`, default
2 minutes, never longer than the remaining sign-in limit) runs, and expiry stops the browser and
marks the sign-in failed with reason `viewer_left`. Reattach calls `session.attach(io)`, which swaps
the output channel and restarts the screencast so the current Microsoft page is drawn at once. If
the sign-in finishes while nobody is attached (the user approved the push and the browser reached
D2L), the outcome, including the OAuth redirect, is held and delivered on the next attach. The page
script reconnects automatically on close and when the tab becomes visible, for as long as the
sign-in is alive. Refusals return 410 with a reason (`expired`, `finished`, `unknown`) in plain
words and emit `signin_link_refused {reason}` without the id. *Alternative:* persist pending
sign-ins so restarts survive. Rejected for now: restarts are rare, and the `unknown` message names
that case. *Alternative:* a longer sign-in limit instead of reattach. Rejected: it does not fix a
reload or a backgrounded tab.

## Risks / Trade-offs

- [A 401 or redirect from a route for reasons other than the token costs one extra mint per call]
  -> `failFor` already folds 401 and 3xx into `SessionExpiredError`; the mint is one HTTPS call,
  happens at most once per call, and shares the in-flight renewal.
- [Replaying a heavy operation such as `get_all_final_grades` repeats its work] -> only on a 401,
  once per call, and the operation is read-only.
- [A session-expired answer only appears when the replay also fails, so the user waits for a mint
  and possibly a silent re-login before seeing the sign-in link] -> same latency the first call
  after a lapse already has today.
- [Recorded expiry is Microsoft's cookie attribute, which can differ from what Microsoft's server
  still accepts] -> it only ever shortens the window, and a failed silent re-login still falls
  through to the sign-in link, so the worst case is the current behaviour.
- [Last-used time refreshed without saving a new jar could keep an old jar alive in our window
  while Microsoft has aged it out] -> decision 4's recorded expiry bounds this whenever the cookie
  is persistent.

- [Microsoft changes the "Stay signed in?" page markup and the click stops matching] -> a missed
  click is silent and harmless; the `persistent: false` field and warning show it in the log and to
  the user, and the page copy still tells the user to choose Yes.
- [Keeping persistent sign-in is a longer-lived credential on the server than users may expect] ->
  it was already kept for up to 30 days; the sign-in page copy now says so, and sign-out still
  deletes everything.
- [A lapsed school stays listed, so tools that count connected schools may attempt it] -> the
  10 minute pause makes that attempt a fast `SessionExpiredError`; `runAcrossD2LSchools` already
  reports it as a warning beside the other school's data.

- [Sweep silent re-logins use the single Chromium slot and a user starting a sign-in at the same
  moment is told to retry] -> a re-login holds the slot at most 30 seconds, only runs for sessions
  that are actually dead, and sessions are processed one at a time.
- [Hourly renewal makes one request per user and school] -> trivially small at this scale; the sweep
  event shows the count and time.
- [Hourly keep-alive does not stop an absolute D2L session cap] -> silent re-login and the sign-in
  link remain; the `keepalive_sweep` and `silent_relogin` events show how often that happens.
- [A disconnected viewer keeps a Chromium for up to 2 minutes] -> bounded by the grace period and
  the 5 minute sign-in limit; the concurrency cap is unchanged.
- [A held outcome carries an OAuth redirect with an authorization code] -> it stays in server
  memory, is delivered once to whoever reattaches via the unguessable link, and the code itself is
  single-use and expires in 5 minutes.

## Migration Plan

No data migration: the new record fields (`msPersistentExpiresAt`, `lapsedAt`, `reloginFailures`)
are optional and absent on existing users. Users already cleared by the old behaviour sign in
again once. Deploy as a normal
control-plane release. Rollback is a revert; the extra field is ignored by the old code.

## Open Questions

- What the real `ESTSAUTHPERSISTENT` lifetime is on the POLITEMall and NYP tenants is still
  unobserved. It only tunes how often users see a sign-in link and can be answered from the first
  recorded expiries after release.
