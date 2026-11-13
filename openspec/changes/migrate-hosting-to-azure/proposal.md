# Proposal

## Why

The hosted server runs on AWS (one EC2 instance, Secrets Manager, SSM), but the owner now wants it on their Microsoft Azure subscription. Hosting is currently tied to AWS in three places: the master encryption key is read through the AWS SDK, provisioning is AWS-only scripts, and the deploy docs and agent guidance all say "AWS".

## What Changes

- Run the hosted server on a single Azure Linux VM (East Asia region; Southeast Asia is not available to the owner's subscription) with the existing Docker Compose stack unchanged: Caddy plus the control-plane container.
- Replace the AWS Secrets Manager master-key loader with Azure Key Vault, read through the VM's managed identity (no stored credentials). Remove the `@aws-sdk/client-secrets-manager` dependency and the `AWS_REGION` / `MASTER_KEY_SECRET_ID` settings. **BREAKING** for anyone self-hosting on AWS: they must set `MASTER_KEY_BASE64` or move to Key Vault.
- Add Azure provisioning scripts under `deploy/` (resource group, static public IP, network rules for 80/443 only, VM, Key Vault, managed identity) and a cloud-init bootstrap replacing `user-data.sh`. Mark the AWS scripts as retired once the cutover is done.
- Cut over with a fresh start: generate a new master key in Key Vault, start with an empty `server/data`, and have everyone re-register their MCP client and sign in again. The hostname changes (new static IP, still `<ip-with-dashes>.sslip.io`), so every connector URL changes once.
- Update `README.md`, `deploy/README.md`, `CLAUDE.md` and `.claude/rules/cicd.md` so they describe Azure instead of AWS. Deployment stays manual.
- After cutover and a soak period, decommission the AWS resources (instance, security group, IAM role, secret) on the owner's explicit instruction.

## Capabilities

### New Capabilities
- `hosted-master-key`: how the hosted server obtains the key that encrypts stored sign-in sessions, and how it behaves when the key cannot be read.

### Modified Capabilities
- `agent-cicd-guidance`: the guidance must say deployment is the manual Azure procedure rather than AWS.

## Impact

- Code: `server/control-plane/src/auth/secrets.ts`, `src/utils/config.ts`, `package.json` and lockfile (swap AWS SDK for Azure identity and Key Vault client), tests for the loader.
- Ops: `server/docker-compose.yml` (environment names), new `deploy/azure/*`, `deploy/README.md`.
- Docs and rules: `README.md`, `CLAUDE.md`, `.claude/rules/cicd.md`.
- Users: one-time loss of sessions and new connector URL; no change to tool behavior.
- Out of scope: automated deploy, a custom domain, managed container platforms.
