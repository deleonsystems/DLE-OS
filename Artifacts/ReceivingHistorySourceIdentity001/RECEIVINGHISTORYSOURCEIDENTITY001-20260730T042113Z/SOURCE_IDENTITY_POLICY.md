# Receiving History Source Identity Policy

## Approved scope

This policy applies only to cross-pass comparison of:

- `X:\AON\ADATA\POT-03`
- `X:\AON\ADATA\POT-04`
- `X:\AON\ADATA\POT-14`

For those exact paths only, zero-based FIN offsets `14`, `15`, `16`, and `17`
are classified `ProcessLocal` and excluded from cross-pass FIN equality.

## Required controls

Qualification still requires:

- fixed approved path;
- `MODE="O_RDONLY"` for every open;
- complete FID equality within and across passes;
- complete FIN equality within each individual source open;
- equal FIN length;
- cross-pass equality of every FIN byte except offsets 14–17;
- stable file length, creation time, last-write time, and attributes;
- matching source layout;
- matching record count;
- matching first and last keys;
- strict key order;
- exact ordered-key SHA-256;
- exact decoded ordered key-record SHA-256;
- valid natural keys;
- zero writes;
- zero locks;
- zero residual mission-owned processes.

Any FIN difference outside offsets 14–17 fails closed. The same offsets on any
unapproved file fail closed. No global FIN rule is changed.

## Implementation

The policy is encoded in:

- `Tools/ReceivingHistory/SourceIdentity/receiving_source_identity_policy.py`
- `Tools/ReceivingHistory/compare_receiving_history_passes.py`

The original full-FIN rule remains in force inside each pass. Only the
cross-pass comparison uses the exact-path mask.

## Revocation

Remove the three exact-path entries from `RECEIVING_HISTORY_POLICY` to restore
complete cross-pass FIN equality. Any future semantic mismatch, filesystem
mutation, FID change, or volatility outside offsets 14–17 automatically blocks
qualification and requires a new investigation.
