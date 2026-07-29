[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigurationPath)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'VProQualificationHarness.psm1') -Force
$configuration = Get-Content -Raw -LiteralPath $ConfigurationPath | ConvertFrom-Json
$maximumRetries = if ($configuration.Retry) {
    [Math]::Min(1, [Math]::Max(0, [int]$configuration.Retry.MaximumAutomaticRetries))
} else { 0 }
$retryable = if ($configuration.Retry) { @($configuration.Retry.RetryableCategories) } else { @() }
$history = @()
$result = Invoke-VProQualificationHarness -ConfigurationPath $ConfigurationPath
$history += [ordered]@{
    AttemptId=$result.AttemptId; Verdict=$result.Verdict
    FailureCategory=$result.FailureCategory
}
if ($result.Verdict -eq 'FAILED' -and $maximumRetries -eq 1 -and
    $retryable -contains $result.FailureCategory -and
    $result.SourceIdentityStable -and $result.SourceWrites -eq 0 -and
    $result.SourceLocks -eq 0 -and $result.MissionOwnedProcessesRemaining -eq 0) {
    $result = Invoke-VProQualificationHarness -ConfigurationPath $ConfigurationPath
    $history += [ordered]@{
        AttemptId=$result.AttemptId; Verdict=$result.Verdict
        FailureCategory=$result.FailureCategory
    }
}
$result | Add-Member -NotePropertyName RetryHistory -NotePropertyValue $history -Force
$result | ConvertTo-Json -Depth 12
if ($result.Verdict -in @('PASS','PASS WITH CLARIFICATIONS')) { exit 0 }
if ($result.Verdict -eq 'ALREADY_RUNNING') { exit 3 }
if ($result.Verdict -eq 'BLOCKED') { exit 2 }
exit 1
