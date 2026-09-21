# Spec Delta

## Purpose

Maintains a single declarative, version-checked catalog of D2L Valence API routes the
server is allowed to call, replacing scattered hardcoded path strings and giving the
project one place to add, look up, or audit supported routes.

## ADDED Requirements

### Requirement: Catalog is the single source of truth for D2L routes
The system SHALL maintain a declarative catalog of every supported D2L Valence route,
keyed by a stable operation identifier, including its HTTP method, product (LE/LP), path
template, path/query parameters, pagination style, and access scope (course/user/global).
Any code path that calls a cataloged D2L route SHALL build its request path from the
catalog entry rather than from an inline literal path string.

#### Scenario: resolving a path from an operation key
- **WHEN** a caller requests the catalog entry for a valid operation key with valid path parameters
- **THEN** the catalog SHALL return the fully-substituted request path for the configured product version

#### Scenario: rejecting an unknown operation key
- **WHEN** a caller requests a catalog entry for an operation key that does not exist
- **THEN** the catalog SHALL report the operation as unknown without attempting any network call

### Requirement: Catalog is scoped to read-only Learning Environment routes
Initial catalog population SHALL include every `GET` route documented under the Valence
Learning Environment (LE) product, excluding routes under `agents/*`, `locker/*`, `lti/*`,
and `ltiadvantage/*`. The catalog SHALL NOT include `POST`, `PUT`, `DELETE`, or `PATCH`
routes as part of this change.

#### Scenario: LE GET route present
- **WHEN** the catalog is queried for the operation covering `GET /d2l/api/le/{version}/{orgUnitId}/grades/final/values/`
- **THEN** a matching catalog entry SHALL exist

#### Scenario: mutating route absent
- **WHEN** the catalog is queried for any route whose HTTP method is `POST`, `PUT`, `DELETE`, or `PATCH`
- **THEN** no matching catalog entry SHALL exist

#### Scenario: excluded route family absent
- **WHEN** the catalog is queried for any route under `agents/`, `locker/`, `lti/`, or `ltiadvantage/`
- **THEN** no matching catalog entry SHALL exist

### Requirement: Pinned D2L API version is checked against tenant support at startup
On process startup, the system SHALL check, for each configured D2L school host, whether
that tenant's advertised supported API versions include the pinned LE and LP versions the
server is configured to use. If a pinned version is unsupported by a tenant, the system
SHALL fail startup with an error identifying the tenant and the unsupported version, rather
than starting and surfacing the problem later as failed individual tool calls.

#### Scenario: all tenants support the pinned versions
- **WHEN** the server starts and every configured school host's supported-versions list includes the pinned LE_VERSION and LP_VERSION
- **THEN** the server SHALL start normally

#### Scenario: a tenant no longer supports the pinned version
- **WHEN** the server starts and a configured school host's supported-versions list does not include the pinned LE_VERSION or LP_VERSION
- **THEN** the server SHALL fail to start and SHALL log which host and which version was unsupported

#### Scenario: version check cannot reach a tenant
- **WHEN** the version-compatibility check cannot reach a configured school host
- **THEN** the system SHALL fail startup with an error that distinguishes "could not verify" from "verified unsupported"
