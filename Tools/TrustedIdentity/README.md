# DLE-OS trusted downstream identity

Development 5051 issues a fresh, two-minute ES256 assertion for each request to the isolated operational API. The assertion is audience-bound to `dle-os-development-operational-api` and environment-bound to `DEVELOPMENT`. The browser never receives signing material or constructs assertions.

Required runtime configuration names:

- `DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH` on the 5051 issuer.
- `DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH` on the isolated downstream validator.

No key value belongs in Git or application settings. The development key pair is generated in the protected ProgramData key directory by `Initialize-DevelopmentIdentitySigningKey.ps1`. The private key is loaded only by the issuer; downstream validation loads the public key.

## Lifecycle

1. Generate a new P-256 pair in a new versioned protected directory.
2. Give only the 5051 service identity read access to the private key. Distribute the public key to development validators.
3. Restart development validators with the new public-key path, then restart 5051 with the matching private-key path.
4. Complete valid, wrong-key, audience, environment, expiry, and replay qualification.
5. Revoke the previous key by removing its public key from validator configuration, stop its issuer use, and archive or destroy private material under an approved retention procedure.

Development and future production must use separate issuers and keys. Production rollout additionally requires HTTPS, separate service identities, production-specific audiences, and an explicitly approved trust deployment.
