[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$requiredIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $requiredIdentity) {
    throw "The dedicated Sync Operations host requires $requiredIdentity; actual identity is $identity."
}

$releaseRoot = $PSScriptRoot
$manifestPath = Join-Path $releaseRoot 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The dedicated Sync Operations release manifest is absent.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -cne 'dle-os.sync-operations-control-release.v1' -or
    [string]$manifest.releaseId -notmatch '^syncops5056-') {
    throw 'The dedicated Sync Operations release manifest was rejected.'
}
foreach ($file in $manifest.files) {
    $path = Join-Path $releaseRoot ([string]$file.path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Release file is absent: $($file.path)"
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -cne [string]$file.sha256) {
        throw "Release file hash mismatch: $($file.path)"
    }
}

$listener = netstat.exe -ano -p tcp |
    Select-String -Pattern '^\s*TCP\s+\S+:5056\s+\S+\s+LISTENING\s+\d+\s*$' |
    Select-Object -First 1
if ($listener) { throw 'Port 5056 is already listening.' }

$env:DLE_OS_ENVIRONMENT = 'Development'
$env:DLE_OS_RELEASE_ID = [string]$manifest.releaseId
$env:DLE_OS_SYNC_OPERATIONS_CONTROL_PREFIX = 'http://dle-os-host:5056'
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH =
    'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
$env:DLE_OS_SECURITY_CONNECTION_STRING =
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Connect Timeout=5;Application Intent=ReadOnly;'
$env:DLE_OS_SYNC_OPERATIONS_EXECUTION_MODE = 'DISABLED_FOR_STANDALONE_QUALIFICATION'
$env:DLE_OS_SYNC_OPERATIONS_RUN_WORKER_PREFLIGHT = 'true'
$env:DLE_OS_SYNC_OPERATIONS_WORKER_PREFLIGHT_EVIDENCE =
    'C:\ProgramData\DLE-OS\SyncOperationsControl\Qualification\worker-identity.json'

$executable = Join-Path $releaseRoot 'DleOs.SyncOperationsControlHost.exe'
& $executable
exit $LASTEXITCODE
