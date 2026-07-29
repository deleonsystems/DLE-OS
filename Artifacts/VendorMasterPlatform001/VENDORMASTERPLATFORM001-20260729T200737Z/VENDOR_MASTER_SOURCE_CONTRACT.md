# Vendor Master Source Contract

Verdict: **PROVEN WITH CLARIFICATIONS**

Natural key: `FirmId + VendorNumber`. APM-01 key bytes 1–2 contain FirmId and bytes 3–8 contain the six-character Vendor Number. The 805 qualified rows contain no duplicate natural keys, and no Vendor Number is reused across qualified firms.

## Authoritative source family

| File | Role | Qualified rows |
|---|---|---:|
| APM-01 | Current core Vendor master | 805 |
| APM-02 | Repeatable AP detail profiles; payment terms dependency | 912 |
| APM-05 | Repeatable purchasing addresses | 107 |
| APM-06 | Vendor/buyer/purchasing assignment | 0 |
| APM-09 | Internal comments; restricted and excluded | 124 |
| APM-10 | AP type/distribution/terms/payment-group descriptions | 27 |
| IVM-10 | Buyer lookup; supporting only | 207 |

APM-04 is an alternate index, not an entity owner. APM-03 is not opened by the proven maintenance chain. APM-11 and APM-12 are transactional/history sources and are not current Vendor master owners. APM-13 was not proven as a direct maintenance dependency.

## Proven population behavior

- APM.MB deletes the APM-01 row and its supporting rows; no retained inactive flag was proven.
- `VendorStatus`, `IsActive`, `VendorType`, `VendorClass`, and `ApprovedSupplierStatus` remain null because their semantics are unavailable.
- APM-02 is repeatable. Payment terms resolve only when all current profiles for a Vendor have the same nonblank code; otherwise the canonical value is null.
- APM-05 proves repeatable purchasing addresses. One orphan is classified and excluded.
- Contacts are embedded in APM-01 and APM-05; no repeatable VendorContact entity is proven.
- APM-06 is empty, so Buyer cannot be populated safely.
- Address lines are free-form; City and State are not split or inferred.
- APM-09 comments, tax/accounting/payment-history fields, and the invoice-hold flag are not in the general package or API.

## Population results

Vendor rows 805; blank names 4; duplicate natural keys 0; purchasing addresses 106 accepted plus 1 classified orphan; Vendors with multiple purchasing addresses 24; Vendors without purchasing addresses 743; without primary phone 3; without primary contact 381; orphan AP detail profiles 44.

The raw invoice-hold aggregate is blank 3, N 801, Y 1. It is AccountingRestricted and is not a general Vendor status. Therefore active and inactive counts are unavailable, and the one Y value is reported only as a restricted aggregate.
