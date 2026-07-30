[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$artifactRoot = Join-Path $repository (
    'Artifacts\PlatformFreshnessCache001\' +
    'PLATFORMFRESHNESSCACHE001-20260730T010815Z')
$toolRoot = Join-Path $repository 'Tools\PlatformFreshnessCache'
$publicationRoot = 'C:\ProgramData\DLE-OS\Frontend'
$refreshRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$qualifiedBoundary =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\' +
    'QualifiedBoundary\current-qualified-snapshot.json'
$statusPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json'
$sourceStatePath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\' +
    'State\qualified-source-state.json'
$publisher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Publish-LiveCanonicalApi.ps1')
$liveLauncher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1')
$liveStopper = Join-Path $server (
    'DleOs.PlatformApi.Tests\Stop-LiveCanonicalApiAsDedicatedIdentity.ps1')
$frontendPublisher = Join-Path $toolRoot 'Publish-VersionedFrontend.ps1'
$frontendRollback = Join-Path $toolRoot 'Rollback-VersionedFrontend.ps1'
$serverOverlay = Join-Path $toolRoot 'Apply-ServerSourceOverlay.ps1'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Listener {
    param([int] $Port)
    $line = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $line) { return $null }
    [int]((-split $line.Line)[-1])
}

function Wait-Listener {
    param([int] $Port, [int] $Seconds = 60)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $pidValue = Get-Listener $Port
        if ($null -ne $pidValue) { return $pidValue }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach LISTENING."
}

function Get-ProcessOwner {
    param([int] $ProcessId)
    $process = Get-CimInstance Win32_Process -Filter (
        "ProcessId=$ProcessId")
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    "$($owner.Domain)\$($owner.User)"
}

function Set-LiveRuntimeReadExecuteAcl {
    param([string] $Path)
    $identity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
    $acl = Get-Acl -LiteralPath $Path
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $identity,
        [Security.AccessControl.FileSystemRights]::ReadAndExecute,
        (
            [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
        ),
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl

    $qualifiedRules = @(
        (Get-Acl -LiteralPath $Path).Access |
            Where-Object {
                $_.IdentityReference.Value -ieq $identity -and
                $_.AccessControlType -eq
                    [Security.AccessControl.AccessControlType]::Allow
            }
    )
    $rightsText =
        if ($qualifiedRules.Count -eq 1) {
            $qualifiedRules[0].FileSystemRights.ToString()
        }
        else {
            ''
        }
    if (
        $qualifiedRules.Count -ne 1 -or
        $rightsText.IndexOf(
            'ReadAndExecute', [StringComparison]::Ordinal) -lt 0 -or
        $rightsText.IndexOf(
            'Write', [StringComparison]::Ordinal) -ge 0 -or
        $rightsText.IndexOf(
            'Modify', [StringComparison]::Ordinal) -ge 0 -or
        $rightsText.IndexOf(
            'FullControl', [StringComparison]::Ordinal) -ge 0
    ) {
        throw 'LIVE runtime read/execute ACL qualification failed.'
    }
}

function Stop-HistoricalRuntime {
    $pidValue = Get-Listener 5041
    if ($null -eq $pidValue) { return }
    $process = Get-CimInstance Win32_Process -Filter (
        "ProcessId=$pidValue")
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    if (
        "$($owner.Domain)\$($owner.User)" -ine $operator -or
        [string]$process.CommandLine -notlike '*DLE-OS-Server.dll*'
    ) {
        throw 'Port 5041 is owned by an unqualified process.'
    }
    Stop-Process -Id $pidValue -Force
}

function Start-HistoricalRuntime {
    $logRoot = 'C:\ProgramData\DLE-OS\Frontend\Logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $assembly = Join-Path $server (
        'bin\Release\net8.0\DLE-OS-Server.dll')
    Start-Process `
        -FilePath 'C:\Program Files\dotnet\dotnet.exe' `
        -ArgumentList @("`"$assembly`"") `
        -WorkingDirectory $server `
        -WindowStyle Hidden `
        -RedirectStandardOutput (
            Join-Path $logRoot 'historical-runtime.stdout.log') `
        -RedirectStandardError (
            Join-Path $logRoot 'historical-runtime.stderr.log') |
        Out-Null
    Wait-Listener 5041
}

function Convert-BytesToHex {
    param([byte[]] $Bytes)
    ([BitConverter]::ToString($Bytes)).Replace('-', '')
}

function Get-SourceIndicatorFingerprint {
    param([object[]] $Sources)
    $material = foreach ($source in $Sources) {
        @(
            [string]$source.Path,
            [string]$source.Length,
            [string]$source.LastWriteTimeUtc,
            [string]$source.Access
        ) -join "`0"
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        Convert-BytesToHex (
            $algorithm.ComputeHash(
                [Text.Encoding]::UTF8.GetBytes(($material -join "`n"))))
    }
    finally {
        $algorithm.Dispose()
    }
}

