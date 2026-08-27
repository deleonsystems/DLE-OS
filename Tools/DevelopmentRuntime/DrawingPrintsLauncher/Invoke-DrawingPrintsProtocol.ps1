[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $ProtocolUri,
    [switch] $SuppressUi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$approvedRoot = '\\DeLeon-Server\Production\Drawing-Prints'
$uriPattern = '^dle-drawing-prints://open/(?<token>[A-Za-z0-9_-]{2,1366})$'

function Show-LauncherMessage {
    param([Parameter(Mandatory)][string] $Message)
    if ($SuppressUi) { return }
    try {
        Add-Type -AssemblyName PresentationFramework
        [void][System.Windows.MessageBox]::Show(
            $Message,
            'DLE-OS Assembly Drawing',
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
    Stop-Launcher "Assembly Drawing folders may be opened only on $approvedComputer."
}
$match = [regex]::Match(
    $ProtocolUri,
    $uriPattern,
    [Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $match.Success) {
    Stop-Launcher 'Unsupported Assembly Drawing protocol action.'
}
try {
    $base64 = $match.Groups['token'].Value.Replace('-', '+').Replace('_', '/')
    $base64 += '=' * ((4 - ($base64.Length % 4)) % 4)
    $bytes = [Convert]::FromBase64String($base64)
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $relative = $utf8.GetString($bytes)
} catch {
    Stop-Launcher 'The Assembly Drawing folder identifier is invalid.'
}

if (
    [string]::IsNullOrWhiteSpace($relative) -or
    $relative.Length -gt 1024 -or
    [IO.Path]::IsPathRooted($relative) -or
    $relative.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0
) {
    Stop-Launcher 'The Assembly Drawing folder identifier is invalid.'
}
$segments = @($relative -split '[\\/]' | Where-Object { $_ -ne '' })
if (
    $segments.Count -eq 0 -or
    @($segments | Where-Object { $_ -in @('.', '..') }).Count -ne 0
) {
    Stop-Launcher 'The Assembly Drawing folder identifier is invalid.'
}

try {
    if (-not (Test-Path -LiteralPath $approvedRoot -PathType Container)) {
        Stop-Launcher 'The governed Drawing-Prints root is unavailable.'
    }
    $root = [IO.Path]::GetFullPath($approvedRoot).TrimEnd('\')
    $rootItem = Get-Item -LiteralPath $root -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Stop-Launcher 'The governed Drawing-Prints root is unexpectedly redirected.'
    }

    $target = [IO.Path]::GetFullPath((Join-Path $root $relative)).TrimEnd('\')
    if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Launcher 'The resolved folder escaped the governed Drawing-Prints root.'
    }

    $cursor = $root
    foreach ($segment in $segments) {
        $cursor = Join-Path $cursor $segment
        if (-not (Test-Path -LiteralPath $cursor -PathType Container)) {
            Stop-Launcher 'The resolved Assembly Drawing folder no longer exists.'
        }
        $item = Get-Item -LiteralPath $cursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-Launcher 'The resolved Assembly Drawing folder is unexpectedly redirected.'
        }
    }
    if ([IO.Path]::GetFullPath($cursor).TrimEnd('\') -ine $target) {
        Stop-Launcher 'The Assembly Drawing folder failed final path validation.'
    }
} catch {
    Stop-Launcher 'The governed Drawing-Prints folder could not be validated.'
}

Start-Process `
    -FilePath (Join-Path $env:WINDIR 'explorer.exe') `
    -ArgumentList "`"$target`""
