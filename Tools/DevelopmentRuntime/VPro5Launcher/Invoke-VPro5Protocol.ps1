[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $ProtocolUri,
    [switch] $SuppressUi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$approvedUri = 'dle-vpro5://customer/new'
$approvedShortcut = 'C:\BASIS\VPRO5\Visual PRO5 Prod.lnk'
$approvedExecutable = 'C:\BASIS\VPRO5\vpro5.exe'
$approvedArguments = '-tT8 -nT8 -m1024 -cX:\CONFIG.AON X:\AON\ADM\SYS.ZA'
$approvedWorkingDirectory = 'C:\BASIS\VPRO5'
$mutexName = 'Local\DleOsVPro5CustomerEntryLauncher'

function Show-LauncherMessage {
    param(
        [Parameter(Mandatory)]
        [string] $Message,
        [switch] $ErrorMessage
    )

    if ($SuppressUi) { return }

    try {
        Add-Type -AssemblyName PresentationFramework
        $icon = if ($ErrorMessage) {
            [System.Windows.MessageBoxImage]::Error
        } else {
            [System.Windows.MessageBoxImage]::Information
        }
        [void][System.Windows.MessageBox]::Show(
            $Message,
            'DLE-OS VPro5 Launcher',
            [System.Windows.MessageBoxButton]::OK,
            $icon
        )
    } catch {
        # The launcher intentionally does not write logs that could capture
        # workstation or ERP details. The process exit code remains available.
    }
}

function Stop-Launcher {
    param([Parameter(Mandatory)][string] $Message)

    Show-LauncherMessage -Message $Message -ErrorMessage
    exit 1
}

if ($env:COMPUTERNAME -ine $approvedComputer) {
    Stop-Launcher "This protocol is approved only on $approvedComputer."
}

if (
    -not [string]::Equals(
        $ProtocolUri,
        $approvedUri,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    Stop-Launcher 'Unsupported VPro5 protocol action. No application was launched.'
}

$createdNew = $false
$launchMutex = [Threading.Mutex]::new(
    $true,
    $mutexName,
    [ref] $createdNew
)

try {
    if (-not $createdNew) {
        exit 0
    }

    if (@(Get-Process -Name 'vpro5' -ErrorAction SilentlyContinue).Count) {
        exit 0
    }

    if (-not (Test-Path -LiteralPath $approvedShortcut -PathType Leaf)) {
        Stop-Launcher "The approved VPro5 shortcut is missing: $approvedShortcut"
    }
    if (-not (Test-Path -LiteralPath $approvedExecutable -PathType Leaf)) {
        Stop-Launcher "The approved VPro5 executable is missing: $approvedExecutable"
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($approvedShortcut)
    $targetMatches = [string]::Equals(
        [IO.Path]::GetFullPath($shortcut.TargetPath),
        $approvedExecutable,
        [StringComparison]::OrdinalIgnoreCase
    )
    $argumentsMatch = [string]::Equals(
        $shortcut.Arguments,
        $approvedArguments,
        [StringComparison]::Ordinal
    )
    $workingDirectoryMatches = [string]::Equals(
        [IO.Path]::GetFullPath($shortcut.WorkingDirectory),
        $approvedWorkingDirectory,
        [StringComparison]::OrdinalIgnoreCase
    )
    if (-not ($targetMatches -and $argumentsMatch -and $workingDirectoryMatches)) {
        Stop-Launcher (
            'The approved VPro5 shortcut no longer matches its governed ' +
            'target, arguments, or working directory. No application was launched.'
        )
    }

    Start-Process -FilePath $approvedShortcut

    $accepted = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (@(Get-Process -Name 'vpro5' -ErrorAction SilentlyContinue).Count) {
            $accepted = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $accepted) {
        Stop-Launcher (
            'The approved shortcut was requested, but VPro5 did not start ' +
            'within 10 seconds. Contact the DLE-OS operator.'
        )
    }
} catch {
    Stop-Launcher (
        'The local VPro5 launcher failed. No customer action was automated. ' +
        $_.Exception.Message
    )
} finally {
    if ($createdNew) {
        try { $launchMutex.ReleaseMutex() } catch {}
    }
    $launchMutex.Dispose()
}
