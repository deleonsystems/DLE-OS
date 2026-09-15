# SIM Labor Quotation Workspace V1

RFQs → Open Labor opens the dedicated operation table. The SIM-only Labor
GET/PUT endpoints use existing Technical Review view/disposition permissions.
GET creates an unsaved template without writing state. Materials and Labor have
independent revisions/status and share the governed atomic-write gate in
`rfq-lanes.json`; each save retains the other lane. Generic lane-status writes
cannot bypass quotation completion validation.

## Operations and hierarchy

The editable PCB SMT/Thru-Hole template has 13 operations, blank run times,
a synthetic $75/hour rate and zero markup. Legacy RFQs without assembly type
use this starting template; their technical classification is unchanged.
Other assembly types use the general assembly template. Kitting starts with
Accepted BOM line count; other operation quantities start blank.

Operations have stable IDs, name, Qty, Run / Unit seconds, instructions and
`PER_UNIT` (default) or `BATCH` time basis. Searchable operation choices include
Manual Entry. Child choices are contextual for Kitting, SMT Setup and Inspection.
This vocabulary is not work-center master data.

A nullable `parentId` supports one child level. Orphans, self/cycles and nested
children are rejected. Parent and sibling order determine sequences such as
10, 10.1 and 10.2. Parents move with children; children move within their parent.
Add Sub-operation sits beside Operation. The Options popover contains basis,
Move Up/Down and Delete. Removing a parent group requires an inline confirmation.
All edits remain a draft until Save.

Parents with children show read-only dashes for Qty and Run / Unit. Only Total
Time rolls up adjusted child totals, with no parent double counting. Removing
the last child restores the retained parent inputs/basis. Collapse hides children
without changing calculations and remains local to the open workspace session.

## Current calculation contract

`LABOR_BATCH_ALLOCATION_V6` uses:

- Raw work = Qty × Run seconds.
- Per Unit operation seconds = raw work.
- Batch operation seconds = raw work / Qty Quoted.
- Parent seconds = sum of adjusted child seconds when children exist.
- Footer seconds per assembly = sum of root operation totals.
- Minutes/unit = seconds / 60; hours/unit = seconds / 3600.
- Cost/unit = unrounded hours/unit × rate.
- Sale/unit = unrounded cost/unit × (1 + markup / 100).

There is no further quantity division in footer pricing. The retained `SaleTotal`
contract field has the same per-assembly value as `UnitSalePrice` in V6.
Blank Qty/run contributes zero. Negative, excessive or more-than-six-place input
values are rejected. The backend uses decimal arithmetic; the UI retains a
common BigInt quantity denominator through calculation and rounds only final
display/currency outputs. Currency rounds to cents, midpoint away from zero.
Grid seconds display up to 12 decimal places; minutes/hours are display-only.
Batch leaves show `sec*` with a tooltip explaining raw work and allocation.

Example: 55 × 180 / 25 = 396 sec/unit, costing $8.25 at $75/hour and selling
for $10.31/unit at 25% markup. Children of 1 × 600 / 25 and 55 × 180 / 25
roll up to 24 + 396 = 420 sec; parent Qty/Run remain dashes.

## Persistence and history

Save records reviewer/time and sets Labor IN_PROGRESS. Completion requires
named operations and valid values/rate, marks Labor COMPLETE and appends a
snapshot with source ID, quoted quantity, operations, basis, instructions,
rate, markup, totals and calculation version. Later saves reopen only Labor
and preserve completed versions. Revision/source mismatches block stale writes.

Current V2 minute plans project to seconds; V3/V4/V5 current plans project to
V6 retaining inputs/basis. Explicit Save persists the projected plan. Historical
snapshots retain their recorded totals and calculation versions. Original V1
setup-based active plans require deliberate review/conversion. Older client
contracts must reload before saving. No source quantity change silently reprices
a stored plan.

## Read-only references

View BOM opens a separate permission-checked Accepted BOM reference with Find #,
customer/BOM P/N, confirmed MFG P/N, Description, Ref Des, Qty/Assy and component
type. It displays BOM line/component totals and exact decimal selected totals.
Click, Ctrl/Command+Click and Shift+Click select rows; Clear/Escape reset them.
Selection is browser-local, resets on refresh and makes no network/storage writes.
No drag selection is implemented. Materials quotation fields are omitted.

Open Drawing uses the Manufacturing Definition's governing document ID and
existing controlled intake-document endpoint in a separate `noopener` tab.
Neither reference depends on the original file path. No source documents or
runtime state belong in this checkpoint.

## Qualification

`Tests/SimAnalysis001` covers arithmetic, source/stale guards, validation,
hierarchy, save/reopen, completed versions and concurrent independent lanes.
`Tests/SimRfqs001/run-labor-ui-tests.mjs` covers live totals, operation controls,
failed-save draft retention, reference links, read-only behavior and hierarchy.
`run-bom-reference-tests.mjs` covers exact totals and local immutable selection.
No traveler release, scheduling, production promotion or real-rate integration
is introduced.
