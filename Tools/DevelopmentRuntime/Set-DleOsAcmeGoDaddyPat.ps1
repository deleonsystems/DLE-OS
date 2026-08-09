[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$secretDirectory = Join-Path $env:ProgramData 'DLE-OS\ACME\Secrets'
$secretPath = Join-Path $secretDirectory 'godaddy-pat.dpapi'
$entropyText = 'DLE-OS|ACME|GoDaddy-PAT|v1'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-RestrictedAcl {
    param(
        [Parameter(Mandatory)]
        [string]$LiteralPath,

        [Parameter(Mandatory)]
        [ValidateSet('Directory', 'File')]
        [string]$Kind
    )

    $acl = if ($Kind -eq 'Directory') {
        [Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        [Security.AccessControl.FileSecurity]::new()
    }

    $acl.SetAccessRuleProtection($true, $false)

    $inheritance = if ($Kind -eq 'Directory') {
        [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    }
    else {
        [Security.AccessControl.InheritanceFlags]::None
    }

    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow

    $systemRule = [Security.AccessControl.FileSystemAccessRule]::new(
        'NT AUTHORITY\SYSTEM',
        [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        $propagation,
        $allow)
    $administratorsRule = [Security.AccessControl.FileSystemAccessRule]::new(
        'BUILTIN\Administrators',
        [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        $propagation,
        $allow)

    $acl.AddAccessRule($systemRule)
    $acl.AddAccessRule($administratorsRule)
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

if (-not (Test-IsAdministrator)) {
    $arguments = @(
        '-NoLogo'
        '-NoProfile'
        '-ExecutionPolicy'
        'Bypass'
        '-File'
        ('"{0}"' -f $PSCommandPath)
    )

    $elevatedProcess = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Verb RunAs `
        -ArgumentList $arguments `
        -Wait `
        -PassThru
    exit $elevatedProcess.ExitCode
}

if (Test-Path -LiteralPath $secretPath) {
    throw "The governed GoDaddy PAT secret already exists at $secretPath. It was not overwritten."
}

Add-Type -AssemblyName System.Security

if (-not (Test-Path -LiteralPath $secretDirectory)) {
    New-Item -ItemType Directory -Path $secretDirectory | Out-Null
}
Set-RestrictedAcl -LiteralPath $secretDirectory -Kind Directory

Write-Host 'DLE-OS ACME credential initialization'
Write-Host 'Renewal identity: NT AUTHORITY\SYSTEM'
Write-Host "Protected destination: $secretPath"
Write-Host 'Right-click once to paste the GoDaddy PAT at the protected prompt, then press Enter.'
Write-Host 'Do not use Ctrl+V in the legacy Windows PowerShell console.'

$securePat = $null
$plainTextPointer = [IntPtr]::Zero
$plainChars = $null
$plainBytes = $null
$entropyBytes = $null
$protectedBytes = $null
$temporaryPath = $null

try {
    $securePat = Read-Host 'GoDaddy PAT' -AsSecureString
    if ($securePat.Length -lt 20) {
        throw 'The entered value is unexpectedly short. No credential was stored.'
    }

    $plainTextPointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($securePat)
    $plainChars = [char[]]::new($securePat.Length)
    for ($index = 0; $index -lt $plainChars.Length; $index++) {
        $plainChars[$index] = [char][Runtime.InteropServices.Marshal]::ReadInt16(
            $plainTextPointer,
            $index * 2)
    }
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plainChars)
    $entropyBytes = [Text.Encoding]::UTF8.GetBytes($entropyText)
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
        $plainBytes,
        $entropyBytes,
        [Security.Cryptography.DataProtectionScope]::LocalMachine)

    $temporaryPath = Join-Path $secretDirectory ('.godaddy-pat.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllBytes($temporaryPath, $protectedBytes)
    Set-RestrictedAcl -LiteralPath $temporaryPath -Kind File
    Move-Item -LiteralPath $temporaryPath -Destination $secretPath
    $temporaryPath = $null

    Write-Host 'GoDaddy PAT stored successfully using DPAPI LocalMachine protection.'
    Write-Host 'The plaintext value was not written to disk or emitted to output.'
    Write-Host 'You may close this window.'
}
catch {
    Write-Host ''
    Write-Host ('Credential storage failed: {0}' -f $_.Exception.Message) -ForegroundColor Red
    [void](Read-Host 'Press Enter to close this window')
    exit 1
}
finally {
    if ($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    if ($plainBytes) {
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    if ($plainChars) {
        [Array]::Clear($plainChars, 0, $plainChars.Length)
    }
    if ($entropyBytes) {
        [Array]::Clear($entropyBytes, 0, $entropyBytes.Length)
    }
    if ($protectedBytes) {
        [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    }
    if ($plainTextPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($plainTextPointer)
    }
    if ($securePat) {
        $securePat.Dispose()
    }
}
