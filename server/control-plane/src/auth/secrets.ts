import { config } from "../utils/config.js";
import { setMasterKey } from "./crypto.js";
import { loadOrCreateKey, loadOsKeyring } from "../local/key-store.js";

// Loads the AES-256 master key used to encrypt stored session cookies at rest.
// The hosted server reads it from Secrets Manager via the instance's IAM role. A local run keeps
// it in the OS credential store (or an owner-only file) on the person's own machine. For tests and
// development, MASTER_KEY_BASE64 can be set directly, which skips both.
export async function loadMasterKey(): Promise<void> {
  if (process.env.MASTER_KEY_BASE64) {
    setMasterKey(process.env.MASTER_KEY_BASE64);
    return;
  }
  if (config.local) {
    const { key } = loadOrCreateKey({ dataDir: config.localDir, sessionsFile: config.sessionFile, keyring: await loadOsKeyring(config.localDir) });
    setMasterKey(key);
    return;
  }

  // Loaded only here so a local run never needs the AWS SDK.
  const { GetSecretValueCommand, SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
  const client = new SecretsManagerClient({ region: config.awsRegion });
  const res = await client.send(new GetSecretValueCommand({ SecretId: config.masterKeySecretId }));
  if (!res.SecretString) throw new Error("Master key secret has no SecretString");
  setMasterKey(res.SecretString);
}