function Open-LiveConnection {
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=10;Application Name=PLATFORM-FRESHNESS-CACHE-001'
    $connection =
        [System.Data.SqlClient.SqlConnection]::new($connectionString)
    $connection.Open()
    return $connection
}

function Get-SnapshotRow {
    $connection = Open-LiveConnection
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT ImportRunId, EnvironmentId, MirrorRunId, PackageHash, ContractVersion,
       SnapshotTimestampUtc, BillOfMaterialCount, InventoryItemCount,
       WorkOrderCount, GeneralLedgerAccountCount, TotalCount
FROM liveapi.SnapshotMetadata;
'@
        $table = [System.Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        if ($table.Rows.Count -ne 1) {
            throw 'LIVE snapshot metadata did not return exactly one row.'
        }
        return $table.Rows[0]
    }
    finally {
        $connection.Dispose()
    }
}

function Invoke-SqlScript {
    param([string] $Path)
    $text = [IO.File]::ReadAllText($Path)
    $batches = [regex]::Split(
        $text,
        '(?im)^\s*GO\s*(?:--.*)?$') |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $connection = Open-LiveConnection
    $transaction = $connection.BeginTransaction(
        [System.Data.IsolationLevel]::Serializable)
    try {
        foreach ($batch in $batches) {
            $command = $connection.CreateCommand()
            $command.Transaction = $transaction
            $command.CommandText = $batch
            $command.CommandTimeout = 60
            [void]$command.ExecuteNonQuery()
        }
        $transaction.Commit()
    }
    catch {
        $transaction.Rollback()
        throw
    }
    finally {
        $transaction.Dispose()
        $connection.Dispose()
    }
}

function Seed-OperationalStatus {
    param(
        [System.Data.DataRow] $Snapshot,
        [object] $Status,
        [object] $SourceState
    )
    $fingerprint =
        Get-SourceIndicatorFingerprint @($SourceState.Sources)
    $connection = Open-LiveConnection
    try {
        $command = $connection.CreateCommand()
        $command.CommandType =
            [System.Data.CommandType]::StoredProcedure
        $command.CommandText = 'platform.RecordLiveFullQualification'
        [void]$command.Parameters.AddWithValue(
            '@ImportRunId', [Guid]$Snapshot.ImportRunId)
        [void]$command.Parameters.AddWithValue(
            '@MirrorRunId', [string]$Snapshot.MirrorRunId)
        [void]$command.Parameters.AddWithValue(
            '@PackageHash', [string]$Snapshot.PackageHash)
        $snapshotParameter = $command.Parameters.Add(
            '@SnapshotAsOfUtc', [Data.SqlDbType]::DateTime2)
        $snapshotParameter.Scale = 7
        $snapshotParameter.Value =
            [DateTime]$Snapshot.SnapshotTimestampUtc
        $sourceCheckedParameter = $command.Parameters.Add(
            '@SourceCheckedAtUtc', [Data.SqlDbType]::DateTime2)
        $sourceCheckedParameter.Scale = 7
        $sourceCheckedParameter.Value =
            ([DateTimeOffset]$SourceState.QualifiedAtUtc).UtcDateTime
        $qualificationParameter = $command.Parameters.Add(
            '@QualificationCompletedAtUtc', [Data.SqlDbType]::DateTime2)
        $qualificationParameter.Scale = 7
        $qualificationParameter.Value =
            ([DateTimeOffset]$Status.CompletedAtUtc).UtcDateTime
        [void]$command.Parameters.AddWithValue(
            '@SourceIndicatorFingerprint', $fingerprint)
        [void]$command.Parameters.AddWithValue(
            '@FullExtractionRunId', [string]$Status.RunId)
        [void]$command.Parameters.AddWithValue(
            '@ForceFullIntent', [bool]$Status.ForceFullExtraction)
        [void]$command.ExecuteNonQuery()
    }
    finally {
        $connection.Dispose()
    }
    return $fingerprint
}

