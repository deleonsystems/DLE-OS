[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$common = Join-Path $PSScriptRoot 'DevFrontendDeployment.Common.ps1'
$engine = Join-Path $PSScriptRoot 'Deploy-DleOsDevelopmentFrontendWindowsService.ps1'
$configuration = Join-Path $PSScriptRoot 'DleOs.DevelopmentFrontend\service-runtime.Development.json'
$evidenceRoot = Join-Path $repository '.tmp\windows-service-deployment'

. $common
$null = Assert-DleOsDevelopmentFrontendConfiguration $configuration

$before = @{}
if (Test-Path -LiteralPath $evidenceRoot) {
    Get-ChildItem -LiteralPath $evidenceRoot -Directory | ForEach-Object { $before[$_.FullName] = $true }
}

$isAdministrator = ([Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Output 'DLE-OS DEV frontend deployment'
Write-Output 'Target: DleOsDevelopmentFrontend / https://dev.dle-os.internal.dlemfg.com'

if ($isAdministrator) {
    & $engine -ApproveDevelopmentDeployment -Confirm:$false
    $exitCode = 0
} else {
    Write-Output 'Requesting one Windows elevation approval for publish and service transition...'
    $command = "& '$engine' -ApproveDevelopmentDeployment -Confirm:`$false"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    try {
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded
        ) -Verb RunAs -WindowStyle Hidden -PassThru
        # Start-Process -Wait can remain attached to processes launched during
        # an elevated service transition even after the deployment process has
        # exited. Wait on the exact elevated PID instead.
        if (-not $process.WaitForExit(1800000)) {
            throw 'The elevated DEV deployment exceeded 30 minutes.'
        }
        $process.Refresh()
        $exitCode = $process.ExitCode
    } catch {
        throw "DEV deployment elevation was not completed: $($_.Exception.Message)"
    }
}

$candidate = Get-ChildItem -LiteralPath $evidenceRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not $before.ContainsKey($_.FullName) } |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $candidate) { throw 'The deployment produced no evidence directory.' }
$evidencePath = Join-Path $candidate.FullName 'deployment.json'
if (-not (Test-Path -LiteralPath $evidencePath)) { throw "Deployment evidence is absent: $evidencePath" }
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
$verdict = if ($evidence.PSObject.Properties.Name -contains 'Verdict') { [string]$evidence.Verdict } else { 'FAIL' }

Write-Output "Evidence: $evidencePath"
Write-Output "Release: $($evidence.ReleasePath)"
Write-Output "Service PID: $($evidence.ServiceProcessId)"
if ($evidence.PSObject.Properties.Name -contains 'RuntimeIdentity') {
    Write-Output "Git HEAD: $($evidence.RuntimeIdentity.gitHead)"
    Write-Output "Source dirty: $($evidence.RuntimeIdentity.sourceDirty)"
    Write-Output "Source digest: $($evidence.RuntimeIdentity.sourceDigestSha256)"
}
Write-Output "Verdict: $verdict"
if ($evidence.PSObject.Properties.Name -contains 'Error') { Write-Output "Error: $($evidence.Error)" }

if ($exitCode -ne 0 -or $verdict -ne 'PASS') { exit 1 }
exit 0
