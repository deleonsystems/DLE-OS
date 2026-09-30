# WO operation editor refinement

WO instruction and Work Center/Department edits are optional `OperationContent` overlays on immutable source operations. Read projections inherit the approved shop instruction when present, otherwise the original source instruction; old records are never migrated on read. Editing sends fields keyed to existing active operation IDs. Unchanged source defaults do not create override records. An explicit empty instruction is a reviewed removal; omitted fields/older requests retain current overlays.

Each changed operation carries a stable content ID, revision ID, operation ID and creation/update actor/time. New revisions retain content identity and rebind revision linkage. Input limits are 8000 characters for instructions and 120 for Work Center/Department, with control characters rejected for assignment fields. No governed work-center catalog was found in this path, so assignment is controlled text rather than a new master list.

Source operation payloads remain immutable; validation still compares them to the original frozen binding. WO overlays participate in dual comparisons, typed audit events and the existing version/lease/reason/technical-review/approval checks. Effective projection/print uses the approved overlay; unsaved or draft changes never alter the effective Traveler. The persisted pre-start execution guard remains unchanged.

The expanded area is ordered: Traveler Instructions; Substeps; Production Notes/Clarifications; Source/Team/Traveler Visuals; Work Center/Department; read-only Planning Reference; Technical References; collapsed Source Instruction; collapsed Source Information/History. Team evidence remains separate from controlled instructions, and metadata remains out of the collapsed row. The disclosure opens this editor; + adds contextual content. Existing grouped drag and keyboard reorder are retained. Substep Up/Down remains parent-scoped.

No quote, Labor time, technical authority, BOM, material status or Production execution changes are made by the editor. PDFs show effective instruction, assignment and controlled content with non-controlled-copy markings. Team Input is not printed by default.
