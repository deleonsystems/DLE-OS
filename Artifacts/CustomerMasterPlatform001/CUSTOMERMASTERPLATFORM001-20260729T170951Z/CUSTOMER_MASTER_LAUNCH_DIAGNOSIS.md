# Customer Master qualifier launch diagnosis

## Finding

The corrected fresh-directory compile gate passed for
`Attempt-20260729T180728Z`. Its compiled program SHA-256 is:

`33CAD7A53B399AA70A621CC940773C1FA7C7D17CB58EFE64BBE6D39F963EB775`

The subsequent VPro process remained active without creating
`SOURCE_PASS_SUMMARY.csv`. That file is opened and its header is printed before
the program's first `MODE="O_RDONLY"` source open. Therefore the prior attempt
did not prove that the compiled qualifier began executing, and it produced no
qualified source-read evidence.

The previous invocation had two avoidable launch risks:

1. It supplied the compiled program by a long absolute path.
2. Its copied configuration retained a `PREFIX` pointing to the prior
   Platform002 program directory instead of the current Customer Master
   attempt directory.

The synchronous `Start-Process -Wait` call also had no startup, progress, or
hard-runtime deadline, so this pre-program state could remain indefinitely.

The first bounded diagnostic launch corrected those path risks but retained
redirected standard streams. It timed out cleanly after 30 seconds with no
startup output and no remaining process. Existing qualified Lab execution
evidence documents the same VPro5 behavior: redirected or sandboxed GUI
startup can leave the process alive without reaching the requested program,
whereas an interactive `ProcessStartInfo` launch with
`UseShellExecute=true` reaches the T0 program and exits normally.

## Correction

`Invoke-CustomerMasterQualifiedAttempt.ps1` now:

- reuses only the passed compiled artifact and verifies its compile-gate
  identity and SHA-256;
- creates an attempt-local configuration whose first `PREFIX` is the current
  Customer Master `Programs` directory;
- launches the compiled program by basename from that directory;
- uses the previously qualified interactive `ProcessStartInfo` mechanism with
  `UseShellExecute=true` and no redirected standard streams;
- refuses to start when another VPro process or Customer Master wrapper is
  active;
- requires non-empty startup output within 30 seconds;
- requires continued runtime-output progress within 120 seconds;
- applies a 900-second hard runtime limit;
- terminates only the exact VPro PID it started when a bound is exceeded;
- verifies that the started PID is absent before reporting a clean
  fail-closed result.

No source guard was weakened. The fixed source allowlist remains unchanged,
and every VPro source record open remains `MODE="O_RDONLY"`.

## Proven program-start defect

A fresh, local-only pre-open diagnostic containing the qualifier's declarations
proved VPro runtime error `42` at the array-based source-definition table.
Renaming the second numeric array did not change the error. Replacing that
unnecessary table with the scalar-per-file branch already qualified by
Platform002 made the complete pre-open probe pass.

The original `Attempt-20260729T180728Z` compile gate and program hash remain
preserved as evidence; that binary is not promoted because it contains the
proven runtime-invalid declaration structure.

The corrected first source-read attempt then completed the ARM-01 stream and
raised error `42` while assigning cross-pass values through undeclared string
array syntax (`PFID$[FILE]`, `PFIRST$[FILE]`, and `PLAST$[FILE]`). Those
pseudo-arrays were removed. Cross-pass count remains checked in VPro, and
exact key-plus-decoded-record equality remains fail-closed through the
wrapper's independent SHA-256 comparison of the two pass files.

The first complete two-pass run then exposed a post-processing defect: raw
CSV hashes included the intentionally different leading pass number (`1` or
`2`). All eight streams were proven identical after removing only that
metadata column. The comparator now retains each raw file hash but qualifies
equality using a normalized record-stream SHA-256 that excludes only the
leading pass value.
