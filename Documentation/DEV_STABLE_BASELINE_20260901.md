# DLE-OS DEV stable baseline — 2026-09-01

This record preserves the qualified DEV topology after the final controlled
Windows reboot on 2026-09-01. It is an operational/source-control reference,
not an instruction to redeploy or rotate credentials.

## Qualified topology

| Port | Component | Ownership and startup | Qualified release/state |
| --- | --- | --- | --- |
| 5051 | Authenticated DEV frontend/BFF | Windows service `DleOsDevelopmentFrontend`, Automatic, `DLE-OS-HOST\DLE-OS-DEV-FRONTEND` | `20260901T185555Z`; routes canonical reads to 5052, ordinary operations to 5054, Sync Operations only to 5056, and Invoice History refresh control only to 5057 |
| 5052 | Read-only canonical API | Password task `\DLE-OS\Development\Canonical API 5052`, startup delay `PT1M`, `DLE-OS-HOST\DLE-OS-LIVE-API` | `ReadyFresh`; SELECT allowed and INSERT/UPDATE/DELETE/EXECUTE denied |
| 5054 | Protected operational control | Password task `\DLE-OS DEV Operational ControlHost 5054 Candidate`, startup delay `PT2M`, `DLE-OS-HOST\DLE-OS-DEV-CONTROL`, Limited | `dev5054-20260825T170328Z-4e01176a73ea`; legacy task disabled; diagnostic service stopped/manual |
| 5056 | Sync Operations control | Password task `\DLE-OS\Development\Sync Operations ControlHost 5056 Candidate`, startup delay `PT1M`, `DLE-OS-HOST\DLE-OS`, Highest | `syncops5056-20260831T225016Z-91ea937d248d`; execution-disabled by default |
| 5057 | Governed Invoice History refresh control | Password task `\DLE-OS\Development\Governed Refresh ControlHost Candidate`, startup delay `PT1M`, `DLE-OS-HOST\DLE-OS`, Highest | `refreshcontrol-20260901T205619Z-8a579f9767fe`; execution-disabled by default |
| 5053 | Customer Files | No listener | Intentionally offline and excluded pending the technical-drawings/documents architecture review |
| 5055 | Diagnostic runtime | No required listener | Diagnostic only; excluded from the stable topology |

The qualified startup ordering is 5052 at `PT1M`, 5056 and 5057 at `PT1M`,
then dependency-bound 5054 at `PT2M`. Tasks use `StartWhenAvailable`,
`IgnoreNew`, and `PT0S`. The protected 5054, 5056, and 5057 tasks retain zero
automatic retries; no speculative restart policy was qualified.

## Release and task attestations

| Component | Executable SHA-256 | Additional qualified hash |
| --- | --- | --- |
| 5051 | `2A9D7D0E5205FF983298C661A81F03FED2D04C311309A170AEBE378736E9CF91` | deployed source digest `AD5446337ACF8F8F879BFDC8455EF0F684CCD56FD246FC393976480DFE8FD614`; reconciled permanent source digest `983F64B280F1FA95645FEC7B041D4F991738FDE32E8C5BD3F9D408AC310D3266` after removing qualification-only UI |
| 5052 | `2DBBF2E77E04E053C4691C15BC5C1930567A7EA0E5C50DBE6163E5364F63A6BA` | task XML `4E917BBF97724B603F02F290110170D850D06456B3FA1E5EF3B633C3F352A8A3` |
| 5054 | `CBE22D5E4262B71C6AB814EFFF947D0E6EB35D96DBEB3E0019D1A537A4E00637` | task XML `7437CC2B9A734601A911F33B704BB131DC841185EC04FDD37784F627C2957DA3` |
| 5056 | `8F9680FDEB92583C11C09BC3B48A616F89B534133B37113871A94D85605DDE89` | DLL `37C72886EE15A0F35ED94864B441A165A35EA141F81F37D3C7B91EC51B38F8F2`; manifest `31503BC66A6E991F19EC2EFDB9DAA9A9178DE5676A91B0F270ED8DDAA332D631`; task XML `0CA75503D745A25AE5D966087D3A206A7AFAF9B071353A39B9E6CD33EA8D5CA3` |
| 5057 | `101A3B2915892D43531903354799F20DD4A9BB1A0E59A65B04D35BA3E701BFA9` | DLL `A37EE75343E2BDA2BD63D29E0D2B59ABD2C2A1DB929764443778BF28BBF6892D`; manifest `D3508B644A6067042F456BA55F8C6DDEAB2D95AF1CADD2639D6A26CB6BFE72F7`; task XML `68440137C2AF8C152F8288BC8C3C16C2C55290B6A77494EF50D284EE0031BEF4` |

