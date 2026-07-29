# Customer Master Source Contract

Verdict: **PASS WITH CLARIFICATIONS**

| Source | Qualified role | Natural key | Count | Operational use |
|---|---|---|---:|---|
| ARM-01 | Authoritative customer master | FirmId + CustomerNumber | 380 | Customer identity, name, free-form address, postal code, country, primary contact/phone, shipping/freight codes |
| ARM-02 | One-to-one customer detail | FirmId + CustomerNumber + AR type | 380 | Salesperson, terms, territory, pricing class, customer type codes |
| ARM-03 | Alternate ship-to address | FirmId + CustomerNumber + AddressCode | 29 | 28 attached operational addresses; 1 classified orphan |
| ARM-05 | Internal comments | source key | 94 | Restricted; excluded |
| ARM-06 | Payment/accounting summary | source key | 259 | Restricted; excluded |
| ARM-09 | Customer jobs | source key | 0 | No population |
| ARM-10 | Qualified code descriptions | FirmId + layout + code | 120 | Terms, salesperson, territory, customer type, pricing class descriptions |
| ARM-14 | Tickler/contact sequence | source key | 0 | No population |

All approved source opens were fixed to the qualified files and used `MODE="O_RDONLY"`. ARM-04 is an alternate index and is not an authoritative business-fact source.

Primary addresses and primary contacts are embedded in ARM-01. Alternate ship-to contacts are embedded in ARM-03. No separate repeatable CustomerContact source was proven.

`CustomerStatus` and `IsActive` are unavailable. The legacy retain flag was not promoted because it was not proven to mean active customer status.

The canonical operational contract excludes credit hold, credit limit, aging, balances, tax identifiers/codes, resale identifiers, D&B, SIC, internal comments, payment summary, and fax.
