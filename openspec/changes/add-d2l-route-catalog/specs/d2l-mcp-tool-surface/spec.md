# Spec Delta

## Purpose

Defines how the D2L route catalog is exposed to MCP clients — curated per-workflow tools
plus a bounded generic/discovery pair — so the full catalog is reachable without one MCP
tool per route.

## ADDED Requirements

### Requirement: Existing tools are behavior-preserving
Every MCP tool registered by the server before this change SHALL continue to be registered
with an unchanged tool name, input schema, and output shape after this change ships.

#### Scenario: pre-existing tool unchanged
- **WHEN** a client calls `get_grades` with the same arguments as before this change
- **THEN** the tool SHALL return the same response shape (grade item id, name, maxPoints, weight, pointsAwarded, displayedGrade, lastModified) as it did before this change

### Requirement: Curated tools cover common D2L read workflows
For a route the project has promoted to a curated tool, the system SHALL expose a
dedicated MCP tool with a workflow-oriented name and description, and a response shaped
for readability (e.g. resolving user or grade-item ids to names where the underlying route
requires a join), rather than a raw passthrough of the D2L JSON response.

#### Scenario: curated tool shapes its response
- **WHEN** a client calls a curated tool such as `get_my_final_grade` for a course
- **THEN** the response SHALL be the calculated final grade for the caller's own enrollment, not the raw unshaped Valence payload

#### Scenario: curated tool for an instructor/TA-only route is clearly labeled
- **WHEN** a curated tool wraps a route that requires an instructor/TA/grader permission
- **THEN** the tool's title/description SHALL say so, and a caller without that permission SHALL receive a permission-denied error result rather than empty or misleading data

### Requirement: Curated tools cover both the student and instructor/TA audience where D2L exposes both
This server serves two audiences: a student or other individual enrollee looking at their own
record, and an instructor/TA looking at the whole class. For a curated workflow where the
underlying D2L API exposes both an own-scoped view and a class-wide view of the same or a
paired route, the system SHALL provide a curated tool for each scope it exposes, distinctly
named so a caller can tell which scope a given tool queries, rather than covering only
whichever audience was implemented first. This requirement does not apply to a workflow whose
underlying data is inherently course-level or personal rather than per-student (e.g. course
content structure, rubrics, or a personal cross-course activity feed with no class-wide
equivalent in the D2L API).

#### Scenario: student-facing tool exists for a paired workflow
- **WHEN** a client calls the student-facing tool for a workflow that has both scopes (e.g. `get_my_final_grade`, `get_my_dropbox_submission`)
- **THEN** the response SHALL be scoped to the caller's own data only

#### Scenario: instructor-facing tool exists for the same paired workflow
- **WHEN** a client calls the instructor-facing tool for that same workflow (e.g. `get_all_final_grades`, `get_dropbox_submissions`, `get_survey_results`)
- **THEN** the response SHALL cover every enrolled student, and SHALL require the same class-wide D2L permission the underlying route requires, erroring with a permission-denied result for a caller without it

### Requirement: Generic tool reaches every cataloged operation without one MCP tool per route
The system SHALL expose a single generic tool that can invoke any operation in the D2L
route catalog by its operation key, so the full cataloged route surface is reachable
without registering a dedicated MCP tool per route. The generic tool SHALL validate the
operation key against the catalog's allow-list and validate supplied parameters against
that operation's declared parameter schema; it SHALL NOT accept an arbitrary path, URL, or
unvalidated value that gets interpolated directly into a request.

#### Scenario: generic tool invokes a cataloged operation
- **WHEN** a client calls the generic tool with a valid operation key and valid parameters
- **THEN** the system SHALL issue the corresponding D2L request and return its result using the same session/permission/error handling as curated tools

#### Scenario: generic tool rejects an operation not in the catalog
- **WHEN** a client calls the generic tool with an operation key that is not in the catalog
- **THEN** the system SHALL return an error result without making any request to D2L

#### Scenario: generic tool rejects invalid parameters
- **WHEN** a client calls the generic tool with parameters that do not satisfy the operation's declared schema, such as a non-numeric `orgUnitId`
- **THEN** the system SHALL return a validation error result without making any request to D2L

### Requirement: Long-tail operations are discoverable without bloating tool count
The system SHALL expose a discovery tool that lists or describes catalog operations,
filterable by category or keyword, so a client can find a long-tail operation's key and
parameters without every cataloged route being registered as its own MCP tool.

#### Scenario: discovering operations by category
- **WHEN** a client calls the discovery tool with a category filter such as "rubrics"
- **THEN** the response SHALL list the matching catalog operations with their operation key, description, and required parameters

### Requirement: Read-only tools are annotated as such
Every D2L tool the server registers (curated, generic, and discovery) SHALL be annotated
as read-only and non-destructive using MCP tool annotations, since this change adds no
mutating D2L routes.

#### Scenario: annotation present on a new tool
- **WHEN** a client inspects the tool list returned by the server
- **THEN** every D2L-related tool's annotations SHALL include `readOnlyHint: true` and `destructiveHint: false`
