[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $repository
try {
    foreach ($test in @('run-new-order-navigation-tests.mjs','run-new-order-ui-contract-tests.mjs','run-back-navigation-tests.mjs')) {
        & node (Join-Path $PSScriptRoot $test)
        if ($LASTEXITCODE -ne 0) { throw "Failed: $test" }
    }
    # Copy the E2E checkpoint into an isolated test root. Never reset or rewrite the live dataset.
    $testOutput = Join-Path $repository ('tmp\quoted-new-order-' + [guid]::NewGuid().ToString('N'))
    $buildOutput = Join-Path $testOutput 'build'
    & dotnet build Tests/SimNewOrder001 --no-restore -o $buildOutput -p:UseAppHost=false
    if ($LASTEXITCODE -ne 0) { throw 'New Order test build failed.' }
    & dotnet (Join-Path $buildOutput 'SimAnalysis001.dll') (Join-Path $repository '.sim-state') (Join-Path $testOutput 'state')
    if ($LASTEXITCODE -ne 0) { throw 'New Order isolated server checks failed.' }
} finally { Pop-Location }
