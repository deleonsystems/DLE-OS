[CmdletBinding()]
param(
    [ValidateSet('Quick','Full')]
    [string] $Mode = 'Quick'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$suites = if ($Mode -eq 'Quick') {
    @(
        'Tests\SimDeveloperTools001\run-tests.ps1',
        'Tests\SimShellIsolation001\run-tests.ps1',
        'Tests\SimStateReset001\run-tests.ps1',
        'Tests\SimLanMode001\run-tests.ps1'
    )
} else {
    @(
        'Tests\SimDeveloperTools001\run-tests.ps1',
        'Tests\SimShellIsolation001\run-tests.ps1',
        'Tests\SimUiParity001\run-tests.ps1',
        'Tests\SimSyntheticIdentity001\run-tests.ps1',
        'Tests\SimStateReset001\run-tests.ps1',
        'Tests\SimOperationsCenter001\run-tests.ps1',
        'Tests\SimInvoiceHistory001\run-tests.ps1',
        'Tests\SimBroaderReadOnly001\run-tests.ps1',
        'Tests\SimVerifiedStatus001\run-tests.ps1',
        'Tests\SimWorkflowFailure001\run-tests.ps1',
        'Tests\SimDocumentsPrint001\run-tests.ps1',
        'Tests\SimDesktopVisual001\run-tests.ps1',
        'Tests\SimLanMode001\run-tests.ps1'
    )
}

$results = foreach ($suite in $suites) {
    $path = Join-Path $repo $suite
    Write-Host "Running $suite"
    try {
        & $path | ForEach-Object { Write-Host $_ }
        [pscustomobject]@{ suite = $suite; passed = $true; error = $null }
    }
    catch {
        [pscustomobject]@{ suite = $suite; passed = $false; error = $_.Exception.Message }
        throw "SIM test suite failed: $suite"
    }
}

[pscustomobject]@{
    mode = $Mode
    passed = $true
    suites = $results
} | ConvertTo-Json -Depth 6
