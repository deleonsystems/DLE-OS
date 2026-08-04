[CmdletBinding()]
param([switch] $Unregister)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$launcher = Join-Path $repository (
    'Tools\DevelopmentRuntime\CustomerFilesLauncher\' +
    'Invoke-CustomerFilesProtocol.ps1'
)
$powerShell = (
    'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
)
$protocolKey = 'HKCU:\Software\Classes\dle-customer-files'

if ($env:COMPUTERNAME -ine $approvedComputer) {
    throw "Registration is approved only on $approvedComputer."
}
if ($Unregister) {
    if (Test-Path -LiteralPath $protocolKey) {
        Remove-Item -LiteralPath $protocolKey -Recurse -Force
    }
    Write-Output 'Removed current-user dle-customer-files registration.'
    exit 0
}
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "The governed launcher is missing: $launcher"
}

$command = (
    '"{0}" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden ' +
    '-ExecutionPolicy RemoteSigned -File "{1}" -ProtocolUri "%1"'
) -f $powerShell, $launcher
New-Item -Path $protocolKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:DLE-OS Customer Files'
New-ItemProperty `
    -LiteralPath $protocolKey `
    -Name 'URL Protocol' `
    -Value '' `
    -PropertyType String `
    -Force |
    Out-Null
$commandKey = New-Item -Path "$protocolKey\shell\open\command" -Force
Set-Item -LiteralPath $commandKey.PSPath -Value $command
Write-Output 'Registered dle-customer-files for the current user.'
