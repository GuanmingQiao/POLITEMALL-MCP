# Spec Delta

## MODIFIED Requirements

### Requirement: Agent-loaded CI/CD rules exist
The repository SHALL contain a root `CLAUDE.md` that summarizes how to build, test and ship the project and points to `.claude/rules/cicd.md`, which SHALL document the branch and PR flow, Conventional Commit format, how releases are produced, that deployment to Azure remains the manual procedure in `deploy/README.md`, and the prohibited actions.

#### Scenario: Agent learns the flow
- **WHEN** an agent starts work in the repository
- **THEN** it loads instructions stating that changes go through a pull request with a Conventional Commit title and that releases are automated and Azure deployment is manual
