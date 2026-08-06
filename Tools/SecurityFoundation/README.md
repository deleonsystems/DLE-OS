# DLE-OS Security Foundation

This development-only foundation keeps external authentication identity separate from internal DLE-OS authorization.

```text
WINDOWS / DLE-OS-HOST\Miguel
    -> security.ExternalIdentity
    -> security.User (Miguel)
    -> security.UserRole
    -> security.Role (SUPER_ADMIN)
```

`DLE-OS-HOST\DLE-OS` remains an unmapped service identity. Windows local Administrator membership is never consulted by the authorization evaluator.

## Database boundary

Phase 2 targets only `DLE-OS-HOST\SQLEXPRESS / DLE_OS_SECURITY_DEV`. The provisioning and bootstrap tools use fixed database names and reject catalogs containing `LIVE`.

1. A SQL administrator runs `Database/000_ProvisionIsolatedDevelopmentDatabase.sql` once. It creates only `DLE_OS_SECURITY_DEV` and grants Miguel `db_owner` only inside that database.
2. Miguel runs `DleOs.Security.Bootstrap` with `DLE_OS_SECURITY_DEVELOPMENT=true`. It applies the additive migration and invokes the fixed bootstrap procedure.
3. `Tests/SecurityFoundation001` runs with the same development guard and connection string.

The bootstrap accepts no user, role, or external-identity arguments. Both the CLI and stored procedure require the exact Miguel Windows identity. Existing contradictory mappings or a different active SUPER_ADMIN close the bootstrap.

## Authorization semantics

`AuthorizationEvaluator` is the single SUPER_ADMIN override:

- inactive or unresolved user: deny;
- active SUPER_ADMIN: allow any syntactically valid DLE-OS permission code;
- normal active user: allow only an active explicit role permission;
- otherwise: deny.

No production host references this project during Phase 2.
