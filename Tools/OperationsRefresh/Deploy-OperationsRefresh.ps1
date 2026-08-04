[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Operations Refresh deployment must begin non-elevated as DLE-OS-HOST\DLE-OS.'
}
$deploy = 'C:\DLE-OS\Repositories\DLE-OS\Tools\PlatformRefreshCenter\Deploy-PlatformRefreshCenter.ps1'
& $deploy -InstallOperationsSchedule
if ($LASTEXITCODE -ne 0) {
    throw "Governed Operations Refresh deployment returned $LASTEXITCODE."
}
