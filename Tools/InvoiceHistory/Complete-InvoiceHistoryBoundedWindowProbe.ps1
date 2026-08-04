[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Probe completion requires the non-elevated DLE-OS operator.'
}

$summary =
    'C:\Add-On\Lab\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z\BOUNDED_SUMMARY.csv'
$evidence =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
    'BOUNDED_PROBE_GRACEFUL_CLOSE.json'
if (-not (Test-Path -LiteralPath $summary -PathType Leaf)) {
    throw 'The bounded probe has not produced its summary.'
}
$summaryText = Get-Content -LiteralPath $summary -Raw
if (
    $summaryText -match '(?im)^failure,' -or
    $summaryText -notmatch '(?im)^open_mode,O_RDONLY\s*$'
) {
    throw 'The bounded probe summary is incomplete or reports failure.'
}

$matches = @(
    Get-CimInstance Win32_Process -Filter "Name = 'vpro5.exe'" |
        Where-Object CommandLine -Like (
            '*INVOICE_HISTORY_BOUNDED_WINDOW_PROBE*')
)
if ($matches.Count -ne 1) {
    throw "Expected one owned bounded-probe VPro process; found $($matches.Count)."
}

$process = Get-Process -Id $matches[0].ProcessId -ErrorAction Stop
$closeAccepted = $process.CloseMainWindow()
[ordered]@{
    RequestedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    WindowsIdentity = $identity.Name
    Elevated = $false
    ProcessId = $process.Id
    CommandLine = $matches[0].CommandLine
    Method = 'CloseMainWindow'
    Accepted = $closeAccepted
    ForcedTermination = $false
} |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $evidence -Encoding UTF8

if (-not $closeAccepted) {
    throw 'The owned probe did not accept a normal window-close request.'
}
