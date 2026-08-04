[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runId = 'CUSTOMERMASTERPLATFORM001-20260729T170951Z'
$attemptId = 'Attempt-20260729T180728Z'
$expectedProgramSha256 =
    '33CAD7A53B399AA70A621CC940773C1FA7C7D17CB58EFE64BBE6D39F963EB775'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    "Artifacts\CustomerMasterPlatform001\$runId")
$attemptRoot = "C:\Add-On\Lab\CustomerMasterPlatform001\$runId\$attemptId"
$runtime = Join-Path $attemptRoot 'Runtime'
$programs = Join-Path $attemptRoot 'Programs'
$program = Join-Path $programs 'CUSTOMER_MASTER_QUALIFIER'
$config = Join-Path $programs 'configCUSTOMERMASTERPLATFORM001.aon'
$vpro = 'C:\BASIS\VPRO5\vpro5.exe'
$compileGate = Join-Path $artifactRoot 'CUSTOMER_MASTER_COMPILE_GATE.json'
$launchEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_BOUNDED_LAUNCH.json')
$executionEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_SOURCE_EXECUTION.json')
$errorEvidence = Join-Path $artifactRoot (
    'CUSTOMER_MASTER_SOURCE_EXECUTION_ERROR.json')
$startupOutput = Join-Path $runtime 'SOURCE_PASS_SUMMARY.csv'
$runtimeVerdict = Join-Path $runtime 'RUNTIME_VERDICT.txt'
$startupTimeoutSeconds = 30
$progressTimeoutSeconds = 120
$hardRuntimeSeconds = 900
$sourcePaths = @(
    'X:\AON\ADATA\ARM-01',
    'X:\AON\ADATA\ARM-02',
    'X:\AON\ADATA\ARM-03',
    'X:\AON\ADATA\ARM-05',
    'X:\AON\ADATA\ARM-06',
    'X:\AON\ADATA\ARM-09',
    'X:\AON\ADATA\ARM-10',
    'X:\AON\ADATA\ARM-14'
)
$process = $null
$mutex = $null
$mutexOwned = $false
$startedAt = $null
$stopwatch = $null
$terminationReason = $null

function Write-JsonEvidence {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$Value
    )
    $Value |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $Path -Encoding UTF8
}

function Stop-StartedVPro {
    param(
        [Parameter(Mandatory)]
        [Diagnostics.Process]$StartedProcess,
        [Parameter(Mandatory)]
        [string]$Reason
    )
    if ($StartedProcess.HasExited) {
        return
    }
    $script:terminationReason = $Reason
    Stop-Process -Id $StartedProcess.Id -Force -ErrorAction Stop
    if (-not $StartedProcess.WaitForExit(10000)) {
        throw "Started VPro PID $($StartedProcess.Id) did not exit after cleanup."
    }
    if (Get-Process -Id $StartedProcess.Id -ErrorAction SilentlyContinue) {
        throw "Started VPro PID $($StartedProcess.Id) remains after cleanup."
    }
}

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

