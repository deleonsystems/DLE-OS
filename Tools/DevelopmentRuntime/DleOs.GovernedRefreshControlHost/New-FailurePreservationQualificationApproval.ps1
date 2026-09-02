[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\Miguel' -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Qualification approval requires elevated DLE-OS-HOST\Miguel.'
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json') -Raw |
    ConvertFrom-Json
if ($manifest.schema -cne 'dle-os.governed-refresh-control-release.v1') {
    throw 'The qualification approval release manifest was rejected.'
}
$root = 'C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification'
$path = Join-Path $root 'pending-approval.json'
$liveApproval =
    'C:\ProgramData\DLE-OS\GovernedRefreshControl\Approval\pending-live-approval.json'
if (Test-Path -LiteralPath $liveApproval) {
    throw 'A live approval is pending; qualification approval is mutually exclusive.'
}
if (Test-Path -LiteralPath $path) { throw 'A pending qualification approval already exists.' }
[IO.Directory]::CreateDirectory($root) | Out-Null
$now = [DateTimeOffset]::UtcNow
$approval = [ordered]@{
    schema = 'dle-os.governed-refresh-local-approval.v1'
    releaseId = [string]$manifest.releaseId
    mode = 'APPROVED_FAILURE_PRESERVATION_QUALIFICATION'
    createdAtUtc = $now.ToString('O')
    expiresAtUtc = $now.AddMinutes(5).ToString('O')
    nonce = [Guid]::NewGuid().ToString('N').ToUpperInvariant()
    approvedBy = $identity.Name
}
$stage = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllText($stage, (($approval | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))
[IO.File]::Move($stage, $path)
[pscustomobject]@{
    ApprovalPath = $path
    ReleaseId = $approval.releaseId
    Mode = $approval.mode
    ExpiresAtUtc = $approval.expiresAtUtc
    PasswordOrCredentialCaptured = $false
} | ConvertTo-Json
