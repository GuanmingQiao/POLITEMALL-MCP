import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config } from "./config.js";
import { setMasterKey } from "./crypto.js";

// Loads the AES-256 master key used to encrypt stored session cookies at rest.
// In production this comes from Secrets Manager via the instance's IAM role.
// For local dev, MASTER_KEY_BASE64 can be set directly to skip AWS entirely.
export async function loadMasterKey(): Promise<void> {
  if (process.env.MASTER_KEY_BASE64) {
    setMasterKey(process.env.MASTER_KEY_BASE64);
    return;
  }

  const client = new SecretsManagerClient({ region: config.awsRegion });
  const res = await client.send(new GetSecretValueCommand({ SecretId: config.masterKeySecretId }));
  if (!res.SecretString) throw new Error("Master key secret has no SecretString");
  setMasterKey(res.SecretString);
}
