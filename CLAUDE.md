# politemall-mcp

Hosted MCP server for the POLITEMall and NYP D2L Brightspace tenants. See [README.md](README.md) for what it does.

## Layout

- `server/control-plane/` – the MCP server (TypeScript, Node 22). `src/`, `tests/`, `Dockerfile`. Also published to npm as `@qiaoguanming/politemall-mcp` (`src/local/` is the npx entry point).
- `server/docker-compose.yml`, `server/Caddyfile` – how it runs on the host.
- `deploy/` – one-time AWS provisioning record and the manual deploy procedure (`deploy/README.md`).
- `openspec/` – specs (`openspec/specs`) and in-flight changes (`openspec/changes`).
- `.github/` – CI, release and dependency automation.

## Commands (run in `server/control-plane`)

```bash
npm ci
npm run build   # tsc
npm test        # tsc + node --test
npm run smoke   # after build: pack, inspect and start the npm package
```

## How work flows

Feature or behavior changes use OpenSpec: `/opsx:propose`, then `/opsx:apply`, then `/opsx:archive`.
Everything reaches `main` through a pull request with CI green. Releases are automated and each one publishes
to npm. Deploying to AWS is still manual. Read the full rules before touching workflows, versions, tags or the server:

@.claude/rules/cicd.md
