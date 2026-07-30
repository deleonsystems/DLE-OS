# Frontend Cache Root Cause

Verdict: PROVEN

The pre-mission shell referenced mutable JavaScript and CSS beneath stable
`/SRC/...` and `/ASSETS/...` URLs. The shell and those assets had no
deployment-level immutable identity, so a browser could retain build
`20260729-03` after the server deployed `20260729-04`. The query-string and
`/app` workarounds created new URLs but did not establish a governed build
contract.

The final implementation gives each publication a unique timestamp-plus-source
hash ID, publishes a complete build before changing the current pointer, serves
the shell with `no-store`, and serves only build-qualified asset URLs with
`immutable`.

During live acceptance, an additional generator defect was found: replacing
every literal `<head>` also modified `<head>` strings embedded in print/report
JavaScript. This caused `SyntaxError: Unexpected end of input`. Publication now
inserts diagnostics after only the first document `<head>`, requires exactly one
diagnostic marker, and retains the complete initialization script. The fixed
build loaded without console errors.
