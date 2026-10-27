param([Parameter(Mandatory)][string]$EvidencePath,[Parameter(Mandatory)][string]$ReceiptPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'StagingPlan.psm1') -Force
$desired=Get-Content (Join-Path $PSScriptRoot 'service-proposal.json') -Raw|ConvertFrom-Json
$observed=Get-Content -LiteralPath $EvidencePath -Raw|ConvertFrom-Json
$receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json
Get-QuotingRollbackPlan $desired $observed $receipt|ConvertTo-Json -Depth 8
# Deliberately no execution mode; never deletes records or modifies live configuration.
