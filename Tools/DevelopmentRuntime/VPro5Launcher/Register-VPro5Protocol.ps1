[CmdletBinding()]
param(
    [switch] $Unregister
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$launcherPath = Join-Path $repository (
    'Tools\DevelopmentRuntime\VPro5Launcher\Invoke-VPro5Protocol.ps1'
)
$powerShellPath = (
    'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
)
$protocolKey = 'HKCU:\Software\Classes\dle-vpro5'

if ($env:COMPUTERNAME -ine $approvedComputer) {
    throw "Registration is approved only on $approvedComputer."
}

if ($Unregister) {
    if (Test-Path -LiteralPath $protocolKey) {
        Remove-Item -LiteralPath $protocolKey -Recurse -Force
    }
    Write-Output "Removed current-user dle-vpro5 protocol registration."
    exit 0
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "The governed launcher is missing: $launcherPath"
}
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "Windows PowerShell is missing: $powerShellPath"
}

$command = (
    '"{0}" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden ' +
    '-ExecutionPolicy RemoteSigned -File "{1}" -ProtocolUri "%1"'
) -f $powerShellPath, $launcherPath

New-Item -Path $protocolKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:DLE-OS VPro5 Launcher'
New-ItemProperty `
    -LiteralPath $protocolKey `
    -Name 'URL Protocol' `
    -Value '' `
    -PropertyType String `
    -Force |
    Out-Null

$iconKey = New-Item -Path "$protocolKey\DefaultIcon" -Force
Set-Item -LiteralPath $iconKey.PSPath -Value "$launcherPath,0"

$commandKey = New-Item -Path "$protocolKey\shell\open\command" -Force
Set-Item -LiteralPath $commandKey.PSPath -Value $command

Write-Output "Registered dle-vpro5 for the current user on $approvedComputer."
Write-Output "Launcher: $launcherPath"
