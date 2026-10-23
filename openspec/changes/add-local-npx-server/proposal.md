## Why

Today the only way to use this server is the shared cloud deployment, where each person types their Microsoft credentials into a browser *streamed from our server*. Some people will not, or cannot, trust a third-party host with that; others want nothing to host. The repo has a developer-only `npm run local` mode that needs a clone, a build and a Chromium path, and still runs the streamed sign-in. We want a one-line install that runs entirely on the user's machine, signs in in their own browser, and keeps their credentials on their own disk.

## What Changes

- Add a locally-run distribution of this same server, started with `npx` (stdio MCP transport, one local user, nothing listening on the network). The MCP client config becomes `command: npx, args: [politemall-mcp]`.
- Sign-in happens in a real, visible browser window on the user's own computer (their installed Chrome or Edge): the user types their Microsoft credentials and MFA there. The server then harvests the D2L session and mints a Bearer token exactly as the cloud does. No streamed view, no sign-in link, no OAuth.
- Credentials (D2L sessions, saved Microsoft sign-in state, Bearer tokens) are stored encrypted in a per-user directory on the user's machine, with the encryption key kept locally. No AWS, no Secrets Manager.
- Everything else is shared, not reimplemented: the same tool set, the same D2L client, token minting and renewal, silent re-login, keep-alive, source links and provenance. The only code that differs between cloud and local is (a) how a person signs in and (b) where credentials are kept and which key protects them.
- Make the package publishable to npm (`bin`, `files`, build on publish) and add a small CLI, modelled on [brightspace-mcp-server](https://github.com/RohanMuppa/brightspace-mcp-server): `setup` (checks prerequisites, registers the server with supported MCP clients, offers a first sign-in), `auth` (sign in now / retry a stuck sign-in), `auth --logout` (delete this computer's stored sessions) and `doctor` (checks Node, browser, credential store, connectivity, sign-in state, version). With no subcommand it runs the stdio server.
- Keep the encryption key in the operating system's credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service), falling back to an owner-only key file when none is available.
- **BREAKING (developer-only)**: the `LOCAL_MODE` / `npm run local` HTTP + streamed-sign-in mode is removed in favour of the npx entry point; the README "Running it locally" section is rewritten.
- Release the package automatically: build on the merged CI/release flow (Conventional Commits -> release-please Release PR -> `vX.Y.Z` tag, GitHub Release with notes, `CHANGELOG.md`; see `.claude/rules/cicd.md` and the `release-management` spec) and add a **publish-to-npm** job that runs when a release is created, so each release becomes `@qiaoguanming/politemall-mcp@X.Y.Z` and the `latest` tag, and `npx @qiaoguanming/politemall-mcp@latest` always runs the newest stable release. Publishing uses npm Trusted Publishing (GitHub OIDC, no stored token) with provenance, verifies the packed package before upload, and has a manual rollback that repoints `latest`. A `package` job in `ci.yml` runs the same pack-and-handshake check on every pull request so packaging breakage is caught before a release. The package version is still changed only by the Release PR, and a release still does not deploy the AWS server (that remains manual).

Non-goals: storing the user's Microsoft password or automating the credential form (the user always types their own credentials and MFA in the window); any new or changed tool, response shape or D2L behaviour; changes to the cloud server's behaviour; a local HTTP/OAuth mode; multi-user local installs.

## Capabilities

### New Capabilities
- `local-npx-server`: running the server on the user's machine via npx — stdio transport, local-browser sign-in, local encrypted credential storage, and parity of the tool surface with the cloud server.
- `npm-package-publishing`: each GitHub release publishes the identical version to npm under `latest` (pre-releases elsewhere), with pre- and post-publish verification, short-lived credentials with provenance, and a rollback path.

### Modified Capabilities
<!-- None: the cloud sign-in spec (streamed-login-session), the tool surface and all D2L behaviour are unchanged. -->

## Impact

- New: local entry point and CLI (`setup` / `auth` / `doctor` / default stdio run), a local `ToolContext` for the single user, a headed local-browser sign-in that reuses the existing harvest/mint code, local credential-store configuration (data dir + OS-keyring key with file fallback), browser discovery (Chrome / Edge / `CHROMIUM_PATH`).
- Edited: `server/control-plane/package.json` (name, `bin`, `files`, `prepublishOnly`, no longer `private`), `src/types/tool-context.ts` (optional sign-in hint so messages fit a local user), `src/tools/helpers.ts` (use the hint), `src/auth/signin-browser.ts` (headed launch option; share the session-harvest loop with the streamed flow), `src/utils/config.ts` and `src/auth/secrets.ts` (drop `LOCAL_MODE`, add local data dir), root `README.md`, `server/README.md`.
- Removed: `src/local.ts`, the `LOCAL_MODE` paths, the `npm run local` script, and `tests/auth/local-mode.test.ts` (replaced by tests for the new key/store setup).
- Dependencies: one small prebuilt-binary OS-keyring library (optional dependency, no node-gyp build; e.g. `@napi-rs/keyring`); `playwright-core` is already present and drives the user's installed browser (no browser download). `@aws-sdk/client-secrets-manager` is loaded only on the cloud path.
- Builds on the merged release flow: `release-please-config.json` (type `simple`, tag `vX.Y.Z`, `extra-files` already bump `server/control-plane/package.json` and its lockfile), `.release-please-manifest.json`, `CHANGELOG.md`, `ci.yml`, `pr-title.yml`, `dependabot.yml`. No release-management requirement changes; this change only adds publishing.
- New: `.github/workflows/publish-npm.yml` (reusable, called from `release-please.yml`), `.github/workflows/rollback-npm.yml` (manual `dist-tag` dispatch), a pack-and-handshake smoke script, and a `package` job in `ci.yml`.
- Edited: `.github/workflows/release-please.yml` (expose `release_created` / `tag_name` outputs and call the publish workflow), `.claude/rules/cicd.md`, `CLAUDE.md` and `.github/pull_request_template.md` as `cicd.md` requires when workflows or the release procedure change.
- Owner-only external steps (npm): publish the first version by hand to create the package and reserve the name `politemall-mcp`, then configure its Trusted Publisher (this repository, `publish-npm.yml` / the release workflow, environment if used) on npmjs.com; optionally add the new `package` check to branch protection.
