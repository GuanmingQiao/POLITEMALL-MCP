## Why

The repo has no `.github/` directory, no tags, and no changelog. Tests (`npm test` in `server/control-plane`) run only if someone remembers to, versions are not recorded anywhere, and agents working in the repo have no written rules for how changes reach `main`. Automating the AWS deploy is wanted too, but it is deferred to a later change so this one stays small and low-risk.

## What Changes

- Add a GitHub Actions **CI** workflow: on every PR and push to `main`, install, build and run the control-plane tests on Node 22, build the Docker image, and validate OpenSpec changes.
- Add **release control** with release-please: Conventional Commits on `main` produce a standing "Release PR" that bumps the version in `server/control-plane/package.json`, updates `CHANGELOG.md`, and, when merged, creates the `vX.Y.Z` tag and GitHub Release. `0.1.0` is the baseline; PR titles are linted for Conventional Commit form.
- Add Dependabot for npm, Docker base image and GitHub Actions updates.
- Write the CI/CD conventions for agents: a root `CLAUDE.md` and `.claude/rules/cicd.md`, covering branch/PR flow, commit format, how releases work, what never to do (no manual tags, no hand-edited changelog or version, no push to `main`, no secrets in the repo), and how this fits with OpenSpec. The shared `.claude/` files (commands, skills, rules) are committed; `settings.local.json` is gitignored. The rules state that deploying to AWS is still manual, per `deploy/README.md`.

**Out of scope (deferred):** CD to AWS (OIDC, SSM deploy, health check and rollback). A published release does not touch the server. Deployment stays the manual procedure in `deploy/README.md`; a later change can add the workflow on top of the release tags this change creates.

## Capabilities

### New Capabilities
- `release-management`: versioning, tags, changelog and GitHub Releases are produced from `main` by an automated, reviewable process, and PRs are gated by CI.
- `agent-cicd-guidance`: the repo carries written CI/CD rules where agents load them, and they stay consistent with the workflows.

### Modified Capabilities
<!-- None: no existing server behavior changes. -->

## Impact

- New: `.github/workflows/{ci,release-please,pr-title}.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`, `CLAUDE.md`, `.claude/rules/cicd.md`.
- Edited: `server/control-plane/Dockerfile` (`npm ci`), root `README.md` (short contributing/release note).
- Owner-only setup: add the `RELEASE_PLEASE_TOKEN` secret, enable branch protection and squash-merge.
- No AWS, instance or runtime changes; no change to tool behavior.
