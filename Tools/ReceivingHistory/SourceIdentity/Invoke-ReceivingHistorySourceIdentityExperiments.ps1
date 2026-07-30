[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('A','B','C','D','E','F','G')]
    [string]$Experiment,

    [Parameter(Mandatory)]
    [string]$EvidenceRoot
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$harness = Join-Path $repositoryRoot 'Tools\VProQualificationHarness\Invoke-VProQualificationHarness.ps1'
$source = Join-Path $PSScriptRoot 'RECEIVING_HISTORY_SOURCE_IDENTITY_EXPERIMENT.src'
$attemptRoot = 'C:\Add-On\Lab\VProQualificationHarness\ReceivingHistorySourceIdentity'
$sources = @(
    'X:\AON\ADATA\POT-03',
    'X:\AON\ADATA\POT-04',
    'X:\AON\ADATA\POT-14'
)
$limits = @{ A = 0; B = 0; C = 1; D = 100; E = 0; F = 0; G = 0 }

function Get-SourceFileSystemIdentity {
    @(
        foreach ($path in $sources) {
            $item = Get-Item -LiteralPath $path -Force
            [ordered]@{
                Path = $item.FullName
                Length = [long]$item.Length
                CreationTimeUtc = $item.CreationTimeUtc.ToString('O')
                LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
                Attributes = $item.Attributes.ToString()
                ObservedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
            }
        }
    )
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
$elevated = $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($identity -ine 'DLE-OS-HOST\DLE-OS') {
    throw "Required identity is not active: $identity"
}
if ($elevated) {
    throw 'The source-identity experiment must run non-elevated.'
}
if (-not (Test-Path -LiteralPath 'X:\')) {
    throw 'The existing mapped X: drive is unavailable.'
}
foreach ($path in $sources) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required fixed source is unavailable: $path"
    }
}

$allProcesses = @(Get-CimInstance Win32_Process)
$excludedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$excludedProcessIds.Add($PID)
$ancestorId = @($allProcesses | Where-Object ProcessId -eq $PID)[0].ParentProcessId
while ($ancestorId -and $excludedProcessIds.Add([int]$ancestorId)) {
    $ancestor = @($allProcesses | Where-Object ProcessId -eq $ancestorId)
    if ($ancestor.Count -eq 0) { break }
    $ancestorId = $ancestor[0].ParentProcessId
}
$overlap = @($allProcesses | Where-Object {
    -not $excludedProcessIds.Contains([int]$_.ProcessId) -and (
        $_.Name -ieq 'vpro5.exe' -or
        $_.CommandLine -match 'ReceivingHistorySourceIdentity|RECEIVING_HISTORY_SOURCE_IDENTITY'
    )
})
if ($overlap.Count -gt 0) {
    throw ('Overlapping Visual PRO/5 or Receiving History identity process: ' +
        (($overlap | ForEach-Object ProcessId) -join ', '))
}

$evidencePath = [IO.Path]::GetFullPath($EvidenceRoot)
New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
$before = Get-SourceFileSystemIdentity

