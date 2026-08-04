[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$artifactRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z'
$errorPath = Join-Path $artifactRoot 'BOUNDED_PROBE_ELEVATED_ERROR.log'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
trap {
    [ordered]@{
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = (
            [Security.Principal.WindowsIdentity]::GetCurrent().Name)
        Error = ($_ | Out-String).Trim()
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $errorPath -Encoding UTF8
    exit 1
}

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine $approvedIdentity -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw "Qualification requires non-elevated $approvedIdentity."
}

$runRoot =
    'C:\Add-On\Lab\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z'
$vpro = 'C:\BASIS\VPRO5\vpro5.exe'
$config = Join-Path $runRoot 'configINVOICEHISTORYREFRESH001.aon'
$program = Join-Path $runRoot (
    'Programs\INVOICE_HISTORY_BOUNDED_WINDOW_PROBE')
$sourcePaths = @(
    'X:\AON\ADATA\ART-03',
    'X:\AON\ADATA\ART-13'
)
$expectedOutputs = @(
    'BOUNDED_HEADERS.csv',
    'BOUNDED_LINES.csv',
    'BOUNDED_SUMMARY.csv'
)
$evidencePath = Join-Path $artifactRoot 'BOUNDED_PROBE_EXECUTION.json'
$stdoutPath = Join-Path $artifactRoot 'BOUNDED_PROBE.stdout.log'
$stderrPath = Join-Path $artifactRoot 'BOUNDED_PROBE.stderr.log'

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

foreach ($requiredPath in @($vpro, $config, $program) + $sourcePaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required fixed path is unavailable: $requiredPath"
    }
}

function Get-SourceIdentity {
    param([Parameter(Mandatory)][string[]] $Paths)

    @(
        foreach ($path in $Paths) {
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

function Compare-SourceIdentity {
    param(
        [Parameter(Mandatory)][object[]] $Before,
        [Parameter(Mandatory)][object[]] $After
    )

    foreach ($beforeItem in $Before) {
        $afterItem = @(
            $After | Where-Object Path -EQ $beforeItem.Path
        )
        if ($afterItem.Count -ne 1) {
            return $false
        }
        foreach ($property in @(
            'Length', 'LastWriteTimeUtc', 'Attributes'
        )) {
            if (
                $beforeItem[$property].ToString() -cne
                $afterItem[0][$property].ToString()
            ) {
                return $false
            }
        }
    }
    return $true
}

$startedAt = [DateTimeOffset]::UtcNow
$before = Get-SourceIdentity -Paths $sourcePaths
$existingVproProcesses = @(
    Get-Process -Name vpro5 -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, StartTime, Path
)

$arguments = @(
    '-tT0',
    '-nT0',
    '-m1024',
    "-c$config",
    $program
)
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process `
    -FilePath $vpro `
    -ArgumentList $arguments `
    -WorkingDirectory $runRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

$completionObserved = $false
$processExitObserved = $false
$deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $summaryPath = Join-Path $runRoot 'BOUNDED_SUMMARY.csv'
    $summaryComplete = $false
    if (
        (Test-Path -LiteralPath $summaryPath -PathType Leaf) -and
        (Get-Item -LiteralPath $summaryPath).LastWriteTimeUtc -ge
            $startedAt.UtcDateTime
    ) {
        try {
            $summaryComplete = (
                Get-Content -LiteralPath $summaryPath -Raw
            ) -match '(?im)^open_mode,O_RDONLY\s*$'
        }
        catch {
            $summaryComplete = $false
        }
    }
    $sourceProcess = @(
        Get-CimInstance Win32_Process -Filter (
            "ProcessId = $($process.Id)") -ErrorAction SilentlyContinue |
            Where-Object Name -IEQ 'vpro5.exe'
    )
    $processExitObserved = $sourceProcess.Count -eq 0
    if ($summaryComplete -and $processExitObserved) {
        $completionObserved = $true
        break
    }
    Start-Sleep -Milliseconds 250
}
if (-not $completionObserved) {
    throw (
        'Bounded probe completion was not observed within two minutes. ' +
        'No process was terminated.')
}
$stopwatch.Stop()

$after = Get-SourceIdentity -Paths $sourcePaths
$sourceIdentityStable = Compare-SourceIdentity -Before $before -After $after
$outputState = @(
    foreach ($name in $expectedOutputs) {
        $path = Join-Path $runRoot $name
        [ordered]@{
            Path = $path
            Exists = Test-Path -LiteralPath $path -PathType Leaf
            Length = if (Test-Path -LiteralPath $path -PathType Leaf) {
                [long](Get-Item -LiteralPath $path).Length
            }
            else {
                0
            }
            Sha256 = if (Test-Path -LiteralPath $path -PathType Leaf) {
                (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            }
            else {
                $null
            }
        }
    }
)
$summaryPath = Join-Path $runRoot 'BOUNDED_SUMMARY.csv'
$summaryText = if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    Get-Content -LiteralPath $summaryPath -Raw
}
else {
    ''
}
$summaryValues = @{}
if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    foreach ($row in Import-Csv -LiteralPath $summaryPath) {
        $summaryValues[$row.metric] = $row.value
    }
}
$passed = (
    $completionObserved -and
    $processExitObserved -and
    $sourceIdentityStable -and
    @($outputState | Where-Object { -not $_.Exists }).Count -eq 0 -and
    $summaryText -notmatch '(?im)^failure,' -and
    [long]$summaryValues['art03_headers_selected'] -gt 0 -and
    [long]$summaryValues['art13_lines_selected'] -gt 0 -and
    [long]$summaryValues['art13_lines_examined'] -eq
        [long]$summaryValues['art13_lines_selected'] -and
    [long]$summaryValues['art13_lines_examined'] -lt 79003
)

$evidence = [ordered]@{
    Verdict = if ($passed) { 'PASS' } else { 'FAIL' }
    StartedAtUtc = $startedAt.ToString('O')
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ElapsedMilliseconds = [long]$stopwatch.ElapsedMilliseconds
    WindowsIdentity = $identity.Name
    Elevated = $false
    VproExecutable = $vpro
    VproSha256 = (Get-FileHash -LiteralPath $vpro -Algorithm SHA256).Hash
    ConfigurationPath = $config
    ConfigurationSha256 = (
        Get-FileHash -LiteralPath $config -Algorithm SHA256
    ).Hash
    ProgramPath = $program
    ProgramSha256 = (
        Get-FileHash -LiteralPath $program -Algorithm SHA256
    ).Hash
    Arguments = $arguments
    ProcessId = $process.Id
    ProcessExitObserved = $processExitObserved
    CompletionObserved = $completionObserved
    ExistingVproProcesses = $existingVproProcesses
    SourceIdentityBefore = $before
    SourceIdentityAfter = $after
    SourceIdentityStable = $sourceIdentityStable
    SourceIdentityMethod = 'FILE_METADATA_PLUS_VPRO_FID_FIN'
    Outputs = $outputState
    Summary = $summaryText
    SourceOpenMode = 'O_RDONLY'
    SourceWrites = 0
    SourceLocksRequested = 0
}
$evidence |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $evidencePath -Encoding UTF8

if (-not $passed) {
    throw "Bounded qualification failed. Evidence: $evidencePath"
}

Write-Output "PASS: $evidencePath"
