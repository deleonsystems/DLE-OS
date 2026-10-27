param([Parameter(Mandatory)][string]$EvidencePath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'StagingPlan.psm1') -Force
$desired=Get-Content (Join-Path $PSScriptRoot 'service-proposal.json') -Raw|ConvertFrom-Json
$observed=Get-Content -LiteralPath $EvidencePath -Raw|ConvertFrom-Json
Get-QuotingInstallPlan $desired $observed|ConvertTo-Json -Depth 8
# Deliberately no execution mode. Printed plan is not installation authorization.
