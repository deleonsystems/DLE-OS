[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\Miguel' -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'One-run live approval requires elevated DLE-OS-HOST\Miguel.'
}

$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json') -Raw |
    ConvertFrom-Json
if ($manifest.schema -cne 'dle-os.governed-refresh-control-release.v1') {
    throw 'The one-run live approval release manifest was rejected.'
}
$qualificationApproval =
    'C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\pending-approval.json'
if (Test-Path -LiteralPath $qualificationApproval) {
    throw 'A qualification approval is pending; live approval is mutually exclusive.'
}
$instancePath =
    'C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\host-instance.json'
$statusPath = 'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json'
if (-not (Test-Path -LiteralPath $instancePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
    throw 'The current host instance or durable Invoice History state is unavailable.'
}
$instance = Get-Content -LiteralPath $instancePath -Raw | ConvertFrom-Json
if ($instance.schema -cne 'dle-os.governed-refresh-host-instance.v1' -or
    $instance.releaseId -cne [string]$manifest.releaseId -or
    [string]$instance.hostInstanceId -notmatch '^[0-9A-F]{32}$') {
    throw 'The current 5057 host-instance evidence was rejected.'
}
$process = Get-Process -Id ([int]$instance.processId) -ErrorAction Stop
if ($process.ProcessName -cne 'DleOs.GovernedRefreshControlHost') {
    throw 'The host-instance process is not the governed refresh host.'
}

$root = 'C:\ProgramData\DLE-OS\GovernedRefreshControl\Approval'
$path = Join-Path $root 'pending-live-approval.json'
if (Test-Path -LiteralPath $path) { throw 'A pending live approval already exists.' }
[IO.Directory]::CreateDirectory($root) | Out-Null
$now = [DateTimeOffset]::UtcNow
$approval = [ordered]@{
    schema = 'dle-os.governed-refresh.one-live-run-approval.v1'
    module = 'INVOICE_HISTORY'
    releaseId = [string]$manifest.releaseId
    hostInstanceId = [string]$instance.hostInstanceId
    createdAtUtc = $now.ToString('O')
    expiresAtUtc = $now.AddMinutes(10).ToString('O')
    maximumRuns = 1
    approvalId = [Guid]::NewGuid().ToString('N').ToUpperInvariant()
    issuer = $identity.Name
    durableStatusSha256 = (Get-FileHash -LiteralPath $statusPath -Algorithm SHA256).Hash
}
$material = [string]::Join('|', @($approval.schema, $approval.module, $approval.releaseId,
    $approval.hostInstanceId, $approval.createdAtUtc, $approval.expiresAtUtc,
    [string]$approval.maximumRuns, $approval.approvalId, $approval.issuer,
    $approval.durableStatusSha256))
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $approval.evidenceSha256 = ([BitConverter]::ToString(
        $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))).Replace('-', '')
}
finally { $sha.Dispose() }
$stage = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllText($stage, (($approval | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))
[IO.File]::Move($stage, $path)
[pscustomobject]@{
    ApprovalPath = $path
    ApprovalId = $approval.approvalId
    ReleaseId = $approval.releaseId
    HostInstanceId = $approval.hostInstanceId
    MaximumRuns = $approval.maximumRuns
    ExpiresAtUtc = $approval.expiresAtUtc
    EvidenceSha256 = $approval.evidenceSha256
    CredentialsOrTokensCaptured = $false
} | ConvertTo-Json
