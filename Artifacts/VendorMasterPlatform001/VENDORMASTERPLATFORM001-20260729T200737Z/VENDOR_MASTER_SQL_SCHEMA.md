# Vendor Master SQL Schema

Database: `DLE_OS_CANONICAL_LIVE` only.

Objects:

- `platform.VendorMasterImportRun`
- `canonical.VendorMaster`
- `canonical.VendorAddress`
- `canonical.VendorMasterViewer`
- `liveapi.VendorMasterMetadata`

Primary and foreign keys enforce both natural-key uniqueness and address parentage. Import validation verifies manifest schema/version, all file hashes, aggregate package SHA-256, counts, keys, parent relationships, and restricted-field exclusion before opening SQL. Replacement of both operational tables occurs within one serializable transaction. An identical committed package returns `NO-OP`; the induced failure after DELETE rolled back to 805/106 and retained the sole committed run.

`dle_live_api_reader` receives SELECT only on the viewer, address table, and metadata view. No write endpoint or SQL mutation permission is introduced.
