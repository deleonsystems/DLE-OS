[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$results = [Collections.Generic.List[object]]::new()

function Text([string]$Path) {
    Get-Content -LiteralPath (Join-Path $repo $Path) -Raw
}
function Check([string]$Name, [scriptblock]$Rule) {
    try {
        & $Rule
        $results.Add([pscustomobject]@{ Test = $Name; Result = 'PASS'; Detail = '' })
    }
    catch {
        $results.Add([pscustomobject]@{
            Test = $Name
            Result = 'FAIL'
            Detail = $_.Exception.Message
        })
    }
}
function Need([bool]$Value, [string]$Message) {
    if (-not $Value) { throw $Message }
}

$provisioner = Text 'Tools\DevelopmentRuntime\Provision-DevelopmentCanonicalApiStartupTask.ps1'
$manifest = Text 'Documentation\DEV_ENVIRONMENT_MANIFEST.md'
$startup = Text 'Documentation\DEVELOPMENT_RUNTIME_STARTUP.md'
$baseline = Text 'Documentation\DEV_STABLE_BASELINE_20260901.md'

Check '5052 authoritative provisioner uses the qualified PT1M delay' {
    Need $provisioner.Contains("`$trigger.Delay='PT1M'") 'PT1M trigger delay is absent.'
    Need (-not $provisioner.Contains("`$trigger.Delay='PT30S'")) 'Retired PT30S delay remains.'
    foreach ($required in @(
            "-UserId `$apiIdentity -LogonType Password -RunLevel Highest",
            '-StartWhenAvailable', '-ExecutionTimeLimit ([TimeSpan]::Zero)',
            '-RestartCount 10', '-RestartInterval (New-TimeSpan -Minutes 1)',
            '-MultipleInstances IgnoreNew')) {
        Need $provisioner.Contains($required) "Missing 5052 task contract: $required"
    }
}

Check 'protected 5054 ordering is documented as PT2M and release-pinned' {
    foreach ($required in @(
            '\DLE-OS DEV Operational ControlHost 5054 Candidate',
            'DLE-OS-HOST\DLE-OS-DEV-CONTROL',
            'dev5054-20260825T170328Z-4e01176a73ea',
            'PT2M')) {
        Need ($manifest.Contains($required) -or $baseline.Contains($required)) "Missing protected 5054 baseline field: $required"
    }
}

Check '5056 and 5057 unattended ownership remains execution-disabled' {
    foreach ($required in @('PT1M', 'execution-disabled', 'IgnoreNew', 'PT0S',
            'syncops5056-20260831T225016Z-91ea937d248d',
            'refreshcontrol-20260901T205619Z-8a579f9767fe')) {
        Need ($baseline.Contains($required) -or $startup.Contains($required)) "Missing 5056/5057 baseline field: $required"
    }
}

Check 'historical combined installer is not documented as current ownership' {
    Need $startup.Contains('historical bootstrap tooling') 'Historical installer warning is absent.'
    Need ($manifest.IndexOf('historical bootstrap installers', [StringComparison]::OrdinalIgnoreCase) -ge 0) 'Manifest does not protect the current task definitions.'
}

$failed = @($results | Where-Object Result -ne 'PASS')
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($failed.Count -gt 0) {
    throw "$($failed.Count) development startup contract test(s) failed."
}
Write-Host "PASS: $($results.Count) development startup contract tests."
