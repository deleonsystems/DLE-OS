# Receiving History Program and File Relationships

Static program inspection used local `pro5lst` listings only. No report or
production program was executed.

| Chain | Proven role |
|---|---|
| `POE.CA → POE.CB → POE.CC → POE.CD` | QA receipt entry |
| `POE.DA → POE.DB → POE.DC` | Purchase-order receipt entry |
| `POR.CA → POR.CB` | QA receipt register |
| `POR.DA → POR.DB/POR.DC/POR.DD` | Purchase-order receipt register |
| `POU.CA` | QA update; promotes accepted quantity to PO receipt work and writes rejected detail to `POT-03` |
| `POU.DA` | Receipt update; writes posted `POT-04`/`POT-14` history and downstream PO/inventory/WO effects |
| `POR.PA → POR.PB → POR.PC` | Purchase receipt history by vendor |
| `POR.QA` | Purchase receipt history by item |
| `POR.RA → POR.RB` | QA work-in-process inquiry/report |
| `POR.SA → POR.SB` | QA rejection history |
| `POR.TA → POR.TB` | Billed/unbilled receipts |
| `POU.FA` | Governed purchase-receipt-history purge |
| `POU.HA` | Governed QA-rejection-history purge |
| `POC.QD/POC.QE` | Receipt header/detail SpeedSearch |
| `POC.QH` | QA receipt header SpeedSearch |
| `POC.LA/POC.LB` | Receiver/PO lookup |
| `POC.MA/POC.NA` | Receiver creation/next-number support |
| `POC.GA` | General-ledger posting support |

The update sequence proves that positive retained `POT-14` numeric slot 7 is
the posted receipt quantity. For QA receipts, accepted quantity is promoted
into that slot; rejected detail is retained separately in `POT-03`. Negative
slot-7 values are real signed postings, but no dedicated retained discriminator
was found that proves whether each is a return, correction, or reversal.

Source program hashes were captured before and after listing and matched.
Listings are local under
`C:\Add-On\Lab\ReceivingHistoryPlatform001\RECEIVINGHISTORYPLATFORM001-20260730T030741Z\Listings`.
