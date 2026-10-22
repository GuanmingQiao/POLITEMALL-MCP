# Proposal

## Why

Renewal today is lazy and mostly sound (mint from the stored D2L session, then a silent Microsoft
re-login), but two gaps make a user's session die sooner than it needs to, and the user pays for it
with a "sign in again" message:

- When D2L rejects a token that still looks unexpired (revoked, clock skew), the call fails with
  "session expired - sign in again" even though the next call would have minted a fresh token
  silently. The rejected token is forgotten, but nothing retries.
- The saved Microsoft sign-in state, which silent re-login depends on, is overwritten after every
  silent re-login regardless of whether it improved, and the server never learns when Microsoft's
  own sign-in cookie expires. It guesses a flat 30 days, so it can keep dead state or discard
  live state.

- On the live server a user's first renewal failed, the school sessions were deleted on that one
  failure, and the user then saw "No school connected yet" instead of "session expired". Nothing was
  logged about why the silent re-login gave up, so the cause (most likely Microsoft issuing only a
  short-lived cookie because "Stay signed in?" was declined or never answered) cannot be seen.

- Nothing touches a user's D2L session between their own tool calls. The cookie-based build ran a
  keep-alive sweep because D2L sessions use sliding idle expiry; the streamed-login rewrite removed
  it, so idle sessions now die and push every user into silent re-login.
- Sign-in links are fragile. The link page opens only while a sign-in is "open", so a reload after
  the browser starts shows "already used or expired"; a viewer who disconnects (for example a phone
  browser sent to the background to approve a push in Authenticator) ends the sign-in and kills the
  link; and the 15 minute lifetime starts when the link is created, not when it is opened.

The reference implementation (RohanMuppa/brightspace-mcp-server, whose token mint this server
already follows) keeps sessions alive the same way, on use rather than on a timer: one HTTP mint and
at most one browser login per failed call, concurrent callers sharing one renewal, and Microsoft
state saved only when it is newer. Adopting that gives the same "stays signed in most days"
behaviour.

## What Changes

- A call that D2L rejects with 401 on a Bearer token recovers once, inside the call: mark the
  rejected token, mint a new one from the stored D2L session, and re-run the call. Only if that mint
  says the session is dead does the existing silent re-login run, and only then a sign-in link. A
  transient mint failure never starts a browser and never asks the user to sign in.
- Each call recovers at most once (one mint, at most one silent re-login). A second 401 after
  recovery is reported, not retried.
- Silent re-login saves the Microsoft browser state only when it holds a Microsoft sign-in cookie
  the previous state lacked or one that now expires later; a run that ends with no Microsoft cookies
  never replaces saved state.
- The expiry of Microsoft's persistent sign-in cookie is recorded when state is saved, and the
  retention check uses it (capped by the configured maximum) instead of the flat window, so state
  Microsoft has already expired is not replayed and live state is not dropped early.
- A failed silent re-login no longer deletes the user's school sessions. They are marked lapsed, so
  the user is told their session expired rather than that nothing is connected. Further silent
  re-logins are paused briefly so a broken state does not launch a browser on every call, and the
  sessions are cleared only after repeated consecutive failures or when the Microsoft state is no
  longer usable.
- Every silent re-login attempt is recorded as an audit event naming the school, the outcome and a
  reason category (never page content, URLs, cookies, tokens or credentials).
- The streamed sign-in answers Microsoft's "Stay signed in?" prompt with Yes, explains why on the
  sign-in page, and tells the user when Microsoft did not issue a persistent sign-in, so silent
  re-login has something to replay.
- A background keep-alive renews every stored school session every 60 minutes, one at a time, using
  the same renewal path as a tool call (mint, then silent re-login, then lapse). This departs from
  the reference, which has no timer, because here the browser that created the session closes
  after sign-in and many users share one server.
- When a mint succeeds, any rotated D2L session cookies in its response are saved, so a sliding
  session stays usable.
- Sign-in links stay valid for the whole sign-in: a reload or reconnect re-attaches to the running
  sign-in (one viewer at a time), a disconnected viewer gets a short grace period before the browser
  is closed, the link lifetime is longer, and a refused link says whether it expired, was finished,
  or is unknown (for example after a restart), with the reason logged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `streamed-login-session`: the renewable-token requirement gains rejected-token recovery within a
  call and background keep-alive; the sign-in and streamed-session requirements allow re-attaching; the silent re-login requirement gains the newer-state-only save, cookie-expiry-aware
  retention, and keeping lapsed sessions with a pause between attempts; and two requirements are
  added for the "Stay signed in?" prompt and for renewal outcome events.

## Impact

- `server/control-plane/src/auth/d2l-session.ts`: rejected-token handling and a recover-once entry
  point alongside `getD2lAuth`.
- `server/control-plane/src/auth/signin-browser.ts` and `session-vault.ts`: newer-state check,
  recording and reading Microsoft cookie expiry, reason categories for silent re-login, and a
  lapsed marker with failure count instead of deleting school sessions.
- `server/control-plane/src/auth/signin-session.ts` and `signin-stream.ts`: answering the "Stay
  signed in?" prompt, the sign-in page copy and the persistent-sign-in warning and audit field.
- `server/control-plane/src/tools/helpers.ts` and `types/tool-context.ts`: the two per-school
  chokepoints (`runAcrossD2LSchools`, `runForD2LCourse`) re-run their read-only call once with the
  recovered credential.
- `server/control-plane/src/index.ts` and a new `src/auth/keep-alive.ts`: the 60 minute sweep.
- `server/control-plane/src/auth/token-mint.ts`: reading rotated session cookies from the response.
- `server/control-plane/src/auth/signin-registry.ts`, `signin-stream.ts`, `utils/config.ts`:
  re-attachable links, grace period, longer lifetime and refusal reasons.
- Tests under `server/control-plane/tests/auth` and the helper tests.
- No new dependencies, no API or tool-surface changes, no new stored secrets (only a cookie expiry
  timestamp is added to the user record).
