# Authorization Model

The control host uses HTTP.sys Negotiate/NTLM Windows authentication. Only `DLE-OS-HOST\DLE-OS` satisfies `SnapshotRefreshOperator`.

- Anonymous requests are challenged (`401`).
- Other authenticated Windows identities are forbidden.
- No credentials are stored.
- Existing read-only APIs are unchanged.
- Fixed operator launchers preserve the established execution identity and source mappings.
- No request accepts a path, command line, script name, database, or source location.
