# Spec Delta

## Purpose

Defines what every curated tool result tells a user and an agent about where its data came from,
so an answer built from it can be cited, compared with the source page, and judged for
freshness — and defines the guidance the server gives an agent on using that information.

## ADDED Requirements

### Requirement: Each linkable item carries its own source link
A curated tool that returns items with a page (see the `source-links` capability) SHALL include a
`sourceUrl` on each such item, next to the item's own data. An item with no verified page SHALL
have no `sourceUrl` field at all (not an empty or guessed value).

#### Scenario: per-item binding
- **WHEN** `get_announcements` returns three announcements
- **THEN** each of the three SHALL have its own `sourceUrl` pointing at that announcement, so a statement about one cannot be credited to another

#### Scenario: no page, no field
- **WHEN** an item has no verified page
- **THEN** the item SHALL have no `sourceUrl` and the tool description SHALL say which items are unlinked

### Requirement: Collection-level results identify the page that shows them
A curated tool whose result describes a page rather than a set of separately linkable items SHALL
include a `pageUrl` for that page, and a tool returning a set of linkable items MAY additionally
include the `pageUrl` of the list page they appear on.

#### Scenario: classlist and grades
- **WHEN** `get_classlist` or `get_grades` returns
- **THEN** the result SHALL include the `pageUrl` of the classlist page or "my grades" page for that course

### Requirement: Every curated result says where and when it was read
Each curated tool result SHALL identify the system it came from (POLITEMall, NYP or STEP) and the time
it was retrieved, in a form both a person and an agent can read, without changing the result's
existing structure.

#### Scenario: cross-school result
- **WHEN** a tool returns rows from both schools
- **THEN** each row SHALL be attributable to its school (by its link host or an explicit school field) and the result SHALL state a single retrieval time

#### Scenario: STEP result
- **WHEN** a STEP tool returns
- **THEN** its provenance SHALL name STEP as the source and carry a retrieval time, exactly as for the Brightspace tools

#### Scenario: array-returning tools stay arrays
- **WHEN** a tool that returned a JSON array before this change returns after it
- **THEN** its first content block SHALL still be a JSON array, and the retrieval statement SHALL be carried in an additional content block

### Requirement: Dates users compare with the page are also given in Singapore time
For each date-time field a user is likely to compare against a Brightspace page (due dates,
start and end dates, announcement dates, submission dates, event times), the result SHALL keep
the original value unchanged and SHALL add a companion value expressing the same instant in
Singapore time with an explicit `+08:00` offset. This includes STEP session start and end times
and STEP announcement dates, which STEP's pages show in Singapore time.

#### Scenario: due date
- **WHEN** an item's D2L due date is `2026-10-01T04:00:00.000Z`
- **THEN** the item SHALL also carry the companion `2026-10-01T12:00:00+08:00`

#### Scenario: no date, no companion
- **WHEN** a date field is null or unreadable
- **THEN** no companion SHALL be added for it

#### Scenario: matches what the page shows
- **WHEN** an announcement whose start date is `2026-09-09T05:23:00.000Z` is opened on NYP
- **THEN** its companion time SHALL correspond to the page's displayed "1:23 PM" on 9 September 2026
- **WHEN** a STEP session starts at `2026-10-06T01:00:00+00:00`
- **THEN** its companion time SHALL be `2026-10-06T09:00:00+08:00`, matching the STEP page's displayed "06/10/2026 09:00"

### Requirement: The change is additive and compatible
Adding provenance SHALL NOT remove or rename any existing field, tool, input argument or error
message, SHALL NOT change the type of any existing field, and SHALL NOT change how existing size
controls (`count`, `limit`, `maxDepth`, `typeFilter`) behave.

#### Scenario: existing checks still pass
- **WHEN** the existing live test cases are run after this change
- **THEN** all of them SHALL still pass without modification other than tolerance for the added fields

#### Scenario: size controls still bound the result
- **WHEN** `get_announcements` is called with `count` 5
- **THEN** at most 5 announcements SHALL be returned, each with its link

### Requirement: The server tells the agent how to cite
The server SHALL give connecting agents guidance, in its server-level instructions and in the
descriptions of the tools that return links, to: cite a fact with the `sourceUrl` (or `pageUrl`)
of the item it came from, as an inline link; use only links that appear in `sourceUrl`/`pageUrl`
fields and never construct, edit or guess one; say plainly when an item has no link; quote the
Singapore-time companion when giving a date; and mention the retrieval time when the answer
depends on data that can change.

#### Scenario: guidance is delivered on connection
- **WHEN** a client initialises a session
- **THEN** the server's instructions SHALL contain the citation rules above

#### Scenario: guidance travels with the tool
- **WHEN** a client lists tools
- **THEN** each tool that returns `sourceUrl` or `pageUrl` SHALL say so in its description

### Requirement: Trusted links are distinguishable from text written by other people
Links inside text that D2L returns (announcement bodies, descriptions, discussion posts) are
authored by other people and SHALL be identified to the agent as untrusted content that is not
evidence. Only server-produced `sourceUrl` and `pageUrl` values SHALL be identified as evidence.

#### Scenario: announcement with an embedded link
- **WHEN** an announcement body contains a link
- **THEN** the result SHALL flag that the body's links are untrusted and the guidance SHALL tell the agent not to cite them as sources

### Requirement: Evidence does not change what a user is authorised to see
Provenance data SHALL be derived only from data the caller was already authorised to receive;
adding a link SHALL NOT trigger any additional D2L request the caller's role could not make, and
SHALL NOT reveal the existence of an item the tool did not otherwise return.

#### Scenario: hidden item
- **WHEN** an item is hidden from the caller and therefore not returned
- **THEN** no link to it SHALL appear anywhere in the result

### Requirement: MCP resource links are optional and never the only channel
When enabled by configuration, the server MAY additionally return one MCP `resource_link` content
block per distinct page, addressed to the user. The `sourceUrl`/`pageUrl` fields SHALL always be
present regardless, and the first content block SHALL remain the JSON result.

#### Scenario: disabled
- **WHEN** resource links are not enabled
- **THEN** results SHALL contain no `resource_link` blocks and SHALL be otherwise identical

#### Scenario: enabled
- **WHEN** resource links are enabled and a tool returns links to two distinct pages
- **THEN** the result SHALL contain two `resource_link` blocks, each with a human-readable name and description and an audience of the user
