# Receiving History Additive Date Quality

Implementation verdict: **PASS**

## Proven physical fields and encoding

| Canonical field | Physical field | Source member | DDM definition | Program evidence |
|---|---|---|---|---|
| Receipt Date | `POT-04A130` | `A1$(29,6)` | `PO REC DATE`, Purchase Order Receipt Date, type `D`, length 6 | `POR.PB`, `POR.PC`, `POR.SB`, `POR.CB`, and `POR.DA` format it through `FNB6$`; `POU.DA` uses it as the receipt/posting date |
| Required Date | `POT-14A090` | `W1$(3,6)` | `PO REQ DATE`, Date Required, type `D`, length 6 | `POR.CB`, `POR.RB`, `POR.PC`, and `POR.QA` format it through `FNB6$` |

`FNB6$` selects characters 3-4 as month, 5-6 as day, and passes
characters 1-2 through `FNYY21_YY$`. This is the same Add+ON `YY21MMDD`
encoding proven for Order Date. No program branch, dictionary definition, or
alternate formatter supports a second interpretation.

## Qualified field-specific populations

| Field | Resolved | InvalidSourceValue | Expected invalid |
|---|---:|---:|---:|
| Order Date | 39,559 | 5 | 5 |
| Receipt Date | 39,563 | 1 | 1 |
| Required Date | 189,246 | 26 | 26 |

The complete affected keys and raw values are retained in the package:

- `BaselinePackage\MalformedOrderDate.csv`
- `BaselinePackage\MalformedReceiptDate.csv`
- `BaselinePackage\MalformedRequiredDate.csv`

Receipt `D01129` mechanically resolves to 2030-11-29. Required values
mechanically resolve as follows:

- `291120` -> 2029-11-20
- `F50917` -> 2055-09-17
- `300802` -> 2030-08-02
- `C70103` -> 2027-01-03

All are structurally valid Add+ON dates and valid calendar dates, but exceed
the qualified 2026 snapshot horizon. No historical or related field proves a
replacement date.

## Canonical handling

For Receipt Date and Required Date independently:

- preserve the exact raw six-character value;
- set the ISO/SQL date to null;
- set the field-specific resolution status to `InvalidSourceValue`;
- set the reason to
  `Decoded date exceeds qualified historical/snapshot horizon`;
- retain the source header or line;
- never substitute another date.

Blank values remain `BlankSourceValue`. Valid in-horizon values remain
`Resolved`. Wrong length, invalid YY21 prefix, nonnumeric remainder, invalid
month, invalid day, and invalid calendar dates still fail package validation.
The existing five-record Order Date policy and reason are unchanged.

The API DTO and viewer detail surface expose raw, parsed, status, and reason
for all three governed dates. The viewer renders `Invalid source value` and
never renders the mechanically decoded future date.

## Relationship clarification

Four POT-04 headers have no POT-14 children. They are retained as genuine
header history under an exact count gate; no child is fabricated.

`POU.DA` writes POT-04 after the detail loop and explicitly routes `LINES=0`
through the completed/deleted active-PO path. Inquiry programs read these
headers and have no detail rows to print. All 189,272 retained lines have a
valid parent, and orphan lines remain zero.

## Package and SQL results

- Package SHA-256:
  `84A4267E17412B373DC8868B98C1775134ED497FF1A5EF4EB2930BA4B9CC492E`
- Headers: 39,564
- Lines: 189,272
- Rejections: 0
- Blank-PO orphan: 1 header / 1 child line
- Header-only histories: 4
- Duplicate source keys: 0
- Orphan lines: 0
- Receiving History ImportRunId:
  `034f0f72-8713-4163-b20d-fb9d421a7961`
- Initial transactional import: PASS
- Identical re-import: NO-OP
- Induced-failure rollback: PASS
- Importer role: approved insert/delete/select only; no alter/control/execute
- LIVE API identity: approved viewer/metadata SELECT only; writes denied

## Deployment and acceptance

The governed runtime deployment passed after operator-approved UAC elevation.
The LIVE API runs on port 5042 under
`DLE-OS-HOST\DLE-OS-LIVE-API`, reports `ReadyFresh`, and exposes Receiving
History metadata and data through the qualified read-only route boundary.

HTTP qualification passed 30 assertions. In-app browser acceptance confirmed
all ten viewer sections, 189,272 Receiving History records, explicit invalid
Receipt/Required Date display, raw-value traceability, and the retained
blank-PO orphan behavior.
