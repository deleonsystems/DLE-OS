# Receiving History Source Identity Safety Analysis

## Original false positive

The original rule treated all 470 FIN bytes as persisted file identity.
Controlled evidence shows offsets 14–17 vary with Visual PRO/5 process/channel
state even when the complete business streams and all filesystem metadata are
unchanged. Rejecting otherwise identical passes solely for those bytes is a
false positive.

## Risk of the exception

The risk is that a future Visual PRO/5 version could reuse one of the four
offsets for persisted source state. The exception is therefore limited to the
three exact POT paths, exact offsets, and cross-pass comparison only. It is not
applied within an open, to other files, or to any other FIN byte.

## Replacement integrity controls

Business-record changes remain detectable through exact record count,
first/last keys, ordered-key SHA-256, and decoded key-record SHA-256.
Structural changes remain detectable through exact FID, FIN length, every
nonvolatile FIN byte, fixed path, file length, source layout, and filesystem
timestamps/attributes.

Writes, locks, missing evidence, invalid hex, wrong access mode, or residual
owned processes fail closed.

## Isolation

BOM, Inventory, Work Order, Sales Order, Purchase Order, and every unapproved
source retain full FIN equality. A difference at offset 14–17 on any unapproved
path fails.

## Revocation

The exception is a small policy map. Removing an exact path immediately
restores full FIN comparison for that file. Evidence of any semantic mismatch
or any new volatile offset requires revocation and a new source-identity
mission.
