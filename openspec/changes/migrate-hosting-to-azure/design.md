# Design

## Context

Today (observed): one EC2 t3.small (2 GB) in ap-southeast-1 runs `server/docker-compose.yml` (Caddy on 80/443, control-plane with headless Chromium capped at 1.4 GB, `./data` bind mount). The only AWS use in code is `src/auth/secrets.ts`, which dynamically imports `@aws-sdk/client-secrets-manager`; `MASTER_KEY_BASE64` and the local OS-keyring path already bypass it. Management is by SSM with no port 22. TLS comes from Caddy and Let's Encrypt on an `<ip-with-dashes>.sslip.io` name. See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**
- Same runtime shape on Azure, so the container, Caddyfile and hardening (read-only, uid 1000, seccomp) are untouched.
- No long-lived cloud credentials on the VM or in the repo.
- Provisioning is a recorded, reviewable script, like `provision.ps1` today.

**Non-Goals:**
- Migrating existing sessions or OAuth registrations (the owner chose a fresh start).
- Custom domain, autoscaling, containers-as-a-service, CI-driven deploys.
- Keeping AWS as a supported hosted target.

## Decisions

1. **Azure VM + Docker Compose, not Container Apps or App Service.** Chromium needs the custom seccomp profile, `shm_size`, a read-only root and a persistent local disk; a VM reproduces all of that exactly. Container Apps would need Azure Files and a separate ingress/TLS design; App Service cannot apply the seccomp profile. Cost is one small VM.
2. **VM size Standard_B2als_v2 (2 vCPU, 4 GiB), region East Asia (Hong Kong).** More headroom than the 2 GB t3.small for Chromium plus the OS. The owner's subscription cannot create VMs in Southeast Asia (`NotAvailableForSubscription`), and B2s (v1) is also blocked in East Asia, so the v2 B-series is used; it needs Basv2 vCPU quota in the region. Revisit the size if sign-in memory pressure shows in logs.
3. **Key Vault via the VM's system-assigned managed identity.** Role "Key Vault Secrets User" scoped to the one vault; the code uses `DefaultAzureCredential` and `SecretClient`. Alternatives: env var only (key sits in the VM environment) and a service principal secret (a credential to rotate). Settings: `AZURE_KEY_VAULT_URL` and `AZURE_KEY_VAULT_SECRET_NAME` (default `master-key`), replacing `AWS_REGION` and `MASTER_KEY_SECRET_ID`. Azure packages are imported dynamically like the AWS one, so the npx local path never loads them.
4. **Fail closed.** The loader validates the secret is base64 for 32 bytes and throws otherwise; it never generates a key in hosted mode. This is stricter than today (which only checks non-empty) and is specified in `hosted-master-key`.
5. **Fresh key, empty data.** Because sessions are not migrated, generate a new 32-byte key straight into Key Vault; it never touches a laptop or the repo. Old AWS `sessions.json` is not copied.
6. **Network and access.** The network security group allows inbound 80/443 only, no SSH, mirroring the AWS security group. Admin access is through Azure Run Command (`az vm run-command invoke`), the analogue of SSM. A Standard static public IP keeps the sslip.io hostname stable across VM restarts.
7. **Bootstrap with cloud-init**, replacing `user-data.sh`: install Docker and the compose plugin, clone the repo to `/opt/politemall-mcp`, and create `data/` owned by uid 1000.
8. **Scripts live in `deploy/azure/`**; the AWS scripts move to `deploy/aws-retired/` once cutover is confirmed, so the record of what ran stays visible.

## Risks / Trade-offs

- [Users must reconnect: new URL and lost sessions] → Announce before cutover; keep AWS running until the new host is verified. The URL change is unavoidable with sslip.io.
- [Let's Encrypt fails if the hostname does not resolve on first start] → Create and attach the static IP first, confirm `<ip>.sslip.io` resolves, then start Caddy.
- [Chromium sandbox behaves differently on the Azure kernel] → Check the `chromium_sandbox` log line on first start; `CHROMIUM_NO_SANDBOX=1` remains the documented fallback.
- [Managed identity role assignment lags] → Startup fails closed with a clear error; retry after a few minutes.
- [Paying for two clouds during the soak] → Time-box it and decommission AWS on the owner's instruction.
- [Self-hosters on AWS break] → Called out as **BREAKING** in the changelog; `MASTER_KEY_BASE64` remains a supported path.

## Migration Plan

1. Merge the Key Vault loader change and release; npm publishing is unaffected.
2. Provision Azure resources with the script; deploy at the release tag per `deploy/README.md`.
3. Verify: HTTPS works on the new hostname, a real sign-in succeeds, `signin_ok` and keepalive appear in logs, a tool call returns data.
4. Tell users the new URL; they re-register and sign in.
5. After the soak, decommission AWS (instance, security group, IAM role and profile, secret), only when the owner asks.

Rollback: until step 5, point users back at the AWS host, which is untouched. After step 5, redeploy the previous tag onto a new VM.
