# signin-browser-hardening Specification

## Purpose

Limits what the streamed sign-in browser can reach and with what privileges it runs, keeps
anonymous clients from monopolising its limited capacity, and requires a supported runtime, so that
exposing the sign-in to the internet does not expose the server or its users' stored sessions.

## Requirements

### Requirement: The streamed browser can reach only the sign-in sites
The streamed browser SHALL load pages only from the two school hosts and Microsoft's sign-in hosts.
The system SHALL refuse any navigation, including frames and redirects, to another host, and SHALL
refuse every request, of any type, to a private, loopback, link-local or otherwise non-public
address or to a non-HTTP(S) scheme other than inline data. The system MAY allow other public hosts
for page resources such as scripts, images and telemetry, SHALL count them per sign-in, and SHALL
record the host names (never URLs, paths, cookies or content) of refused and unexpected requests.

#### Scenario: navigation off the sign-in sites
- **WHEN** a page in the streamed browser links, redirects or scripts a navigation to a host that is not a school or Microsoft sign-in host
- **THEN** the system SHALL refuse the navigation and the streamed browser SHALL stay on the page it was on

#### Scenario: internal addresses
- **WHEN** any page in the streamed browser requests an address on the server's own network, a loopback address, or a link-local address such as the cloud metadata endpoint
- **THEN** the system SHALL refuse the request

#### Scenario: normal Microsoft sign-in is unaffected
- **WHEN** a user signs in through Microsoft's pages using their CDNs and telemetry hosts
- **THEN** the sign-in SHALL complete and the system SHALL record any host it had to allow without being listed, by name only

#### Scenario: refusals are visible
- **WHEN** a request is refused
- **THEN** the audit log SHALL gain a count for that sign-in naming the host only

### Requirement: The streamed browser runs without privileges
The service that runs the streamed browser SHALL run as a non-root user with no added Linux
capabilities, with privilege escalation disabled and a read-only root filesystem, writing only to
its data volume and a temporary area. Chromium's own sandbox SHALL be enabled by default, and
disabling it SHALL require an explicit setting that is recorded at start-up.

#### Scenario: not root
- **WHEN** the control-plane container is running
- **THEN** its process SHALL be a non-root user and the browser SHALL start with its sandbox on

#### Scenario: sandbox explicitly disabled
- **WHEN** the operator sets the sandbox opt-out
- **THEN** the system SHALL still start, SHALL log once at start-up that the sandbox is off, and the other restrictions SHALL remain in force

#### Scenario: existing data stays readable
- **WHEN** the service is upgraded to run as the non-root user
- **THEN** the stored sessions and OAuth files SHALL be readable and writable by it, so no user is signed out by the upgrade

### Requirement: Anonymous clients cannot monopolise sign-in capacity
The system SHALL limit, per client IP address, how many streamed browsers can be started in a
period, and SHALL pause new starts from an address whose recent sign-ins keep ending without
success. It SHALL cap the number of sign-in links that are open and not yet started, both overall
and per IP address. It SHALL close a started browser whose viewer has sent no input within a short
time. When a limit refuses a request the system SHALL say so plainly and SHALL NOT start a browser.

#### Scenario: start rate limited
- **WHEN** one IP address tries to start more streamed browsers than the limit in the period
- **THEN** the system SHALL refuse the extra attempts with a message to try later and SHALL NOT start browsers for them

#### Scenario: repeated unsuccessful sign-ins pause an address
- **WHEN** several sign-ins from one IP address in a row end without success (abandoned, timed out or no input)
- **THEN** the system SHALL refuse that address's next starts for a pause period, while other addresses are unaffected

#### Scenario: link creation capped
- **WHEN** the number of open, never-started links reaches the overall or per-IP cap
- **THEN** the system SHALL refuse to issue another link until some expire or start

#### Scenario: idle viewer
- **WHEN** a started browser receives no input from its viewer within the first-input time
- **THEN** the system SHALL close the browser, discard what it captured, and free the slot

#### Scenario: real sign-in unaffected
- **WHEN** a user opens their link and types within the first-input time, from an address within its limits
- **THEN** the sign-in SHALL proceed exactly as before

### Requirement: The service runs on a supported runtime
The service SHALL be built and run on a Node.js release that still receives security fixes, and the
supported minimum SHALL be recorded in the package metadata. The deploy procedure SHALL rebuild the
image with fresh base layers so the browser and runtime pick up published fixes.

#### Scenario: current runtime
- **WHEN** the container image is built
- **THEN** its Node.js major version SHALL be one still in security support and the service SHALL start without a runtime end-of-support warning

#### Scenario: refusing an old runtime
- **WHEN** the service is installed on a Node.js version older than the recorded minimum
- **THEN** the package manager SHALL warn that the engine is unsupported
