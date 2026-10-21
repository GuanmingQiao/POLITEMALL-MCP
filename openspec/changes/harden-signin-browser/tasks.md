# Tasks

Paths are under `server/control-plane/` unless they start with `server/` or `deploy/`. Run tests with
`npm test` in that directory.

## 1. Node 22

- [x] 1.1 Change `Dockerfile` to `FROM node:22-bookworm-slim` and add `"engines": {"node": ">=22"}` to `package.json`. Verify `npm install` on Node 22 produces no engine warning and `package-lock.json` is unchanged or deliberately updated.
- [x] 1.2 Run the full suite under Node 22 (for example `npx -y node@22 --test` over the built tests, or a container). Verify all tests pass, in particular the PDF/Office extraction tests.
- [x] 1.3 Update `deploy/README.md` so redeploys use `docker compose build --pull`. Verify the text reads correctly next to the existing redeploy steps.

## 2. Network policy for the streamed browser

- [x] 2.1 Add `src/auth/net-policy.ts` with `decideRequest(url, isNavigation, allowedHosts)` and the Microsoft host list, covering schemes, private/loopback/link-local/CGNAT/multicast/unspecified IPv4 and IPv6 (including IPv4-mapped), `localhost`, `*.localhost`, `*.internal` and single-label names. Verify with `tests/auth/net-policy.test.ts`: each blocked class, each allowed Microsoft and school host, a lookalike host such as `login.microsoftonline.com.evil.example` blocked, public non-allowlisted navigation blocked, public non-allowlisted subresource reported.
- [x] 2.2 Install the policy in `launchBrowser` (`src/auth/signin-browser.ts`) with `context.route`, derive the school hosts from `origins`, honour `SIGNIN_NET_MODE=report`, and set `acceptDownloads: false`, service workers blocked and no permissions. Verify with a Chromium test against the stub site: a link or script navigation to a non-allowlisted host never reaches the stub and the browser stays on its page, a redirect hop is blocked, a request to a private address is blocked, and the normal stub sign-in still completes.
- [x] 2.3 Count blocked and reported hosts per sign-in (max 20 hosts) and write one `signin_net_summary` event when it ends, host names only. Verify in the Chromium test that the event lists the blocked host and contains no URL, path or cookie text.

## 3. Start limits and idle sessions

- [x] 3.1 Generalise `src/auth/rate-limit.ts` into a reusable `allow(key, limit, windowMs)` and add `src/auth/start-limits.ts` with the strike table and pause. Add the client IP helper (Caddy's `X-Forwarded-For`, falling back to the socket) and use it from the page limiter. Verify in `tests/auth/start-limits.test.ts` with an injected clock: budget exhausted, window rolls over, N strikes pause one IP and not another, a success clears strikes, pause expires, and a spoofed extra `X-Forwarded-For` entry from the client does not change the key.
- [x] 3.2 Enforce the start budget and pause at the WebSocket upgrade in `src/auth/signin-stream.ts`: a refused start accepts the socket, sends `{type:"fail", reason}` with the wait, and closes, without starting a browser. Record strikes when a sign-in ends as `viewer_left`, `timeout` or `no_input`. Emit `signin_rate_limited`. Verify with tests: refusal shows the message, no browser is launched, other IPs are unaffected, and a normal sign-in is unaffected.
- [x] 3.3 Add the first-input timeout to `SigninSession` (`SIGNIN_FIRST_INPUT_MS`, default 60 s): stop with reason `no_input` when no accepted input arrives, tell the viewer, and release the slot. Verify with a Chromium test that an idle viewer's browser is closed and the slot freed, and that a viewer who types in time is not cut off even if the sign-in then takes longer than the first-input time.
- [x] 3.4 Cap open anonymous links in `src/auth/signin-registry.ts` and `src/auth/oauth-provider.ts`: record the creating IP, enforce `SIGNIN_MAX_PENDING_PER_IP` and `SIGNIN_MAX_PENDING`, exempt links created for an authenticated user, and make `authorize` answer 429 with a plain message at the cap. Verify with tests: per-IP cap, overall cap, exempt authenticated links still issue, caps free up as links start or expire, and `signin_rate_limited` is logged.
- [x] 3.5 Add the new settings with defaults to `src/utils/config.ts` and document them in `deploy/README.md`. Verify the defaults match the design and the README lists each variable.

## 4. Unprivileged container

- [ ] 4.1 Stop setting `CHROMIUM_NO_SANDBOX` by default: `launchBrowser` adds `--no-sandbox` only when it is set, and logs one `chromium_sandbox enabled|disabled` line at start-up. Remove the comment and `ENV` in the `Dockerfile` that justified running as root, and add `USER node`. Verify with a unit test of the argument building and by building the image.
- [ ] 4.2 Add `server/chromium-seccomp.json` (Docker's default profile plus the namespace syscalls for unprivileged Chromium, with the diff documented in `server/README.md`) and update `server/docker-compose.yml` with `user`, `cap_drop: [ALL]`, `no-new-privileges`, the seccomp profile, `read_only: true`, `tmpfs: [/tmp]` and `HOME=/tmp`. Verify `docker compose config` is valid and a local container with these settings starts Chromium and completes the stub sign-in with the sandbox on.
- [x] 4.3 Add the boot check in `src/index.ts`: verify read and write access to the directories of `SESSION_FILE`, `OAUTH_FILE` and `STORE_FILE`, and exit non-zero with a clear message otherwise. Verify with a test using a read-only directory that the check fails loudly and passes on a writable one.
- [x] 4.4 Update `deploy/README.md` with the upgrade steps (backup, `chown -R 1000:1000 server/data`, build, start, checks) and the rollback note. Verify the steps match the design's migration plan.

## 5. Spec checks and live verification

- [x] 5.1 Run `openspec validate harden-signin-browser --strict` and verify it passes.
- [x] 5.2 Run the full control-plane test suite and `npm run build` and verify both are clean.
- [ ] 5.3 Deploy following the migration plan. Verify on the host: uid 1000, `chromium_sandbox` line (record whether the sandbox is on or the fallback was needed), the boot check passes, a real sign-in completes with "Stay signed in?" answered, and the `signin_net_summary` events show what was blocked and reported. Extend the allowlist for any legitimate Microsoft or school host that was blocked.
- [ ] 5.4 On the host, confirm the abuse limits: open a link and stay idle and verify the browser closes after about a minute and the slot is free, and verify a repeated start from one address gets the "too many attempts" message without a browser launching.
