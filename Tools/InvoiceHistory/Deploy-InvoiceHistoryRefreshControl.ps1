[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $StagingRoot,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repositoryRoot =
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = Join-Path $repositoryRoot (
    'Tools\LiveSnapshotRefresh\ControlHost\' +
    'DleOs.LiveSnapshotRefresh.ControlHost.csproj')
$runtime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$runtimeExecutable =
    Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
$erpRefreshStateRoot =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State'
$launcher = Join-Path $repositoryRoot (
    'Tools\LiveSnapshotRefresh\Start-ElevatedRefreshControlHost.ps1')
$artifactRoot = Join-Path $repositoryRoot (
    'Artifacts\InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z')

function Get-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ControlProcesses {
    Get-Process -Name 'DleOs.LiveSnapshotRefresh.ControlHost' `
        -ErrorAction SilentlyContinue |
        Where-Object {
            try {
                [IO.Path]::GetFullPath($_.Path) -ieq
                    [IO.Path]::GetFullPath($runtimeExecutable)
            }
            catch {
                $false
            }
        }
}

function Wait-ForControlRuntime {
    param([int] $Seconds = 30)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        try {
            $listener = Get-NetTCPConnection -State Listen -LocalPort 5043 `
                -ErrorAction Stop |
                Select-Object -First 1
            $runtimeProcess = @(Get-ControlProcesses) |
                Sort-Object StartTime -Descending |
                Select-Object -First 1
            if ($null -ne $runtimeProcess) {
                return [pscustomobject]@{
                    HttpSysProcessId = [int]$listener.OwningProcess
                    ProcessId = [int]$runtimeProcess.Id
                    ProcessPath = $runtimeProcess.Path
                }
            }
        }
        catch {
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The refresh control host did not become healthy on port 5043.'
}

if (-not $ElevatedStage) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.Name -ine $operator -or (Get-IsElevated)) {
        throw (
            'Deployment preparation must run as the non-elevated approved ' +
            'DLE-OS operator.')
    }
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $publishRoot = Join-Path $artifactRoot "ControlHostPublish-$stamp"
    $childEvidence = Join-Path $artifactRoot (
        "CONTROL_HOST_DEPLOYMENT_$stamp.json")
    $uacEvidence = Join-Path $artifactRoot (
        "CONTROL_HOST_UAC_REQUEST_$stamp.json")
    & 'C:\Program Files\dotnet\dotnet.exe' publish $project `
        -c Release --output $publishRoot --nologo
    if ($LASTEXITCODE -ne 0) {
        throw 'Invoice History refresh control-host publish failed.'
    }

    $arguments = @(
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-ElevatedStage',
        '-StagingRoot', "`"$publishRoot`"",
        '-EvidencePath', "`"$childEvidence`""
    )
    [ordered]@{
        Verdict = 'AWAITING_UAC'
        RequestedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        RequestingIdentity = $identity.Name
        RequestingTokenElevated = $false
        StagingRoot = $publishRoot
        ElevatedEvidencePath = $childEvidence
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $uacEvidence -Encoding UTF8
    try {
        $child = Start-Process `
            -FilePath 'powershell.exe' `
            -ArgumentList $arguments `
            -Verb RunAs `
            -Wait `
            -PassThru
    }
    catch {
        [ordered]@{
            Verdict = 'BLOCKED_UAC'
            FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
            Error = $_.Exception.Message
            StagingRoot = $publishRoot
            ElevatedEvidencePath = $childEvidence
        } |
            ConvertTo-Json -Depth 5 |
            Set-Content -LiteralPath $uacEvidence -Encoding UTF8
        throw
    }
    if ($child.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $childEvidence)) {
        throw (
            'Elevated control-host deployment failed. Review: ' +
            $childEvidence)
    }
    $result = Get-Content -LiteralPath $childEvidence -Raw |
        ConvertFrom-Json
    if ($result.Verdict -ne 'PASS') {
        throw "Control-host deployment verdict was $($result.Verdict)."
    }
    $result | ConvertTo-Json -Depth 10
    exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (
    $identity.Name -ine $operator -or
    -not (Get-IsElevated) -or
    [string]::IsNullOrWhiteSpace($StagingRoot) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)
) {
    throw 'The elevated deployment boundary is invalid.'
}
$resolvedStaging = [IO.Path]::GetFullPath($StagingRoot)
$resolvedArtifact = [IO.Path]::GetFullPath($artifactRoot)
if (
    -not $resolvedStaging.StartsWith(
        $resolvedArtifact + '\',
        [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath (
        Join-Path $resolvedStaging (
            'DleOs.LiveSnapshotRefresh.ControlHost.exe')))
) {
    throw 'The approved local control-host staging publication is invalid.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $artifactRoot "ControlHostRuntimeBackup-$stamp"
$oldProcesses = @(Get-ControlProcesses)
$evidence = [ordered]@{
    Verdict = 'FAIL'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity = $identity.Name
    Elevated = $true
    StagingRoot = $resolvedStaging
    RuntimeRoot = $runtime
    RuntimeBackupRoot = $backupRoot
    PreviousProcessIds = @($oldProcesses | ForEach-Object Id)
    ExistingErpRefreshRoutesPreserved = $true
    ApiOrQualifiedBoundaryModified = $false
    SourceAccessPerformed = $false
}
try {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    if (Test-Path -LiteralPath $runtime) {
        Copy-Item -Path (Join-Path $runtime '*') `
            -Destination $backupRoot -Recurse -Force
    }
    foreach ($process in $oldProcesses) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit(10000)
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -Path (Join-Path $resolvedStaging '*') `
        -Destination $runtime -Recurse -Force

    $stateAcl = Get-Acl -LiteralPath $erpRefreshStateRoot
    $stateAcl.SetAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $operator,
            [Security.AccessControl.FileSystemRights]::Modify,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $erpRefreshStateRoot -AclObject $stateAcl
    $evidence.ErpRefreshStateOperatorAccess = 'MODIFY'

    $url = 'http://dle-os-host:5043/'
    $urlAcl = (& netsh http show urlacl url=$url 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $urlAcl -notmatch [regex]::Escape($operator)) {
        if ($LASTEXITCODE -eq 0) {
            & netsh http delete urlacl url=$url | Out-Null
        }
        & netsh http add urlacl url=$url user=$operator | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'The exact HTTP.sys URL reservation could not be established.'
        }
    }

    & $launcher | Out-Null
    $qualified = Wait-ForControlRuntime
    $process = Get-Process -Id $qualified.ProcessId -ErrorAction Stop
    $evidence.Verdict = 'PASS'
    $evidence.ProcessId = $qualified.ProcessId
    $evidence.HttpSysProcessId = $qualified.HttpSysProcessId
    $evidence.RuntimeProcessPath = $process.Path
    $evidence.RuntimeIdentity = $identity.Name
    $evidence.Port5043Listening = $true
    $evidence.HttpQualification =
        'PENDING_WINDOWS_AUTHENTICATED_BROWSER_ACCEPTANCE'
}
catch {
    $evidence.Error = $_.Exception.Message
    foreach ($process in @(Get-ControlProcesses)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $backupRoot) {
        Copy-Item -Path (Join-Path $backupRoot '*') `
            -Destination $runtime -Recurse -Force
        try {
            & $launcher | Out-Null
            $rollback = Wait-ForControlRuntime
            $evidence.RollbackProcessId = $rollback.ProcessId
            $evidence.RollbackVerdict = 'PASS'
        }
        catch {
            $evidence.RollbackVerdict = 'FAIL'
            $evidence.RollbackError = $_.Exception.Message
        }
    }
}
finally {
    $evidence |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}
if ($evidence.Verdict -ne 'PASS') {
    throw "Control-host deployment failed: $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 10
