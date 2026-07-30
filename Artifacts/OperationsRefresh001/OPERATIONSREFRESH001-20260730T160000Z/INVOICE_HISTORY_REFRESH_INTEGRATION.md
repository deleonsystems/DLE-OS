# Invoice History Refresh Integration

The coordinated third step invokes the existing qualified
`Invoke-InvoiceHistoryRefresh.ps1` unchanged.

- Window: 45 overlapping days
- Method: transactional bounded overlap upsert
- Signed credits/reversals: preserved
- MissingFromSource: preserved
- Full reconciliation: remains separate
- Force-full Core ERP qualification: not invoked

Existing automated regression suite passed 43/43. Live coordinated invocation
remains pending deployment.
