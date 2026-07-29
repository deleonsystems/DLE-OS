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
    throw 'Process inspection requires the non-elevated DLE-OS operator.'
}

$processes = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -ieq 'vpro5.exe' -or
            (
                $_.Name -ieq 'powershell.exe' -and
                $_.CommandLine -like '*InvoiceHistoryBoundedWindow*'
            )
        } |
        Select-Object ProcessId, ParentProcessId, Name, CreationDate,
            CommandLine
)
[ordered]@{
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    WindowsIdentity = $identity.Name
    Elevated = $false
    Processes = $processes
} |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (
        'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
        'InvoiceHistoryRefresh001\' +
        'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
        'QUALIFICATION_PROCESS_STATE.json'
    ) -Encoding UTF8
