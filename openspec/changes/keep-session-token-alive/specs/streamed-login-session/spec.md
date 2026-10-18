## MODIFIED Requirements

### Requirement: D2L access uses a renewable Bearer token obtained from the user's session
After a sign-in the system SHALL obtain a Bearer access token from the school's D2L host by
exchanging the user's D2L session, SHALL call D2L with that token, and SHALL renew it by repeating
the exchange before or after it expires, without launching a browser while the D2L session is
still valid. When D2L rejects a token that has not yet expired, the system SHALL treat that as a
rejected token rather than a lapsed session: it SHALL obtain a new token and repeat the call once
before reporting any failure. Each call SHALL attempt this recovery at most once. Renewal SHALL happen on use and, in
addition, in the background as the keep-alive requirement below states.

#### Scenario: expired token renewed cheaply
- **WHEN** a tool call arrives after the user's access token has expired but their D2L session is still valid
- **THEN** the system SHALL obtain a new token and complete the call without starting a browser or asking the user to sign in

#### Scenario: one sign-in covers both tenants
- **WHEN** a user has signed in once
- **THEN** `list_courses` SHALL include their courses from every tenant (POLITEMall and NYP) on which they are enrolled, each labelled with its school

#### Scenario: rejected but unexpired token recovered within the call
- **WHEN** D2L answers 401 to a call made with a token that has not expired, and the user's D2L session is still valid
- **THEN** the system SHALL obtain a new token, repeat the call once, and return its result without starting a browser or asking the user to sign in

#### Scenario: recovery is attempted only once per call
- **WHEN** the repeated call is also rejected with 401
- **THEN** the system SHALL report the failure for that call and SHALL NOT make a further recovery attempt in the same call

#### Scenario: temporary failure during recovery is not a lapsed session
- **WHEN** a token cannot be obtained during recovery because D2L is unreachable, answers 5xx or 429, or answers in an unrecognised way
- **THEN** the system SHALL report a temporary failure, SHALL NOT start a browser, SHALL NOT discard the user's stored session, and SHALL NOT present a sign-in link

#### Scenario: concurrent calls share one recovery
- **WHEN** several calls for the same user and school are rejected at the same time
- **THEN** the system SHALL perform one token exchange and every call SHALL use its result

### Requirement: Lapsed sessions are re-established silently where possible
When the D2L session can no longer mint a token, the system SHALL attempt a silent re-login using
the Microsoft sign-in state saved from the user's last sign-in, and SHALL only ask the user to sign
in again when that fails or Microsoft demands interaction. The system SHALL replace the saved
Microsoft state after a silent re-login only when the new state holds a Microsoft sign-in cookie
the saved state lacked or one that expires later, and SHALL record when Microsoft's persistent
sign-in cookie expires so that saved state Microsoft has already expired is not replayed. A failed
silent re-login SHALL NOT delete the user's school sessions: the system SHALL mark them lapsed,
SHALL tell the user their session expired (not that no school is connected), and SHALL NOT attempt
another silent re-login for that user and school for 10 minutes. The system SHALL clear a lapsed
school session only after 3 consecutive failed silent re-logins or when the saved Microsoft state is
absent or expired, and a successful sign-in or silent re-login SHALL clear the lapsed mark.

#### Scenario: silent re-login succeeds
- **WHEN** a tool call finds the D2L session lapsed and the saved Microsoft state is still accepted
- **THEN** the system SHALL re-establish the session in a background browser and complete the call without user action

#### Scenario: interaction required
- **WHEN** silent re-login fails or Microsoft requires MFA again
- **THEN** the tool result SHALL be a session-expired error containing a new one-time sign-in link, and SHALL NOT contain partial data

#### Scenario: single failed silent re-login keeps the session
- **WHEN** a silent re-login fails for the first time for a user and school
- **THEN** the system SHALL keep that school session marked lapsed, SHALL return the session-expired error with a new sign-in link (not a "no school connected" message), and SHALL NOT delete the saved Microsoft state

