# politemall-mcp — hosted server

Moved to the [root README](../README.md) — that's now the canonical doc for
connecting, the tool list, and client setup.

This directory holds the server's source: `control-plane/` (the MCP server
itself), `docker-compose.yml`, and `Caddyfile`. See [../deploy/README.md](../deploy/README.md)
for how it's provisioned and operated.

## Container hardening

`docker-compose.yml` runs the control-plane as uid 1000 with all Linux capabilities dropped,
`no-new-privileges`, a read-only root filesystem, and only `/data` (the bind mount) and `/tmp`
(a tmpfs, also `HOME`) writable. Chromium's own sandbox is on.

`chromium-seccomp.json` is Docker's default seccomp profile
(`seccomp/default.json` from [moby/profiles](https://github.com/moby/profiles)) with one rule added
at the end of `syscalls`:

```json
{ "names": ["clone", "unshare", "setns"], "action": "SCMP_ACT_ALLOW" }
```

Docker's default permits `clone`/`unshare`/`setns` only with `CAP_SYS_ADMIN` (or `clone` without
namespace flags). Chromium's sandbox creates user and PID namespaces as an unprivileged user, which
needs them. `clone3` stays blocked (returns ENOSYS), so glibc falls back to `clone`. Refresh the
file from upstream when Docker is upgraded and re-apply that one rule.

If the host cannot give Chromium user namespaces and the sandbox will not start, add
`CHROMIUM_NO_SANDBOX=1` to the control-plane `environment`. The container stays non-root,
capability-less and read-only; the start-up log line `chromium_sandbox disabled` records it.

## Sign-in browser network policy and limits

The streamed browser may navigate only to the school hosts and Microsoft's sign-in hosts, and may
not request any private, loopback or link-local address (`src/auth/net-policy.ts`). Other public
hosts are allowed for page resources and reported. Each sign-in logs one `signin_net_summary` with
host names only. `SIGNIN_NET_MODE=report` turns blocking into reporting without a rebuild.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIGNIN_NET_MODE` | (block) | `report` logs what would be blocked but lets it through |
| `SIGNIN_FIRST_INPUT_MS` | `60000` | A started browser with no viewer input in this time is closed |
| `SIGNIN_STARTS_PER_WINDOW` | `20` | Browsers one IP may start per window |
| `SIGNIN_START_WINDOW_MS` | `600000` | The window for the above, and for counting strikes |
| `SIGNIN_STRIKES_BEFORE_PAUSE` | `5` | Sign-ins from one IP ending without success before it is paused |
| `SIGNIN_PAUSE_MS` | `300000` | How long a paused IP cannot start a browser |
| `SIGNIN_MAX_PENDING_PER_IP` | `10` | Open, never-started anonymous links one IP may hold |
| `SIGNIN_MAX_PENDING` | `200` | The same, overall |

## Running it on a person's own computer

`src/local/` is the npx entry point (`npx -y @qiaoguanming/politemall-mcp@latest`; see the root `README.md`
for use). It runs the same `buildMcpServer` as the hosted server over stdio, with a fixed single
user, instead of Express and OAuth. What differs from the hosted server is only:

- **Sign-in:** a visible Chrome or Edge window on the person's computer (`src/local/signin.ts`),
  using the same session-harvest loop as the streamed sign-in (`src/auth/signin-harvest.ts`). The
  request allowlist and caps above apply to the hosted streamed browser, not to this window.
- **Credential storage:** `sessions.json` in a per-user directory (`src/local/paths.ts`), with the
  encryption key in the OS credential store and an owner-only file as fallback
  (`src/local/key-store.ts`). Startup refuses when stored data exists but its key is gone.

stdout carries only MCP protocol traffic; logs go to stderr. `POLITEMALL_HOST=local` (set by
`src/local/cli.ts` before anything loads) selects these paths in `src/utils/config.ts`.
