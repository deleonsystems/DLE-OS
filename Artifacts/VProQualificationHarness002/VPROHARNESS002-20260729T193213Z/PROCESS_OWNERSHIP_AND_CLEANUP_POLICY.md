# Process Ownership and Cleanup Policy

The harness captures `System.Diagnostics.Process` directly at compiler and
qualifier launch. Its ledger records PID, UTC start time, resolved executable,
arguments, parent wrapper PID, role, mission, and attempt. Before any cleanup,
PID reuse is excluded by comparing both start time and executable path.

Failure cleanup writes the local graceful signal (or attempts
`CloseMainWindow`), waits the configured bound, then may force-stop only that
verified PID. Order is qualifier, launcher children, wrapper. The runner never
uses `Stop-Process -Name`, `taskkill /IM`, or a process-name search for
termination.

The 30-scenario suite proved graceful success, exact-PID forced cleanup,
survival of unrelated VPro-equivalent and PowerShell fixtures, and zero
mission-owned processes after every failed attempt. Live attempts likewise
ended with zero owned processes.
