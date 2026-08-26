[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevation required.' }

$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$expectedLegacyHash = 'A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'
$outputPath = Join-Path $PSScriptRoot 'dev5054-candidate-failure-containment.json'

function Get-TextSha256([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}

$candidateBefore = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$candidateInfoBefore = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$candidateXmlBefore = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyXmlBefore = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashBefore = Get-TextSha256 $legacyXmlBefore
if ($legacyHashBefore -ne $expectedLegacyHash) { throw 'Legacy task differs from the qualified baseline; containment stopped without changes.' }

$listenerBefore = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue)
if ($candidateBefore.State -eq 'Running' -or $listenerBefore.Count -gt 0) {
    Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue
}
Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName | Out-Null

$candidateAfter = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$candidateInfoAfter = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$candidateXmlAfter = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyXmlAfter = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashAfter = Get-TextSha256 $legacyXmlAfter
$listenerAfter = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue)

$taskEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-TaskScheduler/Operational'; StartTime = $candidateInfoBefore.LastRunTime.AddMinutes(-1) } -ErrorAction SilentlyContinue | Where-Object {
    $_.Message -match [regex]::Escape($candidateName)
} | Select-Object TimeCreated, RecordId, Id, LevelDisplayName, Message)
$applicationEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $candidateInfoBefore.LastRunTime.AddMinutes(-1) } -ErrorAction SilentlyContinue | Where-Object {
    $_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea' -or $_.ProviderName -in '.NET Runtime','Application Error','Windows Error Reporting'
} | Select-Object TimeCreated, RecordId, Id, ProviderName, LevelDisplayName, Message)

$result = [ordered]@{
    Schema = 'dle-os.dev5054-candidate-failure-containment.v1'
    CapturedUtc = [DateTimeOffset]::UtcNow
    ElevatedIdentity = $identity.Name
    CandidateBefore = [ordered]@{
        State = [string]$candidateBefore.State
        Enabled = [bool]$candidateBefore.Settings.Enabled
        LastRunTime = $candidateInfoBefore.LastRunTime
        LastTaskResult = [int64]$candidateInfoBefore.LastTaskResult
        XmlSha256 = Get-TextSha256 $candidateXmlBefore
        ExecutionTimeLimit = [string]$candidateBefore.Settings.ExecutionTimeLimit
        MultipleInstances = [string]$candidateBefore.Settings.MultipleInstances
        RestartCount = $candidateBefore.Settings.RestartCount
        RestartInterval = [string]$candidateBefore.Settings.RestartInterval
        StopIfGoingOnBatteries = $candidateBefore.Settings.StopIfGoingOnBatteries
        DisallowStartIfOnBatteries = $candidateBefore.Settings.DisallowStartIfOnBatteries
    }
    ListenerBeforeCount = $listenerBefore.Count
    CandidateAfter = [ordered]@{
        State = [string]$candidateAfter.State
        Enabled = [bool]$candidateAfter.Settings.Enabled
        LastRunTime = $candidateInfoAfter.LastRunTime
        LastTaskResult = [int64]$candidateInfoAfter.LastTaskResult
        XmlSha256 = Get-TextSha256 $candidateXmlAfter
    }
    ListenerAfterCount = $listenerAfter.Count
    LegacyHashBefore = $legacyHashBefore
    LegacyHashAfter = $legacyHashAfter
    LegacyUnchanged = $legacyHashBefore -eq $legacyHashAfter
    TaskEvents = $taskEvents
    ApplicationEvents = $applicationEvents
    CandidateXmlBefore = $candidateXmlBefore
    CandidateXmlAfter = $candidateXmlAfter
}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding utf8
$result | Select-Object CapturedUtc, ElevatedIdentity, CandidateBefore, ListenerBeforeCount, CandidateAfter, ListenerAfterCount, LegacyHashBefore, LegacyHashAfter, LegacyUnchanged | ConvertTo-Json -Depth 6

if ($candidateAfter.Settings.Enabled -or $candidateAfter.State -eq 'Running' -or $listenerAfter.Count -ne 0 -or $legacyHashAfter -ne $legacyHashBefore) {
    throw 'Candidate failure containment did not reach the required safe state.'
}
