# streamed-login-session Specification

## Purpose

Defines how a user signs in to the server through a streamed browser, how the server then keeps
that user's POLITEMall D2L access alive and renews it without manual steps, and what it protects.

## Requirements

### Requirement: Users sign in by typing their own credentials into a streamed browser
The system SHALL let a user sign in by showing them, in their own web browser, a live view of a
browser session running on the server at the school's real Microsoft sign-in page, where the user
types their own credentials and completes MFA. The system SHALL NOT ask the user to copy or paste
a cookie or token.

#### Scenario: first-time sign-in
- **WHEN** a user opens their sign-in link and completes the Microsoft sign-in in the streamed view
- **THEN** the system SHALL report the sign-in as complete, end the streamed browser, and the user's MCP client SHALL be able to read their courses

#### Scenario: sign-in link is single-purpose
- **WHEN** a sign-in link is opened a second time, after completion, or after it has expired
- **THEN** the system SHALL refuse it and SHALL NOT show any browser view

### Requirement: Streamed sessions are isolated, capped and short-lived
Each sign-in SHALL run in its own isolated browser session belonging to one user, SHALL be
available only through that user's one-time link, and SHALL be shut down when the sign-in
completes, fails, or exceeds a time limit. The system SHALL cap the number of concurrent
sessions.

#### Scenario: capacity reached
- **WHEN** a user starts a sign-in while the concurrency cap is reached
- **THEN** the system SHALL tell the user to retry shortly and SHALL NOT start another browser session

#### Scenario: abandoned sign-in
- **WHEN** a streamed sign-in is left open past its time limit
- **THEN** the system SHALL terminate the browser session and discard anything it captured

### Requirement: D2L access uses a renewable Bearer token obtained from the user's session
After a sign-in the system SHALL obtain a Bearer access token from the school's D2L host by
exchanging the user's D2L session, SHALL call D2L with that token, and SHALL renew it by repeating
the exchange before or after it expires, without launching a browser while the D2L session is
still valid.

#### Scenario: expired token renewed cheaply
- **WHEN** a tool call arrives after the user's access token has expired but their D2L session is still valid
- **THEN** the system SHALL obtain a new token and complete the call without starting a browser or asking the user to sign in

#### Scenario: one sign-in covers both tenants
- **WHEN** a user has signed in once
- **THEN** `list_courses` SHALL include their courses from every tenant (POLITEMall and NYP) on which they are enrolled, each labelled with its school

### Requirement: Lapsed sessions are re-established silently where possible
When the D2L session can no longer mint a token, the system SHALL attempt a silent re-login using
the Microsoft sign-in state saved from the user's last sign-in, and SHALL only ask the user to sign
in again when that fails or Microsoft demands interaction.

#### Scenario: silent re-login succeeds
- **WHEN** a tool call finds the D2L session lapsed and the saved Microsoft state is still accepted
- **THEN** the system SHALL re-establish the session in a background browser and complete the call without user action

#### Scenario: interaction required
- **WHEN** silent re-login fails or Microsoft requires MFA again
- **THEN** the tool result SHALL be a session-expired error containing a new one-time sign-in link, and SHALL NOT contain partial data

### Requirement: MCP clients connect by URL through the MCP authorization flow
The system SHALL act as an OAuth authorization server toward MCP clients, so that a client
supporting the MCP authorization specification can connect with only the server URL, with the
streamed sign-in as the user-facing authorize step.

#### Scenario: unauthenticated client
- **WHEN** an MCP client calls the MCP endpoint without a valid token
- **THEN** the system SHALL answer 401 with discovery metadata that lets the client begin authorization, and SHALL return no D2L data

#### Scenario: PKCE enforced
- **WHEN** a client's authorization code is exchanged with a missing or wrong code verifier, or is replayed
- **THEN** the system SHALL reject the exchange

### Requirement: Stored sign-in material is protected and removable
The system SHALL encrypt stored Microsoft sign-in state and D2L tokens at rest, SHALL NOT write
credentials typed into the streamed browser, tokens, cookies, or authorization codes to logs or
audit records, SHALL limit how long saved Microsoft state is kept, and SHALL let a user sign out
and delete all of their stored state.

#### Scenario: typed credentials never recorded
- **WHEN** a user types a password and MFA code into the streamed browser
- **THEN** neither value SHALL appear in any log, audit record, or persisted file

#### Scenario: user deletes their state
- **WHEN** a user signs out
- **THEN** the system SHALL delete their saved Microsoft state and D2L tokens and subsequent tool calls SHALL require a new sign-in

### Requirement: Legacy cookie upload is removed
The system SHALL NOT accept user-supplied cookies, and the former signup and sync endpoints SHALL
be removed.

#### Scenario: old endpoint called
- **WHEN** a client calls the former cookie sync or signup endpoint
- **THEN** the system SHALL answer not found