#### Scenario: attempts are paused after a failure
- **WHEN** another tool call needs that user and school within 10 minutes of a failed silent re-login
- **THEN** the system SHALL NOT start a background browser and SHALL return the session-expired error with a sign-in link

#### Scenario: repeated failures end the session
- **WHEN** a third consecutive silent re-login fails, or the saved Microsoft state is absent or expired
- **THEN** the system SHALL clear that school session

#### Scenario: success clears the lapsed mark
- **WHEN** the user signs in again, or a later silent re-login succeeds
- **THEN** the system SHALL clear the lapsed mark and the failure count for that school

#### Scenario: newer Microsoft state is kept
- **WHEN** a silent re-login ends with a Microsoft sign-in cookie that is new or expires later than the saved one
- **THEN** the system SHALL save the new state in place of the old

#### Scenario: no improvement leaves saved state alone
- **WHEN** a silent re-login ends with Microsoft state that has no Microsoft sign-in cookies, or none that expire later than the saved ones
- **THEN** the system SHALL keep the previously saved state unchanged

#### Scenario: expired Microsoft cookie is not replayed
- **WHEN** a lapsed session needs silent re-login and the recorded expiry of the saved Microsoft sign-in cookie has passed
- **THEN** the system SHALL skip the background browser and go straight to the session-expired error with a new sign-in link

### Requirement: Users sign in by typing their own credentials into a streamed browser
The system SHALL let a user sign in by showing them, in their own web browser, a live view of a
browser session running on the server at the school's real Microsoft sign-in page, where the user
types their own credentials and completes MFA. The system SHALL NOT ask the user to copy or paste
a cookie or token.

#### Scenario: first-time sign-in
- **WHEN** a user opens their sign-in link and completes the Microsoft sign-in in the streamed view
- **THEN** the system SHALL report the sign-in as complete, end the streamed browser, and the user's MCP client SHALL be able to read their courses

#### Scenario: sign-in link is single-purpose
- **WHEN** a sign-in link is opened after its sign-in completed or failed, or after it has expired
- **THEN** the system SHALL refuse it and SHALL NOT show any browser view

### Requirement: Streamed sessions are isolated, capped and short-lived
Each sign-in SHALL run in its own isolated browser session belonging to one user, SHALL be
available only through that user's one-time link, and SHALL be shut down when the sign-in
completes, fails, exceeds a time limit, or its viewer stays disconnected past a grace period. At
most one viewer SHALL be attached to a sign-in at a time. The system SHALL cap the number of
concurrent sessions.

#### Scenario: capacity reached
- **WHEN** a user starts a sign-in while the concurrency cap is reached
- **THEN** the system SHALL tell the user to retry shortly and SHALL NOT start another browser session

#### Scenario: abandoned sign-in
- **WHEN** a streamed sign-in is left open past its time limit
- **THEN** the system SHALL terminate the browser session and discard anything it captured

#### Scenario: second viewer refused
- **WHEN** a viewer is attached to a running sign-in and another connection opens the same link
- **THEN** the system SHALL refuse the second connection and keep the first viewer attached

## ADDED Requirements

### Requirement: Streamed sign-in leaves Microsoft's persistent sign-in in place
When Microsoft shows its "Stay signed in?" prompt during a streamed sign-in, the system SHALL answer
Yes on the user's behalf, without reading or recording anything the user typed, and the sign-in page
SHALL tell the user why. When the sign-in completes without a persistent Microsoft sign-in cookie,
the system SHALL tell the user that they will need to sign in again soon, and the `signin_ok` audit
event SHALL record whether a persistent cookie was present.

#### Scenario: prompt answered
- **WHEN** Microsoft shows "Stay signed in?" during a streamed sign-in
- **THEN** the system SHALL choose Yes, and the sign-in SHALL continue to the D2L home page

