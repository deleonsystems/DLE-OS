# Operations Refresh Progress Fields

The existing Operations Refresh status response was extended with:

| Field | Meaning |
|---|---|
| `OperationsRefreshRunId` | Governed coordinated run identity |
| `OverallStatus` | `Running` or the terminal coordinated result |
| `CurrentStepNumber` | One-based active step; zero after completion |
| `TotalSteps` | Fixed value of three |
| `CurrentDataset` | Operator-facing active dataset name |
| `CurrentPhase` | Genuine runner phase boundary |
| `RecordsProcessed` | Existing or cheaply available count; null when unknown |
| `RecordsExpected` | Existing total count; null when unknown |
| `StartedAt` | Coordinated run start timestamp |
| `LastProgressAt` | Timestamp of the last phase/counter/step change |
| `ElapsedSeconds` | Elapsed coordinated runtime |
| `LastCompletedRunDurationSeconds` | Prior terminal run duration while active; current duration after completion |
| `StepResults` | Results for completed steps only |

The control host merges only the current child runner's fixed local status path
while the coordinated run is active. It does not inspect processes, SQL, VPro,
X:, mirror packages, or arbitrary paths.

Progress writes occur at phase changes. The bounded Open Sales Order extractor
also emits local status at the already-existing transitions into line reading
and bounded Work Order resolution. It validates the refresh run identity before
replacing the local status file.

The browser polling interval is 3,000 milliseconds. Polling stops when the
coordinated result is no longer `Running`.

