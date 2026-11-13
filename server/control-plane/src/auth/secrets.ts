import { config } from "../utils/config.js";
import { setMasterKey } from "./crypto.js";
import { loadOrCreateKey, loadOsKeyring } from "../local/key-store.js";

export type SecretFetcher = (vaultUrl: string, secretName: string) => Promise<string | undefined>;

// Reads one secret from Azure Key Vault with the host's managed identity. The Azure packages are
// loaded only here so a local run never needs them.
const fetchFromKeyVault: SecretFetcher = async (vaultUrl, secretName) => {
  const { DefaultAzureCredential } = await import("@azure/identity");
  const { SecretClient } = await import("@azure/keyvault-secrets");
  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());
  return (await client.getSecret(secretName)).value;
};

// A valid master key is the base64 form of exactly 32 bytes.
function validKey(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9+/]{43}=$/.test(trimmed) && Buffer.from(trimmed, "base64").length === 32;
}

// Loads the AES-256 master key used to encrypt stored session cookies at rest.
// The hosted server reads it from Azure Key Vault via the VM's managed identity and refuses to start
// if it cannot get a valid key. A local run keeps it in the OS credential store (or an owner-only
// file) on the person's own machine. For tests and development, MASTER_KEY_BASE64 can be set
// directly, which skips both.
export async function loadMasterKey(fetchSecret: SecretFetcher = fetchFromKeyVault): Promise<void> {
  if (process.env.MASTER_KEY_BASE64) {
    setMasterKey(process.env.MASTER_KEY_BASE64);
    return;
  }
  if (config.local) {
    const { key } = loadOrCreateKey({ dataDir: config.localDir, sessionsFile: config.sessionFile, keyring: await loadOsKeyring(config.localDir) });
    setMasterKey(key);
    return;
  }

  const { keyVaultUrl, keyVaultSecretName } = config;
  if (!keyVaultUrl) throw new Error("AZURE_KEY_VAULT_URL is not set; the hosted server needs it (or MASTER_KEY_BASE64) to get its master key");
  const where = `secret "${keyVaultSecretName}" in ${keyVaultUrl}`;

  let value: string | undefined;
  try {
    value = await fetchSecret(keyVaultUrl, keyVaultSecretName);
  } catch (err) {
    // Only the failure reason is reported: it names no key material.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the master key (${where}): ${reason}`);
  }
  if (!value) throw new Error(`Master key ${where} is empty`);
  if (!validKey(value)) throw new Error(`Master key ${where} is not base64 for exactly 32 bytes`);
  setMasterKey(value.trim());
}
