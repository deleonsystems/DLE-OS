# E2E-SIM-001 customer prerequisite

Recorded before implementation on 2026-09-20.

Component: `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeEndpoints.cs`, static `Customers` array used by the SIM `/api/platform/live/v1/customer-directory/search` endpoint.

Add one record: customerId `SIM-CUSTOMER-E2E-001`, customerNumber `990901`, customerName `DLE-SIM-CUSTOMER`, aliases `E2E-SIM-001` and `Synthetic Electronics Lab`, sources `E2E-SIM-001 synthetic fixture`, synthetic `true`. Preserve Abbott unchanged. These are fixture identifiers, not new production customer IDs.

Isolation: this array is compiled into DleOs.SimHost only. The endpoint filters an in-memory array and returns environment SIM; it performs no database, ERP, directory or network write. The SIM runtime rejects production connection configuration. No real customer service or data file is affected. Customer 990901 was absent from this SIM directory before the change.

Disposition: retain as a version-controlled SIM fixture throughout the mission. Removing the array entry later removes future selection, not persisted historical intake identities. Do not reset the active SIM state as cleanup. Preserve the alias-to-canonical mapping in the scenario checkpoint record.

Validation plan: compile the SIM host; run existing isolated intake qualification; restart the same SIM runtime through its governed launcher without resetting business data; query the real customer-directory endpoint for name, number and alias; verify Abbott still resolves and business data hashes remain unchanged.
