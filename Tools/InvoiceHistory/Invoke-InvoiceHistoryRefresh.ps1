[CmdletBinding()]
param(
    [switch] $QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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
    $vpro, $config, 'X:\AON\ADATA\ART-03', 'X:\AON\ADATA\ART-13'
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required fixed refresh path is unavailable: $path"
    }
}

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

function Write-Status {
    param(
        [string] $Result,
        [string] $Message,
        [object] $Details
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
        Details = $Details
    } |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $statusPath -Encoding UTF8
}

try {
    New-Item -ItemType Directory -Path $extractionRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $programRoot -Force | Out-Null
    Write-Status 'RUNNING' 'Reading the bounded Invoice History window.' $null

    $source = Get-Content -LiteralPath $template -Raw
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
    $sourceProcess = Start-Process `
        -FilePath $vpro `
        -ArgumentList @(
            '-tT0', '-nT0', '-m1024', "-c$config", $compiledPath) `
        -WorkingDirectory $programRoot `
        -RedirectStandardOutput (Join-Path $runRoot 'vpro.stdout.log') `
        -RedirectStandardError (Join-Path $runRoot 'vpro.stderr.log') `
        -WindowStyle Hidden `
        -PassThru
    $sourceProcessActive = $true
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
    $summaryPath = Join-Path $extractionRoot 'BOUNDED_SUMMARY.csv'
    $completion = $false
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $summaryComplete = $false
        if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
            try {
                $summaryComplete = (
                    Get-Content -LiteralPath $summaryPath -Raw
                ) -match '(?im)^open_mode,O_RDONLY\s*$'
            }
            catch {
                $summaryComplete = $false
            }
        }
        $liveProcess = @(
            Get-CimInstance Win32_Process -Filter (
                "ProcessId = $($sourceProcess.Id)") `
                -ErrorAction SilentlyContinue |
                Where-Object Name -IEQ 'vpro5.exe'
        )
        $sourceProcessActive = $liveProcess.Count -gt 0
        if ($summaryComplete -and -not $sourceProcessActive) {
            $completion = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    $sourceStopwatch.Stop()
    if (-not $completion) {
        throw (
            'The bounded source process did not complete within two minutes. ' +
            'It was not terminated.')
    }
    $summaryText = Get-Content -LiteralPath $summaryPath -Raw
    if ($summaryText -match '(?im)^failure,') {
        throw 'The bounded O_RDONLY source program reported failure.'
    }

    $activeResult = & $exporter -RunRoot $runRoot
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

    $importArguments = @{ PackagePath = $packageRoot }
    if ($QualificationInduceFailure) {
        $importArguments.QualificationInduceFailure = $true
    }
    $importOutput = & $importer @importArguments
    $importResult = $importOutput | ConvertFrom-Json
    $result = [string]$importResult.Result
    Write-Status $result 'Invoice History refresh completed.' ([ordered]@{
        SourceElapsedMilliseconds = $sourceStopwatch.ElapsedMilliseconds
        Package = $builderOutput | ConvertFrom-Json
        Import = $importResult
        SourceOpenMode = 'O_RDONLY'
        SourceWrites = 0
        SourceLocksRequested = 0
    })
    Get-Content -LiteralPath $statusPath -Raw
}
catch {
    Write-Status 'FAILED' $_.Exception.Message ([ordered]@{
        SourceProcessActive = $sourceProcessActive
        ActiveDatasetRetained = $true
        SourceWrites = 0
        SourceLocksRequested = 0
    })
    throw
}
finally {
    $lock.Dispose()
    if (-not $sourceProcessActive -and (Test-Path -LiteralPath $lockPath)) {
        Remove-Item -LiteralPath $lockPath -Force
    }
}
