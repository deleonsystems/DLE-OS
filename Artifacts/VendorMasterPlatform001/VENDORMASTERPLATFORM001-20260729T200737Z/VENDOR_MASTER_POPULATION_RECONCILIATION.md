# Vendor Master Population Reconciliation

APM-01 reconciles exactly to 805 Vendor rows. APM-05 contains 107 rows: 106 have a current APM-01 parent and one is explicitly classified in `OrphanVendorAddress.csv`. APM-02 contains 912 profiles: 44 profile keys lack a current APM-01 parent and are classified in `OrphanVendorDetail.csv`. Operational SQL contains exactly 805 Vendors and 106 VendorAddress rows.

Representative parity:

- `000034` — WALKER COMPONENT GROUP; outside California; primary contact TOM; payment terms 01 / NET 30 DAYS; three purchasing addresses. Source, package, SQL, API, and viewer passed.
- `000007` — full phone/contact data.
- `000002` — blank primary contact.
- `000003` — punctuation in name.
- Four blank Vendor names are retained because keys are valid and blanks are a proven source condition.

Open Purchase Order/receiving/history source data was not added to this qualification allowlist. Static program relationships indicate Vendor references exist in purchasing sources, but a population-level open-PO reconciliation requires a separately governed Purchase Order qualifier. No Vendor was silently classified active, inactive, approved, or currently used.
