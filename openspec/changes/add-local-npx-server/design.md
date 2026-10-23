# Design

## Context

The tool layer is already host-agnostic: `buildMcpServer(ctx: ToolContext)` (`src/server.ts`) registers every tool, and tools only see `ToolContext` (`src/types/tool-context.ts`) — connected schools, a renewable D2L credential, and `connectUrl()`. The cloud host (`src/app.ts`, `src/auth/oauth-provider.ts`, `src/auth/signin-stream.ts`, `signin-registry.ts`, `start-limits.ts`, `rate-limit.ts`) wraps that with Express, OAuth, per-user rate limits and the streamed sign-in. The pieces that actually obtain and keep D2L access are reusable as-is: `signin-browser.ts` (`harvestSession`, `onD2lHome`, `answerStaySignedIn`, `silentRelogin`), `token-mint.ts`, `d2l-session.ts` (renew/recover, injectable `silentRelogin`), `keep-alive.ts`, and `session-vault.ts` (AES-GCM records keyed by a user id, path from `config.sessionFile`, key from `auth/secrets.ts`).

Observed today: a `LOCAL_MODE=1` switch (`src/local.ts`, `config.local`, file-based master key) already runs the cloud host on localhost, but it still serves the streamed sign-in, OAuth and HTTP, needs a clone + build, and uses a headless Chromium. See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- One shared code path for everything except sign-in and credential storage; no forked tools, D2L client, minting, renewal or keep-alive.
- Zero-install-friction distribution (`npx politemall-mcp`) that uses the user's own browser.
- Credentials never leave the machine; same cryptography and record format as the cloud vault.

**Non-Goals:**
- Changing tool behaviour, adding tools, or touching the cloud host's behaviour.
- Storing or automating the user's Microsoft password, or typing MFA codes for them.
- Multiple local users, a local HTTP/OAuth endpoint, auto-update logic.

## Decisions

1. **stdio transport, no HTTP, no OAuth.** An npx-launched MCP server is a child process of the client; stdio is the standard transport and needs no ports or token plumbing. The local host is a small `local/` entry that builds a fixed `ToolContext` and connects `buildMcpServer(ctx)` to `StdioServerTransport`. *Alternative:* run Express on loopback and reuse the OAuth provider — rejected: reimplements nothing but drags in listeners, tokens and rate limits that have no purpose for one local user, and clients configure HTTP+OAuth servers less simply than a command. stdout carries only protocol traffic; all logging goes to stderr.

2. **One fixed local user id.** The vault is keyed by user id; the local host uses a constant id (created on first sign-in via the existing `createUser` path semantics). `createUserContext` is generalised/mirrored as `createLocalContext()` that calls the same `connectedSchools`, `getD2lAuth`, `invalidateD2lAuth`, `recoverD2lAuth`. This keeps vault format, renewal races (single-flight recovery) and keep-alive identical.

3. **Sign-in = headed local browser reusing the existing harvest loop.** The streamed flow's `waitForSessions` (poll for D2L home per tenant → `harvestSession` → mint → open the other tenant for the second grace window) is extracted into a shared function taking a `page/context`; the streamed `SigninSession` and the new local flow both call it. The local flow differs only in: launch is headed (`headless: false`), no CDP screencast / input forwarding, no `acquireBrowserSlot` cap beyond "one at a time", no per-IP limits, and the user closes nothing — the window is closed by the server on success. After success it saves school sessions and the Microsoft storage state with the same vault calls, so silent re-login (hidden browser, `launchBrowser(storageState)`) is unchanged. The local browser skips the cloud's request-allowlist (`net-policy.ts`): that guards the *server's* network from a remote user's page; here the user drives their own browser on their own machine. *Alternative:* a separate extension or cookie-paste flow — rejected (spec forbids pasting; extra implementation).

4. **Key in the OS credential store, data in a per-user directory.** (Borrowed from brightspace-mcp-server, which keeps secrets in Keychain / Credential Manager / Secret Service.) The AES master key is generated on first use and stored via a prebuilt-binary keyring library (candidate `@napi-rs/keyring`, an optional dependency so a failed native load degrades instead of breaking `npx`); if the keyring is unavailable the key goes to an owner-only `master.key` file, and `doctor` says which. The encrypted data stays in files: Directory: `%APPDATA%\politemall-mcp` on Windows, `~/Library/Application Support/politemall-mcp` on macOS, `$XDG_DATA_HOME` or `~/.local/share/politemall-mcp` elsewhere; override with `POLITEMALL_DATA_DIR`. It holds `sessions.json` (and `master.key` only in the fallback case). `config` gets this directory as its default paths when running the local entry, replacing the `LOCAL_MODE` switch with an explicit "host" notion set by the entry point before config is read. If `sessions.json` exists but the key cannot be found in either place, startup fails instead of generating a new key (it would silently orphan data). `checkDataDirs` (`utils/boot-check.ts`) already provides the refuse-to-start behaviour. *Alternatives:* key file only — weaker against other local processes; passphrase prompt — unusable for a background stdio server; a required native keychain binding — can break `npx` on some platforms. On macOS the first read may show a Keychain prompt ("Always Allow" avoids repeats); on Windows the fallback file relies on the user-profile ACL since POSIX modes are not enforced; both documented.

