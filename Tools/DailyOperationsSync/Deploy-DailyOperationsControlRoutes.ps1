[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $StagingRoot,
    [string] $ManifestPath,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$project = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\ControlHost\' +
    'DleOs.LiveSnapshotRefresh.ControlHost.csproj')
$programSource = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\ControlHost\Program.cs')
$dailySource = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\ControlHost\DailyOperationsSyncCenter.cs')
$runtime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$runtimeExecutable = Join-Path $runtime (
    'DleOs.LiveSnapshotRefresh.ControlHost.exe')
$launcher = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\Start-ElevatedRefreshControlHost.ps1')
$artifactRoot = 'C:\DLE-OS\Canonical\Recovery\LIVE-SNAPSHOT-RECOVERY-002-20260804T003700Z\ControlHost5043'
$protectedPorts = @(5041, 5042, 5051, 5052)

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListenerPid([int] $Port) {
    $row = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $row) { return $null }
    [int]((-split $row.Line)[-1])
}

function Get-ProtectedListeners {
    $result = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $result[[string]$port] = Get-ListenerPid $port
    }
    $result
}

function Get-ControlProcesses {
    @(Get-Process -Name 'DleOs.LiveSnapshotRefresh.ControlHost' `
        -ErrorAction SilentlyContinue |
        Where-Object {
            try {
                [IO.Path]::GetFullPath($_.Path) -ieq
                    [IO.Path]::GetFullPath($runtimeExecutable)
            }
            catch { $false }
        })
}

function Wait-Control([int] $Seconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $process = @(Get-ControlProcesses) |
            Sort-Object StartTime -Descending |
            Select-Object -First 1
        if ($null -ne $process -and $null -ne (Get-ListenerPid 5043)) {
            return $process
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The 5043 control host did not become ready.'
}

function Invoke-HttpCheck([string] $Path) {
    $response = Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials `
        -Uri ('http://DLE-OS-HOST:5043' + $Path) -TimeoutSec 20
    if ([int]$response.StatusCode -ne 200) {
        throw "5043 $Path returned $($response.StatusCode)."
    }
    [ordered]@{
        Path = $Path
        StatusCode = [int]$response.StatusCode
        Body = $response.Content
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $operator) {
    throw "Deployment requires $operator; actual identity is $identity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Preparation must begin under the non-elevated operator token.'
    }
    $programDiff = git -C $repository diff -- `
        'Tools/LiveSnapshotRefresh/ControlHost/Program.cs'
    if ($LASTEXITCODE -ne 0) { throw 'Program.cs diff inspection failed.' }
    $addedProgramLines = @($programDiff |
        Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+' })
    $expectedAdds = @(
        '+string[] allowedOrigins =',
        '+    ["http://dle-os-host:5041", "http://dle-os-host:5051"];',
        '+            .WithOrigins(allowedOrigins)',
        '+app.MapDailyOperationsSync(',
        '+    authorizedOperator,',
        '+    "SnapshotRefreshOperator");'
    )
    if (
        $addedProgramLines.Count -ne $expectedAdds.Count -or
        (Compare-Object $addedProgramLines $expectedAdds)
    ) {
        throw 'Program.cs contains changes beyond the approved route registration.'
    }
    $removedProgramLines = @($programDiff |
        Where-Object { $_ -match '^-' -and $_ -notmatch '^---' })
    $expectedRemovals = @(
        '-const string allowedOrigin = "http://dle-os-host:5041";',
        '-            .WithOrigins(allowedOrigin)'
    )
    if (
        $removedProgramLines.Count -ne $expectedRemovals.Count -or
        (Compare-Object $removedProgramLines $expectedRemovals)
    ) {
        throw 'Program.cs contains removals beyond the approved CORS replacement.'
    }
    if (-not (Test-Path -LiteralPath $dailySource -PathType Leaf)) {
        throw 'The approved Daily Operations endpoint source is absent.'
    }
    $tracked = git -C $repository ls-files -- `
        'Tools/LiveSnapshotRefresh/ControlHost/DailyOperationsSyncCenter.cs'
    if ($LASTEXITCODE -ne 0 -or $tracked) {
        throw 'The Daily Operations endpoint source is not the expected additive file.'
    }

    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $stage = Join-Path $artifactRoot "Publish-$stamp"
    $manifest = Join-Path $artifactRoot "manifest-$stamp.json"
    $evidence = Join-Path $artifactRoot "deployment-$stamp.json"
    & 'C:\Program Files\dotnet\dotnet.exe' publish $project `
        -c Release --output $stage --nologo
    if ($LASTEXITCODE -ne 0) { throw '5043 publication failed.' }

    $manifestData = [ordered]@{
        CreatedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ProgramSourceSha256 = (Get-FileHash -Algorithm SHA256 `
            -LiteralPath $programSource).Hash
        DailySourceSha256 = (Get-FileHash -Algorithm SHA256 `
            -LiteralPath $dailySource).Hash
        StagedExeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (
            Join-Path $stage 'DleOs.LiveSnapshotRefresh.ControlHost.exe')).Hash
        StagedDllSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (
            Join-Path $stage 'DleOs.LiveSnapshotRefresh.ControlHost.dll')).Hash
        PreviousRuntimeExeSha256 = (Get-FileHash -Algorithm SHA256 `
            -LiteralPath $runtimeExecutable).Hash
        ProtectedListenersBefore = Get-ProtectedListeners
        Scope = '5043_DAILY_OPERATIONS_ROUTES_ONLY'
    }
    $manifestData | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $manifest -Encoding UTF8

    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"", '-ElevatedStage',
        '-StagingRoot', "`"$stage`"",
        '-ManifestPath', "`"$manifest`"",
        '-EvidencePath', "`"$evidence`""
    )
    $child = Start-Process powershell.exe -ArgumentList $arguments `
        -Verb RunAs -Wait -PassThru
    if ($child.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $evidence)) {
        throw "The governed 5043 deployment failed. Evidence: $evidence"
    }
    $result = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
    if ($result.Verdict -ne 'PASS') {
        throw "The governed 5043 deployment verdict was $($result.Verdict)."
    }
    $result | ConvertTo-Json -Depth 10
    exit 0
}