$configRoot = Join-Path $attemptRoot 'GeneratedConfigurations'
New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
$configPath = Join-Path $configRoot ("Experiment-{0}.json" -f $Experiment)
$mission = "RECEIVING_HISTORY_SOURCE_IDENTITY_{0}" -f $Experiment
$configuration = [ordered]@{
    ContractVersion = '1.0'
    MissionName = $mission
    QualifierSource = $source
    RequiredIdentity = 'DLE-OS-HOST\DLE-OS'
    RequireNonElevated = $true
    RequiredMappedPaths = @('X:\')
    RequiredSourcePaths = $sources
    AttemptRoot = $attemptRoot
    VariableEffectiveLength = 16
    SourceReplacements = [ordered]@{
        '__RUN_ID__' = '{ATTEMPT_ID}'
        '__LAB_RUNTIME__' = '{RUNTIME}'
        '__EXPERIMENT_CODE__' = $Experiment
        '__READ_LIMIT__' = [string]$limits[$Experiment]
    }
    Retry = [ordered]@{
        MaximumAutomaticRetries = 0
        RetryableCategories = @()
    }
    Compiler = [ordered]@{
        Executable = 'C:\BASIS\VPRO5\pro5cpl.exe'
        Arguments = @('-d{PROGRAMS}', '{SOURCE}')
        EmittedArtifactName = 'RECEIVING_HISTORY_SOURCE_IDENTITY_EXPERIMENT.src'
        ExpectedArtifactName = 'RECEIVING_HISTORY_SOURCE_IDENTITY_EXPERIMENT'
        MinimumArtifactBytes = 32
        FailurePatterns = @('(?i)\berror\b', '(?i)\bfatal\b')
        KnownStaleHashes = @()
    }
    Runtime = [ordered]@{
        Executable = 'C:\BASIS\VPRO5\vpro5.exe'
        Arguments = @(
            '-tT0', '-nT0', '-m1024', '-c{CONFIG}',
            'RECEIVING_HISTORY_SOURCE_IDENTITY_EXPERIMENT'
        )
        ConfigurationLines = @(
            'ALIASES=4', 'FCBS=64', 'CIBS=64', 'STBLEN=12000',
            'PREFIX {PROGRAMS_POSIX}/ C:/BASIS/VPRO5/',
            'SETOPTS 0000000000000000', 'ALIAS T0 SYSWINDOW ""'
        )
        Directories = @()
        AdapterType = 'MARKER_FILES'
        StartedMarker = 'IDENTITY_OBSERVATIONS.csv'
        ProgressMarker = 'IDENTITY_OBSERVATIONS.csv'
        ProgressPattern = '*'
        CompletionMarker = 'RUNTIME_VERDICT.txt'
        CompletionSuccessPattern = '(?im)^qualification_verdict=PASS\s*$'
        FirstMarkerTimeoutSeconds = 30
        RequireProgress = $true
        ProgressTimeoutSeconds = if ($Experiment -in @('E','F')) { 900 } else { 120 }
        HardRuntimeTimeoutSeconds = if ($Experiment -in @('E','F')) { 1800 } else { 300 }
        GracefulCloseTimeoutSeconds = 10
    }
}
$configuration | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $configPath -Encoding UTF8

if ($Experiment -eq 'A') {
    Start-Sleep -Seconds 5
}

$stdoutPath = Join-Path $evidencePath ("EXPERIMENT_{0}_HARNESS.stdout.json" -f $Experiment)
$stderrPath = Join-Path $evidencePath ("EXPERIMENT_{0}_HARNESS.stderr.log" -f $Experiment)
$process = Start-Process -FilePath 'powershell.exe' -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
    -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $harness,
        '-ConfigurationPath', $configPath
    )
$after = Get-SourceFileSystemIdentity

$result = Get-Content -Raw -LiteralPath $stdoutPath | ConvertFrom-Json
$summary = [ordered]@{
    Experiment = $Experiment
    StartedBy = $identity
    Elevated = $elevated
    HarnessExitCode = $process.ExitCode
    AttemptId = $result.AttemptId
    AttemptRoot = $result.AttemptRoot
    Verdict = $result.Verdict
    FailureCategory = $result.FailureCategory
    SourceAccessMode = if ($Experiment -eq 'A') { 'NOT_OPENED' } else { 'O_RDONLY' }
    SourceWrites = $result.SourceWrites
    SourceLocks = $result.SourceLocks
    MissionOwnedProcessesRemaining = $result.MissionOwnedProcessesRemaining
    FileSystemIdentityBefore = $before
    FileSystemIdentityAfter = $after
}
$summaryPath = Join-Path $evidencePath ("EXPERIMENT_{0}_SUMMARY.json" -f $Experiment)
$summary | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $summaryPath -Encoding UTF8

if ($process.ExitCode -ne 0 -or $result.Verdict -notin @('PASS','PASS WITH CLARIFICATIONS')) {
    throw "Experiment $Experiment failed. See $summaryPath"
}

$summary | ConvertTo-Json -Depth 12