5. **Sign-in triggering without a new tool.** Tools only say "sign in at <connectUrl()>". Adding a tool would change the tool surface (forbidden). Instead: `ToolContext` gets an optional `connectHint()`; `tools/helpers.ts` uses it in place of "Sign in at <url>" when present. The local context's hint *starts* (idempotently, one window at a time) the sign-in browser and returns "A sign-in window has opened on this computer — finish signing in there, then ask again." The cloud context omits the hint, so its messages are byte-identical. The CLI covers explicit use before the first tool call (Decision 8). *Alternative:* a loopback "start sign-in" URL — rejected: needs a listener.

6. **Browser discovery.** `playwright-core` ships no browser. Resolve in order: `CHROMIUM_PATH`, `chromium.launch({channel:"chrome"})`, then `channel:"msedge"`; if none launches, fail with the supported-browser message. Never download. Sandbox stays enabled (`CHROMIUM_NO_SANDBOX` is cloud-container only).

7. **Packaging.** Publish `server/control-plane` as `politemall-mcp` (name subject to npm availability): drop `private`, add `bin` → `dist/local/cli.js` (shebang, built by `tsc`), `files: ["dist/**"]` excluding `*.test.js` (compile tests to `.test-build` only, as `npm test` already does), `prepublishOnly: npm run build`, `engines.node >=22`. `@aws-sdk/client-secrets-manager` stays a dependency but is dynamically imported only on the cloud path so the local start does not load it. The Dockerfile/cloud entry (`dist/index.js`) is untouched.

8. **CLI modelled on brightspace-mcp-server.** `cli.ts` dispatches: no args -> stdio server; `setup`, `auth`, `auth --logout`, `doctor`. `setup` is interactive but never asks for a password; client registration writes a standard stdio entry (`npx -y @qiaoguanming/politemall-mcp@latest`) into each detected client's config (Claude Desktop, Claude Code, and similar) only after a yes. `doctor` reuses the browser-discovery, key-store and `warmD2lVersions` checks and prints no secrets. Deliberately **not** borrowed: their stored password + headless form-fill + typed TOTP secret, because they would make us hold the user's Microsoft credentials; our silent re-login keeps replaying saved Microsoft *browser state* instead. macOS note from their docs worth keeping: run `npx` from the home folder, since `npx` is blocked from Documents/Desktop/Downloads without permission.

9. **Remove `LOCAL_MODE`.** Its job (run without AWS) is subsumed by the local entry; keeping both would be two local modes. `npm run local` and `src/local.ts` go; `MASTER_KEY_BASE64` stays as a cloud/test override.

10. **Publish from the same release run, via release-please outputs.** Today `release-please.yml` is one job with no outputs (it uses `RELEASE_PLEASE_TOKEN`, a PAT, so CI runs on the Release PR). We give the release-please step an `id`, expose `release_created` and `tag_name` as job outputs, and add a `publish` job `needs: release-please`, `if: needs.release-please.outputs.release_created == 'true'`, that calls `publish-npm.yml` (`workflow_call`, input `tag`). It checks out the tag, so the published bytes are the tagged commit. A release does not deploy the AWS server (deploy is manual per `cicd.md`), so publish is the only thing a release triggers besides the GitHub Release itself. *Alternative:* a separate `on: release: published` workflow - works with the PAT but silently stops firing if the token is ever swapped for `GITHUB_TOKEN`; explicit chaining does not depend on that.

