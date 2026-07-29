[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Waiter cleanup requires the non-elevated DLE-OS operator.'
}

$vpro = @(Get-CimInstance Win32_Process -Filter "Name = 'vpro5.exe'")
if ($vpro.Count -ne 0) {
    throw 'A VPro process exists; the PowerShell waiter will not be stopped.'
}
$matches = @(
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object CommandLine -Like (
            '*Invoke-InvoiceHistoryBoundedWindowQualification.ps1*')
)
if ($matches.Count -ne 1) {
    throw "Expected one stale qualification waiter; found $($matches.Count)."
}

$evidence =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
    'STALE_WAITER_CLEANUP.json'
[ordered]@{
    StoppedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    WindowsIdentity = $identity.Name
    Elevated = $false
    ProcessId = $matches[0].ProcessId
    CommandLine = $matches[0].CommandLine
    VproProcessesActive = 0
    SourceProcessTerminated = $false
    Reason = 'VPro exited normally; stale PowerShell WaitForExit wrapper remained.'
} |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $evidence -Encoding UTF8

Stop-Process -Id $matches[0].ProcessId -ErrorAction Stop
