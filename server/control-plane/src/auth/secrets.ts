import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config } from "../utils/config.js";
import { setMasterKey } from "./crypto.js";

// Local runs keep the AES key in a file beside the token store, created on first start. The
// stored session cookies are only as safe as that file, so it is written owner-only.
function loadOrCreateLocalKey(): string {
  const keyFile = join(dirname(config.storeFile), "master.key");
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf-8").trim();
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32).toString("base64");
  writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}

// Loads the AES-256 master key used to encrypt stored session cookies at rest.
// In production this comes from Secrets Manager via the instance's IAM role.
// For local dev, MASTER_KEY_BASE64 can be set directly, or LOCAL_MODE=1 uses a generated key
// file — either skips AWS entirely.
export async function loadMasterKey(): Promise<void> {
  if (process.env.MASTER_KEY_BASE64) {
    setMasterKey(process.env.MASTER_KEY_BASE64);
    return;
  }
  if (config.local) {
    setMasterKey(loadOrCreateLocalKey());
    return;
  }

  const client = new SecretsManagerClient({ region: config.awsRegion });
  const res = await client.send(new GetSecretValueCommand({ SecretId: config.masterKeySecretId }));
  if (!res.SecretString) throw new Error("Master key secret has no SecretString");
  setMasterKey(res.SecretString);
}