function Set-JsonProperty {
    param([object] $Object, [string] $Name, [object] $Value)
    $Object |
        Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Set-BoundaryValues {
    param([object] $Boundary, [System.Data.DataRow] $Snapshot)
    Set-JsonProperty $Boundary 'ExpectedImportRunId' (
        ([Guid]$Snapshot.ImportRunId).ToString('D').ToUpperInvariant())
    Set-JsonProperty $Boundary 'ExpectedMirrorRunId' (
        [string]$Snapshot.MirrorRunId)
    Set-JsonProperty $Boundary 'ExpectedPackageHash' (
        [string]$Snapshot.PackageHash)
    Set-JsonProperty $Boundary 'ExpectedBillOfMaterialCount' (
        [long]$Snapshot.BillOfMaterialCount)
    Set-JsonProperty $Boundary 'ExpectedInventoryItemCount' (
        [long]$Snapshot.InventoryItemCount)
    Set-JsonProperty $Boundary 'ExpectedWorkOrderCount' (
        [long]$Snapshot.WorkOrderCount)
    Set-JsonProperty $Boundary 'ExpectedGeneralLedgerAccountCount' (
        [long]$Snapshot.GeneralLedgerAccountCount)
    Set-JsonProperty $Boundary 'SnapshotWarningMinutes' 1440
    Set-JsonProperty $Boundary 'SourceCheckWarningMinutes' 1440
    Set-JsonProperty $Boundary 'SourceCheckHardExpirationMinutes' 4320
    Set-JsonProperty $Boundary 'QualificationWarningMinutes' 10080
}

function Write-JsonAtomic {
    param([string] $Path, [object] $Value)
    $stage = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.staging'
    [IO.File]::WriteAllText(
        $stage,
        ($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $stage -Destination $Path -Force
}

function Update-Configuration {
    param([System.Data.DataRow] $Snapshot)
    $protected =
        Get-Content -LiteralPath $qualifiedBoundary -Raw |
        ConvertFrom-Json
    Set-BoundaryValues $protected.LiveQualifiedBoundary $Snapshot
    Write-JsonAtomic $qualifiedBoundary $protected

    $sourceBoundaryPath = Join-Path $server (
        'live-qualified-boundary.json')
    $sourceBoundary =
        Get-Content -LiteralPath $sourceBoundaryPath -Raw |
        ConvertFrom-Json
    Set-BoundaryValues $sourceBoundary.LiveQualifiedBoundary $Snapshot
    Write-JsonAtomic $sourceBoundaryPath $sourceBoundary

    $liveSettingsPath = Join-Path $server 'appsettings.Live.json'
    $liveSettings =
        Get-Content -LiteralPath $liveSettingsPath -Raw |
        ConvertFrom-Json
    Set-BoundaryValues $liveSettings.LiveApi $Snapshot
    Write-JsonAtomic $liveSettingsPath $liveSettings
}

function Patch-ExactText {
    param(
        [string] $Path,
        [string] $OldText,
        [string] $NewText,
        [string] $Description
    )
    $text = [IO.File]::ReadAllText($Path)
    if (-not $text.Contains($OldText)) {
        if ($text.Contains($NewText)) { return }
        throw "$Description patch anchor was not found: $Path"
    }
    [IO.File]::WriteAllText(
        $Path,
        $text.Replace($OldText, $NewText),
        [Text.UTF8Encoding]::new($false))
}

function Invoke-HttpEvidence {
    param([string] $ExpectedBuildId)
    $shell = Invoke-WebRequest `
        -Uri 'http://DLE-OS-HOST:5041/' `
        -UseBasicParsing `
        -Headers @{ 'Cache-Control' = 'no-cache' } `
        -TimeoutSec 15
    if (
        $shell.StatusCode -ne 200 -or
        $shell.Headers['Cache-Control'] -notmatch 'no-store' -or
        $shell.Content -notmatch [regex]::Escape($ExpectedBuildId)
    ) {
        throw 'Frontend shell qualification failed.'
    }
    $assetMatch = [regex]::Match(
        $shell.Content,
        '/assets/' +
        [regex]::Escape($ExpectedBuildId) +
        '/SRC/[^"''\s>]+\.js')
    if (-not $assetMatch.Success) {
        throw 'Versioned frontend asset reference was not found.'
    }
    $asset = Invoke-WebRequest `
        -Uri ('http://DLE-OS-HOST:5041' + $assetMatch.Value) `
        -UseBasicParsing `
        -TimeoutSec 15
    if (
        $asset.StatusCode -ne 200 -or
        $asset.Headers['Cache-Control'] -notmatch 'immutable'
    ) {
        throw 'Immutable frontend asset qualification failed.'
    }
    [ordered]@{
        BuildId = $ExpectedBuildId
        ShellStatus = $shell.StatusCode
        ShellCacheControl = [string]$shell.Headers['Cache-Control']
        AssetPath = $assetMatch.Value
        AssetStatus = $asset.StatusCode
        AssetCacheControl = [string]$asset.Headers['Cache-Control']
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $operator) {
    throw "Deployment requires $operator; actual identity is $identity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Deployment preparation must start non-elevated.'
    }
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $childEvidence = Join-Path $artifactRoot (
        "DEPLOYMENT_$stamp.json")
    $child = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', "`"$PSCommandPath`"",
            '-ElevatedStage',
            '-EvidencePath', "`"$childEvidence`""
        ) `
        -Verb RunAs `
        -Wait `
        -PassThru
    if (
        $child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $childEvidence -PathType Leaf)
    ) {
        throw "Elevated deployment failed. Evidence: $childEvidence"
    }
    Get-Content -LiteralPath $childEvidence -Raw
    exit 0
}

if (-not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)) {
    throw 'Elevated deployment boundary is invalid.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $artifactRoot "DeploymentBackup-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = $identity
    Elevated = $true
    SourceAccessPerformed = $false
    XDriveWrites = 0
    PortsBefore = [ordered]@{
        Historical = Get-Listener 5041
        Live = Get-Listener 5042
        Refresh = Get-Listener 5043
        Promotion = Get-Listener 5044
    }
    BackupRoot = $backupRoot
}
$mutationStarted = $false
$databaseBackup = $null

try {
    $snapshotBefore = Get-SnapshotRow
    $statusBefore =
        Get-Content -LiteralPath $statusPath -Raw |
        ConvertFrom-Json
    $sourceState =
        Get-Content -LiteralPath $sourceStatePath -Raw |
        ConvertFrom-Json

    $backupFiles = @(
        'Program.cs',
        'appsettings.json',
        'appsettings.Live.json',
        'live-qualified-boundary.json',
        'Options\FrontendOptions.cs',
        'Options\LiveApiOptions.cs',
        'Options\LiveApiQualifiedBoundary.cs',
        'Hosting\FrontendApplicationExtensions.cs',
        'Models\Platform\LivePlatformModels.cs',
        'Contracts\Platform\LivePlatformDtos.cs',
        'Data\Platform\LivePlatformStatusRepository.cs',
        'DleOs.PlatformApi.Tests\Publish-LiveCanonicalApi.ps1'
    )
    foreach ($relative in $backupFiles) {
        $source = Join-Path $server $relative
        $target = Join-Path $backupRoot (
            'ServerSource\' + $relative)
        New-Item -ItemType Directory -Path (
            Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    foreach ($pair in @(
        [pscustomobject]@{
            Source = $qualifiedBoundary
            Target = Join-Path $backupRoot (
                'Protected\current-qualified-snapshot.json')
        },
        [pscustomobject]@{
            Source = Join-Path $refreshRoot (
                'Invoke-LiveSnapshotRefresh.ps1')
            Target = Join-Path $backupRoot (
                'Refresh\Invoke-LiveSnapshotRefresh.ps1')
        },
        [pscustomobject]@{
            Source = Join-Path $refreshRoot (
                'Complete-LiveSnapshotPromotion.ps1')
            Target = Join-Path $backupRoot (
                'Refresh\Complete-LiveSnapshotPromotion.ps1')
        },
        [pscustomobject]@{
            Source = Join-Path $refreshRoot (
                'Promote-QualifiedSnapshotBoundary.ps1')
            Target = Join-Path $backupRoot (
                'Refresh\Promote-QualifiedSnapshotBoundary.ps1')
        }
    )) {
        New-Item -ItemType Directory -Path (
            Split-Path -Parent $pair.Target) -Force | Out-Null
        Copy-Item -LiteralPath $pair.Source -Destination $pair.Target -Force
    }
    $liveRuntimeRoot = 'C:\Program Files\DLE-OS\LiveCanonicalApi'
    Copy-Item `
        -LiteralPath $liveRuntimeRoot `
        -Destination (Join-Path $backupRoot 'LiveRuntime') `
        -Recurse -Force
    $historicalBin = Join-Path $server 'bin\Release\net8.0'
    if (Test-Path -LiteralPath $historicalBin -PathType Container) {
        Copy-Item `
            -LiteralPath $historicalBin `
            -Destination (Join-Path $backupRoot 'HistoricalRuntime') `
            -Recurse -Force
    }
    foreach ($name in @(
        'current-release.json',
        'previous-release.json'
    )) {
        $pointer = Join-Path $publicationRoot $name
        if (Test-Path -LiteralPath $pointer -PathType Leaf) {
            $target = Join-Path $backupRoot ('Frontend\' + $name)
            New-Item -ItemType Directory -Path (
                Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath $pointer -Destination $target -Force
        }
    }

    $backupDirectory = 'C:\DLE-OS\Backups\LiveApi001'
    if (-not (Test-Path -LiteralPath $backupDirectory -PathType Container)) {
        throw 'The qualified SQL backup directory is absent.'
    }
    $databaseBackup = Join-Path $backupDirectory (
        "DLE_OS_CANONICAL_LIVE_$stamp.bak")
    $masterConnection = [System.Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=master;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=10;Application Name=PLATFORM-FRESHNESS-CACHE-001 Backup')
    try {
        $masterConnection.Open()
        $backupCommand = $masterConnection.CreateCommand()
        $escapedBackup = $databaseBackup.Replace("'", "''")
        $backupCommand.CommandText =
            "BACKUP DATABASE [DLE_OS_CANONICAL_LIVE] TO DISK=N'$escapedBackup' " +
            'WITH COPY_ONLY, INIT, CHECKSUM; RESTORE VERIFYONLY FROM DISK=' +
            "N'$escapedBackup' WITH CHECKSUM;"
        $backupCommand.CommandTimeout = 600
        [void]$backupCommand.ExecuteNonQuery()
    }
    finally {
        $masterConnection.Dispose()
    }
    $evidence.DatabaseBackup = [ordered]@{
        Path = $databaseBackup
        Length = (Get-Item -LiteralPath $databaseBackup).Length
        Sha256 = (
            Get-FileHash $databaseBackup -Algorithm SHA256).Hash
        Verified = $true
    }

    $mutationStarted = $true
    & $serverOverlay -ServerRoot $server | Out-Null
    Invoke-SqlScript (
        Join-Path $toolRoot (
            'Database\032_AddLiveSnapshotOperationalStatus.sql'))
    $indicatorFingerprint =
        Seed-OperationalStatus $snapshotBefore $statusBefore $sourceState

    Copy-Item `
        -LiteralPath (
            Join-Path $repository (
                'Tools\LiveSnapshotRefresh\Invoke-LiveSnapshotRefresh.ps1')) `
        -Destination (
            Join-Path $refreshRoot 'Invoke-LiveSnapshotRefresh.ps1') `
        -Force
    Copy-Item `
        -LiteralPath (
            Join-Path $repository (
                'Tools\LiveSnapshotRefresh\Complete-LiveSnapshotPromotion.ps1')) `
        -Destination (
            Join-Path $refreshRoot (
                'Complete-LiveSnapshotPromotion.ps1')) `
        -Force

    $thresholdBlock = @'
        SnapshotWarningMinutes = 1440
        SourceCheckWarningMinutes = 1440
        SourceCheckHardExpirationMinutes = 4320
        QualificationWarningMinutes = 10080
'@
    Patch-ExactText `
        -Path (
            Join-Path $refreshRoot (
                'Promote-QualifiedSnapshotBoundary.ps1')) `
        -OldText '        FreshnessThresholdMinutes = 1440' `
        -NewText $thresholdBlock.TrimEnd() `
        -Description 'Qualified-boundary threshold'

    $publisherOld = @'
    'FreshnessThresholdMinutes', 'WorkOrderNumberWidth',
'@
    $publisherNew = @'
    'SnapshotWarningMinutes', 'SourceCheckWarningMinutes',
    'SourceCheckHardExpirationMinutes', 'QualificationWarningMinutes',
    'WorkOrderNumberWidth',
'@
    Patch-ExactText `
        -Path $publisher `
        -OldText $publisherOld.TrimEnd() `
        -NewText $publisherNew.TrimEnd() `
        -Description 'LIVE publisher boundary-property'

    Update-Configuration $snapshotBefore

    # The historical runtime executes directly from this build output. Stop
    # only that qualified listener before replacing its loaded assembly.
    Stop-HistoricalRuntime
    $buildOutput = @(
        & 'C:\Program Files\dotnet\dotnet.exe' build (
            Join-Path $server 'DLE-OS-Server.csproj') `
            -c Release --nologo
    ) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) {
        throw "Server build failed.`n$buildOutput"
    }
    $evidence.ServerBuild = 'PASS'

    $buildA = @(
        & $frontendPublisher `
            -SourceRoot $repository `
            -PublicationRoot $publicationRoot `
            -PublishedAtUtc ([DateTimeOffset]::UtcNow)
    ) -join [Environment]::NewLine | ConvertFrom-Json

    if ($null -ne (Get-Listener 5042)) {
        & $liveStopper | Out-Null
    }
    Set-LiveRuntimeReadExecuteAcl $liveRuntimeRoot
    $evidence.LivePublishOutput = (@(& $publisher) | Out-String).Trim()
    $evidence.LiveLaunchOutput = (@(& $liveLauncher) | Out-String).Trim()
    $livePid = Wait-Listener 5042
    $historicalPid = Start-HistoricalRuntime

    $httpA = Invoke-HttpEvidence $buildA.FrontendBuildId
    $buildB = @(
        & $frontendPublisher `
            -SourceRoot $repository `
            -PublicationRoot $publicationRoot `
            -PublishedAtUtc (
                [DateTimeOffset]::UtcNow.AddSeconds(1))
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $httpB = Invoke-HttpEvidence $buildB.FrontendBuildId
    $rollbackA = @(
        & $frontendRollback -PublicationRoot $publicationRoot
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $httpRollback = Invoke-HttpEvidence $buildA.FrontendBuildId
    $rollForwardB = @(
        & $frontendRollback -PublicationRoot $publicationRoot
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $httpRollForward = Invoke-HttpEvidence $buildB.FrontendBuildId

    $readiness = Invoke-RestMethod `
        -Uri (
            'http://DLE-OS-HOST:5042/' +
            'api/platform/live/v1/readiness') `
        -TimeoutSec 20
    if (
        $readiness.readinessVerdict -ne 'Ready' -or
        $readiness.apiContractVersion -ne 'live-readiness-v2' -or
        [string]$readiness.currentImportRunId -ine
            ([Guid]$snapshotBefore.ImportRunId).ToString('D')
    ) {
        throw 'Post-deployment LIVE readiness qualification failed.'
    }
    if (
        (Get-ProcessOwner $livePid) -ine
            'DLE-OS-HOST\DLE-OS-LIVE-API' -or
        (Get-ProcessOwner $historicalPid) -ine $operator
    ) {
        throw 'Post-deployment runtime identity qualification failed.'
    }
    if (
        $null -eq (Get-Listener 5043) -or
        $null -eq (Get-Listener 5044)
    ) {
        throw 'Refresh control or promotion broker regressed.'
    }

    $evidence.FrontendBuildA = $buildA
    $evidence.FrontendBuildB = $buildB
    $evidence.BuildAHttp = $httpA
    $evidence.BuildBHttp = $httpB
    $evidence.Rollback = [ordered]@{
        Result = $rollbackA
        Http = $httpRollback
    }
    $evidence.RollForward = [ordered]@{
        Result = $rollForwardB
        Http = $httpRollForward
    }
    $evidence.OperationalStatusSeed = [ordered]@{
        SnapshotAsOfUtc =
            ([DateTime]$snapshotBefore.SnapshotTimestampUtc).ToString('O')
        SourceCheckedAtUtc =
            ([DateTimeOffset]$sourceState.QualifiedAtUtc).ToString('O')
        QualificationCompletedAtUtc =
            ([DateTimeOffset]$statusBefore.CompletedAtUtc).ToString('O')
        ImportRunId =
            ([Guid]$snapshotBefore.ImportRunId).ToString('D')
        PackageHash = [string]$snapshotBefore.PackageHash
        SourceIndicatorFingerprint = $indicatorFingerprint
    }
    $evidence.LiveReadiness = $readiness
    $evidence.PortsAfter = [ordered]@{
        Historical = $historicalPid
        Live = $livePid
        Refresh = Get-Listener 5043
        Promotion = Get-Listener 5044
    }
    $evidence.RuntimeOwners = [ordered]@{
        Historical = Get-ProcessOwner $historicalPid
        Live = Get-ProcessOwner $livePid
    }
    $evidence.CompletedAtUtc =
        [DateTimeOffset]::UtcNow.ToString('O')
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    $evidence.FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    if ($mutationStarted) {
        $recovery = [Collections.Generic.List[string]]::new()
        try {
            if ($null -ne (Get-Listener 5042)) {
                & $liveStopper | Out-Null
            }
            Stop-HistoricalRuntime
            $recovery.Add('RUNTIMES_STOPPED')

            foreach ($relative in $backupFiles) {
                $source = Join-Path $backupRoot (
                    'ServerSource\' + $relative)
                $target = Join-Path $server $relative
                if (Test-Path -LiteralPath $source -PathType Leaf) {
                    Copy-Item -LiteralPath $source -Destination $target -Force
                }
            }
            Copy-Item `
                -LiteralPath (
                    Join-Path $backupRoot (
                        'Protected\current-qualified-snapshot.json')) `
                -Destination $qualifiedBoundary `
                -Force
            foreach ($name in @(
                'Invoke-LiveSnapshotRefresh.ps1',
                'Complete-LiveSnapshotPromotion.ps1',
                'Promote-QualifiedSnapshotBoundary.ps1'
            )) {
                Copy-Item `
                    -LiteralPath (
                        Join-Path $backupRoot ('Refresh\' + $name)) `
                    -Destination (Join-Path $refreshRoot $name) `
                    -Force
            }
            $recovery.Add('SOURCE_CONFIG_AND_REFRESH_FILES_RESTORED')

            $liveRuntimeBackup = Join-Path $backupRoot 'LiveRuntime'
            if (Test-Path -LiteralPath $liveRuntimeRoot) {
                Remove-Item -LiteralPath $liveRuntimeRoot -Recurse -Force
            }
            Copy-Item `
                -LiteralPath $liveRuntimeBackup `
                -Destination $liveRuntimeRoot `
                -Recurse -Force
            Set-LiveRuntimeReadExecuteAcl $liveRuntimeRoot
            $historicalRuntimeBackup =
                Join-Path $backupRoot 'HistoricalRuntime'
            if (
                Test-Path -LiteralPath $historicalRuntimeBackup `
                    -PathType Container
            ) {
                if (Test-Path -LiteralPath $historicalBin) {
                    Remove-Item -LiteralPath $historicalBin -Recurse -Force
                }
                Copy-Item `
                    -LiteralPath $historicalRuntimeBackup `
                    -Destination $historicalBin `
                    -Recurse -Force
            }
            $recovery.Add('RUNTIME_BINARIES_RESTORED')

            foreach ($name in @(
                'current-release.json',
                'previous-release.json'
            )) {
                $backupPointer = Join-Path $backupRoot (
                    'Frontend\' + $name)
                $pointer = Join-Path $publicationRoot $name
                if (Test-Path -LiteralPath $backupPointer -PathType Leaf) {
                    Copy-Item `
                        -LiteralPath $backupPointer `
                        -Destination $pointer `
                        -Force
                }
                elseif (Test-Path -LiteralPath $pointer -PathType Leaf) {
                    Remove-Item -LiteralPath $pointer -Force
                }
            }
            $recovery.Add('FRONTEND_POINTERS_RESTORED')

            if ($null -ne $databaseBackup) {
                $masterConnection =
                    [System.Data.SqlClient.SqlConnection]::new(
                        'Server=lpc:.\SQLEXPRESS;Database=master;' +
                        'Integrated Security=True;Encrypt=False;' +
                        'TrustServerCertificate=True;Connect Timeout=10;' +
                        'Application Name=PLATFORM-FRESHNESS-CACHE-001 Rollback')
                try {
                    $masterConnection.Open()
                    $restore = $masterConnection.CreateCommand()
                    $escapedBackup = $databaseBackup.Replace("'", "''")
                    $restore.CommandText =
                        'ALTER DATABASE [DLE_OS_CANONICAL_LIVE] ' +
                        'SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ' +
                        'RESTORE DATABASE [DLE_OS_CANONICAL_LIVE] FROM DISK=' +
                        "N'$escapedBackup' WITH REPLACE, CHECKSUM; " +
                        'ALTER DATABASE [DLE_OS_CANONICAL_LIVE] SET MULTI_USER;'
                    $restore.CommandTimeout = 600
                    [void]$restore.ExecuteNonQuery()
                }
                finally {
                    $masterConnection.Dispose()
                }
                $recovery.Add('DATABASE_RESTORED_FROM_VERIFIED_BACKUP')
            }

            [void](Start-HistoricalRuntime)
            & $liveLauncher | Out-Null
            [void](Wait-Listener 5042)
            $recovery.Add('PRIOR_RUNTIMES_RESTARTED')
        }
        catch {
            $recovery.Add(
                'RECOVERY_FAILED: ' + $_.Exception.Message)
        }
        $evidence.Recovery = @($recovery)
    }
}
finally {
    [IO.File]::WriteAllText(
        $EvidencePath,
        ($evidence | ConvertTo-Json -Depth 16) +
            [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
}

if ($evidence.Verdict -ne 'PASS') {
    throw "PLATFORM-FRESHNESS-CACHE-001 deployment failed: $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 16
