Set-StrictMode -Version Latest

function Get-InvoiceHistoryOutputProgressState {
    param(
        [Parameter(Mandatory)]
        [string[]] $Paths
    )

    $files = @(
        foreach ($path in $Paths) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $item = Get-Item -LiteralPath $path -Force
                [pscustomobject][ordered]@{
                    Path = $item.FullName
                    Length = [long]$item.Length
                    LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
                    LastWriteTimeUtcTicks = $item.LastWriteTimeUtc.Ticks
                }
            }
        }
    )
    $latestTicks = 0L
    if ($files.Count -gt 0) {
        $latestTicks = [long](
            $files |
                Measure-Object -Property LastWriteTimeUtcTicks -Maximum
        ).Maximum
    }
    [pscustomobject][ordered]@{
        Signature = (@(
            $files |
                Sort-Object Path |
                ForEach-Object {
                    '{0}|{1}|{2}' -f
                        $_.Path, $_.Length, $_.LastWriteTimeUtcTicks
                }
        ) -join "`n")
        FileCount = $files.Count
        TotalBytes = [long](
            $files | Measure-Object -Property Length -Sum).Sum
        LatestWriteTimeUtc = if ($latestTicks -gt 0) {
            [DateTime]::new($latestTicks, [DateTimeKind]::Utc).ToString('O')
        }
        else {
            $null
        }
        Files = $files
    }
}

function Get-InvoiceHistoryWaitDecision {
    param(
        [Parameter(Mandatory)]
        [DateTimeOffset] $Now,
        [Parameter(Mandatory)]
        [DateTimeOffset] $StartedAt,
        [Parameter(Mandatory)]
        [DateTimeOffset] $LastProgressAt,
        [Parameter(Mandatory)]
        [bool] $ProcessAlive,
        [Parameter(Mandatory)]
        [bool] $SummaryValid,
        [Parameter(Mandatory)]
        [int] $NoProgressTimeoutSeconds,
        [Parameter(Mandatory)]
        [int] $AbsoluteTimeoutSeconds
    )

    if (($Now - $StartedAt).TotalSeconds -ge $AbsoluteTimeoutSeconds) {
        return 'ABSOLUTE_LIMIT'
    }
    if (-not $ProcessAlive) {
        if ($SummaryValid) { return 'COMPLETE' }
        return 'PROCESS_EXITED_INCOMPLETE'
    }
    if (($Now - $LastProgressAt).TotalSeconds -ge
        $NoProgressTimeoutSeconds) {
        return 'NO_PROGRESS'
    }
    return 'WAIT'
}

function Write-InvoiceHistoryWaitEvidence {
    param(
        [Parameter(Mandatory)]
        [string] $Path,
        [Parameter(Mandatory)]
        [System.Collections.IDictionary] $Value
    )
    $Value |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $Path -Encoding UTF8
}

function Wait-InvoiceHistoryVProExtraction {
    param(
        [Parameter(Mandatory)]
        [Diagnostics.Process] $Process,
        [Parameter(Mandatory)]
        [DateTimeOffset] $ProcessStartedAtUtc,
        [Parameter(Mandatory)]
        [string] $SummaryPath,
        [Parameter(Mandatory)]
        [string[]] $ProgressPaths,
        [Parameter(Mandatory)]
        [string] $EvidencePath,
        [int] $NoProgressTimeoutSeconds = 180,
        [int] $AbsoluteTimeoutSeconds = 600,
        [int] $PollMilliseconds = 500
    )

    $lastProgressAt = $ProcessStartedAtUtc
    $progress = Get-InvoiceHistoryOutputProgressState -Paths $ProgressPaths
    $lastSignature = $progress.Signature
    $lastEvidenceAt = [DateTimeOffset]::MinValue
    $decision = 'WAIT'
    $summaryValid = $false

    while ($decision -eq 'WAIT') {
        $now = [DateTimeOffset]::UtcNow
        $Process.Refresh()
        $processAlive = -not $Process.HasExited
        $progress = Get-InvoiceHistoryOutputProgressState -Paths $ProgressPaths
        if ($progress.Signature -cne $lastSignature) {
            $lastSignature = $progress.Signature
            $lastProgressAt = $now
        }
        $summaryValid = $false
        if (Test-Path -LiteralPath $SummaryPath -PathType Leaf) {
            try {
                $summaryValid = (
                    Get-Content -LiteralPath $SummaryPath -Raw
                ) -match '(?im)^open_mode,O_RDONLY\s*$'
            }
            catch {
                $summaryValid = $false
            }
        }
        $decision = Get-InvoiceHistoryWaitDecision `
            -Now $now `
            -StartedAt $ProcessStartedAtUtc `
            -LastProgressAt $lastProgressAt `
            -ProcessAlive $processAlive `
            -SummaryValid $summaryValid `
            -NoProgressTimeoutSeconds $NoProgressTimeoutSeconds `
            -AbsoluteTimeoutSeconds $AbsoluteTimeoutSeconds
        if (
            $decision -ne 'WAIT' -or
            ($now - $lastEvidenceAt).TotalSeconds -ge 5
        ) {
            Write-InvoiceHistoryWaitEvidence -Path $EvidencePath -Value (
                [ordered]@{
                    State = $decision
                    TimeoutReason = if ($decision -in @(
                        'NO_PROGRESS', 'ABSOLUTE_LIMIT')) {
                        $decision
                    }
                    else { $null }
                    ProcessId = $Process.Id
                    ProcessStartedAtUtc = $ProcessStartedAtUtc.ToString('O')
                    ProcessAlive = $processAlive
                    LastObservedProgressAtUtc = $lastProgressAt.ToString('O')
                    ObservedAtUtc = $now.ToString('O')
                    ElapsedMilliseconds = [long](
                        $now - $ProcessStartedAtUtc).TotalMilliseconds
                    NoProgressElapsedMilliseconds = [long](
                        $now - $lastProgressAt).TotalMilliseconds
                    NoProgressTimeoutSeconds = $NoProgressTimeoutSeconds
                    AbsoluteTimeoutSeconds = $AbsoluteTimeoutSeconds
                    SummaryValid = $summaryValid
                    OutputFileCount = $progress.FileCount
                    OutputTotalBytes = $progress.TotalBytes
                    OutputLatestWriteTimeUtc = $progress.LatestWriteTimeUtc
                    OutputFiles = $progress.Files
                })
            $lastEvidenceAt = $now
        }
        if ($decision -eq 'WAIT') {
            Start-Sleep -Milliseconds $PollMilliseconds
        }
    }

    [pscustomobject][ordered]@{
        Result = $decision
        TimeoutReason = if ($decision -in @(
            'NO_PROGRESS', 'ABSOLUTE_LIMIT')) { $decision } else { $null }
        ProcessId = $Process.Id
        ProcessStartedAtUtc = $ProcessStartedAtUtc
        ProcessAlive = $processAlive
        LastObservedProgressAtUtc = $lastProgressAt
        ObservedAtUtc = $now
        ElapsedMilliseconds = [long](
            $now - $ProcessStartedAtUtc).TotalMilliseconds
        SummaryValid = $summaryValid
        Output = $progress
    }
}