if (
    -not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($StagingRoot) -or
    [string]::IsNullOrWhiteSpace($ManifestPath) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)
) {
    throw 'The elevated 5043 deployment boundary is invalid.'
}
$stage = [IO.Path]::GetFullPath($StagingRoot)
$artifact = [IO.Path]::GetFullPath($artifactRoot)
if (-not $stage.StartsWith($artifact + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The staged publication is outside the recovery boundary.'
}
$manifestData = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifestData.Scope -ne '5043_DAILY_OPERATIONS_ROUTES_ONLY') {
    throw 'The deployment manifest scope is invalid.'
}
foreach ($file in @('DleOs.LiveSnapshotRefresh.ControlHost.exe',
        'DleOs.LiveSnapshotRefresh.ControlHost.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $file) -PathType Leaf)) {
        throw "The staged $file is absent."
    }
}
if (
    (Get-FileHash -Algorithm SHA256 -LiteralPath (
        Join-Path $stage 'DleOs.LiveSnapshotRefresh.ControlHost.exe')).Hash -ne
        $manifestData.StagedExeSha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath (
        Join-Path $stage 'DleOs.LiveSnapshotRefresh.ControlHost.dll')).Hash -ne
        $manifestData.StagedDllSha256
) {
    throw 'The staged binary hashes do not match the approved manifest.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backup = Join-Path $artifactRoot "RuntimeBackup-$stamp"
$oldProcesses = @(Get-ControlProcesses)
if ($oldProcesses.Count -ne 1) {
    throw "Expected one exact 5043 process; found $($oldProcesses.Count)."
}
$result = [ordered]@{
    Verdict = 'FAIL'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity = $identity
    Scope = $manifestData.Scope
    PreviousProcessId = [int]$oldProcesses[0].Id
    PreviousRuntimeExeSha256 = $manifestData.PreviousRuntimeExeSha256
    RuntimeBackup = $backup
    ProtectedListenersBefore = $manifestData.ProtectedListenersBefore
    FrontendModified = $false
    ApiModified = $false
    SqlModified = $false
}
try {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -Path (Join-Path $runtime '*') -Destination $backup `
        -Recurse -Force
    Stop-Process -Id $oldProcesses[0].Id -Force
    $oldProcesses[0].WaitForExit(15000)
    Copy-Item -Path (Join-Path $stage '*') -Destination $runtime `
        -Recurse -Force
    & $launcher | Out-Null
    $newProcess = Wait-Control
    $checks = @(
        Invoke-HttpCheck '/health'
        Invoke-HttpCheck '/api/platform/refresh/v1/status'
        Invoke-HttpCheck '/api/platform/daily-operations-sync/v1/status'
        Invoke-HttpCheck '/api/platform/daily-operations-sync/v1/latest'
        Invoke-HttpCheck '/api/platform/daily-operations-sync/v1/last-successful'
    )
    $after = Get-ProtectedListeners
    foreach ($port in $protectedPorts) {
        $key = [string]$port
        if ([int]$after[$key] -ne [int]$manifestData.ProtectedListenersBefore.$key) {
            throw "Protected listener $port changed identity."
        }
    }
    $result.NewProcessId = [int]$newProcess.Id
    $result.NewRuntimeExeSha256 = (Get-FileHash -Algorithm SHA256 `
        -LiteralPath $runtimeExecutable).Hash
    $result.ProtectedListenersAfter = $after
    $result.HttpChecks = $checks
    $result.Verdict = 'PASS'
}
catch {
    $result.Error = $_.Exception.Message
    foreach ($process in @(Get-ControlProcesses)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path (Join-Path $backup '*') -Destination $runtime `
        -Recurse -Force
    try {
        & $launcher | Out-Null
        $rollbackProcess = Wait-Control
        $result.RollbackVerdict = 'PASS'
        $result.RollbackProcessId = [int]$rollbackProcess.Id
    }
    catch {
        $result.RollbackVerdict = 'FAIL'
        $result.RollbackError = $_.Exception.Message
    }
}
finally {
    $result | ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}
if ($result.Verdict -ne 'PASS') {
    throw "The 5043 deployment failed: $($result.Error)"
}
$result | ConvertTo-Json -Depth 10
