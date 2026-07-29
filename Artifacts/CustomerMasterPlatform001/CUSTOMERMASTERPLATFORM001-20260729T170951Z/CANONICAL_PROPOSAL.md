# Canonical Proposal

## Customer

Owner key: `FirmId + CustomerNumber`. Platform identifier: concatenated fixed-width `CustomerMasterId`.

Approved operational members include customer number/name; five legacy free-form address lines; postal code; country; primary contact and phone; salesperson, territory, payment terms, shipping method, freight terms, customer type, and pricing class codes/descriptions; source identity; import provenance; and alternate ship-to count.

`CustomerStatus` and `IsActive` are additive nullable placeholders only. They must remain null until a separately qualified business source exists.

## CustomerAddress

Owner key: `FirmId + CustomerNumber + AddressCode`. It represents an alternate operational ship-to address with free-form address lines, postal/country, contact/phone, salesperson and territory.

## Deferred

`CustomerContact` is deferred because no populated repeatable source was qualified. City/state decomposition is deferred because only free-form address lines are proven.

Restricted credit, tax, accounting, aging, balance, internal-comment, and compliance identifiers are not canonicalized into this general viewer boundary.
