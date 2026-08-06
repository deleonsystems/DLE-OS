[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$requiredIdentity = 'DLE-OS-HOST\DLE-OS'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$evidenceDirectory = Join-Path $repository '.tmp\authenticated-frontend'
$logPath = Join-Path $evidenceDirectory 'phase3-service-module-tests.log'
$resultPath = Join-Path $evidenceDirectory 'phase3-service-module-tests.json'
$errorPath = Join-Path $evidenceDirectory 'phase3-service-module-tests.error.log'

try {

if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $requiredIdentity) {
    throw "Service module tests require $requiredIdentity."
}

New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
Set-Location -LiteralPath $repository
$projects = @(
    'Tests\ShipmentStagingReconciliation001\DleOs.ShipmentStagingReconciliation.Tests.csproj',
    'Tests\WorkOrderApproval001\DleOs.WorkOrderApproval.Tests.csproj'
)
$results = @()
foreach ($project in $projects) {
    $lines = @(& dotnet.exe run --project (Join-Path $repository $project) `
        -c Release --no-build 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $lines | Add-Content -LiteralPath $logPath -Encoding utf8
    $results += [ordered]@{ Project = $project; ExitCode = $exitCode; Output = $lines }
    if ($exitCode -ne 0) { throw "Service module test failed: $project" }
}

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Results = $results
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
}
catch {
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    ($_ | Out-String) | Set-Content -LiteralPath $errorPath -Encoding utf8
    throw
}
