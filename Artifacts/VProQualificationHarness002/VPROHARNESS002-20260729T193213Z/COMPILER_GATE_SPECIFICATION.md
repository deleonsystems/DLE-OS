# Compiler Gate Specification

A qualifier may launch only when all conditions hold:

1. the compiler process completed;
2. stdout and stderr were captured and combined;
3. exit code is zero;
4. no configured case-insensitive failure marker (including `error` or
   `fatal`) appears;
5. the emitted artifact exists and is resolved to the expected fixed name;
6. the artifact is contained by the current attempt;
7. its write time belongs to the attempt;
8. its size is at least the configured plausible minimum;
9. SHA-256 is recorded and is not a configured stale failed-stub hash;
10. the source SHA-256 and compiled SHA-256 are linked in compile metadata.

The preflight is intentionally conservative, not a PRO/5 parser. It detects
`FN` prefixes, truncation to reserved `FN`, names beyond configured effective
length, and duplicates after truncation. Compiler validation remains
authoritative.

Local tests proved rejection of nonzero exit, zero-exit error text, zero-exit
fatal text, missing output, stale-time output, outside-attempt output, and
reserved/truncated names.
