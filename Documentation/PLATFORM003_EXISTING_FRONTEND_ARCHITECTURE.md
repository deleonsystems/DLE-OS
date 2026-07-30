# PLATFORM-003 Existing Frontend Architecture

## Repository state

Inspection was performed on branch `main` at commit
`e3774531e519517eadd49c386f7cb984ee287b87`.

Four unrelated working-tree changes existed before PLATFORM-003:

- `DATA/shipment-staging/shipment-staging.json`
- `SRC/modules/shipping/shipping-workspace.css`
- `SRC/modules/shipping/shipping-workspace.html`
- `SRC/modules/shipping/shipping-workspace.js`

They are outside PLATFORM-003 and must remain byte-for-byte unchanged during
this mission. No repository `AGENTS.md` exists.

## Shell and module loading

`DLE_Work_Center_v4.0.0.html` is the current application shell. It contains
the root application structure and established global styling, then loads
modular CSS and JavaScript files. Generation 2 modules normally:

1. register a controller in `window.DleWorkspaces`;
2. locate a shell-owned element by `data-workspace-mount`;
3. fetch their own HTML template once;
4. mark the mount with `data-workspace-loaded="true"`;
5. render again when the workspace becomes active.

`SRC/shell/workspace-registry.js` is the authoritative flat Workspace View
catalog. `SRC/shell/workspace-shell.js` builds the selector, activates the
matching `data-workspace-home`, emits `dle:workspace-change`, and calls the
registered workspace controller.

There is no generic nested-navigation or module-destruction service.
PLATFORM-003 can safely represent the requested hierarchy by adding one
top-level Platform workspace and rendering one selected child entry inside
that isolated mount.

## Shared API client

`SRC/api/dle-api-client.js` owns API configuration. Resolution order is:

1. `window.DLE_API_CONFIG`;
2. `DLE_OS_API_CONFIG` in local storage;
3. default `http://DLE-OS-HOST:5041`.

The existing `getJson` path issues GET requests. A separate
`getJsonWithFallback` helper supports older modules that use project JSON.
The canonical viewer must not use that fallback helper. PLATFORM-003 should
extend the shared client with dedicated canonical GET methods, query
parameter allowlists, cancellation signals, structured safe errors, bounded
pagination, and exact URI encoding.

## Styling and visual language

The shell defines the core dark design tokens:

- `--bg`
- `--panel`
- `--panel-2`
- `--border`
- `--blue`
- `--blue-soft`
- `--text`
- `--muted`
- `--disabled`
- `--green`
- `--yellow`

Generation 2 modules use isolated class prefixes, 7–10 pixel radii,
translucent navy panels, blue focus/active states, compact status pills,
responsive grids, scrollable tables, and desktop-first layouts. RFQ,
Shipping, and Kitting are the closest structural references.

No new framework, package, font, icon set, or external dependency is needed.

## Lifecycle and cleanup

Existing modules generally load once and delegate events from their mount.
Cleanup support is inconsistent. PLATFORM-003 should improve locally without
altering the shell:

- bind one named delegated listener set;
- use `AbortController` for each entity request;
- abort active requests on `dle:workspace-change` when leaving Platform;
- reject stale responses by request sequence;
- provide an idempotent frozen controller with `render` and `destroy`;
- preserve filters, pages, page sizes, and selected records in closure state.

## Notifications, errors, and accessibility

Existing modules use visible status regions plus console logging. PLATFORM-003
should display safe user-facing state and reserve console output for
diagnostics without exposing raw API bodies.

Current Generation 2 modules use semantic headings, labels, buttons, tables,
focus styles, `aria` labels, keyboard-selectable rows, and modal/dialog
patterns. The canonical viewer should use tabs with the ARIA tab pattern,
semantic table headers, `aria-live` status, keyboard row activation, Escape
to close details, and text plus color for every status.

## Tests and development method

The frontend repository has no `package.json`, test runner, or browser-test
configuration. Existing qualification is manual/static. PLATFORM-003 should
add a dependency-free Node qualification harness, then use the established
DLE-OS-Server static hosting path for real browser and HTTP qualification.

## Selected integration points

PLATFORM-003 may change only these existing frontend files:

- `DLE_Work_Center_v4.0.0.html`
- `SRC/shell/workspace-registry.js`
- `SRC/api/dle-api-client.js`

It will add an isolated `SRC/modules/canonical-data-viewer` module plus
documentation, tests, and evidence. Existing operational module source is
not an integration point.
