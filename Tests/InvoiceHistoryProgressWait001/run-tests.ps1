$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helperPath = Join-Path $root (
    'Tools\InvoiceHistory\InvoiceHistoryVProWait.ps1')
$runnerPath = Join-Path $root (
    'Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1')
. $helperPath
$runner = Get-Content -LiteralPath $runnerPath -Raw
$results = [Collections.Generic.List[object]]::new()

function Test-Case {
    param([string] $Name, [scriptblock] $Body)
    try {
        & $Body
        $results.Add([pscustomobject]@{ Name = $Name; Passed = $true })
    }
    catch {
        $results.Add([pscustomobject]@{
            Name = $Name
            Passed = $false
            Error = $_.Exception.Message
        })
    }
}
function Require([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Start-WaitFixture {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][int] $ExitCode,
        [int] $DelayMilliseconds = 100,
        [switch] $WriteValidSummary
    )
    $fixture = Join-Path $Root 'fixture.ps1'
    $summary = Join-Path $Root 'BOUNDED_SUMMARY.csv'
    $progress = Join-Path $Root 'BOUNDED_LINES.csv'
    $summaryStatement = if ($WriteValidSummary) {
        "Set-Content -LiteralPath '$($summary.Replace("'", "''"))' " +
            "-Value @('metric,value','open_mode,O_RDONLY') -Encoding ASCII"
    }
    else { '' }
    @"
Start-Sleep -Milliseconds $DelayMilliseconds
Set-Content -LiteralPath '$($progress.Replace("'", "''"))' -Value 'progress' -Encoding ASCII
$summaryStatement
exit $ExitCode
"@ | Set-Content -LiteralPath $fixture -Encoding UTF8
    $stdout = Join-Path $Root 'stdout.log'
    $stderr = Join-Path $Root 'stderr.log'
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = 'powershell.exe'
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive ' +
        "-ExecutionPolicy Bypass -File `"$fixture`""
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    [pscustomobject]@{
        Process = $process
        Summary = $summary
        Progress = $progress
        Evidence = Join-Path $Root 'wait.json'
    }
}

function Invoke-WaitFixture {
    param(
        [Parameter(Mandatory)][int] $ExitCode,
        [switch] $AlreadyExited
    )
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) (
        'DLE-OS-InvoiceHistoryExit-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    $fixture = $null
    try {
        $fixture = Start-WaitFixture -Root $tempRoot -ExitCode $ExitCode `
            -WriteValidSummary
        $started = [DateTimeOffset](
            $fixture.Process.StartTime.ToUniversalTime())
        if ($AlreadyExited) { $fixture.Process.WaitForExit() }
        Wait-InvoiceHistoryVProExtraction -Process $fixture.Process `
            -ProcessStartedAtUtc $started -SummaryPath $fixture.Summary `
            -ProgressPaths @($fixture.Progress, $fixture.Summary) `
            -EvidencePath $fixture.Evidence -NoProgressTimeoutSeconds 5 `
            -AbsoluteTimeoutSeconds 10 -PollMilliseconds 25
    }
    finally {
        if ($fixture -and -not $fixture.Process.HasExited) {
            $fixture.Process.Kill()
            $fixture.Process.WaitForExit()
        }
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

$start = [DateTimeOffset]::Parse('2026-08-18T19:20:38Z')
Test-Case 'Progress after two minutes continues waiting' {
    $decision = Get-InvoiceHistoryWaitDecision `
        -Now $start.AddSeconds(240) `
        -StartedAt $start `
        -LastProgressAt $start.AddSeconds(230) `
        -ProcessAlive $true `
        -SummaryValid $false `
        -NoProgressTimeoutSeconds 180 `
        -AbsoluteTimeoutSeconds 600
    Require ($decision -ceq 'WAIT') "Expected WAIT; got $decision"
}
Test-Case 'No progress fails closed' {
    $decision = Get-InvoiceHistoryWaitDecision `
        -Now $start.AddSeconds(181) `
        -StartedAt $start `
        -LastProgressAt $start `
        -ProcessAlive $true `
        -SummaryValid $false `
        -NoProgressTimeoutSeconds 180 `
        -AbsoluteTimeoutSeconds 600
    Require ($decision -ceq 'NO_PROGRESS') (
        "Expected NO_PROGRESS; got $decision")
}
Test-Case 'Absolute ceiling fails despite recent progress' {
    $decision = Get-InvoiceHistoryWaitDecision `
        -Now $start.AddSeconds(600) `
        -StartedAt $start `
        -LastProgressAt $start.AddSeconds(599) `
        -ProcessAlive $true `
        -SummaryValid $false `
        -NoProgressTimeoutSeconds 180 `
        -AbsoluteTimeoutSeconds 600
    Require ($decision -ceq 'ABSOLUTE_LIMIT') (
        "Expected ABSOLUTE_LIMIT; got $decision")
}
Test-Case 'Late valid completion is accepted' {
    $decision = Get-InvoiceHistoryWaitDecision `
        -Now $start.AddSeconds(389) `
        -StartedAt $start `
        -LastProgressAt $start.AddSeconds(388) `
        -ProcessAlive $false `
        -SummaryValid $true `
        -NoProgressTimeoutSeconds 180 `
        -AbsoluteTimeoutSeconds 600
    Require ($decision -ceq 'COMPLETE') "Expected COMPLETE; got $decision"
}
Test-Case 'Completed source process captures exit code zero' {
    $result = Invoke-WaitFixture -ExitCode 0
    Require ($result.Result -ceq 'COMPLETE') "Expected COMPLETE; got $($result.Result)"
    Require ($result.ExitCode -eq 0) "Expected exit 0; got $($result.ExitCode)"
    Require ($result.Output.TotalBytes -gt 0) 'Progress output was not observed.'
}
Test-Case 'Completed source process captures nonzero exit code' {
    $result = Invoke-WaitFixture -ExitCode 7
    Require ($result.Result -ceq 'COMPLETE') "Expected COMPLETE; got $($result.Result)"
    Require ($result.ExitCode -eq 7) "Expected exit 7; got $($result.ExitCode)"
    Require ($runner -match '\$sourceExitCode -ne 0') (
        'Wrapper no longer rejects a captured nonzero exit code.')
}
Test-Case 'Source launch retains a directly owned process handle' {
    Require ($runner -match '\[Diagnostics\.Process\]::new\(\)') (
        'Source launch does not directly own a Diagnostics.Process handle.')
    Require ($runner -match 'StandardOutput\.BaseStream\.CopyToAsync') (
        'Source stdout capture was not preserved.')
    Require ($runner -notmatch '(?s)\$sourceProcess\s*=\s*Start-Process') (
        'Source launch still uses unreliable Start-Process -PassThru.')
}
Test-Case 'Exit code remains available when process already exited' {
    $result = Invoke-WaitFixture -ExitCode 0 -AlreadyExited
    Require ($result.Result -ceq 'COMPLETE') "Expected COMPLETE; got $($result.Result)"
    Require ($result.ExitCode -eq 0) "Expected exit 0; got $($result.ExitCode)"
}
Test-Case 'Live waiter preserves no-progress timeout behavior' {
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) (
        'DLE-OS-InvoiceHistoryTimeout-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    $fixture = $null
    try {
        $fixture = Start-WaitFixture -Root $tempRoot -ExitCode 0 `
            -DelayMilliseconds 5000
        $started = [DateTimeOffset](
            $fixture.Process.StartTime.ToUniversalTime())
        $result = Wait-InvoiceHistoryVProExtraction `
            -Process $fixture.Process -ProcessStartedAtUtc $started `
            -SummaryPath $fixture.Summary `
            -ProgressPaths @($fixture.Progress, $fixture.Summary) `
            -EvidencePath $fixture.Evidence -NoProgressTimeoutSeconds 1 `
            -AbsoluteTimeoutSeconds 10 -PollMilliseconds 25
        Require ($result.Result -ceq 'NO_PROGRESS') (
            "Expected NO_PROGRESS; got $($result.Result)")
        Require ($null -eq $result.ExitCode) (
            'A running timed-out process must not have an inferred exit code.')
    }
    finally {
        if ($fixture -and -not $fixture.Process.HasExited) {
            $fixture.Process.Kill()
            $fixture.Process.WaitForExit()
        }
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}
Test-Case 'Final summary still requires O_RDONLY' {
    $decision = Get-InvoiceHistoryWaitDecision `
        -Now $start.AddSeconds(389) `
        -StartedAt $start `
        -LastProgressAt $start.AddSeconds(388) `
        -ProcessAlive $false `
        -SummaryValid $false `
        -NoProgressTimeoutSeconds 180 `
        -AbsoluteTimeoutSeconds 600
    Require ($decision -ceq 'PROCESS_EXITED_INCOMPLETE') (
        "Invalid summary was accepted: $decision")
    $helper = Get-Content -LiteralPath $helperPath -Raw
    Require ($helper -match "open_mode,O_RDONLY") (
        'Wait contract no longer requires O_RDONLY.')
}
Test-Case 'Source identity mismatch remains rejected' {
    $builder = Get-Content -LiteralPath (Join-Path $root (
        'Tools\InvoiceHistory\build_invoice_history_refresh_package.py')) -Raw
    Require ($builder -match 'source identity changed during extraction') (
        'Source identity mismatch guard is absent.')
    Require ($builder -match 'art03_fid_before_hex') 'ART-03 FID guard absent.'
    Require ($builder -match 'art13_fin_after_hex') 'ART-13 FIN guard absent.'
}
Test-Case 'Lock and cleanup retain exact ownership' {
    foreach ($token in @(
        'SourceProcessId',
        'SourceProcessStartedAtUtc',
        'Stop-StartedSourceProcess',
        'Refusing cleanup because VPro PID',
        'WaitForExit(10000)',
        'if (-not $sourceProcessActive -and'
    )) {
        Require ($runner.Contains($token)) "Missing governed cleanup: $token"
    }
}
Test-Case 'Timeout configuration and evidence are explicit' {
    Require ($runner -match '\$noProgressTimeoutSeconds = 180') (
        'No-progress timeout is not 180 seconds.')
    Require ($runner -match '\$absoluteTimeoutSeconds = 600') (
        'Absolute timeout is not 600 seconds.')
    $helper = Get-Content -LiteralPath $helperPath -Raw
    foreach ($token in @(
        'NO_PROGRESS',
        'ABSOLUTE_LIMIT',
        'LastObservedProgressAtUtc',
        'OutputTotalBytes',
        'OutputLatestWriteTimeUtc'
    )) {
        Require ($helper.Contains($token)) "Missing timeout evidence: $token"
    }
}
Test-Case 'Output size and mtime changes are progress signals' {
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) (
        'DLE-OS-InvoiceHistoryProgress-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    try {
        $output = Join-Path $tempRoot 'BOUNDED_LINES.csv'
        Set-Content -LiteralPath $output -Value 'first' -Encoding ASCII
        $before = Get-InvoiceHistoryOutputProgressState -Paths @($output)
        Add-Content -LiteralPath $output -Value 'second' -Encoding ASCII
        (Get-Item -LiteralPath $output).LastWriteTimeUtc =
            [DateTime]::UtcNow.AddSeconds(1)
        $after = Get-InvoiceHistoryOutputProgressState -Paths @($output)
        Require ($after.TotalBytes -gt $before.TotalBytes) (
            'File-size growth was not observed.')
        Require ($after.Signature -cne $before.Signature) (
            'Size/mtime progress signature did not advance.')
    }
    finally {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

$failed = @($results | Where-Object { -not $_.Passed })
$results | Format-List Name, Passed, Error | Out-String -Width 240 | Write-Host
if ($failed.Count -gt 0) {
    throw "$($failed.Count) Invoice History progress-wait test(s) failed."
}
Write-Host (
    "INVOICE-HISTORY-PROGRESS-WAIT-001: PASS ($($results.Count) tests)")
