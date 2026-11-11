# Tasks

## 1. Master key loader

- [ ] 1.1 Replace the Secrets Manager call in `server/control-plane/src/auth/secrets.ts` with a dynamically imported Azure Key Vault read using managed identity, honouring `MASTER_KEY_BASE64` first. Verify with a unit test that stubs the vault client.
- [ ] 1.2 Validate the secret is base64 for exactly 32 bytes and fail startup otherwise, with no key material in the error. Verify tests cover empty, malformed, wrong-length and access-denied cases and assert the key is absent from the message.
- [ ] 1.3 Swap config in `src/utils/config.ts`: add `AZURE_KEY_VAULT_URL` and `AZURE_KEY_VAULT_SECRET_NAME`, remove `AWS_REGION` and `MASTER_KEY_SECRET_ID`. Verify `npm run build` passes and a grep for `aws` in `src/` finds nothing.
- [ ] 1.4 Swap `@aws-sdk/client-secrets-manager` for `@azure/identity` and `@azure/keyvault-secrets` in `package.json` and the lockfile. Verify `npm ci && npm test` and `npm run smoke` pass, and that the npx local path starts without loading either SDK.

## 2. Compose and provisioning

- [ ] 2.1 Update `server/docker-compose.yml` environment for the new variable names and drop the AWS ones. Verify `docker compose config` renders and the CI `docker` check is green.
- [ ] 2.2 Write `deploy/azure/provision.ps1` (resource group, static IP, NSG for 80/443 only, Key Vault with a generated 32-byte secret, managed identity and role assignment, B2s VM in Southeast Asia). Verify it runs to completion in the owner's subscription.
- [ ] 2.3 Write `deploy/azure/cloud-init.yaml` to install Docker and compose, clone the repo and prepare `data/` for uid 1000. Verify on a fresh VM that `/opt/politemall-mcp` exists and `docker compose version` works.

## 3. Docs and rules

- [ ] 3.1 Rewrite `deploy/README.md` for Azure (first deploy, redeploy, Run Command access, sign-out, rollback). Verify every command in it was run once during the cutover.
- [ ] 3.2 Update `README.md`, `CLAUDE.md` and `.claude/rules/cicd.md` to say Azure, in the same PR. Verify a case-insensitive grep for `aws` over those files returns only intentional historical mentions.

## 4. Cutover

- [ ] 4.1 When the owner asks, deploy to Azure at the release tag, then verify HTTPS on `<ip-with-dashes>.sslip.io`, a real sign-in, a tool call returning data, and `chromium_sandbox` and `signin_ok` in the logs.
- [ ] 4.2 Announce the new URL; verify at least one fresh MCP client registration and sign-in works end to end.
- [ ] 4.3 After the soak and on the owner's explicit instruction, decommission the AWS resources and move the AWS scripts to `deploy/aws-retired/`. Verify the AWS console shows no politemall-mcp resources.
- [ ] 4.4 Open the PR titled `feat!: host the server on Azure and read the master key from Key Vault`, linking this change. Verify `test`, `docker`, `package`, `openspec` and `pr-title` are green, then archive in its own `chore:` PR.
