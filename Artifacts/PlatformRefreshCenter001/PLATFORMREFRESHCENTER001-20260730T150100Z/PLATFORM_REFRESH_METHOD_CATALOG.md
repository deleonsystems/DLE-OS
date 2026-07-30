# Refresh Method Catalog

| Method | Meaning | Enabled |
|---|---|---|
| MetadataSourceCheck | Compare qualified source identities; unchanged returns `NO_SOURCE_CHANGES` | Core datasets |
| FullGovernedSnapshot | Existing complete validated core extraction/import/promotion path after changed source | Core datasets |
| ForceFullQualification | Explicit operator-only full core qualification; never the normal button | Core global action |
| BoundedOverlapUpsert | Existing 45-day transactional overlap refresh | Invoice History |
| CompleteMasterRead | Candidate repeated full-master strategy requiring separate qualification | Disabled |
| OpenTransactionRefresh | Candidate open-transaction strategy requiring separate qualification | Disabled |
| FullReconciliation | Separately governed historical reconciliation | Disabled |

Baseline package importers are not represented as routine refreshes.
