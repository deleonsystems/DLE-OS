[CmdletBinding()]
param(
    [switch] $QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. 'C:\DLE-OS\Repositories\DLE-OS\Tools\SyncOperations\Assert-SyncOperationsLease.ps1'

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine $approvedIdentity -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw "Invoice History extraction requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$refreshRoot = 'C:\DLE-OS\Canonical\InvoiceHistory\Refresh'
$runsRoot = Join-Path $refreshRoot 'Runs'
$stateRoot = Join-Path $refreshRoot 'State'
$lockPath = Join-Path $stateRoot 'invoice-history-refresh.lock'
$statusPath = Join-Path $stateRoot 'status.json'
$template = Join-Path $repo (
    'Tools\InvoiceHistory\VPro\' +
    'INVOICE_HISTORY_BOUNDED_WINDOW_PROBE.src')
$exporter = Join-Path $repo (
    'Tools\InvoiceHistory\Export-ActiveInvoiceHistory.ps1')
$builder = Join-Path $repo (
    'Tools\InvoiceHistory\build_invoice_history_refresh_package.py')
$importer = Join-Path $repo (
    'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1')
$waitHelper = Join-Path $repo (
    'Tools\InvoiceHistory\InvoiceHistoryVProWait.ps1')
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$compiler = 'C:\BASIS\VPRO5\pro5cpl.exe'
$vpro = 'C:\BASIS\VPRO5\vpro5.exe'
$config =
    'C:\Add-On\Lab\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
    'configINVOICEHISTORYREFRESH001.aon'

foreach ($path in @(
    $template, $exporter, $builder, $importer, $python, $compiler,
    $waitHelper, $vpro, $config, '\\deleon-server\Add-ON\AON\ADATA\ART-03',
    '\\deleon-server\Add-ON\AON\ADATA\ART-13'
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required fixed refresh path is unavailable: $path"
    }
}
. $waitHelper

New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
try {
    $lock = [IO.File]::Open(
        $lockPath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None)
}
catch [IO.IOException] {
    [pscustomobject]@{
        Result = 'ALREADY_RUNNING'
        CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    } | ConvertTo-Json
    exit 2
}

$sourceProcessActive = $false
$runId = 'INVOICEHISTORYREFRESH-' +
    [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' +
    ([Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())
$runRoot = Join-Path $runsRoot $runId
$extractionRoot = Join-Path $runRoot 'Extraction'
$programRoot = Join-Path $runRoot 'Program'
$packageRoot = Join-Path $runRoot 'Package'
$windowEnd = (Get-Date).Date
$windowStart = $windowEnd.AddDays(-44)
$startedAt = [DateTimeOffset]::UtcNow
$sourceProcess = $null
$sourceProcessStartedAt = $null
$sourceWaitResult = $null
$sourceStdoutStream = $null
$sourceStderrStream = $null
$sourceStdoutTask = $null
$sourceStderrTask = $null
$noProgressTimeoutSeconds = 180
$absoluteTimeoutSeconds = 600

function Write-LockOwnership {
    param([System.Collections.IDictionary] $Value)
    $bytes = [Text.Encoding]::UTF8.GetBytes(
        ($Value | ConvertTo-Json -Depth 5))
    $lock.SetLength(0)
    $lock.Position = 0
    $lock.Write($bytes, 0, $bytes.Length)
    $lock.Flush()
}

function Test-StartedSourceProcessAlive {
    if (-not $sourceProcess) { return $false }
    try {
        $sourceProcess.Refresh()
        return -not $sourceProcess.HasExited
    }
    catch { return $false }
}

function Stop-StartedSourceProcess {
    param([Parameter(Mandatory)][string] $Reason)
    if (-not (Test-StartedSourceProcessAlive)) {
        $script:sourceProcessActive = $false
        return
    }
    $actualStart = $sourceProcess.StartTime.ToUniversalTime()
    if ([Math]::Abs(
        ($actualStart - $sourceProcessStartedAt.UtcDateTime).TotalSeconds
    ) -gt 1) {
        throw (
            "Refusing cleanup because VPro PID $($sourceProcess.Id) " +
            'no longer has the launched process start time.')
    }
    Stop-Process -Id $sourceProcess.Id -Force -ErrorAction Stop
    if (-not $sourceProcess.WaitForExit(10000)) {
        throw (
            "Started VPro PID $($sourceProcess.Id) did not exit after " +
            "$Reason cleanup.")
    }
    $script:sourceProcessActive = $false
}

function Complete-StartedSourceOutputCapture {
    foreach ($task in @($sourceStdoutTask, $sourceStderrTask)) {
        if ($null -ne $task -and -not $task.Wait(10000)) {
            throw 'VPro output capture did not complete after process exit.'
        }
    }
    foreach ($stream in @($sourceStdoutStream, $sourceStderrStream)) {
        if ($null -ne $stream) { $stream.Dispose() }
    }
    $script:sourceStdoutTask = $null
    $script:sourceStderrTask = $null
    $script:sourceStdoutStream = $null
    $script:sourceStderrStream = $null
}

function Write-Status {
    param(
        [string] $Result,
        [string] $Message,
        [object] $Details,
        [string] $CurrentPhase = '',
        [object] $RecordsProcessed = $null,
        [object] $RecordsExpected = $null
    )
    [ordered]@{
        Result = $Result
        Message = $Message
        RefreshRunId = $runId
        WindowStart = $windowStart.ToString('yyyy-MM-dd')
        WindowEnd = $windowEnd.ToString('yyyy-MM-dd')
        StartedAtUtc = $startedAt.ToString('O')
        UpdatedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ExecutionIdentity = $identity.Name
        Elevated = $false
        CurrentPhase = $CurrentPhase
        RecordsProcessed = $RecordsProcessed
        RecordsExpected = $RecordsExpected
        Details = $Details
    } |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $statusPath -Encoding UTF8
}

try {
    New-Item -ItemType Directory -Path $extractionRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $programRoot -Force | Out-Null
    Write-Status 'RUNNING' 'Reading the bounded Invoice History window.' `
        $null 'Reading 45-Day Window'

    $source = Get-Content -LiteralPath $template -Raw
    $source = $source.Replace('X:\AON\ADATA', '\\deleon-server\Add-ON\AON\ADATA')
    $source = $source -replace (
        '(?m)^0060 LET ROOT\$=.*$'),
        ('0060 LET ROOT$="' + $extractionRoot + '\"')
    $source = $source -replace (
        '(?m)^0080 LET STARTDATE=.*$'),
        (
            '0080 LET STARTDATE=' +
            $windowStart.ToString('yyMMdd') +
            ',ENDDATE=' + $windowEnd.ToString('yyMMdd') +
            ',Q$=$22$'
        )
    $source = $source -replace (
        '(?m)^1810 PRINT \(22\).*$'),
        (
            '1810 PRINT (22)"overlap_start,' +
            $windowStart.ToString('yyyy-MM-dd') + '"'
        )
    $source = $source -replace (
        '(?m)^1820 PRINT \(22\).*$'),
        (
            '1820 PRINT (22)"overlap_end,' +
            $windowEnd.ToString('yyyy-MM-dd') + '"'
        )
    $sourcePath = Join-Path $programRoot 'INVOICE_HISTORY_REFRESH.src'
    $compiledPath = Join-Path $programRoot 'INVOICE_HISTORY_REFRESH'
    [IO.File]::WriteAllText($sourcePath, $source, [Text.Encoding]::ASCII)

    $compileInfo = [Diagnostics.ProcessStartInfo]::new()
    $compileInfo.FileName = $compiler
    $compileInfo.UseShellExecute = $false
    $compileInfo.RedirectStandardInput = $true
    $compileInfo.RedirectStandardOutput = $true
    $compileInfo.RedirectStandardError = $true
    $compileProcess = [Diagnostics.Process]::new()
    $compileProcess.StartInfo = $compileInfo
    [void]$compileProcess.Start()
    $compileProcess.StandardInput.Write($source)
    $compileProcess.StandardInput.Close()
    $compiled = [IO.File]::Create($compiledPath)
    $compileProcess.StandardOutput.BaseStream.CopyTo($compiled)
    $compiled.Dispose()
    $compileError = $compileProcess.StandardError.ReadToEnd()
    $compileProcess.WaitForExit()
    if (
        $compileProcess.ExitCode -ne 0 -or
        (Get-Item -LiteralPath $compiledPath).Length -lt 100
    ) {
        throw "VPro compilation failed: $compileError"
    }

    $sourceStopwatch = [Diagnostics.Stopwatch]::StartNew()
    $sourceInfo = [Diagnostics.ProcessStartInfo]::new()
    $sourceInfo.FileName = $vpro
    $sourceInfo.Arguments = @(
        '-tT0', '-nT0', '-m1024', "-c$config", $compiledPath) -join ' '
    $sourceInfo.WorkingDirectory = $programRoot
    $sourceInfo.UseShellExecute = $false
    $sourceInfo.CreateNoWindow = $true
    $sourceInfo.RedirectStandardOutput = $true
    $sourceInfo.RedirectStandardError = $true
    $sourceProcess = [Diagnostics.Process]::new()
    $sourceProcess.StartInfo = $sourceInfo
    [void]$sourceProcess.Start()
    $sourceStdoutStream = [IO.File]::Create(
        (Join-Path $runRoot 'vpro.stdout.log'))
    $sourceStderrStream = [IO.File]::Create(
        (Join-Path $runRoot 'vpro.stderr.log'))
    $sourceStdoutTask = $sourceProcess.StandardOutput.BaseStream.CopyToAsync(
        $sourceStdoutStream)
    $sourceStderrTask = $sourceProcess.StandardError.BaseStream.CopyToAsync(
        $sourceStderrStream)
    $sourceProcessActive = $true
    $sourceProcessStartedAt = [DateTimeOffset](
        $sourceProcess.StartTime.ToUniversalTime())
    Write-LockOwnership ([ordered]@{
        RefreshRunId = $runId
        OrchestratorProcessId = $PID
        SourceProcessId = $sourceProcess.Id
        SourceProcessStartedAtUtc = $sourceProcessStartedAt.ToString('O')
        AcquiredAtUtc = $startedAt.ToString('O')
    })
    $summaryPath = Join-Path $extractionRoot 'BOUNDED_SUMMARY.csv'
    $sourceWaitResult = Wait-InvoiceHistoryVProExtraction `
        -Process $sourceProcess `
        -ProcessStartedAtUtc $sourceProcessStartedAt `
        -SummaryPath $summaryPath `
        -ProgressPaths @(
            (Join-Path $extractionRoot 'BOUNDED_HEADERS.csv'),
            (Join-Path $extractionRoot 'BOUNDED_LINES.csv'),
            $summaryPath,
            (Join-Path $runRoot 'vpro.stdout.log'),
            (Join-Path $runRoot 'vpro.stderr.log')) `
        -EvidencePath (Join-Path $runRoot 'vpro-wait.json') `
        -NoProgressTimeoutSeconds $noProgressTimeoutSeconds `
        -AbsoluteTimeoutSeconds $absoluteTimeoutSeconds
    $sourceProcessActive = $sourceWaitResult.ProcessAlive
    $sourceStopwatch.Stop()
    if ($sourceWaitResult.TimeoutReason) {
        Stop-StartedSourceProcess -Reason $sourceWaitResult.TimeoutReason
        throw (
            "Invoice History VPro timeout $($sourceWaitResult.TimeoutReason): " +
            "PID $($sourceProcess.Id), elapsedMs=" +
            "$($sourceWaitResult.ElapsedMilliseconds), lastProgressUtc=" +
            "$($sourceWaitResult.LastObservedProgressAtUtc.ToString('O')), " +
            "outputBytes=$($sourceWaitResult.Output.TotalBytes).")
    }
    if ($sourceWaitResult.Result -ne 'COMPLETE') {
        throw (
            'The bounded source process exited without a valid final ' +
            'O_RDONLY summary.')
    }
    Complete-StartedSourceOutputCapture
    $sourceExitCode = $sourceWaitResult.ExitCode
    if ($null -eq $sourceExitCode) {
        throw 'The bounded source process completed without a captured exit code.'
    }
    if ($sourceExitCode -ne 0) {
        throw "The bounded source process exited with code $sourceExitCode."
    }
    $summaryText = Get-Content -LiteralPath $summaryPath -Raw
    if ($summaryText -match '(?im)^failure,') {
        throw 'The bounded O_RDONLY source program reported failure.'
    }

    $activeResult = & $exporter -RunRoot $runRoot
    Write-Status 'RUNNING' 'Comparing recent Invoice History.' $null `
        'Comparing Invoice History'
    $builderOutput = & $python $builder `
        --run-id $runId `
        --input-root $extractionRoot `
        --active-header-csv (
            Join-Path $runRoot 'Active\CustomerInvoice.csv') `
        --active-line-csv (
            Join-Path $runRoot 'Active\CustomerInvoiceLine.csv') `
        --window-start $windowStart.ToString('yyyy-MM-dd') `
        --window-end $windowEnd.ToString('yyyy-MM-dd') `
        --snapshot-year $windowEnd.Year
    if ($LASTEXITCODE -ne 0) {
        throw 'Refresh package validation or comparison failed.'
    }
    $packageProgress = $builderOutput | ConvertFrom-Json
    $invoiceLineCount = [long]$packageProgress.counts.CustomerInvoiceLine
    Write-Status 'RUNNING' 'Updating recent Invoice History.' $null `
        'Updating Invoice History' $invoiceLineCount $invoiceLineCount

    $importArguments = @{ PackagePath = $packageRoot }
    if ($QualificationInduceFailure) {
        $importArguments.QualificationInduceFailure = $true
    }
    $importOutput = & $importer @importArguments
    $importResult = $importOutput | ConvertFrom-Json
    $result = [string]$importResult.Result
    Write-Status $result 'Invoice History refresh completed.' ([ordered]@{
        SourceElapsedMilliseconds = $sourceStopwatch.ElapsedMilliseconds
        SourceExitCode = $sourceExitCode
        Package = $packageProgress
        Import = $importResult
        SourceOpenMode = 'O_RDONLY'
        SourceWrites = 0
        SourceLocksRequested = 0
    }) 'Complete' $invoiceLineCount $invoiceLineCount
    Get-Content -LiteralPath $statusPath -Raw
}
catch {
    if (Test-StartedSourceProcessAlive) {
        try {
            Stop-StartedSourceProcess -Reason 'WRAPPER_FAILURE'
        }
        catch {
            $sourceProcessActive = Test-StartedSourceProcessAlive
            Write-Status 'FAILED' (
                'Invoice History failed and exact-owner VPro cleanup also ' +
                "failed: $($_.Exception.Message)") ([ordered]@{
                    SourceProcessActive = $sourceProcessActive
                    SourceProcessId = if ($sourceProcess) {
                        $sourceProcess.Id
                    } else { $null }
                    SourceProcessStartedAtUtc = if ($sourceProcessStartedAt) {
                        $sourceProcessStartedAt.ToString('O')
                    } else { $null }
                    ActiveDatasetRetained = $true
                    SourceWrites = 0
                    SourceLocksRequested = 0
                })
            throw
        }
    }
    Write-Status 'FAILED' $_.Exception.Message ([ordered]@{
        SourceProcessActive = $sourceProcessActive
        SourceProcessId = if ($sourceProcess) { $sourceProcess.Id } else { $null }
        SourceProcessStartedAtUtc = if ($sourceProcessStartedAt) {
            $sourceProcessStartedAt.ToString('O')
        } else { $null }
        WaitDiagnostics = $sourceWaitResult
        ActiveDatasetRetained = $true
        SourceWrites = 0
        SourceLocksRequested = 0
    })
    throw
}
finally {
    $lock.Dispose()
    $sourceProcessActive = Test-StartedSourceProcessAlive
    if (-not $sourceProcessActive -and (Test-Path -LiteralPath $lockPath)) {
        Remove-Item -LiteralPath $lockPath -Force
    }
    if (-not $sourceProcessActive) {
        Complete-StartedSourceOutputCapture
    }
}
