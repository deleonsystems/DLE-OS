[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevation required.' }
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot 'dev5054-execution-limit-repair.transcript.log') -Force | Out-Null

$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$launcher = Join-Path $release 'Start-DevOperationalControlHost5054.ps1'
$expectedLegacyHash = 'A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'
$outputPath = Join-Path $PSScriptRoot 'dev5054-candidate-execution-limit-repair.json'

function Get-TextSha256([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}
function Get-ComparableXml([string]$Text) {
    [xml]$xml = $Text
    $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $node = $xml.SelectSingleNode('/t:Task/t:Settings/t:ExecutionTimeLimit', $ns)
    if (-not $node) { throw 'ExecutionTimeLimit is absent from the task XML.' }
    $node.InnerText = '<EXECUTION_TIME_LIMIT>'
    return $xml.OuterXml
}

$task = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$info = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$beforeXml = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyBeforeXml = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyBeforeHash = Get-TextSha256 $legacyBeforeXml
$action = @($task.Actions)[0]
$candidateSid = [string]([Security.Principal.NTAccount]::new($task.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]))
$runtimeSid = [string]([Security.Principal.NTAccount]::new($runtimeIdentity).Translate([Security.Principal.SecurityIdentifier]))

if ($legacyBeforeHash -ne $expectedLegacyHash) { throw 'Legacy task differs from the qualified baseline.' }
if ($task.State -ne 'Disabled' -or $task.Settings.Enabled) { throw 'Candidate must be disabled before the one-field repair.' }
if ($candidateSid -ne $runtimeSid -or $task.Principal.LogonType -ne 'Password' -or $task.Principal.RunLevel -ne 'Limited') { throw 'Candidate principal differs from the qualified definition.' }
if ($action.Execute -ine 'powershell.exe' -or $action.Arguments -notmatch [regex]::Escape($launcher) -or $action.WorkingDirectory -ine $release) { throw 'Candidate action differs from the qualified definition.' }
if ([string]$task.Settings.ExecutionTimeLimit -ne 'PT5M') { throw "Expected PT5M execution limit, found $($task.Settings.ExecutionTimeLimit)." }
if ([int64]$info.LastTaskResult -ne 267014) { throw "Expected termination result 0x41306, found $($info.LastTaskResult)." }

$task.Settings.ExecutionTimeLimit = 'PT0S'
Set-ScheduledTask -InputObject $task | Out-Null

$after = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$afterXml = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyAfterXml = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyAfterHash = Get-TextSha256 $legacyAfterXml
$onlyExpectedFieldChanged = (Get-ComparableXml $beforeXml) -ceq (Get-ComparableXml $afterXml)
$passed = $after.State -eq 'Disabled' -and -not $after.Settings.Enabled -and [string]$after.Settings.ExecutionTimeLimit -eq 'PT0S' -and $onlyExpectedFieldChanged -and $legacyAfterHash -eq $legacyBeforeHash

$result = [ordered]@{
    Schema = 'dle-os.dev5054-candidate-execution-limit-repair.v1'
    CapturedUtc = [DateTimeOffset]::UtcNow
    ElevatedIdentity = $identity.Name
    BeforeExecutionTimeLimit = 'PT5M'
    AfterExecutionTimeLimit = [string]$after.Settings.ExecutionTimeLimit
    CandidateXmlSha256Before = Get-TextSha256 $beforeXml
    CandidateXmlSha256After = Get-TextSha256 $afterXml
    OnlyExecutionTimeLimitChanged = $onlyExpectedFieldChanged
    CandidateRemainsDisabled = $after.State -eq 'Disabled' -and -not $after.Settings.Enabled
    LegacyHashBefore = $legacyBeforeHash
    LegacyHashAfter = $legacyAfterHash
    LegacyUnchanged = $legacyAfterHash -eq $legacyBeforeHash
    Passed = $passed
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8
$result | ConvertTo-Json -Depth 8
if (-not $passed) { throw 'The one-field execution-limit repair did not preserve all required invariants.' }
