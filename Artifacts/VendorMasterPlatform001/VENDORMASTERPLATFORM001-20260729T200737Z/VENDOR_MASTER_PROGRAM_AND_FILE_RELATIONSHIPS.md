# Vendor Master Program and File Relationships

## Maintenance chain

1. `X:\AON\SCN\APM.MA` — Vendor Maintenance orchestrator.
2. `X:\AON\SCN\APM.MB` — name/address/contact maintenance; owns APM-01 and deletes the Vendor family on removal.
3. `X:\AON\ACT\APM.MC` — detail/profile maintenance.
4. `X:\AON\ACT\APM.MD` — AP type, distribution, payment group, and terms editing against APM-02/APM-10.
5. `X:\AON\ACT\APM.MJ` — replenishment/buyer/purchasing assignment against APM-06 and IVM-10.
6. `X:\AON\ACT\APM.MG` — detail-listing labels used to corroborate physical meanings.

All program inspection was static and read-only. Listings were written only beneath `C:\Add-On\Lab\VendorMasterPlatform001\VENDORMASTERPLATFORM001-20260729T200737Z`.

## Relationship map

`APM-01 (FirmId, VendorNumber)` is the current owner. APM-02 joins on the eight-character prefix and adds AP-type profile rows. APM-05 joins on the prefix plus two-character address code. APM-06 would join on the prefix plus buyer code, but has zero live rows. APM-10 provides coded descriptions. IVM-10 layout F provides buyer descriptions only when APM-06 supplies a code. APM-09 joins to the Vendor but is InternalOnly and excluded.

No program proves a retained inactive record, standalone remittance entity, separate repeatable contact entity, currency, shipping method, freight terms, quality approval, vendor-specific item price, supplier rating, or certification state in this source family.
