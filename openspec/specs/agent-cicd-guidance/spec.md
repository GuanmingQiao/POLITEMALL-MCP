# agent-cicd-guidance Specification

## Purpose

Makes the project's CI/CD rules discoverable by coding agents so they follow the same flow as people.

## Requirements

### Requirement: Agent-loaded CI/CD rules exist
The repository SHALL contain a root `CLAUDE.md` that summarizes how to build, test and ship the project and points to `.claude/rules/cicd.md`, which SHALL document the branch and PR flow, Conventional Commit format, how releases are produced, that deployment to AWS remains the manual procedure in `deploy/README.md`, and the prohibited actions.

#### Scenario: Agent learns the flow
- **WHEN** an agent starts work in the repository
- **THEN** it loads instructions stating that changes go through a pull request with a Conventional Commit title and that releases are automated and AWS deployment is manual

### Requirement: Prohibited actions are explicit
The rules SHALL forbid agents from creating release tags by hand, editing `CHANGELOG.md` or the package version outside the release PR, pushing to `main`, changing the server except by the documented manual procedure and only when the user asks, and placing credentials or `.env` contents in the repository.

#### Scenario: Agent asked to cut a release
- **WHEN** an agent is asked to release
- **THEN** the rules direct it to merge the release pull request, not to tag manually

### Requirement: Rules stay aligned with workflows
Changing a workflow's trigger, required check or release procedure SHALL include updating the documented rules in the same pull request, and the rules SHALL state the OpenSpec flow (propose, apply, archive) alongside the CI/CD flow.

#### Scenario: Workflow change updates docs
- **WHEN** a pull request changes `.github/workflows/`
- **THEN** it also updates `.claude/rules/cicd.md` where behavior changed
