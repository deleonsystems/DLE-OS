# Program and File Relationships

The bounded T0 qualifier reads only the fixed approved Customer Master files. It does not run production programs or reports.

```text
CUSTOMER_MASTER_QUALIFIER
├── ARM-01 customer master
├── ARM-02 customer detail
├── ARM-03 ship-to addresses
├── ARM-05 internal comments (classification only)
├── ARM-06 payment summary (classification only)
├── ARM-09 customer jobs
├── ARM-10 code/description table
└── ARM-14 tickler/contact sequence
```

The package builder joins ARM-02 to ARM-01 by `FirmId + CustomerNumber`. ARM-03 uses `FirmId + CustomerNumber + AddressCode`; rows are attached only when the parent ARM-01 key exists. ARM-10 descriptions resolve by `FirmId + layout + code`. No reference row is allowed to replace its direct code.

The qualified raw ARM-10 record is authoritative for the display description. The qualifier's diagnostic `decoded_material` records VPro variable boundaries and is not treated as a field projection.
