# SQL Schema Report

Database scope: `DLE_OS_CANONICAL_LIVE` only.

Created:

- `platform.CustomerMasterImportRun`
- `canonical.CustomerMaster`
- `canonical.CustomerAddress`
- `canonical.CustomerMasterViewer`
- `liveapi.CustomerMasterMetadata`

The pre-existing `canonical.Customer` used by Sales Orders was not replaced or altered. Customer Master replacement occurs inside one SQL transaction. Package manifest, aggregate hash, file hashes, counts, natural keys, parent relationships, and restricted-field exclusion are validated before commit.

The `dle_live_api_reader` role receives SELECT only on `canonical.CustomerMasterViewer`, `canonical.CustomerAddress`, and `liveapi.CustomerMasterMetadata`. No write grant or write endpoint was added.
