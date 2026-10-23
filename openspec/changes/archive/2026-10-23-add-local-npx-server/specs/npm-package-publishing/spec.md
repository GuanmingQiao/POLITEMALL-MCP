## ADDED Requirements

### Requirement: Each GitHub release publishes the same version to npm
When a release is created on the repository, the system SHALL publish the package to the npm registry at exactly the released version, so that the git tag `vX.Y.Z`, the GitHub Release, the package version and the npm version are the same number. Publishing SHALL be triggered only by the automated release process, not by hand or by ordinary pushes.

#### Scenario: release publishes the package
- **WHEN** release `v0.2.0` is created
- **THEN** version `0.2.0` of the package exists on npm and was built from the commit that tag points to

#### Scenario: ordinary merge does not publish
- **WHEN** a commit is merged to `main` without a release being created
- **THEN** nothing is published to npm

#### Scenario: version mismatch refused
- **WHEN** the package version in the tagged commit differs from the release tag
- **THEN** publishing SHALL fail before anything is uploaded

#### Scenario: re-run is safe
- **WHEN** the publish step runs again for a version already on npm
- **THEN** it SHALL succeed without republishing and SHALL NOT change the published package

### Requirement: Users get the newest release with `@latest`
A stable release SHALL be published under the `latest` distribution tag so that `npx @qiaoguanming/politemall-mcp@latest` (and `npx @qiaoguanming/politemall-mcp`) runs the newest stable release, and `npx @qiaoguanming/politemall-mcp@X.Y.Z` runs that exact release. A pre-release version SHALL NOT be tagged `latest`.

#### Scenario: latest follows the newest stable release
- **WHEN** a stable release `v0.3.0` is published after `v0.2.0`
- **THEN** `npx @qiaoguanming/politemall-mcp@latest` runs `0.3.0`

#### Scenario: pre-release stays off latest
- **WHEN** a pre-release version is published
- **THEN** it is available under a separate tag and `latest` is unchanged

### Requirement: Published packages are verified before and after upload
Before uploading, the system SHALL run the build and tests, check that the package contains only the intended files (no tests, sources of secrets or local data), and start the packed package to confirm it answers an MCP handshake and lists its tools. After uploading, it SHALL confirm the registry reports the new version under the intended tag.

#### Scenario: broken package is not published
- **WHEN** the packed package fails to start or fails the handshake
- **THEN** the publish fails and no version is uploaded

#### Scenario: unexpected files blocked
- **WHEN** the packed file list contains a file outside the allowed set
- **THEN** the publish fails before upload

### Requirement: Publishing uses short-lived credentials and carries provenance
Publishing SHALL authenticate to npm without a long-lived stored token where the registry supports it, SHALL be limited to the repository's release workflow, and SHALL attach build provenance linking the package version to the source commit and workflow run.

#### Scenario: provenance visible
- **WHEN** a version is published
- **THEN** its npm page shows provenance naming this repository, the tag's commit and the workflow run

### Requirement: A bad release can be withdrawn from users without rewriting history
An operator SHALL be able to repoint `latest` to a previous version and deprecate a bad version with a message, through a manual, audited workflow. Published versions SHALL NOT be deleted as part of normal operation.

#### Scenario: roll back latest
- **WHEN** an operator runs the rollback workflow naming an earlier published version
- **THEN** `npx @qiaoguanming/politemall-mcp@latest` runs that earlier version
