# Canonical Data Viewer Operator Guide

## Purpose

The Canonical Data Viewer is a read-only inspection surface for the
historical canonical snapshot qualified by PLATFORM-001 and PLATFORM-002.
It is an end-to-end proof, not an operational production module.

## Navigation

In DLE-OS select:

`Workspace View → Platform → Canonical Data Viewer — Test Data`

Platform currently contains only this child.

## Historical test-data warning

The persistent banner identifies:

- historical test data;
- read-only canonical snapshot;
- source `DLE_OS_PLATFORM_LAB`;
- Contract V1.1;
- not live Add+ON data.

The banner cannot be dismissed and is repeated inside an open detail drawer.

## Requirements

- Existing DLE-OS frontend repository.
- Existing unchanged DLE-OS-Server PLATFORM-002 service.
- Existing `DLE_OS_PLATFORM_LAB` database.
- API readiness at `/api/platform/v1/readiness`.
- API snapshot metadata at `/api/platform/v1/snapshot`.

## Launch

For the established LAN setup, launch the existing server normally and open
`http://DLE-OS-HOST:5041`.

For loopback-only local qualification, start the existing executable with:

```powershell
& 'C:\DLE-OS\Repositories\DLE-OS-Server\bin\Debug\net8.0\DLE-OS-Server.exe' `
  '--Kestrel:Endpoints:Http:Url=http://127.0.0.1:5041'
```

Then open `http://127.0.0.1:5041/`. The shared client uses the same origin
only when the shell itself is hosted on localhost/loopback. Explicit runtime
or stored API configuration remains higher priority, and the LAN default
remains `http://DLE-OS-HOST:5041`.

## Verify readiness

The header must show API readiness `Ready`, snapshot `Ready`, Contract
`V1.1`, the API-provided total, and import timestamp. `Refresh Status`
rechecks metadata without discarding current results.

If status is Not Ready or Unavailable, entity requests remain disabled and
the viewer offers a retry. It never uses an alternate data source.

## Browse entities

The four tabs are Work Orders, Inventory Items, Bills of Material, and
General Ledger Accounts. Work Orders is the default.

Enter supported filters and choose Search. Clear resets only that tab's
criteria. Each tab preserves its page, page size, filters, and selected
record while the workspace remains loaded.

Work Order Number is an exact canonical filter. Leading zeros are optional:
for example, `5` requests `0000005`, and `102362` requests `0102362`.
The value displayed in the input remains exactly what the user typed. Typing
pauses for 300 ms before issuing the server request, so a complete number
filters naturally without requiring Search. The Search button remains
available. Surrounding whitespace is ignored for the request; overlength
values are never truncated, and nonnumeric values are not padded.

## Pagination

The default is page 1 with 50 rows. Available sizes are 25, 50, 100, and
200. Previous and Next keep active filters. Enter a page number and press
Enter or choose Go to navigate directly while retaining the current filters
and page size. Values below 1 use page 1; values above the last page use the
last page. The viewer identifies the correction. Blank values restore the
current page; fractional values restore it and display the valid range. No
request exceeds 200 rows and filtering is server-side.

## Detail view

Select a row or focus it and press Enter/Space. The drawer performs one
exact, URI-encoded API lookup and shows every approved canonical member.
Use Close or Escape to return to the table.

## Canonical value policies

RawDate members are exact six-character source strings. They are labeled
Raw Date, and the viewer does not convert them to calendar dates.

`SchProdQuantity` is exact unscaled text. The viewer does not add decimals,
grouping, currency, or arithmetic formatting.

For stocked Work Orders, ItemDescription is the resolved inventory
description returned by the API. For non-stock Work Orders,
ItemDescription remains null and the two non-stock description lines remain
separate, ordered, and untrimmed.

## What the viewer cannot do

It cannot save, edit, update, delete, archive, import, synchronize, refresh
the mirror, refresh SQL, write back, export, or show live Add+ON data. It
cannot access SQL, mirror CSV, local business JSON, Add+ON, Visual PRO/5, or
network drives.

## Stop services

Close the browser tab. Stop only the qualification API process that you
started, for example:

```powershell
Stop-Process -Id <qualification-process-id>
```

## Troubleshooting

- `Not Ready`: inspect the structured readiness checks and the existing
  PLATFORM-002 operator evidence.
- `Unavailable`: verify the configured base URL and that the unchanged API
  process is running.
- Timeout: retry once or narrow filters.
- 404: the exact normalized identifier is absent from this snapshot.
- 409: more than one byte-exact canonical identifier exists; the viewer
  refuses to choose an internal row.
- Blank-looking values: spaces and empty strings are preserved; null uses
  the neutral `—` marker.

This viewer explicitly does not show live Add+ON data.
