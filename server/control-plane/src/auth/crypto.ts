import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

let masterKey: Buffer | null = null;

export function setMasterKey(base64Key: string): void {
  masterKey = Buffer.from(base64Key, "base64");
  if (masterKey.length !== 32) {
    throw new Error(`Master key must be 32 bytes, got ${masterKey.length}`);
  }
}

export function encrypt(plaintext: string): string {
  if (!masterKey) throw new Error("Master key not initialized");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  if (!masterKey) throw new Error("Master key not initialized");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
