# d2l-route-catalog Specification

## Purpose

Maintains a single declarative, version-checked catalog of D2L Valence API routes the
server is allowed to call, replacing scattered hardcoded path strings and giving the
project one place to add, look up, or audit supported routes.

## Requirements

### Requirement: Catalog is the single source of truth for D2L routes
The system SHALL maintain a declarative catalog of every supported D2L Valence route,
keyed by a stable operation identifier, including its HTTP method, product (LE/LP), path
template, path/query parameters, pagination style, and access scope (course/user/global).
Any code path that calls a cataloged D2L route SHALL build its request path from the
catalog entry rather than from an inline literal path string.

#### Scenario: resolving a path from an operation key
- **WHEN** a caller requests the catalog entry for a valid operation key with valid path parameters
- **THEN** the catalog SHALL return the fully-substituted request path for the target tenant's discovered product version

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

### Requirement: D2L API versions are discovered per tenant, not pinned
The system SHALL determine the D2L API version to use for each product it calls (`le` and
`lp`) separately for each configured school host, by reading that tenant's anonymous
`/d2l/api/versions/` list and selecting the newest version it supports (compared numerically,
so `1.10` is newer than `1.9`). Cataloged path templates SHALL carry a `{version}` placeholder
that is substituted with the discovered version for the target tenant at request time; no
version number SHALL be hardcoded in a route path. Discovery SHALL be lazy (performed on the
first D2L request for a tenant), cached per tenant with a time limit, and shared by concurrent
requests so one tenant is queried once at a time.

#### Scenario: newest supported version is used
- **WHEN** a tenant's versions list gives `le` supported versions `1.9` and `1.97`
- **THEN** requests to that tenant SHALL use `1.97` for `le` routes, and the other tenant SHALL use its own discovered versions independently

#### Scenario: versions are cached and shared
- **WHEN** several D2L requests for the same tenant arrive within the cache lifetime
- **THEN** the versions list SHALL be fetched at most once for them

#### Scenario: operator override
- **WHEN** the environment variable `D2L_LE_VERSION` or `D2L_LP_VERSION` is set to a valid dotted version
- **THEN** that product SHALL use the given version for every tenant instead of the discovered one

#### Scenario: refresh fails after a good answer
- **WHEN** the cached versions have expired, the refresh fails, and an earlier answer exists
- **THEN** the system SHALL keep using the earlier answer, log a warning, and retry after a short delay rather than on every request

#### Scenario: discovery fails with no earlier answer
- **WHEN** a tenant cannot be reached, answers with an error status, returns an unreadable or unexpected list, or does not list the `le` or `lp` product, and no earlier answer exists
- **THEN** the request SHALL fail with an error that names the tenant and the reason, distinguishing "could not reach" from "listed no such product", and no route request SHALL be sent to D2L

### Requirement: Startup reports resolved versions without blocking
On process startup the system SHALL attempt discovery for every configured school host and log
the resolved `le` and `lp` version for each. A tenant that cannot be resolved at startup SHALL be
logged as a warning and SHALL NOT prevent the server from starting; discovery SHALL be retried on
that tenant's first use.

#### Scenario: tenants resolve at startup
- **WHEN** the server starts and every tenant's versions list is readable
- **THEN** the server SHALL log each tenant's resolved `le` and `lp` versions and start normally

#### Scenario: a tenant is briefly unreachable at startup
- **WHEN** the server starts and one tenant's versions list cannot be read
- **THEN** the server SHALL log a warning naming that tenant, SHALL still start, and SHALL retry discovery when that tenant is next used
