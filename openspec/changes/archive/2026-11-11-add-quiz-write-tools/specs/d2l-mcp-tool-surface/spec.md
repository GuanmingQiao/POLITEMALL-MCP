# Spec Delta

## MODIFIED Requirements

### Requirement: Read-only tools are annotated as such
Every D2L tool the server registers (curated, generic, and discovery) SHALL be annotated
as read-only and non-destructive using MCP tool annotations, except the quiz authoring
tools defined by the `quiz-authoring-tools` capability, which SHALL be annotated as
modifying. The generic tool and the route catalog SHALL remain read-only (`GET`) even though
authoring tools exist.

#### Scenario: annotation present on a new tool
- **WHEN** a client inspects the tool list returned by the server
- **THEN** every D2L-related tool other than `create_quiz`, `update_quiz` and `save_quiz_questions` SHALL include `readOnlyHint: true` and `destructiveHint: false`

#### Scenario: generic tool cannot write
- **WHEN** a client calls `call_d2l_operation` with the operation key of a write route
- **THEN** the system SHALL return an unknown-operation error without making any request to D2L