function Get-RuntimeProgressSignature {
    $items = @(
        Get-ChildItem -LiteralPath $runtime -File -Recurse `
            -ErrorAction SilentlyContinue |
            Sort-Object FullName
    )
    return (
        $items |
            ForEach-Object {
                '{0}|{1}|{2}' -f
                    $_.FullName,
                    $_.Length,
                    $_.LastWriteTimeUtc.Ticks
            }
    ) -join "`n"
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (
        $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
        $principal.IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    ) {
        throw (
            'Customer Master qualification requires the non-elevated ' +
            'approved operator.')
    }

    $mutex = [Threading.Mutex]::new(
        $false,
        'Local\DLE_OS_CUSTOMER_MASTER_PLATFORM_001')
    $mutexOwned = $mutex.WaitOne(0)
    if (-not $mutexOwned) {
        throw 'Another Customer Master qualification wrapper is active.'
    }

    $overlap = @(
        Get-Process -Name 'vpro5' -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Path -ieq $vpro
            }
    )
    if ($overlap.Count -gt 0) {
        throw (
            'A VPro5 process is already active; qualification will not ' +
            'start because overlap cannot be excluded. PIDs: ' +
            (($overlap.Id | Sort-Object) -join ', '))
    }

    foreach ($path in @(
        $compileGate,
        $program,
        $vpro
    ) + $sourcePaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required fixed path is unavailable: $path"
        }
    }

    $gate = Get-Content -Raw -LiteralPath $compileGate |
        ConvertFrom-Json
    if (
        $gate.Verdict -cne 'PASS' -or
        $gate.AttemptId -cne $attemptId -or
        $gate.CompiledArtifact -cne $program -or
        $gate.CompiledArtifactSha256 -cne $expectedProgramSha256
    ) {
        throw 'The preserved fresh-directory compile gate is not qualified.'
    }
    $actualProgramSha256 = (
        Get-FileHash -LiteralPath $program -Algorithm SHA256).Hash
    if ($actualProgramSha256 -cne $expectedProgramSha256) {
        throw 'The preserved compiled qualifier hash changed.'
    }

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

    foreach ($path in @(
        $startupOutput,
        $runtimeVerdict
    )) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force
        }
    }
    foreach ($pass in @('Pass1', 'Pass2')) {
        $passPath = Join-Path $runtime $pass
        Get-ChildItem -LiteralPath $passPath -File `
            -ErrorAction SilentlyContinue |
            Remove-Item -Force
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
    $processStart.UseShellExecute = $true
    $processStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $process = [Diagnostics.Process]::Start($processStart)

    Write-JsonEvidence -Path $launchEvidence -Value ([ordered]@{
        Verdict = 'RUNNING'
        RunId = $runId
        AttemptId = $attemptId
        StartedAtUtc = $startedAt.ToString('O')
        ProcessId = $process.Id
        Executable = $vpro
        WorkingDirectory = $programs
        Arguments = $arguments
        UseShellExecute = $true
        StandardStreamsRedirected = $false
        ProgramSha256 = $actualProgramSha256
        ConfigPath = $config
        ConfigSha256 = (
            Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
        StartupOutput = $startupOutput
        StartupTimeoutSeconds = $startupTimeoutSeconds
        ProgressTimeoutSeconds = $progressTimeoutSeconds
        HardRuntimeSeconds = $hardRuntimeSeconds
        CleanupScope = 'STARTED_PROCESS_ID_ONLY'
    })

    $startupObserved = $false
    $lastSignature = ''
    $lastProgressAt = [DateTimeOffset]::UtcNow
    while (-not $process.HasExited) {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        $elapsedSeconds = $stopwatch.Elapsed.TotalSeconds
        $signature = Get-RuntimeProgressSignature
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
            $elapsedSeconds -ge $startupTimeoutSeconds
        ) {
            Stop-StartedVPro `
                -StartedProcess $process `
                -Reason 'STARTUP_OUTPUT_TIMEOUT'
            throw (
                "VPro PID $($process.Id) produced no startup output within " +
                "$startupTimeoutSeconds seconds.")
        }
        if (
            $startupObserved -and
            (
                [DateTimeOffset]::UtcNow - $lastProgressAt
            ).TotalSeconds -ge $progressTimeoutSeconds
        ) {
            Stop-StartedVPro `
                -StartedProcess $process `
                -Reason 'RUNTIME_PROGRESS_TIMEOUT'
            throw (
                "VPro PID $($process.Id) made no output progress within " +
                "$progressTimeoutSeconds seconds.")
        }
        if ($elapsedSeconds -ge $hardRuntimeSeconds) {
            Stop-StartedVPro `
                -StartedProcess $process `
                -Reason 'HARD_RUNTIME_TIMEOUT'
            throw (
                "VPro PID $($process.Id) exceeded the " +
                "$hardRuntimeSeconds-second runtime bound.")
        }
    }
    $stopwatch.Stop()
    if ($process.ExitCode -ne 0) {
        throw "Customer Master qualifier returned $($process.ExitCode)."
    }
    if (-not $startupObserved) {
        throw 'The qualifier exited without proving startup output.'
    }

    $verdict = Get-Content -Raw -LiteralPath $runtimeVerdict
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
        if ($hash1 -cne $hash2) {
            throw "Two-pass decoded stream mismatch for $name."
        }
        $rows = @((Import-Csv -LiteralPath $pass1)).Count
        $comparisons[$name] = [ordered]@{
            Count = $rows
            Pass1Sha256 = $hash1
            Pass2Sha256 = $hash2
            Match = $true
        }
    }

    $retained = Join-Path $artifactRoot 'QualifiedSource'
    New-Item -ItemType Directory -Path $retained -Force | Out-Null
    Copy-Item -LiteralPath (
        Join-Path $runtime 'SOURCE_PASS_SUMMARY.csv'
    ) -Destination $retained -Force
    Copy-Item -LiteralPath $runtimeVerdict -Destination $retained -Force
    foreach ($name in $comparisons.Keys) {
        Copy-Item -LiteralPath (
            Join-Path $runtime "Pass1\$name.csv"
        ) -Destination (Join-Path $retained "$name.csv") -Force
    }

    Write-JsonEvidence -Path $executionEvidence -Value ([ordered]@{
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
        VproSha256 = (
            Get-FileHash -LiteralPath $vpro -Algorithm SHA256).Hash
        ProgramSha256 = $actualProgramSha256
        AttemptId = $attemptId
        AttemptRoot = $attemptRoot
        StartupOutputObserved = $startupObserved
        StartupTimeoutSeconds = $startupTimeoutSeconds
        ProgressTimeoutSeconds = $progressTimeoutSeconds
        HardRuntimeSeconds = $hardRuntimeSeconds
        SourceWrites = 0
        SourceLocksRequested = 0
        OutputRoot = $retained
    })
    Write-JsonEvidence -Path $launchEvidence -Value ([ordered]@{
        Verdict = 'PASS'
        RunId = $runId
        AttemptId = $attemptId
        StartedAtUtc = $startedAt.ToString('O')
        CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ProcessId = $process.Id
        ExitCode = $process.ExitCode
        StartupOutputObserved = $startupObserved
        CleanupRequired = $false
        ProgramSha256 = $actualProgramSha256
        ConfigPath = $config
        ConfigSha256 = (
            Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
    })
    Write-Output "PASS: $executionEvidence"
}
catch {
    if ($stopwatch -and $stopwatch.IsRunning) {
        $stopwatch.Stop()
    }
    if ($process -and -not $process.HasExited) {
        try {
            Stop-StartedVPro `
                -StartedProcess $process `
                -Reason 'WRAPPER_FAILURE_CLEANUP'
        }
        catch {
            $terminationReason = (
                'CLEANUP_FAILURE: ' + ($_ | Out-String).Trim())
        }
    }
    $processStillPresent = $false
    if ($process) {
        $processStillPresent = [bool](
            Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
    }
    Write-JsonEvidence -Path $errorEvidence -Value ([ordered]@{
        Verdict = 'FAIL'
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = (
            [Security.Principal.WindowsIdentity]::GetCurrent().Name)
        AttemptId = $attemptId
        ProgramSha256 = $expectedProgramSha256
        ProcessId = if ($process) { $process.Id } else { $null }
        ProcessStillPresent = $processStillPresent
        TerminationReason = $terminationReason
        Error = ($_ | Out-String).Trim()
        SourceWrites = 0
        SourceLocksRequested = 0
    })
    if ($processStillPresent) {
        throw (
            'Qualification failed and its started VPro process remains. ' +
            "Evidence: $errorEvidence")
    }
    Write-Error (
        'Qualification failed closed; no started VPro process remains. ' +
        "Evidence: $errorEvidence")
    exit 1
}
finally {
    if ($mutexOwned -and $mutex) {
        $mutex.ReleaseMutex()
    }
    if ($mutex) {
        $mutex.Dispose()
    }
}
