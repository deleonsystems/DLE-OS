[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$requiredIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $requiredIdentity) {
    throw "The governed refresh host requires $requiredIdentity; actual identity is $identity."
}

$releaseRoot = $PSScriptRoot
$manifestPath = Join-Path $releaseRoot 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The governed refresh release manifest is absent.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -cne 'dle-os.governed-refresh-control-release.v1' -or
    [string]$manifest.releaseId -notmatch '^refreshcontrol-') {
    throw 'The governed refresh release manifest was rejected.'
}
foreach ($file in $manifest.files) {
    $path = Join-Path $releaseRoot ([string]$file.path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release file is absent: $($file.path)" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne [string]$file.sha256) {
        throw "Release file hash mismatch: $($file.path)"
    }
}
if (netstat.exe -ano -p tcp | Select-String -Pattern '^\s*TCP\s+\S+:5057\s+\S+\s+LISTENING\s+\d+\s*$' | Select-Object -First 1) {
    throw 'Port 5057 is already listening.'
}

$logRoot = 'C:\ProgramData\DLE-OS\GovernedRefreshControl\Logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:DLE_OS_ENVIRONMENT = 'Development'
$env:DLE_OS_RELEASE_ID = [string]$manifest.releaseId
$env:DLE_OS_GOVERNED_REFRESH_CONTROL_PREFIX = 'http://dle-os-host:5057'
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH =
    'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
$env:DLE_OS_SECURITY_CONNECTION_STRING =
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Connect Timeout=5;Application Intent=ReadOnly;'
$executionMode = 'DISABLED_FOR_STANDALONE_QUALIFICATION'
$approvalPath = 'C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\pending-approval.json'
$liveApprovalPath = 'C:\ProgramData\DLE-OS\GovernedRefreshControl\Approval\pending-live-approval.json'
if (Test-Path -LiteralPath $approvalPath -PathType Leaf) {
    $approval = $null
    try {
        $approval = Get-Content -LiteralPath $approvalPath -Raw | ConvertFrom-Json
        $now = [DateTimeOffset]::UtcNow
        if (Test-Path -LiteralPath $liveApprovalPath -PathType Leaf) {
            throw 'Qualification and live approvals are mutually exclusive.'
        }
        if ($approval.schema -cne 'dle-os.governed-refresh-local-approval.v1' -or
            $approval.releaseId -cne [string]$manifest.releaseId -or
            [string]$approval.mode -notin @(
                'APPROVED_FAILURE_PRESERVATION_QUALIFICATION',
                'APPROVED_ONE_RUN_GATE_QUALIFICATION') -or
            [DateTimeOffset]$approval.expiresAtUtc -le $now -or
            [DateTimeOffset]$approval.createdAtUtc -gt $now -or
            [DateTimeOffset]$approval.expiresAtUtc -gt ([DateTimeOffset]$approval.createdAtUtc).AddMinutes(5) -or
            [string]$approval.approvedBy -cne 'DLE-OS-HOST\Miguel' -or
            [string]$approval.nonce -notmatch '^[0-9A-F]{32}$') {
            throw 'The one-shot local qualification approval was rejected.'
        }
        $executionMode = [string]$approval.mode
        $consumed = [ordered]@{
            schema = 'dle-os.governed-refresh-consumed-approval.v1'
            releaseId = [string]$approval.releaseId
            mode = [string]$approval.mode
            approvedBy = [string]$approval.approvedBy
            consumedAtUtc = $now.ToString('O')
            nonceSha256 = (Get-FileHash -LiteralPath $approvalPath -Algorithm SHA256).Hash
        }
        $consumedPath = Join-Path (Split-Path $approvalPath -Parent) 'consumed-approval.json'
        $consumed | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $consumedPath -Encoding UTF8
    }
    finally {
        Remove-Item -LiteralPath $approvalPath -Force -ErrorAction SilentlyContinue
    }
}
$env:DLE_OS_INVOICE_HISTORY_EXECUTION_MODE = $executionMode
$env:DLE_OS_INVOICE_HISTORY_RUN_WORKER_PREFLIGHT = 'true'
$env:DLE_OS_INVOICE_HISTORY_WORKER_PREFLIGHT_EVIDENCE =
    'C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\worker-identity.json'

$executable = Join-Path $releaseRoot 'DleOs.GovernedRefreshControlHost.exe'
& $executable 1>> (Join-Path $logRoot 'host.stdout.log') 2>> (Join-Path $logRoot 'host.stderr.log')
exit $LASTEXITCODE
