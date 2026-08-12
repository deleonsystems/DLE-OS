$leasePath = 'C:\ProgramData\DLE-OS\SyncOperations\lease.json'
if (Test-Path -LiteralPath $leasePath) {
    try { $syncLease = Get-Content -LiteralPath $leasePath -Raw | ConvertFrom-Json }
    catch { throw 'A machine-wide synchronization lease exists but is unreadable; failing closed.' }
    if ([string]$syncLease.RunId -cne [string]$env:DLE_OS_SYNC_OPERATIONS_RUN_ID) {
        throw "ALREADY_RUNNING: governed Sync Operations run $($syncLease.RunId) owns the canonical-changing lease."
    }
}
