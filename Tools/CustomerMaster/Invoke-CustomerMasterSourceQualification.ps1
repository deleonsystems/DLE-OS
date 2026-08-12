[CmdletBinding()]
param(
    [ValidatePattern(
        '^(CUSTOMERMASTERPLATFORM001-[0-9]{8}T[0-9]{6}Z|CUSTOMERREFRESH-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8})$')]
    [string] $RunId = 'CUSTOMERMASTERPLATFORM001-20260729T170951Z',
    [switch] $RoutineRefresh
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runId = $RunId
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
if ($RoutineRefresh) {
    if (-not $runId.StartsWith('CUSTOMERREFRESH-')) {
        throw 'Routine refresh requires a CUSTOMERREFRESH run ID.'
    }
    $artifactRoot =
        "C:\DLE-OS\Canonical\CustomerMaster\Refresh\Runs\$runId\Evidence"
    $labRoot = "C:\Add-On\Lab\CustomerMasterRefresh\$runId"
}
else {
    $artifactRoot = Join-Path $repository (
        "Artifacts\CustomerMasterPlatform001\$runId")
    $labRoot = "C:\Add-On\Lab\CustomerMasterPlatform001\$runId"
}
$attemptId = 'Attempt-' + [DateTimeOffset]::UtcNow.ToString(
    'yyyyMMddTHHmmssZ')
$attemptRoot = Join-Path $labRoot $attemptId
$runtime = Join-Path $attemptRoot 'Runtime'
$programs = Join-Path $attemptRoot 'Programs'
$compile = Join-Path $attemptRoot 'Compile'
$listings = Join-Path $attemptRoot 'Listings'
$template = Join-Path $repository (
    'Tools\CustomerMaster\VPro\CUSTOMER_MASTER_QUALIFIER.src')
$source = Join-Path $compile 'CUSTOMER_MASTER_QUALIFIER.src'
$program = Join-Path $programs 'CUSTOMER_MASTER_QUALIFIER'
$config = Join-Path $programs 'configCUSTOMERMASTERPLATFORM001.aon'
$compiler = 'C:\BASIS\VPRO5\pro5cpl.exe'
$lister = 'C:\BASIS\VPRO5\pro5lst.exe'
$vpro = 'C:\BASIS\VPRO5\vpro5.exe'
$sourceRoot = '\\deleon-server\Add-ON\AON\ADATA'
$sourcePaths = @('ARM-01','ARM-02','ARM-03','ARM-05','ARM-06','ARM-09','ARM-10','ARM-14') |
    ForEach-Object { Join-Path $sourceRoot $_ }
$executionEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_SOURCE_EXECUTION.json')
$errorEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_SOURCE_EXECUTION_ERROR.json')
$compileGateEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_COMPILE_GATE_RETRY_6.json')
$launchEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_BOUNDED_LAUNCH_RETRY_6.json')
$startupTimeoutSeconds = 30
$progressTimeoutSeconds = 120
$hardRuntimeSeconds = 900
$process = $null
$terminationReason = $null

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

trap {
    if ($process -and -not $process.HasExited) {
        $terminationReason = 'WRAPPER_FAILURE_CLEANUP'
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        [void]$process.WaitForExit(10000)
    }
    [ordered]@{
        Verdict = 'FAIL'
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = (
            [Security.Principal.WindowsIdentity]::GetCurrent().Name)
        Error = ($_ | Out-String).Trim()
        AttemptId = $attemptId
        ProcessId = if ($process) { $process.Id } else { $null }
        ProcessStillPresent = if ($process) {
            [bool](Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
        }
        else {
            $false
        }
        TerminationReason = $terminationReason
        SourceWrites = 0
        SourceLocksRequested = 0
    } |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $errorEvidence -Encoding UTF8
    exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Customer Master qualification requires the non-elevated approved operator.'
}

foreach ($path in @(
    $template, $compiler, $lister, $vpro
) + $sourcePaths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required fixed path is unavailable: $path"
    }
}

$overlap = @(
    Get-Process -Name 'vpro5' -ErrorAction SilentlyContinue |
        Where-Object Path -IEQ $vpro
)
if ($overlap.Count -gt 0) {
    throw (
        'A VPro5 process is already active; overlap cannot be excluded. ' +
        'PIDs: ' + (($overlap.Id | Sort-Object) -join ', '))
}

foreach ($path in @(
    $runtime,
    (Join-Path $runtime 'Pass1'),
    (Join-Path $runtime 'Pass2'),
    $programs,
    $compile,
    $listings
)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

$knownStaleProgramHashes = @(
    Get-ChildItem `
        -LiteralPath $labRoot `
        -Recurse `
        -File `
        -Filter 'CUSTOMER_MASTER_QUALIFIER' `
        -ErrorAction SilentlyContinue |
        Where-Object FullName -NotLike "$attemptRoot*" |
        ForEach-Object {
            (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        } |
        Sort-Object -Unique
)

function Get-SourceIdentity {
    @(
        foreach ($path in $sourcePaths) {
            $item = Get-Item -LiteralPath $path -Force
            [ordered]@{
                Path = $item.FullName
                Length = [long]$item.Length
                LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
                Attributes = $item.Attributes.ToString()
            }
        }
    )
}

function Get-NormalizedPassHash {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [ValidateSet(1, 2)]
        [int]$Pass
    )
    $prefix = "$Pass,"
    $normalized = @(
        Get-Content -LiteralPath $Path |
            ForEach-Object {
                if ($_.StartsWith(
                    $prefix,
                    [StringComparison]::Ordinal
                )) {
                    $_.Substring($prefix.Length)
                }
                else {
                    $_
                }
            }
    ) -join "`n"
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($normalized)
        return (
            [BitConverter]::ToString(
                $algorithm.ComputeHash($bytes)
            )
        ).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

$sourceText = Get-Content -Raw -LiteralPath $template
$sourceText = $sourceText.Replace('__RUN_ID__', $runId)
$sourceText = $sourceText.Replace('X:\AON\ADATA', $sourceRoot)
$sourceText = $sourceText.Replace(
    '__LAB_RUNTIME__',
    $runtime.TrimEnd('\'))
if (
    ($sourceText -split 'MODE="O_RDONLY"').Count -lt 3 -or
    $sourceText -match '(?im)\b(WRITE|REMOVE|INITFILE|ERASE|LOCK|UNLOCK)\b'
) {
    throw 'The fixed qualifier failed its static read-only guard.'
}
$sourceText | Set-Content -LiteralPath $source -Encoding ASCII
$configPrefix = ($programs -replace '\\', '/').TrimEnd('/') + '/'
@(
    'ALIASES=4'
    'FCBS=64'
    'CIBS=64'
    'STBLEN=12000'
    "PREFIX $configPrefix C:/BASIS/VPRO5/"
    'SETOPTS 0000000000000000'
    'ALIAS T0 SYSWINDOW ""'
) | Set-Content -LiteralPath $config -Encoding ASCII

$compilerStdout = Join-Path $attemptRoot 'compiler.stdout.log'
$compilerStderr = Join-Path $attemptRoot 'compiler.stderr.log'
$compileStartedAtUtc = [DateTime]::UtcNow
$compilerProcess = Start-Process `
    -FilePath $compiler `
    -ArgumentList @("-d$programs", $source) `
    -WorkingDirectory $compile `
    -RedirectStandardOutput $compilerStdout `
    -RedirectStandardError $compilerStderr `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
$compilerOutput = @(
    Get-Content -Raw -LiteralPath $compilerStdout -ErrorAction SilentlyContinue
    Get-Content -Raw -LiteralPath $compilerStderr -ErrorAction SilentlyContinue
) -join [Environment]::NewLine
if (
    $compilerProcess.ExitCode -ne 0 -or
    $compilerOutput -match '(?im)\b(error|fatal)\b'
) {
    throw (
        "VPro compiler rejected the qualifier. Exit code " +
        "$($compilerProcess.ExitCode). Output: $compilerOutput")
}
$compiledSourceName = Join-Path $programs (
    [IO.Path]::GetFileName($source))
if (-not (Test-Path -LiteralPath $compiledSourceName -PathType Leaf)) {
    throw 'The compiler did not create the expected current-attempt output.'
}
$compiledItem = Get-Item -LiteralPath $compiledSourceName
if ($compiledItem.LastWriteTimeUtc -lt $compileStartedAtUtc.AddSeconds(-2)) {
    throw 'The compiled output timestamp does not belong to this attempt.'
}
$compiledHash = (
    Get-FileHash -LiteralPath $compiledSourceName -Algorithm SHA256).Hash
if ($knownStaleProgramHashes -contains $compiledHash) {
    throw 'The compiled output matches a known prior-attempt stale stub.'
}
Move-Item -LiteralPath $compiledSourceName -Destination $program
if (-not (Test-Path -LiteralPath $program -PathType Leaf)) {
    throw 'The compiled fixed-path qualifier is absent.'
}
$programItem = Get-Item -LiteralPath $program
if ($programItem.LastWriteTimeUtc -lt $compileStartedAtUtc.AddSeconds(-2)) {
    throw 'The promoted compiled program is not current-attempt output.'
}

[ordered]@{
    Verdict = 'PASS'
    AttemptId = $attemptId
    AttemptRoot = $attemptRoot
    CompilerProcessId = $compilerProcess.Id
    CompilerExitCode = $compilerProcess.ExitCode
    CompilerOutputContainsError = (
        $compilerOutput -match '(?im)\berror\b')
    CompilerOutputContainsFatal = (
        $compilerOutput -match '(?im)\bfatal\b')
    CompileStartedAtUtc = $compileStartedAtUtc.ToString('O')
    CompiledArtifact = $program
    CompiledArtifactLastWriteTimeUtc =
        $programItem.LastWriteTimeUtc.ToString('O')
    CompiledArtifactLength = [long]$programItem.Length
    CompiledArtifactSha256 = $compiledHash
    KnownStaleProgramHashes = $knownStaleProgramHashes
    FreshDirectory = $true
    PriorArtifactReused = $false
} |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (
        $compileGateEvidence
    ) -Encoding UTF8

& $lister "-d$listings" '-p' $program
if ($LASTEXITCODE -ne 0) {
    throw "VPro lister returned $LASTEXITCODE."
}

$before = Get-SourceIdentity
$startedAt = [DateTimeOffset]::UtcNow
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$arguments = @(
    '-tT0',
    '-nT0',
    '-m1024',
    "-c$config",
    (Split-Path -Leaf $program)
)
$processStart = [Diagnostics.ProcessStartInfo]::new()
$processStart.FileName = $vpro
$processStart.Arguments = $arguments -join ' '
$processStart.WorkingDirectory = $programs
$processStart.UseShellExecute = $false
$processStart.CreateNoWindow = $true
$processStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$process = [Diagnostics.Process]::Start($processStart)
[ordered]@{
    Verdict = 'RUNNING'
    StartedAtUtc = $startedAt.ToString('O')
    AttemptId = $attemptId
    ProcessId = $process.Id
    Arguments = $arguments
    UseShellExecute = $false
    ProgramSha256 = $compiledHash
    StartupTimeoutSeconds = $startupTimeoutSeconds
    ProgressTimeoutSeconds = $progressTimeoutSeconds
    HardRuntimeSeconds = $hardRuntimeSeconds
    CleanupScope = 'STARTED_PROCESS_ID_ONLY'
} |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $launchEvidence -Encoding UTF8

$startupOutput = Join-Path $runtime 'SOURCE_PASS_SUMMARY.csv'
$startupObserved = $false
$lastSignature = ''
$lastProgressAt = [DateTimeOffset]::UtcNow
while (-not $process.HasExited) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    $runtimeItems = @(
        Get-ChildItem -LiteralPath $runtime -File -Recurse `
            -ErrorAction SilentlyContinue |
            Sort-Object FullName
    )
    $signature = (
        $runtimeItems |
            ForEach-Object {
                '{0}|{1}|{2}' -f
                    $_.FullName,
                    $_.Length,
                    $_.LastWriteTimeUtc.Ticks
            }
    ) -join "`n"
    if ($signature -cne $lastSignature) {
        $lastSignature = $signature
        $lastProgressAt = [DateTimeOffset]::UtcNow
    }
    if (
        -not $startupObserved -and
        (Test-Path -LiteralPath $startupOutput -PathType Leaf) -and
        (Get-Item -LiteralPath $startupOutput).Length -gt 0
    ) {
        $startupObserved = $true
        $lastProgressAt = [DateTimeOffset]::UtcNow
    }
    if (
        -not $startupObserved -and
        $stopwatch.Elapsed.TotalSeconds -ge $startupTimeoutSeconds
    ) {
        $terminationReason = 'STARTUP_OUTPUT_TIMEOUT'
        Stop-Process -Id $process.Id -Force
        [void]$process.WaitForExit(10000)
        throw 'The qualifier produced no startup output within 30 seconds.'
    }
    $runtimeVerdictPath = Join-Path $runtime 'RUNTIME_VERDICT.txt'
    if (Test-Path -LiteralPath $runtimeVerdictPath -PathType Leaf) {
        $runtimeVerdictText = Get-Content -Raw `
            -LiteralPath $runtimeVerdictPath `
            -ErrorAction SilentlyContinue
        if (
            $runtimeVerdictText -match
                '(?m)^qualification_verdict=FAIL\s*$'
        ) {
            $terminationReason = 'RUNTIME_FAIL_VERDICT'
            Stop-Process -Id $process.Id -Force
            [void]$process.WaitForExit(10000)
            throw (
                'The qualifier emitted a fail verdict: ' +
                ($runtimeVerdictText -replace '\s+', ' ').Trim())
        }
    }
    if (
        $startupObserved -and
        (
            [DateTimeOffset]::UtcNow - $lastProgressAt
        ).TotalSeconds -ge $progressTimeoutSeconds
    ) {
        $terminationReason = 'RUNTIME_PROGRESS_TIMEOUT'
        Stop-Process -Id $process.Id -Force
        [void]$process.WaitForExit(10000)
        throw 'The qualifier made no output progress within 120 seconds.'
    }
    if ($stopwatch.Elapsed.TotalSeconds -ge $hardRuntimeSeconds) {
        $terminationReason = 'HARD_RUNTIME_TIMEOUT'
        Stop-Process -Id $process.Id -Force
        [void]$process.WaitForExit(10000)
        throw 'The qualifier exceeded its 900-second runtime bound.'
    }
}
$stopwatch.Stop()
if ($process.ExitCode -ne 0) {
    throw "Customer Master qualifier returned $($process.ExitCode)."
}

$verdictPath = Join-Path $runtime 'RUNTIME_VERDICT.txt'
$verdict = Get-Content -Raw -LiteralPath $verdictPath
if ($verdict -notmatch '(?m)^qualification_verdict=PASS\s*$') {
    throw 'The VPro qualifier did not return PASS.'
}
$after = Get-SourceIdentity
$identityStable = (
    ($before | ConvertTo-Json -Depth 5 -Compress) -ceq
    ($after | ConvertTo-Json -Depth 5 -Compress)
)
if (-not $identityStable) {
    throw 'A source identity changed during qualification.'
}

$comparisons = [ordered]@{}
foreach ($name in @(
    'ARM-01', 'ARM-02', 'ARM-03', 'ARM-05',
    'ARM-06', 'ARM-09', 'ARM-10', 'ARM-14'
)) {
    $pass1 = Join-Path $runtime "Pass1\$name.csv"
    $pass2 = Join-Path $runtime "Pass2\$name.csv"
    $hash1 = (Get-FileHash -LiteralPath $pass1 -Algorithm SHA256).Hash
    $hash2 = (Get-FileHash -LiteralPath $pass2 -Algorithm SHA256).Hash
    $normalizedHash1 = Get-NormalizedPassHash -Path $pass1 -Pass 1
    $normalizedHash2 = Get-NormalizedPassHash -Path $pass2 -Pass 2
    if ($normalizedHash1 -cne $normalizedHash2) {
        throw "Two-pass decoded stream mismatch for $name."
    }
    $rows = @((Import-Csv -LiteralPath $pass1)).Count
    $comparisons[$name] = [ordered]@{
        Count = $rows
        Pass1Sha256 = $hash1
        Pass2Sha256 = $hash2
        NormalizedRecordStreamSha256 = $normalizedHash1
        Match = $true
    }
}

$retained = Join-Path $artifactRoot 'QualifiedSource'
New-Item -ItemType Directory -Path $retained -Force | Out-Null
Copy-Item -LiteralPath (
    Join-Path $runtime 'SOURCE_PASS_SUMMARY.csv'
) -Destination $retained -Force
Copy-Item -LiteralPath $verdictPath -Destination $retained -Force
foreach ($name in $comparisons.Keys) {
    Copy-Item -LiteralPath (
        Join-Path $runtime "Pass1\$name.csv"
    ) -Destination (Join-Path $retained "$name.csv") -Force
}

[ordered]@{
    Verdict = 'PASS'
    RunId = $runId
    StartedAtUtc = $startedAt.ToString('O')
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ElapsedMilliseconds = [long]$stopwatch.ElapsedMilliseconds
    WindowsIdentity = $identity.Name
    Elevated = $false
    SourceOpenMode = 'O_RDONLY'
    SourceIdentityBefore = $before
    SourceIdentityAfter = $after
    SourceIdentityStable = $identityStable
    TwoPassComparisons = $comparisons
    VproSha256 = (Get-FileHash -LiteralPath $vpro -Algorithm SHA256).Hash
    ProgramSha256 = (
        Get-FileHash -LiteralPath $program -Algorithm SHA256).Hash
    AttemptId = $attemptId
    AttemptRoot = $attemptRoot
    CompilerStdout = $compilerStdout
    CompilerStderr = $compilerStderr
    ProgramListing = $listings
    SourceWrites = 0
    SourceLocksRequested = 0
    OutputRoot = $retained
} |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $executionEvidence -Encoding UTF8

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AttemptId = $attemptId
    ProcessId = $process.Id
    ExitCode = $process.ExitCode
    StartupOutputObserved = $startupObserved
    CleanupRequired = $false
    ProgramSha256 = $compiledHash
} |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $launchEvidence -Encoding UTF8

Write-Output "PASS: $executionEvidence"
