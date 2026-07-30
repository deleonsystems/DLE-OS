# FID and FIN Classification

## Result

All three tested sources returned stable complete FID values in Experiments
B–G. Each FID is classified `StructureStable`.

FIN is 470 bytes for all three sources. Offsets are zero-based.

| Component | POT-03 | POT-04 | POT-14 | Evidence-based classification |
|---|---|---|---|---|
| FIN offsets 0–13 | Stable | Stable | Stable | `StructureStable` |
| FIN offsets 14–17 | Variable | Variable | Variable | `ProcessLocal` |
| FIN offsets 18–469 | Stable | Stable | Stable | `StructureStable` |
| Full decoded record stream | Empty/stable | Stable | Stable | `ContentStable` |

No FIN byte changed within a single source open, including after one record,
100 records, or a complete traversal. Offsets 14–17 changed across fresh
processes and could also change between files in one process after another
file's traversal. The same four-byte value was shared by all three sources in
the no-read process, demonstrating that it is not a source-specific content
identifier.

The experiment does not assign an undocumented internal name to the four-byte
value. It is classified only as opaque Visual PRO/5 process/channel state.
There is no evidence that it is a persisted business-content or structural
value.

No `VolatileOnRead` or `VolatileByTraversal` component was found. No component
was classified `ExternallyMutable` during the experiment.
