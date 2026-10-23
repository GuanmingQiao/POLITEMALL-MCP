## ADDED Requirements

### Requirement: The server runs locally from npx over stdio
The system SHALL be runnable on a user's own computer with a single `npx` command that starts an MCP server over standard input/output for one local user. It SHALL NOT open a network listener, require an account with any hosting provider, or require AWS access.

#### Scenario: client configured with npx
- **WHEN** an MCP client launches the package's command and performs the MCP handshake
- **THEN** the server SHALL answer over stdio and list its tools without any network port being opened

#### Scenario: unsupported Node version
- **WHEN** the package is started on a Node.js version older than the supported minimum
- **THEN** it SHALL exit with a message naming the required version and SHALL NOT start

### Requirement: The local server offers exactly the cloud server's functionality
The local server SHALL expose the same tools, with the same names, input schemas, descriptions, annotations, results, evidence links, provenance, citation instructions and error behaviour as the cloud server for the same inputs. The only behaviours that MAY differ are how a person signs in, where credentials are stored, and the wording of sign-in guidance shown when no usable session exists.

#### Scenario: same tool list
- **WHEN** the local and cloud servers each list their tools
- **THEN** the two lists SHALL be identical in names, schemas and descriptions

#### Scenario: same results for the same session
- **WHEN** the same tool is called with the same arguments against the same signed-in person's D2L data
- **THEN** the local server SHALL return the same result shape and content as the cloud server

#### Scenario: sign-in guidance fits a local user
- **WHEN** a tool is called and no school is connected, or a session has expired and cannot be renewed silently
- **THEN** the local server SHALL tell the user that a sign-in window has been opened on their computer (or how to open one), and SHALL NOT present a web link to a streamed browser

### Requirement: Sign-in happens in the user's own local browser
The local server SHALL sign a person in by opening a visible browser window on their own computer, using a browser already installed there (Google Chrome or Microsoft Edge, or one the user names), at the school's real Microsoft sign-in page. The user SHALL type their own credentials and complete MFA in that window. The system SHALL NOT ask the user to copy or paste a cookie or token, and SHALL NOT stream the browser to any other page.

#### Scenario: first-time sign-in
- **WHEN** the user runs `auth`, or calls a tool while not signed in, and then completes the Microsoft sign-in in the opened window
- **THEN** the system SHALL capture the D2L session, verify it by obtaining a Bearer token, close the window, and subsequent tool calls SHALL read the user's courses

#### Scenario: one sign-in covers both tenants
- **WHEN** the user has signed in once
- **THEN** both POLITEMall and NYP SHALL be connected where the account is enrolled, as in the cloud server

#### Scenario: no suitable browser
- **WHEN** no Chrome, Edge or user-specified browser can be found
- **THEN** the system SHALL fail the sign-in with a message saying which browsers are supported and how to point it at one, and SHALL NOT download a browser

#### Scenario: window closed or sign-in abandoned
- **WHEN** the user closes the window or the sign-in exceeds its time limit
- **THEN** the system SHALL end that sign-in, discard anything captured from it, leave any previously stored session untouched, and report that the sign-in did not complete

#### Scenario: only one sign-in at a time
- **WHEN** a sign-in window is already open and another sign-in is requested
- **THEN** the system SHALL reuse the open window rather than start a second one

### Requirement: Credentials are stored encrypted on the user's machine only
The local server SHALL keep the person's D2L sessions, saved Microsoft sign-in state and Bearer tokens only on the local file system, encrypted at rest with a key that is generated on first use and kept on that machine, preferably in the operating system's credential store and otherwise in an owner-only key file, with the data in a per-user directory readable only by that user where the operating system supports it. It SHALL NOT send credentials anywhere other than the school and Microsoft sign-in hosts, and SHALL NOT log them.

#### Scenario: first run creates the store
- **WHEN** the server or `auth` runs for the first time
- **THEN** it SHALL create the local data directory and an encryption key, and nothing stored SHALL be readable without that key

#### Scenario: key held in the OS credential store
- **WHEN** the operating system provides a credential store
- **THEN** the encryption key SHALL be kept there and no key file SHALL be written

#### Scenario: no credential store available
- **WHEN** no credential store can be used (for example a headless Linux session)
- **THEN** the system SHALL fall back to an owner-only key file and `doctor` SHALL report which is in use

#### Scenario: sessions survive restarts
- **WHEN** the user signs in, the MCP client is closed and later restarted
- **THEN** tool calls SHALL work without signing in again, renewing tokens and re-establishing lapsed D2L sessions silently as the cloud server does

#### Scenario: logout deletes everything
- **WHEN** the user logs out
- **THEN** all stored sessions, saved Microsoft state and tokens for that user SHALL be deleted, not merely marked unusable, and subsequent tool calls SHALL report that no school is connected

#### Scenario: unreadable store
- **WHEN** the data directory cannot be read or written, or the key is missing while encrypted data exists
- **THEN** the server SHALL say so and refuse to start rather than appear signed out or silently replace the key

### Requirement: A small CLI manages setup, sign-in, sign-out and diagnosis
The package SHALL provide subcommands `setup`, `auth`, `auth --logout` and `doctor`, and SHALL run the stdio server when started with no subcommand. The CLI SHALL NOT ask for or store the user's Microsoft password.

#### Scenario: setup
- **WHEN** the user runs `setup`
- **THEN** it SHALL verify prerequisites, offer to register the server with each supported MCP client found on the machine (changing a client's configuration only after the user agrees), and offer to sign in

#### Scenario: auth
- **WHEN** the user runs `auth`
- **THEN** a visible sign-in window SHALL open, or the already-open one SHALL be reused, and the command SHALL report success or failure when it ends

#### Scenario: doctor
- **WHEN** the user runs `doctor`
- **THEN** it SHALL report, without printing any secret, the Node version, the browser found, where the key is held, whether the data directory is usable, whether the schools are reachable, which schools are signed in, and the package version

#### Scenario: logout
- **WHEN** the user runs `auth --logout`
- **THEN** all stored sessions and saved Microsoft state SHALL be deleted and the CLI SHALL say that this signs out this computer only

### Requirement: Session upkeep matches the cloud server while the process runs
While the local server process is running it SHALL renew the stored D2L sessions periodically and re-establish lapsed ones silently from saved Microsoft state, using the same rules as the cloud server, and SHALL ask the user to sign in again only when that fails or Microsoft requires interaction.

#### Scenario: silent re-login uses a background browser
- **WHEN** a D2L session has lapsed and saved Microsoft state is still valid
- **THEN** the system SHALL renew it in a hidden local browser without showing a window or prompting the user

#### Scenario: interaction required
- **WHEN** silent re-login is refused by Microsoft or saved state has expired
- **THEN** the next tool call SHALL report an expired session and open a visible sign-in window as for a first sign-in
