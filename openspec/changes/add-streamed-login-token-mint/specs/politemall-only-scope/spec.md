# Spec Delta

## Purpose

States that the server serves POLITEMall's D2L tenants only, so STEP is not part of its supported
tool surface, and that the authentication change leaves existing D2L tools untouched.

## ADDED Requirements

### Requirement: STEP is not exposed
The system SHALL NOT register any tool that reads from STEP (`stms.polite.edu.sg`), and SHALL NOT
include STEP identity or links in any tool result.

#### Scenario: tool list has no STEP tools
- **WHEN** a client lists the server's tools
- **THEN** the list SHALL contain none of `list_step_courses`, `search_step_courses`, `get_step_course_detail`, `get_step_timetable`, `get_step_announcements`

#### Scenario: identity shows only D2L tenants
- **WHEN** a client calls `whoami`
- **THEN** the result SHALL describe the user only on the POLITEMall and NYP D2L tenants

### Requirement: D2L tools are behavior-preserving across the authentication change
Every remaining D2L tool SHALL keep its name, input schema, and response shape, so only how the
user authenticates changes.

#### Scenario: existing tool unchanged
- **WHEN** a signed-in user calls `get_content_topic` on a PDF lesson topic
- **THEN** the response SHALL still contain the topic's metadata and its `extractedText`, exactly as before this change
