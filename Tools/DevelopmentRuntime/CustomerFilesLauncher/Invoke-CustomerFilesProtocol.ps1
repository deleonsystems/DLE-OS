[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $ProtocolUri,
    [switch] $SuppressUi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$root = '\\DeLeon-Server\Production\Customer Files'
$requirementsFolderName = '00 Customer Requirements & Compliance'
$uriPattern = (
    '^dle-customer-files://' +
    '(?<action>open|open-requirements)/' +
    '(?<number>\d{6})$'
)

function Show-LauncherMessage {
    param([Parameter(Mandatory)][string] $Message)
    if ($SuppressUi) { return }
    try {
        Add-Type -AssemblyName PresentationFramework
        [void][System.Windows.MessageBox]::Show(
            $Message,
            'DLE-OS Customer Files',
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Error)
    } catch {}
}

function Stop-Launcher {
    param([Parameter(Mandatory)][string] $Message)
    Show-LauncherMessage $Message
    exit 1
}

if ($env:COMPUTERNAME -ine $approvedComputer) {
    Stop-Launcher "Customer Files may be opened only on $approvedComputer."
}
$match = [regex]::Match(
    $ProtocolUri,
    $uriPattern,
    [Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $match.Success) {
    Stop-Launcher 'Unsupported Customer Files protocol action.'
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Stop-Launcher 'The governed Customer Files root is unavailable.'
}
$rootItem = Get-Item -LiteralPath $root -Force
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Stop-Launcher 'The governed Customer Files root is unexpectedly redirected.'
}

$customerNumber = $match.Groups['number'].Value
$action = $match.Groups['action'].Value.ToLowerInvariant()
$prefix = $customerNumber + ' - '
$matches = @(
    Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop |
        Where-Object { $_.Name.StartsWith(
            $prefix,
            [StringComparison]::OrdinalIgnoreCase) }
)
if ($matches.Count -ne 1) {
    Stop-Launcher (
        "Customer $customerNumber does not have exactly one verified folder."
    )
}
$resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
$resolvedFolder = [IO.Path]::GetFullPath($matches[0].FullName)
if (-not $resolvedFolder.StartsWith(
    $resolvedRoot + '\',
    [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Launcher 'The resolved customer folder escaped the governed root.'
}

$targetFolder = $resolvedFolder
if ($action -eq 'open-requirements') {
    try {
        $status = Invoke-RestMethod `
            -UseDefaultCredentials `
            -Uri (
                'http://dle-os-host:5053/' +
                'api/customer-files/v1/customers/' +
                $customerNumber +
                '/requirements-compliance'
            ) `
            -TimeoutSec 10
    } catch {
        Stop-Launcher (
            'The Requirements & Compliance folder could not be verified.'
        )
    }
    if (
        $status.customerFolderState -cne 'VERIFIED' -or
        $status.requirementsComplianceState -cne 'AVAILABLE' -or
        $status.folderName -cne $requirementsFolderName
    ) {
        Stop-Launcher (
            'The Requirements & Compliance folder is not available.'
        )
    }
    $targetFolder = [IO.Path]::GetFullPath(
        (Join-Path $resolvedFolder $requirementsFolderName))
    if (
        [IO.Path]::GetDirectoryName($targetFolder) -ine $resolvedFolder -or
        $status.folderPath -ine $targetFolder -or
        -not (Test-Path -LiteralPath $targetFolder -PathType Container)
    ) {
        Stop-Launcher (
            'The Requirements & Compliance folder failed path verification.'
        )
    }
    $targetItem = Get-Item -LiteralPath $targetFolder -Force
    if ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Stop-Launcher (
            'The Requirements & Compliance folder is unexpectedly redirected.'
        )
    }
}

Start-Process `
    -FilePath (Join-Path $env:WINDIR 'explorer.exe') `
    -ArgumentList "`"$targetFolder`""