11. **npm Trusted Publishing (OIDC) with provenance; dist-tags from the version.** Job permissions `id-token: write`, `contents: read`; `npm publish --provenance --access public`. No `NPM_TOKEN` secret once the Trusted Publisher is configured. Steps: assert `package.json` version equals the tag without `v`; `npm ci`, build, `npm test`; `npm pack` and check the file list against an allowlist; install the tarball in a temp dir and run the stdio handshake (`initialize`, `tools/list`) via the smoke script (no browser or login needed); publish with `--tag latest` for `X.Y.Z` and `--tag next` for any pre-release identifier; skip if `npm view @qiaoguanming/politemall-mcp@X.Y.Z` already exists (idempotent re-run); finally `npm view` confirms version and dist-tag. Bootstrap: npm requires the package to exist before a Trusted Publisher can be attached, so the first publish is manual by the owner (no `v*` tag exists yet and the manifest is at 0.1.0, so the first automated release will be the next version release-please proposes) (or one run with a temporary granular token), recorded in the runbook. *Alternative:* long-lived `NPM_TOKEN` - rejected as the default: a stored secret that can publish anything; kept only as the documented bootstrap/fallback.

12. **Smoke check shared by CI and publish.** One script (`server/control-plane/scripts/smoke-pack.mjs`, name indicative) does pack -> allowlist check -> install in a temp dir -> stdio handshake. `ci.yml` gets a `package` job (Node 22, actions pinned to full SHAs with a `# vX` comment like the existing jobs) that runs it on pull requests, and `publish-npm.yml` runs it again on the tag before uploading.

13. **Rollback = move the tag, don't delete.** A `workflow_dispatch` job in the `npm-rollback` environment (required reviewer) runs `npm dist-tag add politemall-mcp@<version> latest` and optionally `npm deprecate` for the bad version. `npm unpublish` is not used (breaks lockfiles, restricted by npm policy after 72 hours). npm Trusted Publishing covers `npm publish` only, so this one job uses an `NPM_TOKEN` secret scoped to that environment and to this package; the publish path itself stays token-free. Also, npm validates the *calling* workflow, so the trusted publisher is configured for `release-please.yml`, not `publish-npm.yml`. Because `setup` registers clients with `npx -y @qiaoguanming/politemall-mcp@latest`, moving `latest` rolls users back on their next start; npx's own cache can delay this, which the docs mention.

## Risks / Trade-offs

- [`RELEASE_PLEASE_TOKEN` expires, so releases (and thus publishes) stop] -> `cicd.md` already says to tell the user rather than work around it; a failed or missing release is visible as a Release PR that stops updating.
- [Version drift between tag, `package.json` and the lockfile] -> release-please `extra-files` already bump all three; the publish job still asserts tag == package version before uploading.
- [A packaging mistake is only found at release time] -> the `package` CI job runs the same smoke check on every PR.
- [`@latest` ships every release immediately to all local users, with no staging] -> the pre-publish tarball handshake plus CI tests gate it; pre-1.0 `bump-minor-pre-major` keeps breaking changes visible; rollback is one dispatch.
- [First publish cannot use OIDC] -> documented manual bootstrap, then Trusted Publisher; the workflow fails clearly (not silently) if publishing is not yet configured.
- [Name squatting or typosquat of `politemall-mcp`] -> reserve the name at bootstrap; enable 2FA / publish-only-via-CI on the package settings.
- [npx cache serves a stale `@latest`] -> `-y @qiaoguanming/politemall-mcp@latest` re-resolves on each launch when online; documented.

- [Keyring native module fails to load or no keyring exists] → optional dependency with owner-only key-file fallback; `doctor` reports the active store.
- [Microsoft/Entra may challenge or block automation-flagged browsers (headed Chrome driven by Playwright)] → use the installed channel browser with a normal profile-less context and default flags minus automation switches; verify a real sign-in manually before release; the cloud flow already proves the harvest works with Chromium.
- [Refactoring `waitForSessions` could regress the cloud streamed sign-in] → keep the existing `signin-stream` / `signin-net` tests green and add a test that the local flow drives the same function against the existing stub tenants.
- [Package name or publish rights unavailable (see Decision 11 for bootstrap)] → name is configuration only; confirm before first publish.
- [stdout pollution breaks the protocol] → route all `console.log` in shared modules used by the local path to stderr (or guard in the local entry) and add a test that a full handshake yields only JSON-RPC on stdout.
- [Headed browser steals focus mid-session when a silent re-login falls back to interactive] → silent re-login stays hidden; a visible window opens only from a tool call, `auth`, or an expired-session message.

## Migration Plan

Additive for users. Developers using `npm run local` switch to `npx` (or `node dist/local/cli.js` from a clone); README documents this. Roll back by unpublishing/deprecating the npm version; the cloud deploy is unaffected.

## Open Questions

- Final npm package name (`politemall-mcp` assumed).
- Exact keyring library and the list of MCP clients `setup` registers with; deferrable, does not alter specs.
