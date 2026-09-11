# SIM labor-first Technical Review experiment

Fresh fixture: **RFQI-SIM-0034**, Abbott, assembly
`LABOR-FIRST-SIM-EXPERIMENT`, revision A, quantity 1, Material + Labor scope.
Created through the existing `/api/sim/rfq-intakes` endpoint, without claiming
technical documents are attached. Correlation ID:
`8fe776af-77f8-49e6-84c8-8eb4d489c9f1` (intake creation is idempotent).

Previously, Start Technical Review unconditionally continued into assembly
history and the materials/package/BOM path. New quote requests now initialize
the existing TechnicalReview model with `reviewPhaseOrder` containing
`MANUFACTURING_LABOR_REVIEW`, then `MATERIAL_BOM_REVIEW`. Both phase statuses
start at `NOT_STARTED`; existing `nextReviewPhase` identifies manufacturing.
No separate workflow store is introduced. New Order initialization is unchanged.

Start uses the existing disposition endpoint and persists manufacturing
`IN_PROGRESS`, overall `TECHNICAL_REVIEW_IN_PROGRESS`, and reviewer/time context.
Materials remain `NOT_STARTED` until the assembly-type gate is saved. Repeated
Start preserves the same record. The selected-item screen has one Start
Technical Review action, No Longer Required, and the existing phase summary.

The first prompt is **What type of assembly is this?** PCB Assembly is the only
supported answer. Save and continue uses the permission-checked PUT endpoint
`/api/sim/technical-reviews/{intakeId}/assembly-type` and persists the existing
structured `assemblyType` field as `PCB_ASSEMBLY`. Invalid answers are rejected;
repeating the same save is idempotent. Saving moves `nextReviewPhase` to
`MATERIAL_BOM_REVIEW` and its status to `IN_PROGRESS`, while manufacturing and
overall Technical Review remain in progress.

After saving, the UI resumes the original guided assembly-history, technical
package, governing BOM and Candidate BOM implementation. No second review shell
is introduced. Reopening displays the saved assembly type; Start skips the
answered gate. RFQI-SIM-0034 has no matching assembly history, so its first
baseline question is **Have we built this assembly before?** Existing eligibility
and package rules remain in effect. No further manufacturing questions,
feasibility, costing or completion are implemented.

Records without the new phase-order field retain their existing path. All five
pre-existing records compare unchanged after creating and starting the fixture,
including RFQI-SIM-0033 and its immutable BOM acceptance. New optional fields
are omitted when null to avoid adding them to legacy persisted records.

Implementation changes:

- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeStore.cs`: phase order and manufacturing
  status, new-quote initialization, Start and assembly-type persistence.
- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeEndpoints.cs`: assembly-type endpoint.
- `SRC/workspaces/technical-review/technical-review-workspace.js`: labor-first
  compact summary, assembly-type question and existing baseline continuation.
- `Tests/SimTechnicalReview001/run-phase-handoff-tests.mjs`: new-ordering, Start,
  gate validation, save failure/success and reopen regressions, alongside legacy checks.

Validation: SimHost build passed with zero warnings/errors. Technical Review,
accepted BOM, guided review, Candidate BOM, Intake and New Order UI suites passed.
Actual SIM API checks verified fresh initialization, deletion eligibility,
persisted Start, idempotent repeated Start, unchanged older records and
`READY / SIM / PRIVATE_LAN_HTTPS` on port 5177. No reset or migration was used.

Assembly-gate qualification: all nine relevant UI suites passed and the build
had zero warnings/errors. Actual API checks confirmed invalid-answer rejection,
idempotence and PCB Assembly survival through an isolated SIM restart. All five
unrelated records, including RFQI-SIM-0033, compare unchanged against the
pre-gate dataset. Edge visually confirmed the single Start action and new
assembly-type question on 5177 before restart. The final post-restart visual
continuation requires browser sign-in; API persistence and readiness are verified.

Unrelated DNS-script hash remains
`432365720BB96E549233466B5A6EEE24FF25D5EDDA6382DA8D56D8C96F5D886E`.
Branch remains `feature/miguel-new-order-intake`, HEAD `9984fa7`.
Existing uncommitted work is preserved. No commit/push or DEV/LIVE action.
