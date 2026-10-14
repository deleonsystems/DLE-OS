# SIM linear labor worksheet — 2026-10-12

Implemented on MichaelDesk in `C:\DLE-OS\Repositories\DLE-OS`, branch `feature/miguel-new-order-intake` (already seven commits ahead). Existing uncommitted slideshow/frontend/backend work was preserved. No commits, pushes, deployment, service restart, security configuration or business-data writes were performed.

## Behavior

- Eight columns: Responsible role, Seq, Operation, Qty, Run / Unit (sec), Notes, Total time, Options. Add-substep stays inside Operation.
- Slide rows are hidden initially. Options > View slides reveals the existing slide authoring controls; Return to worksheet hides them. Existing IDs, stages, intentional blank cards, annotations and image associations use the same slide controller.
- Options puts time basis, slides, movement and deletion first; existing note, visual and drawing-note tools remain available below. Controls have 44px touch targets. Menus dismiss on repeated trigger, outside pointer/focus, Escape, anchor scroll, resize, redraw and navigation. Keyboard arrows/Home/End navigate commands.
- Only main operations have responsible-role controls. Existing child role values are neither rewritten nor migrated. Conflicts appear in a warning with the saved assignment and section role.
- Batch inputs say `sec / batch item`; totals explicitly say `sec / unit`, retaining the batch allocation tooltip. Rollup parents cannot change time basis. Arithmetic and retained parent inputs are unchanged.
- Materials/Kit remains separately collapsible, included in costs and excluded from the production slideshow.

## Validation

Passed:

- `node Tests/SimRfqs001/run-linear-worksheet-tests.cjs`: Edge 1440x1000 and 1024x768, WebKit 1024x768. Isolated intercepted requests only. Eight columns, hidden slide rows, main roles/conflicting legacy roles, batch allocation, preserved values and slides on save, repeated touch menus, outside/Escape/focus/resize/scroll/navigation dismissal, keyboard commands, slide-editor return, move, group-delete cancellation, Materials/Kit totals and read-only access.
- `node Tests/SimRfqs001/run-labor-ui-tests.mjs`: all arithmetic, hierarchy, save/failure/history, notes/images, supplemental costs and lead checks.
- `node Tests/SimRfqs001/run-materials-kit-disclosure-tests.cjs`: Edge desktop, WebKit tablet/phone; existing authoring entry updated to Options > View slides.
- `node Tests/SimRfqs001/run-labor-role-tests.cjs`: Edge and WebKit, desktop/tablet/phone layouts; fixture now preserves a legacy explicit child assignment instead of editing it through removed controls.
- `node Tests/SimRfqs001/run-compact-slide-tests.cjs`: Edge desktop, WebKit tablet/phone; annotated previews, insert/reorder/copy/delete/undo and cleanup.
- `node Tests/SimRfqs001/run-ui-tests.mjs`, `run-operator-turn-grouping-tests.cjs`, `run-material-preparation-tests.mjs`.
- JavaScript syntax checks and scoped `git diff --check` (Git printed line-ending normalization notices only).
- Visually inspected desktop worksheet and Edge/WebKit tablet menu screenshots under `tmp/slides/linear-*.png`.

Initial failures were resolved: a menu overlapped its trigger; old tests expected totals without `/ unit`; an initial test invocation used the wrong working directory. WebKit was initially missing and was downloaded solely into `C:\Users\migue\AppData\Local\Temp\codex-labor-playwright`. Browser test runs set `PLAYWRIGHT_BROWSERS_PATH` to this directory and use the existing `NODE_REPL_NODE_MODULE_DIRS` Playwright package.

Not run: physical iPad acceptance, authenticated live-scenario editing, full backend/integration suite. No separate JavaScript typecheck/lint configuration was found. This change does not alter backend code. Root/ancestor AGENTS files were absent, `.agents` and the supported local `.codex\memories` directory were empty. Existing quotation/checkpoint/slideshow documentation supplied relevant test guidance.

## Scenario and review

Read-only scenario 0036 inspection: saved Labor revision 22, quantity 25, 17 operations, 24 authored cards (2 BLANK, 9 DRAWING, 6 START, 7 END), no conflicting explicit substep roles. The previously documented 33 playback pages was not re-counted through authenticated playback. The saved JSON files remained unchanged across read-only verification. All mutation QA used disposable fixtures, never scenario 0036.

SIM restart is **not required** for these frontend assets: SimHost serves repository `SRC` through its physical file provider. Refresh the app and reopen Labor. Existing backend changes predating this task were not rebuilt or activated.
