# RECEIVING-HISTORY-DATE-DECODE-001

## Verdict

`BLOCKED`

The encoding and business field are proven, but the intended calendar date of
`311029` is not. The retained value is not an alternate encoding of a
November 2013 date. Under the ERP's own date routine it represents
`10/29/31`, which is outside the qualified snapshot horizon. The canonical
decoder therefore remains fail-closed and unchanged.

No source extraction, package build, SQL import, API work, viewer work,
deployment, or commit was performed.

## Physical field and dictionary definition

The field is:

- physical file: `POT-04`
- layout: `A`
- DDM field: `POT-04A090`
- DDM name: `ORDERED DATE`
- business description: `Date Ordered`
- DDM type: `D`
- storage length: `6`
- decoded record member: `A1$(5,6)` (positions 5 through 10 of the
  160-character header string block)

The dictionary result is retained in
`C:\Add-On\Lab\Exports\DDM_FIELD_CATALOG.csv`. Its evidence source is
`DDM-04 definition joined exactly to DDM-06 flattened cross-reference`, with
confidence 100. The logical data element is also retained in
`C:\Add-On\Lab\Exports\DDM01_CATALOG.csv` as `ORDERED DATE`, description
`Date Ordered`, type `D`, length `6`.

## Proven encoding

The field uses the Add+ON `YY21MMDD` representation:

1. The first two characters encode a two-digit year.
2. A numeric first character remains numeric.
3. `A` through `J` in the first character map to decade digits `0` through
   `9`.
4. Characters 3-4 are month.
5. Characters 5-6 are day.

Examples:

- `991123` -> `1999-11-23`
- `A00303` -> `2000-03-03`
- `A50316` -> `2005-03-16`
- `B00225` -> `2010-02-25`
- `B30125` -> `2013-01-25`
- `B90108` -> `2019-01-08`
- `C60122` -> `2026-01-22`

This is not DDMMYY, MMDDYY, Julian, packed, reversed-byte, or an internal
numeric-day value.

## Source-program proof

The retained program listings prove the rule and the field's lineage:

- `POC.RA` line 1200 labels `A1$(5,6)` as `Date Ordered`.
- `POC.RA` line 1220 invokes the standard date control for `A1$(5,6)`.
- `POC.RA` line 5250 displays it through `FNB6$`.
- `POR.PB` lines 1830-1835 assign the receipt-history order date from
  `FNB6$(A1$(5,6))`.
- `POR.PC` lines 6430-6440 print it as `Ordered`.
- `FNB6$` formats characters 3-4 as month, 5-6 as day, and converts the first
  two characters with `FNYY21_YY$`.
- `FNYY21_YY$` maps the first character with the paired lookup strings
  `" 0123456789ABCDEFGHIJ"` and `" 01234567890123456789"`.
- `POU.DA` reads the receipt-entry `POE-04` header into `A1$`, then writes the
  same `A1$` block to `POT-04` at line 3510. It does not transform the order
  date during posting.

The relevant retained listings are under:

`C:\Add-On\Lab\ReceivingHistoryPlatform001\RECEIVINGHISTORYPLATFORM001-20260730T030741Z\Listings`

## Meaning of `311029`

Applying the proven ERP routine:

- encoded year: `31`
- month: `10`
- day: `29`
- ERP display: `10/29/31`

This syntactically denotes 2031-10-29 under the same century interpretation
used by the qualified canonical pipeline. It is not accepted as a canonical
date because 2031 is beyond the 2026 snapshot horizon.

The retained evidence does not prove what date the operator originally
intended. Related November 2013 dates make a source-entry defect plausible,
but they do not prove a safe correction. The value therefore cannot be
changed to 2013, 1931, null, or a receipt date.

## Affected records

`OrderDateRaw=311029` occurs exactly twice in the accepted 39,564-header
stream. Both records share:

- firm: `01`
- vendor: `000077`
- purchase order: `0026639`
- warehouse: `12`
- required date raw: `B31105` (`2013-11-05`)
- blank promised and not-before dates

They differ by receiver and receipt date:

| Header natural key | Receiver | Receipt raw | Receipt date |
|---|---:|---:|---:|
| `0100007700266390026191` | `0026191` | `B31108` | `2013-11-08` |
| `0100007700266390026233` | `0026233` | `B31111` | `2013-11-11` |

The same PO has six retained receipt lines: four under receiver `0026191`
and two under receiver `0026233`. All reference item `PC01NSL495`; the line
required dates are `B31105` or `B40102`. This proves common transaction
origin, not the intended order date.

## Population check

The complete retained header stream contains three other out-of-horizon
Order Date values:

- `490916`, two headers for PO `0041702`; ERP display `09/16/49`; related
  receipt date `2019-09-23`
- `481114`, one header for PO `0041019`; ERP display `11/14/48`; related
  receipt date `2018-11-16`

These records reinforce that isolated historical order-date values can be
malformed. They do not establish a general alternate encoding.

## Decoder decision

No decoder change is authorized:

- the existing YY21 interpretation agrees with DDM semantics and every
  inspected program formatter;
- a special case for `311029` would be value-specific guessing;
- swapping or otherwise reinterpreting numeric year characters would change
  valid dates and still would not explain all anomalous values;
- nulling or substituting another field would discard or invent history;
- relaxing the horizon would admit future dates and weaken a required guard.

Package validation therefore continues to fail closed. The accepted
two-pass source qualification remains valid and retained, but no Receiving
History package or ImportRunId exists.

## Safe unblock

The milestone can continue only after authoritative business correction or
independent historical evidence establishes the intended order date for PO
`0026639` and the other malformed Order Date records. Any correction must be
governed outside this decoder and must preserve the original raw value and
its provenance.
