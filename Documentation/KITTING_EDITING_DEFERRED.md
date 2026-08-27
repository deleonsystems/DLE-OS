# Kitting Editing Deferred (DEV)

## Stable baseline

Persisted Kitting data remains intact. The DEV Kitting queue, dedicated Kitting Job Workspace,
persisted-case review, historical reports, and already-qualified read-only utilities remain
available. Opening an existing case does not acquire an editing lease or create Kitting events.

Kitting editing, including Resume / Reconnect, is temporarily unavailable. The operator sees:

`Kitting editing temporarily unavailable. Saved Kitting information remains available read-only.`

This is a deliberate fail-closed DEV state. It is not a change to Kitting permissions, lease
policy, operational data, or submission history.

## Deferred problem

The write-capable resume path requires a current governed Released BOM source before it can call
the backend resume endpoint. The retired `WorkOrderReleasedBom004` prototype path currently
returns HTTP 404 and is not an acceptable production dependency.

Future Kitting work should supply or identify the current governed Released BOM source, qualify
that prerequisite independently, and only then re-enable editing from this stable baseline. Do
not recreate the retired `WorkOrderReleasedBom004` prototype artifact as a shortcut.

This record is DEV-only and does not authorize a LIVE deployment.
