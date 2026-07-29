# Vendor Master Canonical Proposal

Contract `VENDOR_MASTER_1.0` defines two independent canonical entities.

`Vendor` uses `(FirmId, VendorNumber)` and contains only proven general/purchasing fields, source identity, independent import identity, and import timestamp. `VendorStatus`, `IsActive`, `VendorType`, `VendorClass`, and `ApprovedSupplierStatus` are retained as explicit nulls to make the source limitation clear.

`VendorAddress` uses `(FirmId, VendorNumber, AddressCode)`, is a child of Vendor, and represents repeatable APM-05 purchasing addresses. It does not claim to be a remittance or ship-from address. `IsPrimary` is false and `IsActive` null because neither semantic is proven.

No `VendorContact` entity is created because contact values are embedded and not repeatable. City/State are not parsed from free-form address lines. Buyer is not populated because APM-06 is empty. Restricted fields are absent from package, SQL view, DTO, repository query, and viewer.