#### Scenario: no persistent sign-in is reported
- **WHEN** the sign-in completes and the saved Microsoft state has no persistent sign-in cookie
- **THEN** the system SHALL show a notice that the session may need a new sign-in within about a day, and SHALL record `persistent: false` in the audit event

#### Scenario: nothing typed is touched
- **WHEN** the prompt is answered automatically
- **THEN** no password, code or other text the user typed SHALL be read, logged or stored by that step

### Requirement: Silent re-login outcomes are recorded without secrets
The system SHALL record each silent re-login attempt as an audit event naming the school, whether it
succeeded, how long it took, and on failure exactly one reason category from: no saved state, saved
state expired, no browser slot, Microsoft asked for input, timed out, no D2L session after reaching
D2L, or other error. The event SHALL NOT contain page content, URLs, cookies, tokens, credentials or
error text from the page.

#### Scenario: failure reason recorded
- **WHEN** a silent re-login fails because Microsoft shows a prompt that needs an answer
- **THEN** the audit log SHALL gain one event with the school, a failed outcome, the elapsed time and the reason "Microsoft asked for input", and nothing else about the page

#### Scenario: success recorded
- **WHEN** a silent re-login succeeds
- **THEN** the audit log SHALL gain one event with the school, a successful outcome and the elapsed time

### Requirement: Stored D2L sessions are kept alive in the background
The system SHALL renew every stored school session, for every user, once every 60 minutes, using the
same renewal as a tool call: a new token from the stored D2L session, then silent re-login when the
session is dead, then marking it lapsed. It SHALL process sessions one at a time, SHALL NOT let one
failure stop the rest, SHALL skip a school session that is inside its post-failure pause, and SHALL
save any D2L session cookies the school returns while renewing so that a session that rotates its
cookies stays usable.

#### Scenario: idle session stays alive
- **WHEN** 60 minutes pass with no tool call from a user whose D2L session is still valid
- **THEN** the system SHALL renew that user's token and keep their session without starting a browser

#### Scenario: dead session recovered in the background
- **WHEN** the periodic renewal finds a user's D2L session dead and their saved Microsoft state is accepted
- **THEN** the system SHALL re-establish the session by silent re-login so the user's next tool call needs no sign-in

#### Scenario: one failing user does not stop the sweep
- **WHEN** renewal for one user and school fails
- **THEN** the system SHALL record the outcome and continue with the remaining sessions

#### Scenario: rotated cookies are kept
- **WHEN** a token request returns replacement D2L session cookies
- **THEN** the system SHALL store them in place of the old ones

### Requirement: A returned sign-in link works for the whole sign-in
A sign-in link SHALL stay usable from the moment it is issued until its sign-in completes, fails or
reaches its time limit, not only until it is first opened. Opening the link again, or reconnecting
after a dropped connection, while the sign-in is in progress SHALL re-attach the viewer to the same
streamed browser. When the viewer disconnects, the system SHALL keep the browser for a grace period
before closing it. A link that is refused SHALL say whether it expired, was already completed, or is
not known to the server, and the refusal SHALL be recorded with that reason and no part of the link.

#### Scenario: reload during sign-in
- **WHEN** the user reloads the sign-in page or opens the link again while their sign-in is in progress
- **THEN** the system SHALL show the same streamed browser rather than refusing the link

#### Scenario: switching apps to approve a push
- **WHEN** the viewer disconnects (for example the phone browser is backgrounded) and reconnects within the grace period
- **THEN** the system SHALL re-attach to the same browser with the Microsoft sign-in where the user left it

#### Scenario: grace period ends
- **WHEN** the viewer stays disconnected past the grace period
- **THEN** the system SHALL close the browser, discard what it captured, and refuse the link as ended

#### Scenario: refusal says why
- **WHEN** a link is opened after it expired, after its sign-in completed, or after a server restart
- **THEN** the page SHALL state which of those applies and SHALL tell the user to ask for a new link
