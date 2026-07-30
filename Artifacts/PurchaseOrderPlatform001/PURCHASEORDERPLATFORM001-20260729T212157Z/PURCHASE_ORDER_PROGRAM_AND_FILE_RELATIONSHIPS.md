# Purchase Order Program and File Relationships

| Chain | Role | Files and logic |
|---|---|---|
| POE.AA -> POE.AB | PO entry/maintenance | POE header/detail maintenance |
| POE.BA -> POE.BB | PO line maintenance | Uses ordered - received open balance |
| POC.BA -> POC.RA | PO inquiry | Header/line display and lookups |
| POR.KA -> POR.KB | Open PO report | Opens POE-02/POE-12; QTY=B[3]-B[7] |
| POR.SA -> POR.SB | Receiving history/report | Uses POT-04/POT-14 |

The qualified date display routine is FNB6$ with FNYY21_YY$. Its
first year character uses the Add+ON A-J decade encoding. Receiving history
is separable from the header/line contract and remains deferred.
