[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Artifact
)
$ErrorActionPreference = 'Stop'
switch ($Scenario) {
    'nonzero' { Write-Error 'controlled compiler failure'; exit 7 }
    'error-text' { Write-Output 'ERROR controlled misleading success'; }
    'fatal-text' { Write-Output 'fatal controlled misleading success'; }
    'missing' { Write-Output 'compile complete'; exit 0 }
    default {
        $bytes = [Text.Encoding]::ASCII.GetBytes(
            "MOCK-COMPILED-ARTIFACT-$Scenario-" + (Get-Content -Raw $Source))
        [IO.File]::WriteAllBytes($Artifact, $bytes)
        if ($Scenario -eq 'stale-time') {
            (Get-Item $Artifact).LastWriteTimeUtc = [DateTime]::UtcNow.AddDays(-1)
        }
        Write-Output 'compile complete'
    }
}
exit 0
