# Spec Delta

## Purpose

Gives the project controlled, traceable releases: every version is a tag with a changelog entry, produced from reviewed commits on `main`, and nothing reaches `main` without passing CI.

## ADDED Requirements

### Requirement: Pull requests are gated by CI
The project SHALL run build, type-check and the control-plane test suite on every pull request and every push to `main`, and SHALL build the server Docker image to prove it still builds. The `main` branch SHALL only accept changes whose required checks passed.

#### Scenario: Failing test blocks merge
- **WHEN** a pull request has a failing control-plane test
- **THEN** the CI check reports failure and the pull request cannot be merged

#### Scenario: Passing change is mergeable
- **WHEN** build, tests and the image build all succeed on a pull request
- **THEN** the required checks are green

### Requirement: Commit messages drive the version
The project SHALL use Conventional Commits on `main`, enforced by a PR-title check, and SHALL derive the next semantic version from them: `fix` is a patch, `feat` is a minor, and a breaking change is a major at or above 1.0.0 (a minor before it).

#### Scenario: Non-conforming title rejected
- **WHEN** a pull request title is not a valid Conventional Commit
- **THEN** the title check fails

#### Scenario: Feature raises minor version
- **WHEN** a `feat:` change is merged and a release is cut
- **THEN** the proposed version is one minor above the previous release

### Requirement: Releases are proposed, reviewed, then tagged
The project SHALL maintain a single open release pull request that updates `CHANGELOG.md` and the package version from the commits since the last release. Merging it SHALL create the `vX.Y.Z` git tag and a GitHub Release whose notes are that version's changelog section. Tags SHALL NOT be created by hand.

#### Scenario: Release PR accumulates changes
- **WHEN** conventional commits land on `main` after the last release
- **THEN** the release pull request is created or updated with their changelog entries and the new version

#### Scenario: Merging cuts the release
- **WHEN** the release pull request is merged
- **THEN** a `vX.Y.Z` tag and a GitHub Release with the changelog notes exist

### Requirement: Dependencies and actions stay current
The project SHALL receive automated update pull requests for npm packages, the Docker base images and GitHub Actions, and every third-party action SHALL be pinned to a full commit SHA.

#### Scenario: Outdated action flagged
- **WHEN** a pinned action has a newer release
- **THEN** an update pull request is opened for it
