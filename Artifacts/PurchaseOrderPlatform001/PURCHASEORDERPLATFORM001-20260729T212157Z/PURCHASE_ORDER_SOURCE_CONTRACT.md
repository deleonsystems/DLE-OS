# Purchase Order Source Contract

Verdict: qualified active Purchase Order contract.

Authoritative operational files are POE-02 (header) and POE-12
(detail). POE-04/POE-14 are current receiving work files.
POT-04/POT-14 are receiving history and are supporting qualification
sources only; they are not promoted as Purchase Order rows.

All six fixed files were opened twice with MODE="O_RDONLY" under
DLE-OS-HOST\DLE-OS. Source identity was stable, writes were 0, locks were
0, and mission-owned processes remaining were 0.

Header physical key: FirmId(2) + VendorNumber(6) + PurchaseOrderNumber(7).
Line physical key adds PurchaseOrderLineNumber(3). PO number alone is not
unique because the active source contains PO reuse across vendors.

The active POE files are an operational open-file population. They do not
provide a qualified closed/canceled/deleted history contract.
