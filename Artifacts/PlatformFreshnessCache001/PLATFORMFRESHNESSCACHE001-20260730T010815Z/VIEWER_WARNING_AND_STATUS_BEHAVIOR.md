# Viewer Warning and Status Behavior

The Live Snapshot viewer shows:

- actual SnapshotAsOf and age;
- latest SourceCheckedAt and age;
- QualificationCompletedAt and age;
- served and loaded frontend build IDs;
- LIVE API contract version;
- readiness state, warnings, and hard failures.

Warning-only Ready states leave the entity controls and all nine sections
usable. Wording states that the viewer is a qualified snapshot and not
real-time ERP synchronization.

Hard NotReady states block entity requests. No historical-to-LIVE fallback is
introduced.

The ordinary `Run ERP Snapshot Refresh` button remains normal mode. Force-full
is not selected by the browser. Invoice History refresh remains independent.
