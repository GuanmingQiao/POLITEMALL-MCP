# Tasks

## 1. CI workflow

- [x] 1.1 Add `.github/workflows/ci.yml` (jobs `test`, `docker`, `openspec`; Node 22, npm cache, `contents: read`, concurrency; actions pinned to SHAs) and verify it passes on a draft PR (note `signin-stream.test.ts` needs Chromium and hung locally on Windows; see design Risks)
- [x] 1.2 Switch `server/control-plane/Dockerfile` from `npm install` to `npm ci` and verify `docker build server/control-plane` succeeds locally and in CI
- [x] 1.3 Add `.github/workflows/pr-title.yml` enforcing Conventional Commit titles and verify a bad title fails and a `feat: x` title passes
- [x] 1.4 Add `.github/pull_request_template.md` (checks: PR title, OpenSpec change linked, `.claude/rules/cicd.md` updated if workflows changed) and verify it appears on a new PR
- [x] 1.5 Add `.github/dependabot.yml` for npm (`server/control-plane`), docker, and github-actions and verify GitHub accepts the config (Dependabot tab shows no error)

## 2. Release control

- [ ] 2.1 Add `release-please-config.json`, `.release-please-manifest.json` and `version.txt` (baseline `0.1.0`, type `simple` with `server/control-plane/package.json` and lockfile as extra files, no component in tag, `bump-minor-pre-major`) and verify with a release-please dry run (`--dry-run`) that it proposes the expected version
- [x] 2.2 Add `.github/workflows/release-please.yml` using `RELEASE_PLEASE_TOKEN`, outputting `release_created` and `tag_name`; verify a `feat:` merge opens or updates the Release PR with changelog entries
- [ ] 2.3 Seed `CHANGELOG.md` with a header and the baseline note, and create the `v0.1.0` baseline tag via the release process (or document the one-time manual baseline tag) and verify `git tag` and the GitHub Release page show it
- [ ] 2.4 Configure changelog sections (hide `chore`, `docs`, `ci` except breaking) and verify the Release PR groups Features and Bug Fixes

## 3. Agent guidance

- [ ] 3.1 Add root `CLAUDE.md` (layout, build/test commands, pointers to `.claude/rules/cicd.md` and OpenSpec) and verify an agent session in the repo lists it as loaded
- [x] 3.2 Add `.claude/rules/cicd.md` covering branch and PR flow, Conventional Commit titles, CI checks, release PR flow, a note that AWS deploy is manual per `deploy/README.md`, prohibited actions (manual tags, hand-edited changelog or version, push to `main`, secrets in repo), and the OpenSpec propose/apply/archive flow; verify every workflow name and check referenced exists
- [x] 3.3 Commit `.claude/commands`, `.claude/skills`, `.claude/rules` and `CLAUDE.md`; add `.claude/settings.local.json` to `.gitignore`; verify `git status` shows no local settings and `git ls-files .claude` lists the shared files
- [x] 3.4 Add a short "Contributing and releases" section to the root `README.md` linking to the rules, and verify links resolve

## 4. Repository settings and hardening (owner)

- [x] 4.1 Enable branch protection on `main` (required checks `test`, `docker`, `pr-title`, squash merge only, no force push) and verify a direct push is rejected
- [x] 4.2 Add the `RELEASE_PLEASE_TOKEN` secret, enable Dependabot alerts and secret scanning, and verify with `gh api` reads
- [ ] 4.3 Run `openspec validate add-github-cicd --strict` and confirm the full pipeline once (PR, CI green, Release PR, tag and GitHub Release) before archiving this change
