[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Runtime,

    [Parameter(Mandatory = $true)]
    [string] $LogPrefix
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$allowedRoot = 'C:\DLE-OS\Development\OperationalControlHost5054\'
$resolvedRuntime = (Resolve-Path -LiteralPath $Runtime).Path
if (-not $resolvedRuntime.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The 5054 runtime is outside the governed DEV runtime root.'
}
$exe = Join-Path $resolvedRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'The governed DEV ControlHost executable is absent.'
}

$env:DLE_OS_ISOLATED_DEVELOPMENT = 'true'
$env:DLE_OS_CONTROL_PREFIX = 'http://dle-os-host:5054'
$env:DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'
$env:DLE_OS_OPERATIONAL_CONNECTION_STRING = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_OPERATIONAL_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;'
$env:DLE_OS_SECURITY_CONNECTION_STRING = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadOnly;'
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'

Set-Location -LiteralPath $resolvedRuntime
& $exe 1>> ($LogPrefix + '.stdout.log') 2>> ($LogPrefix + '.stderr.log')
exit $LASTEXITCODE
