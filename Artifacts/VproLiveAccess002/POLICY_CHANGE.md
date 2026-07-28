# VPRO-LIVE-ACCESS-002 Policy Change

- Effective date: 2026-07-27
- Operator authorization: explicit authorization supplied with
  `VPRO-LIVE-ACCESS-002`

## Files changed

- `C:\Add-On\AGENTS.md` — authoritative VPro Engineering Lab instruction
- `Documentation\VPRO_STANDING_LEVEL2_ACCESS_POLICY.md` — repository audit copy
- `Artifacts\VproLiveAccess002\POLICY_CHANGE.md` — this change record

## Old restriction

The prior policy prohibited all access to X: by default and required a complete
mission-specific exception block for each read-only qualification.

## New authorization

X: now has standing Level 2 authorization for broad read-only discovery,
inspection, hashing, decoding, relationship tracing, evidence copying,
previously qualified readers, known constrained read-only VPro execution, and
local mirror creation. Approved downstream work remains scoped by the active
mission. Codex must not stop merely because read-only X: access is required.

## Permanent prohibited actions

No live filesystem or VPro record writes are authorized. Creating, modifying,
replacing, renaming, moving, deleting, locking, initializing, repairing,
rebuilding, purging, or converting live content remains prohibited. No
temporary, spool, log, cache, export, listing, or evidence output may be written
to X:. Unknown or uncontrolled program write behavior remains fail-closed.

## Stale restrictions

The blanket X: prohibition and per-mission authorization-block requirement were
removed from the authoritative instruction. Blanket restrictions on Z:, O:, P:,
T:, and direct UNC production access remain because the operator promoted only
X:. The prohibition on mapping, unmapping, or reconnecting drives also remains.