Local deterministic publishes during Git reconciliation reproduced the 5056
and 5057 EXE, DLL, PDB, launcher, configuration/fixture, and dependency
manifest hashes exactly. The qualified 5056 worker chain remained 15/15
byte-identical and the 5057 Invoice History dependency chain remained 23/23
byte-identical.

The preserved 5052 portable PDB was also reconciled against every
non-generated source document used by that build. All recorded SHA-256 source
checksums match the current DLE-OS and DLE-OS-Server files byte-for-byte. A
fresh local publish does not reproduce the deployed EXE/DLL hashes, so 5052 is
not claimed to be binary-reproducible under the current SDK/toolchain; this is
a build-output reproducibility limitation, not a missing-source or
runtime/source-alignment gap. The deployed executable remains the qualified
artifact recorded above and was not rebuilt or replaced during reconciliation.

The permanent 5051 routing/configuration files remain the files used by
release `20260901T185555Z`. The digest difference above is limited to removal
of the DEV browser qualification panel (`Qualify Sync Runs GET` and its
structured diagnostic display); it does not represent a missing routing,
authentication, authorization, or runtime implementation change. The running
release is not modified during Git cleanup.

## Final reboot evidence

The final reboot recovered 5051, 5052, 5054, 5056, and 5057 unattended with
one process per required runtime, no duplicate workers, no active lease or
Invoice History lock, no pending one-run approval, and no unexpected canonical
generation change. 5052 returned HTTP 200 / `ReadyFresh`; 5054 ordinary
operations returned HTTP 200 while its retired Sync Operations route remained
HTTP 404; 5056 and 5057 returned to execution-disabled state.

Machine-local evidence is intentionally ignored rather than committed:

- `.tmp/dev-final-post-reboot-baseline.json` — SHA-256
  `496D2D40B9884B2A0FEE893BEAFBB3DDC39D74E9EACA2EFFD510583579271F2D`
- `.tmp/dev-final-post-reboot-validation.json` — SHA-256
  `F456370847B8102378A7E9D7D727D607119A12F854E50A42CF8A38882C00FBCB`

## Governed data state and accepted exclusions

- Sync Operations and Invoice History are independently governed. Both hosts
  start execution-disabled; a bounded one-run approval is required for a live
  refresh.
- Invoice History canonical reads remain available from 5052 even if its
  refresh-control host is unavailable or a refresh fails before promotion.
- 5053 Customer Files remains intentionally unavailable. Do not revive its
  obsolete direct-authentication runtime as a shortcut.
- Direct Invoice History deep-link/bookmark navigation and remote Explorer
  folder opening from MichaelDesk are deferred usability limitations, not
  data-integrity exceptions.

## Source-control boundary

The permanent source set includes the 5051 routing boundaries, the 5052
`PT1M` provisioner, the dedicated 5056 and governed 5057 hosts and release
builders, their static contract suites, and the current Invoice History UI
status contract. Qualification-only browser panels, one-off credential/UAC
helpers, task XML exports, PID captures, and JSON/log attestations are not
product source. They remain either removed during reconciliation or retained
only under ignored `.tmp` evidence paths.
