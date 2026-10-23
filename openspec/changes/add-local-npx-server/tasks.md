# Tasks

## 1. Shared sign-in core (no behaviour change for the cloud)

- [x] 1.1 Extract the "wait for D2L home on each tenant → harvest → mint → open the second tenant" loop from `SigninSession.waitForSessions` into a shared function usable with any Playwright page/context; verify `signin-stream`, `signin-net` and `d2l-session` tests still pass unchanged
- [x] 1.2 Add browser discovery (`CHROMIUM_PATH`, then Chrome channel, then Edge channel; never download) with a clear "no supported browser" error; verify with unit tests that stub the launcher for each outcome
- [x] 1.3 Add a headed-launch option to `launchBrowser` (visible window, sandbox on, no request allowlist for the local sign-in) while keeping the headless/allowlisted cloud path default; verify cloud launch arguments are unchanged by test

## 2. Local credential store

- [x] 2.1 Add the per-user data directory resolver (Windows/macOS/XDG, `POLITEMALL_DATA_DIR` override) and point `sessionFile`/key paths at it for the local entry only; verify with a test per platform branch
- [x] 2.2 Store the master key in the OS credential store via an optional keyring dependency, falling back to an owner-only `master.key`; fail (not regenerate) when `sessions.json` exists but the key is in neither place; verify with tests (stubbed keyring) for first run, restart, fallback and missing-key
- [x] 2.3 Remove `LOCAL_MODE`, `src/local.ts`, the `npm run local` script and `tests/auth/local-mode.test.ts`; load `@aws-sdk/client-secrets-manager` only on the cloud path; verify `npm test` passes and the cloud entry still boots against the existing tests

## 3. Local host

- [x] 3.1 Add optional `connectHint()` to `ToolContext` and use it in `tools/helpers.ts` for the three "sign in at ..." messages; verify existing tool tests pass and cloud messages are byte-identical
- [x] 3.2 Implement `createLocalContext()` for the fixed local user reusing the existing vault/renewal functions, whose hint starts one headed sign-in at a time and returns the "window opened" wording; verify with a test that two calls while signed out open one sign-in
- [x] 3.3 Implement the local headed sign-in using the shared loop from 1.1, saving school sessions and Microsoft storage state; verify against the existing stub-tenant harness that both tenants are saved, abandonment discards captures, and prior sessions are untouched
- [x] 3.4 Implement the stdio entry (`buildMcpServer` + `StdioServerTransport`), wire `configureD2lSession({ silentRelogin })`, `warmD2lVersions` and `startKeepAlive`, with all logging on stderr; verify with a test that a handshake and `tools/list` produce only JSON-RPC on stdout and open no network listener
- [x] 3.5 Add the CLI dispatcher with `auth` and `auth --logout` (deletes the user's record) and a Node-version guard; verify logout leaves no school connected and an unsupported Node exits with a message
- [x] 3.6 Add `doctor` (Node, browser, key store, data dir, school reachability, signed-in schools, version; no secrets printed); verify with tests that output covers each check and contains no key or cookie material
- [x] 3.7 Add `setup` (prerequisite check, consented registration of a stdio entry in each detected MCP client's config, optional first sign-in; never asks for a password); verify against temp client config files that nothing is written without consent and existing entries are preserved

## 4. Parity and packaging

- [x] 4.1 Add a parity test asserting the local and cloud servers list identical tool names, schemas, descriptions and annotations (extend `mcp.annotations.test`); verify it passes
- [x] 4.2 Make the package publishable: name, `bin` to the compiled CLI with shebang, `files` excluding tests, `prepublishOnly` build, no `private`; verify `npm pack --dry-run` lists only intended files and `npx ./<tarball>` starts the stdio server
- [ ] 4.3 Manual end-to-end on Windows with real Chrome and Edge: run `setup`/`auth`, complete a real Microsoft sign-in, call `list_courses`, restart, confirm silent renewal; record the result in the PR (2026-10-23: sign-in, restart and list_courses confirmed on Windows with Edge; silent renewal after a lapsed session not yet observed)

## 5. Automated release to npm (builds on the merged release flow)

- [ ] 5.1 Verify (no config change expected) that `release-please-config.json` `extra-files` bump the published `server/control-plane/package.json` and lockfile and the tag is `vX.Y.Z`; verify with a release-please dry run (or the next Release PR) that the proposed tag equals the package version
- [x] 5.2 Add the smoke script (pack, allowlist check on the file list, install tarball in a temp dir, stdio `initialize` + `tools/list`, assert no non-JSON-RPC on stdout); verify it passes on a good pack and fails on a tarball with an extra file or a broken `bin`
- [ ] 5.3 Add `package` job to `.github/workflows/ci.yml` running the 5.2 smoke script on pull requests; verify it passes on this branch and fails when a stray file is added to the pack
- [ ] 5.4 Add `.github/workflows/publish-npm.yml` (`workflow_call` with the tag; `contents: read`, `id-token: write`; version==tag assertion; build, test, smoke; `npm publish --provenance --access public` with `latest` for stable and `next` for pre-release; skip when the version already exists; post-publish `npm view` check; actions pinned to SHAs); verify with `actionlint` and a dry run (`npm publish --dry-run`) from a branch
- [ ] 5.5 Edit `release-please.yml` to give the step an `id`, expose `release_created` / `tag_name` outputs and call `publish-npm.yml` only when a release was created (keeping `RELEASE_PLEASE_TOKEN`); verify with `actionlint` that wiring and permissions are valid and that a push without a release does not call it
- [ ] 5.6 Add a manual `rollback-npm.yml` dispatch (`version`, optional `deprecate_message`, environment-gated) that moves `latest` and deprecates; verify against a scratch/prerelease version that `latest` moves and the old version stays installable
- [ ] 5.7 Owner: reserve the name with the first manual publish, configure the Trusted Publisher (repository, workflow file, environment), enable 2FA/publish restrictions on npmjs.com, and optionally add the `package` check to branch protection; verify with `npm view politemall-mcp` and the provenance badge after the first automated release
- [ ] 5.8 End-to-end: merge a Release PR and verify the GitHub Release notes and `CHANGELOG.md` entry, that `npm view politemall-mcp dist-tags` shows the new version as `latest`, and that `npx -y @qiaoguanming/politemall-mcp@latest doctor` on a clean machine reports that version
- [ ] 5.9 Update `.claude/rules/cicd.md` in the same PR (the `package` required-check candidate, "a release publishes to npm but still does not deploy the server", rollback-npm, never publish by hand after bootstrap), the `CLAUDE.md` layout/commands, and the PR template if needed; add an npm badge and `npx -y @qiaoguanming/politemall-mcp@latest` install line to the README; verify every workflow and check name referenced exists

## 6. Docs

- [x] 6.1 Rewrite README "Running it locally" and `server/README.md` for the npx flow (client config snippet, `setup`/`auth`/`doctor`/logout, data directory, browser requirement, where credentials live); verify every command in the docs runs as written
