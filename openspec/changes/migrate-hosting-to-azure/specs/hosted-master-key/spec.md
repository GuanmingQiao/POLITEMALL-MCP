# Spec Delta

## Purpose

Defines how the hosted server obtains the AES-256 key that encrypts each person's stored sign-in sessions, so the key is held by the hosting platform's secret store rather than in the repository or image.

## ADDED Requirements

### Requirement: The hosted server reads its master key from Azure Key Vault
When running as the hosted server and `MASTER_KEY_BASE64` is not set, the system SHALL read the master key from the Azure Key Vault secret named by its configuration, authenticating with the host's managed identity. It SHALL NOT require stored credentials, and SHALL NOT call AWS.

#### Scenario: key available
- **WHEN** the hosted server starts on a host whose identity may read the configured secret
- **THEN** it loads the key and encrypts and decrypts stored sessions with it

#### Scenario: explicit key wins
- **WHEN** `MASTER_KEY_BASE64` is set
- **THEN** the system SHALL use it and SHALL NOT contact Key Vault

### Requirement: The hosted server refuses to start without a usable key
If the key cannot be read, is empty, or is not a valid 32-byte base64 value, the hosted server SHALL fail startup with an error that names the configuration problem and SHALL NOT start serving requests or fall back to an unencrypted or generated key.

#### Scenario: access denied
- **WHEN** the host's identity is not allowed to read the secret
- **THEN** startup fails with an error naming the vault and secret, and the process does not listen

#### Scenario: malformed key
- **WHEN** the secret value is not a valid base64 encoding of 32 bytes
- **THEN** startup fails and the value is not written to any log

### Requirement: The key never appears in logs or errors
The system SHALL NOT include the master key, or any fragment of it, in logs, error messages or responses.

#### Scenario: failed read
- **WHEN** Key Vault returns an error
- **THEN** the logged error contains the vault and secret names and the failure reason, and no key material
