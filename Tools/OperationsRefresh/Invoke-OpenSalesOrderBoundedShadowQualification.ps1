[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidatePattern('^OPENSOSHADOW-\d{8}T\d{6}Z-[A-F0-9]{8}$')]
    [string] $RunId,
    [Parameter(Mandatory)] [string] $RunRoot,
    [Parameter(Mandatory)] [string] $StatePath,
    [Parameter(Mandatory)] [string] $CurrentPath,
    [Parameter(Mandatory)] [string] $LeasePath,
    [Parameter(Mandatory)] [string] $RequestedBy,
    [ValidateRange(2, 3)] [int] $Samples = 3
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine $approvedIdentity -or
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Open SO shadow qualification requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$python = 'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$harness = Join-Path $repo 'Tools\OperationsRefresh\live_bounded_sales_order_shadow.py'
$expectedRoot = 'C:\DLE-OS\Qualification\OpenSalesOrderBoundedShadow\Runs'
$resolvedRunRoot = [IO.Path]::GetFullPath($RunRoot)
if ([IO.Path]::GetDirectoryName($resolvedRunRoot) -ine $expectedRoot -or
    [IO.Path]::GetFileName($resolvedRunRoot) -cne $RunId) {
    throw 'The shadow qualification run root is outside its fixed boundary.'
}
foreach ($path in @($python, $harness)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required qualification path is absent: $path"
    }
}
$dailyStatusPath = 'C:\DLE-OS\Canonical\DailyOperationsSync\State\status.json'
$daily = Get-Content -Raw -LiteralPath $dailyStatusPath | ConvertFrom-Json
if ($daily.OverallStatus -cne 'PASSED_PROMOTED_READY' -or
    [string]::IsNullOrWhiteSpace([string]$daily.RunId)) {
    throw 'The last Daily Operations source generation is not qualified.'
}
$basePackage = Join-Path (
    'C:\DLE-OS\Canonical\DailyOperationsSync\Runs\' + [string]$daily.RunId
) 'Candidates\WorkOrders\BasePackage'
if (-not (Test-Path -LiteralPath $basePackage -PathType Container)) {
    throw "The qualified Work Order base package is absent: $basePackage"
}

$started = [DateTimeOffset]::UtcNow
function Write-State([string] $Status, [string] $Step, [string] $Result = '') {
    $state = [ordered]@{
        RunId = $RunId
        Operation = 'OPEN_SALES_ORDER_BOUNDED_SHADOW_V1'
        Status = $Status
        CurrentStep = $Step
        RequestedBy = $RequestedBy
        ExecutionIdentity = $identity.Name
        StartedAtUtc = $started.ToString('O')
        HeartbeatAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        CompletedAtUtc = if ($Status -in @('SUCCEEDED', 'FAILED')) {
            [DateTimeOffset]::UtcNow.ToString('O')
        } else { $null }
        ArtifactRoot = $resolvedRunRoot
        Result = $Result
    }
    foreach ($path in @($StatePath, $CurrentPath)) {
        $stage = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        [IO.File]::WriteAllText(
            $stage, (($state | ConvertTo-Json -Depth 10) + "`n"),
            [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $stage -Destination $path -Force
    }
}

try {
    Write-State 'RUNNING' 'Running three isolated full-versus-bounded samples'
    $logRoot = Join-Path ([IO.Path]::GetDirectoryName($StatePath)) 'Logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $stdout = Join-Path $logRoot ($RunId + '.stdout.log')
    $stderr = Join-Path $logRoot ($RunId + '.stderr.log')
    $arguments = @(
        $harness, '--run-id', $RunId, '--run-root', $resolvedRunRoot,
        '--base-package', $basePackage, '--samples', [string]$Samples
    )
    $process = Start-Process -FilePath $python -ArgumentList $arguments `
        -WorkingDirectory $repo -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0) {
        throw "Live shadow harness returned $($process.ExitCode); see $stderr"
    }
    $resultPath = Join-Path $resolvedRunRoot 'qualification-result.json'
    $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    if ($result.result -cne 'PASS') {
        throw 'Live shadow qualification did not return PASS.'
    }
    Write-State 'SUCCEEDED' 'Qualification complete' $resultPath
}
catch {
    Write-State 'FAILED' 'Qualification failed' $_.Exception.Message
    throw
}
finally {
    if (Test-Path -LiteralPath $LeasePath -PathType Leaf) {
        try {
            $lease = Get-Content -Raw -LiteralPath $LeasePath | ConvertFrom-Json
            if ($lease.RunId -ceq $RunId) {
                Remove-Item -LiteralPath $LeasePath -Force
            }
        }
        catch {}
    }
}
