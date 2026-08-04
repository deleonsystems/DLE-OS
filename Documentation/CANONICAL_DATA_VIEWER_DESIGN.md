# Canonical Data Viewer Design

## 1. Purpose

Provide the first visible DLE-OS proof that historical Add+ON test data can
flow through the governed mirror, Canonical Contract v1.1, SQL staging, and
the read-only canonical HTTP API into a native Generation 2 workspace.

## 2. Historical test-data scope

The viewer always identifies the source as the historical
`DLE_OS_PLATFORM_LAB` snapshot. A persistent, non-dismissible warning remains
above all entity states. Nothing is represented as live or production data.

## 3. Navigation location

Workspace View gains one `Platform` entry. Its isolated workspace contains
one selected child: `Canonical Data Viewer — Test Data`. No existing
workspace moves or changes names.

## 4. API boundary

All business requests use dedicated methods on `window.DleApiClient`. The
client retains its existing configured base URL. The viewer does not fetch
business JSON, SQL, mirror files, Add+ON files, or any alternate source.

## 5. Four-entity scope

Exactly four tabs are available in this order:

1. Work Orders
2. Inventory Items
3. Bills of Material
4. General Ledger Accounts

Work Orders is initially selected.

## 6. Read-only behavior

Every canonical request is GET. The UI contains search, clear, navigation,
status refresh, row inspection, retry, and close controls only. There are no
edit, persistence, import, synchronization, archive, or write-back actions.

## 7. Search behavior

Search controls map only to PLATFORM-002 filters:

- Work Orders: workOrderNumber, itemNumber, status
- Inventory: itemNumber, itemDescription
- BOM: billNumber, drawingNumber, drawingRevision, bomRevision
- GL: accountNumber, accountDescription

Changing criteria resets the tab to page 1. Search is server-side only.
Work Order Number also submits after a 300 ms typing pause while retaining
the explicit Search button. The viewer state and visible input preserve the
user-entered value. At the outgoing API boundary only, the shared client
trims surrounding whitespace and left-pads a numeric-only value shorter than
the qualified seven-character canonical representation. Correct-width,
overlength, and nonnumeric values are not padded or truncated. The API still
performs exact matching; partial and contains matching are not introduced.

## 8. Pagination behavior

Every tab stores its own page and page size. The default is 1/50. Choices are
25, 50, 100, and 200. Previous/Next and the direct page-number control
preserve active filters and page size. Enter or Go navigates directly.
Whole-number targets below 1 or above the API-provided total page count are
clamped to the nearest available page with an accessible validation message.
Blank values restore the current page. Fractional values restore the current
page and show the valid range.
The viewer never requests more than 200 or downloads an entire entity.

## 9. Detail-view behavior

Selecting or keyboard-activating a row requests the exact canonical
identifier through the shared API client. An in-workspace detail panel shows
all approved members for that entity, a read-only label, and optional
snapshot context. It exposes no provenance or SQL metadata.

## 10. Snapshot and readiness

Initialization requests readiness and snapshot concurrently. Status can be
Checking, Ready, Not Ready, or Unavailable. The header shows contract,
snapshot status, total rows, and import time. Snapshot details show entity
counts and a shortened package hash with the full value available as a title.

Status refresh does not clear entity results. Non-ready status leaves the
workspace open but blocks new entity queries and offers retry.

## 11. Loading, error, empty, and offline states

Initial status and entity loads have visible accessible indicators. Empty
pages show an explicit no-results state. Structured 400, 404, 409, 500, and
503 conditions receive safe purpose-specific messages. Timeouts and
cancellation are distinct. No state falls back to another source.

## 12. WorkOrder description rules

Stocked rows show `ItemDescription` as `Resolved Inventory Description`.
Non-stock rows retain null ItemDescription and show
`NonStockDescriptionLine1` and `NonStockDescriptionLine2` separately and in
order. Values are never joined, trimmed, normalized, or replaced.

## 13. RawDate display policy

`BomRevisionDate`, `LastReceiptDate`, `WorkOrderOpenedDate`, and
`WorkOrderClosedDate` display exactly as returned. Detail labels identify
them as Raw Date and note that conversion is not defined.

## 14. Unscaled Decimal display policy

`SchProdQuantity` displays as exact text with a preserved-source-value note.
No scale, punctuation, currency, or arithmetic formatting is applied.

## 15. Accessibility

The workspace uses labeled fields, semantic buttons and tables, ARIA tabs,
`aria-live` state, keyboard row activation, visible focus, descriptive status
text, and Escape/Close detail behavior. Color is never the sole status cue.

## 16. Out of scope

Dashboards, charts, exports, reports, edits, bulk actions, direct SQL,
fallback files, imports, mirror refresh, live Add+ON, schedulers,
synchronization, authentication changes, production deployment, and
operational-module migration are excluded.

## 17. Future migration path

After user review, individual operational modules may consume specific
canonical API views. They should reuse the same client methods and value
policies while leaving this inspection viewer available as a governed
diagnostic surface. Work Orders is the recommended first migration target,
but no migration occurs in PLATFORM-003.
