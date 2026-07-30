[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    'Artifacts\EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z')
$attemptRoot = (
    'C:\Add-On\Lab\VProQualificationHarness\EmployeeReference\Attempts\' +
    'EMPLOYEE_REFERENCE_PLATFORM_001-20260730T131048478Z-DFA23999')

$historical = Invoke-RestMethod (
    'http://DLE-OS-HOST:5041/api/platform/v1/readiness') -TimeoutSec 10
$live = Invoke-RestMethod (
    'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness') -TimeoutSec 10
$employee = Invoke-RestMethod (
    'http://DLE-OS-HOST:5042/api/platform/live/v1/' +
    'employee-reference/metadata') -TimeoutSec 10
$refreshHealth = Invoke-RestMethod (
    'http://DLE-OS-HOST:5043/health') -UseDefaultCredentials -TimeoutSec 10
$erpStatus = Invoke-RestMethod (
    'http://DLE-OS-HOST:5043/api/platform/refresh/v1/status') `
    -UseDefaultCredentials -TimeoutSec 10
$invoiceStatus = Invoke-RestMethod (
    'http://DLE-OS-HOST:5043/api/platform/refresh/invoice-history/v1/status') `
    -UseDefaultCredentials -TimeoutSec 10
$attempt = Get-Content -Raw (Join-Path $attemptRoot 'attempt-verdict.json') |
    ConvertFrom-Json
$listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort 5041, 5042, 5043, 5044 |
        Select-Object LocalPort, OwningProcess |
        Sort-Object LocalPort
)

$evidence = [ordered]@{
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Ports = @($listeners | ForEach-Object {
        [ordered]@{
            Port = [int]$_.LocalPort
            ProcessId = [int]$_.OwningProcess
        }
    })
    HistoricalReadiness = $historical
    LiveReadiness = $live
    EmployeeReferenceMetadata = $employee
    RefreshControlHealth = $refreshHealth
    ErpRefreshStatus = $erpStatus
    InvoiceHistoryRefreshStatus = $invoiceStatus
    SourceSafety = [ordered]@{
        AttemptId = $attempt.AttemptId
        Identity = $attempt.Identity
        Elevated = $attempt.Elevated
        Mode = $attempt.SourceAccessMode
        IdentityStable = $attempt.SourceIdentityStable
        Writes = $attempt.SourceWrites
        Locks = $attempt.SourceLocks
        MissionOwnedProcessesRemaining = $attempt.MissionOwnedProcessesRemaining
    }
}

$ports = @($listeners.LocalPort)
$passed = (
    @($ports | Where-Object { $_ -in 5041, 5042, 5043, 5044 }).Count -eq 4 -and
    $historical.status -eq 'Ready' -and
    $live.readinessVerdict -eq 'Ready' -and
    $employee.employeeCount -eq 11 -and
    $employee.employeeReferenceImportRunId -eq
        '783a4bc2-1871-4dfb-ad7a-e0beea797841' -and
    $refreshHealth.status -eq 'Ready' -and
    $refreshHealth.authorized -eq $true -and
    $attempt.SourceAccessMode -eq 'O_RDONLY' -and
    $attempt.SourceIdentityStable -eq $true -and
    $attempt.SourceWrites -eq 0 -and
    $attempt.SourceLocks -eq 0 -and
    $attempt.MissionOwnedProcessesRemaining -eq 0
)
$evidence['Verdict'] = if ($passed) { 'PASS' } else { 'FAIL' }

$path = Join-Path $artifactRoot (
    'EMPLOYEE_REFERENCE_RUNTIME_REGRESSION.json')
$evidence | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $path -Encoding UTF8
$evidence | ConvertTo-Json -Depth 12

if (-not $passed) {
    throw 'Employee Reference runtime regression failed.'
}
