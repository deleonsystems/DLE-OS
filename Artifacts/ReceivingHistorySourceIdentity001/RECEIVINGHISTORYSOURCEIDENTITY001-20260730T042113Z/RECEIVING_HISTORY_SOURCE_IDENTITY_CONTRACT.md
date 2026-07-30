# Receiving History Source Identity Investigation Contract

## Mission boundary

This investigation characterizes the physical identity returned by Visual
PRO/5 for the following exact live sources:

- `X:\AON\ADATA\POT-03`
- `X:\AON\ADATA\POT-04`
- `X:\AON\ADATA\POT-14`

Every Visual PRO/5 source open is fixed in the compiled program and uses
`MODE="O_RDONLY"`. Generated programs, logs, record samples, and evidence are
local. No source write, lock, report execution, repair, or program modification
is permitted.

The two rejected Receiving History pass pairs remain rejected. They are
historical observations only and cannot satisfy an experiment or qualification
gate in this mission.

## Identity captured

For every experiment the supervising harness captures, before and after the
process:

- exact path;
- file length;
- last-write time in UTC;
- file attributes;
- observation timestamps.

Creation time is captured by the mission experiment runner because the reusable
harness intentionally uses the narrower source-identity tuple above.

When a Visual PRO/5 channel is opened, the experiment captures:

- the complete `FID(channel)` byte string as uppercase hexadecimal;
- the complete `FIN(channel)` byte string as uppercase hexadecimal;
- FIN length;
- every changed FIN offset, using zero-based offsets in analysis;
- the source-open mode (`O_RDONLY`);
- a before-read and after-read value when the experiment includes a read.

`FID()` and `FIN()` are channel functions. They cannot be obtained without a
Visual PRO/5 open. Therefore Experiment A performs a true no-open operating
system observation and records FID/FIN as not applicable. Experiment B is the
first experiment that can measure full FID/FIN and isolates open/close behavior
without a key or record read. This limitation is explicit and may not be hidden
by describing an open as observation-only.

## Semantic identity

Where the experiment enumerates keys, the retained local stream contains:

- source;
- deterministic ordinal;
- key bytes as uppercase hexadecimal;
- decoded `READ RECORD` bytes as uppercase hexadecimal.

The analysis uses `VPRO_KEY_RECORD_SHA256_V1`:

- ordered-key hash: for each record, four-byte unsigned big-endian key length,
  followed by key bytes;
- ordered key-plus-record hash: the same key framing followed by eight-byte
  unsigned big-endian record length and decoded record bytes.

The analysis also records count, first key, last key, and strict ascending key
order. Raw full-source streams remain in the governed local laboratory attempt
folder and are not copied into Git artifacts.

## Controlled sequence

Each experiment uses a fresh attempt owned by the reusable supervised harness.
No attempt output is reused as another experiment.

1. **A — observation only:** capture operating-system identity, perform no
   source open, wait a bounded five-second interval in the supervisor, and
   capture operating-system identity again.
2. **B — open/close:** for each source, open `O_RDONLY`, capture complete
   FID/FIN, close without `KEY` or `READ RECORD`, then repeat the open/capture/
   close once in the same process.
3. **C — one record:** capture FID/FIN after open, read the first deterministic
   primary-key record when one exists, capture FID/FIN again, and close.
4. **D — bounded sequential read:** perform the same sequence for at most the
   first 100 primary-key records.
5. **E — full read:** enumerate the complete primary-key stream and capture the
   complete decoded record stream.
6. **F — repeated full read:** repeat E in a separate fresh supervised attempt
   during the same quiet window.
7. **G — cross-process observation:** after F fully exits, run a separate fresh
   open/capture/close process without record access.

Experiments run sequentially. The supervisor must prove the prior experiment
has no remaining mission-owned process before launching the next.

## Quiet-window contract

Before A and again before E:

- identity is exactly `DLE-OS-HOST\DLE-OS`;
- the token is non-elevated;
- mapped `X:` and all three exact sources are visible;
- no overlapping Receiving History qualifier exists;
- no mission-owned Visual PRO/5 process remains;
- no known receiving entry, receipt posting, return processing, incoming
  inspection posting, or receiving-report activity is present;
- the operator has confirmed the operational quiet window.

If operational activity cannot be excluded, the live sequence does not start.

## Classification rules

Each identity component is classified source-by-source as:

- `ContentStable`: invariant whenever semantic streams are identical.
- `StructureStable`: invariant with stable layout/count/key structure.
- `VolatileOnOpen`: changes between no-record opens.
- `VolatileOnRead`: changes after one record access.
- `VolatileByTraversal`: changes correlate with traversal volume.
- `ProcessLocal`: stable inside a process but changes across fresh processes.
- `ExternallyMutable`: changes with file-system or semantic source mutation.
- `Unknown`: evidence is insufficient or contradictory.

No byte receives a non-content classification merely because prior rejected
streams happened to match.

## Acceptance criteria

Identity qualification may pass only when:

- the experiment sequence completes in a verified quiet window;
- complete FID/FIN arrays are retained for every experiment that opens a source;
- the exact volatile files, offsets, and triggers are reproducible;
- full-read E and F counts, first/last keys, key order, ordered-key hashes, and
  decoded key-record hashes match;
- file length, last-write time, attributes, and creation time remain stable;
- source writes and locks are zero;
- the approved exception is exact-path, exact-file, and exact-offset scoped;
- all other FID/FIN changes remain fail-closed;
- automated policy tests pass.

## Stop conditions

Stop and return `BLOCKED` if:

- semantic streams differ;
- file-system metadata changes as if a write occurred;
- quiet-window activity cannot be excluded;
- any source cannot be opened `O_RDONLY`;
- a write or lock is observed;
- volatility cannot be isolated to exact files and offsets;
- the exception would need to be global;
- a mission-owned process cannot be cleaned up safely.

## Candidate policy options

1. Retain complete FID/FIN equality if no volatility is proven.
2. Approve a file-specific FIN mask only for exact offsets proven
   non-content-bearing, while requiring all remaining physical and semantic
   controls.
3. Keep the identity `Unknown` and block Receiving History if the experiment
   does not safely distinguish volatile runtime state from source integrity.

No option is approved until the controlled evidence and tests are complete.
