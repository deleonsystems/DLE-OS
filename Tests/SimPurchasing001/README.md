# SIM Purchasing to Expected Receiving qualification

The integration suite copies a supplied SIM checkpoint to a unique repository-local temporary directory using a read-only SQLite backup. Only the new Purchasing tables are reset in that disposable copy, allowing repeatable tests after the live purchase. All buyer commands run in the copy. The supplied checkpoint must contain the submitted E2E-SIM-001 Kitting shortage (WO 0999999, SIM-OPTO-4, short 8). It never purchases or receives against the live checkpoint.

```powershell
dotnet build Tests/SimPurchasing001/SimPurchasing001.csproj -o tmp/purchasing/tests-bin
dotnet tmp/purchasing/tests-bin/SimAnalysis001.dll C:\DLE-OS\Repositories\DLE-OS C:\DLE-OS\Repositories\DLE-OS\.sim-state
node Tests/SimPurchasing001/run-ui-tests.mjs
node Tests/SimPurchasing001/run-receiving-ui-tests.mjs
```

The server suite verifies immutable submitted demand, explicit reviewed traceability, authoritative customer due date, acceptance permissions/versioning, idempotency, coverage reservations, independent buy quantity, readiness invalidation, retained developmental PO lines, exact decimal cost, expected receipts and protected Kitting/canonical/RFQ state. UI suites use in-memory fixtures and perform no live operations.

Purchasing records and expected receipts are explicitly `SIMULATED_DEVELOPMENTAL`. Expected material has received quantity zero and open quantity equal to ordered quantity. There is no physical receiving command, VPRO write, supplier communication, inventory allocation, or Kitting completion transition in this slice.

Pack/UOM conversions and reconciliation of changed source submissions require separate reviewed workflows. Source changes block further buying and retain history. The grouped coverage data contract is supported; the first live scenario remains one demand for eight units.
