[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $PublishedHostPath = '',
    [switch] $Unregister
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedComputer = 'DLE-OS-HOST'
$approvedUser = 'DLE-OS-HOST\Miguel'
$extensionId = 'gappmnmcjliadjleocigmndgalflgffd'
$hostName = 'com.dlemfg.dleos.dev.desktop_capabilities'
$registrationSubKey = "Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
$installRoot = 'C:\ProgramData\DLE-OS\GovernedDesktopCapabilities\DEV\host'
$governedRoot = 'C:\ProgramData\DLE-OS\GovernedDesktopCapabilities'
$manifestPath = Join-Path $installRoot 'native-host-manifest.json'
$executableName = 'DleOs.GovernedDesktopCapabilities.NativeHost.exe'

function Assert-ApprovedElevatedOperator {
    if ($env:COMPUTERNAME -ine $approvedComputer) {
        throw "The DEV desktop-capability host is approved only on $approvedComputer."
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.Name -ine $approvedUser) {
        throw "The DEV desktop-capability host must be installed by $approvedUser."
    }
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Machine-scoped installation requires a normal elevated Miguel UAC session.'
    }
}

function Open-RegistryRoot {
    param(
        [Microsoft.Win32.RegistryHive] $Hive,
        [Microsoft.Win32.RegistryView] $View
    )
    [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
}

function Set-MachineRegistration {
    param([string] $Value)
    $base = Open-RegistryRoot -Hive LocalMachine -View Registry32
    try {
        $key = $base.CreateSubKey($registrationSubKey)
        try { $key.SetValue('', $Value, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Close() }
    }
    finally { $base.Close() }
}

function Remove-HostRegistration {
    param(
        [Microsoft.Win32.RegistryHive] $Hive,
        [Microsoft.Win32.RegistryView] $View
    )
    $base = Open-RegistryRoot -Hive $Hive -View $View
    try { $base.DeleteSubKeyTree($registrationSubKey, $false) }
    finally { $base.Close() }
}

function Set-GovernedPackageAcl {
    $administrators = New-Object Security.Principal.NTAccount('BUILTIN', 'Administrators')
    $system = New-Object Security.Principal.NTAccount('NT AUTHORITY', 'SYSTEM')
    $miguel = New-Object Security.Principal.NTAccount($approvedUser)
    [void]$miguel.Translate([Security.Principal.SecurityIdentifier])
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow

    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($administrators)
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $system, 'FullControl', $inheritance, $propagation, $allow)))
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $administrators, 'FullControl', $inheritance, $propagation, $allow)))
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $miguel, 'ReadAndExecute, Synchronize', $inheritance, $propagation, $allow)))
    Set-Acl -LiteralPath $governedRoot -AclObject $acl
}

function Write-Utf8WithoutBom {
    param([string] $Path, [string] $Content)
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

Assert-ApprovedElevatedOperator

if ($Unregister) {
    if ($PSCmdlet.ShouldProcess($registrationSubKey, 'remove DEV Edge native messaging host registration and ProgramData package')) {
        Remove-HostRegistration -Hive LocalMachine -View Registry32
        if (Test-Path -LiteralPath $installRoot) {
            Remove-Item -LiteralPath $installRoot -Recurse -Force
        }
    }
    Write-Output 'Removed the machine-scoped DEV Edge native messaging host registration and package.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($PublishedHostPath)) {
    throw '-PublishedHostPath is required when installing the DEV native messaging host.'
}
$published = [IO.Path]::GetFullPath($PublishedHostPath)
$publishedExecutable = Join-Path $published $executableName
if (-not (Test-Path -LiteralPath $publishedExecutable -PathType Leaf)) {
    throw "The published native host executable is missing: $publishedExecutable"
}

if ($PSCmdlet.ShouldProcess($registrationSubKey, 'install machine-scoped DEV Edge native messaging host')) {
    [void](New-Item -ItemType Directory -Path $installRoot -Force)
    Get-ChildItem -LiteralPath $published -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $installRoot $_.Name) -Force
    }

    $installedExecutable = Join-Path $installRoot $executableName
    $manifest = [ordered]@{
        name = $hostName
        description = 'DLE-OS governed desktop capabilities DEV native host'
        path = $installedExecutable
        type = 'stdio'
        allowed_origins = @("chrome-extension://$extensionId/")
    }
    Write-Utf8WithoutBom -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 4)
    Set-GovernedPackageAcl
    Set-MachineRegistration -Value $manifestPath

    # Remove only the obsolete exact DEV registration so it cannot shadow HKLM.
    Remove-HostRegistration -Hive CurrentUser -View Registry64
}

Write-Output "ExtensionId=$extensionId"
Write-Output "NativeHostName=$hostName"
Write-Output "Registration=HKLM Registry32 (physical WOW6432Node)\$registrationSubKey"
Write-Output "Manifest=$manifestPath"
Write-Output "Executable=$(Join-Path $installRoot $executableName)"
Get-ChildItem -LiteralPath $installRoot -File | ForEach-Object {
    Write-Output "SHA256 $($_.Name)=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
}
