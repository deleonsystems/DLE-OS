[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$secretDirectory = Join-Path $env:ProgramData 'DLE-OS\Keycloak\Secrets'
$metadataPath = Join-Path $secretDirectory 'metadata.json'
$secretDefinitions = [ordered]@{
    'bootstrap-admin-password' = 'DLE-OS|Keycloak|Bootstrap-Admin|v1'
    'database-password'        = 'DLE-OS|Keycloak|Database|v1'
    'miguel-initial-password'  = 'DLE-OS|Keycloak|Miguel-Initial|v1'
    'oidc-client-secret'       = 'DLE-OS|Keycloak|OIDC-Client|v1'
}

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
    foreach ($identity in 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $identity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow))
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

function Convert-SecureValueToBytes {
    param(
        [Parameter(Mandatory)]
        [Security.SecureString]$SecureValue
    )

    $pointer = [IntPtr]::Zero
    $characters = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($SecureValue)
        $characters = [char[]]::new($SecureValue.Length)
        for ($index = 0; $index -lt $characters.Length; $index++) {
            $characters[$index] = [char][Runtime.InteropServices.Marshal]::ReadInt16(
                $pointer,
                $index * 2)
        }
        return [Text.Encoding]::UTF8.GetBytes($characters)
    }
    finally {
        if ($characters) {
            [Array]::Clear($characters, 0, $characters.Length)
        }
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
        }
    }
}

function Read-ConfirmedSecretBytes {
    param(
        [Parameter(Mandatory)]
        [string]$Label,

        [int]$MinimumLength = 16
    )

    $first = $null
    $second = $null
    $firstBytes = $null
    $secondBytes = $null
    try {
        $first = Read-Host $Label -AsSecureString
        if ($first.Length -lt $MinimumLength) {
            throw "$Label must contain at least $MinimumLength characters."
        }
        $second = Read-Host "Confirm $Label" -AsSecureString
        $firstBytes = Convert-SecureValueToBytes -SecureValue $first
        $secondBytes = Convert-SecureValueToBytes -SecureValue $second
        $difference = $firstBytes.Length -bxor $secondBytes.Length
        $comparisonLength = [Math]::Min($firstBytes.Length, $secondBytes.Length)
        for ($index = 0; $index -lt $comparisonLength; $index++) {
            $difference = $difference -bor ($firstBytes[$index] -bxor $secondBytes[$index])
        }
        if ($difference -ne 0) {
            throw "$Label confirmation did not match. No secrets were stored."
        }
        return $firstBytes
    }
    finally {
        if ($secondBytes) {
            [Array]::Clear($secondBytes, 0, $secondBytes.Length)
        }
        if ($second) {
            $second.Dispose()
        }
        if ($first) {
            $first.Dispose()
        }
    }
}

function Protect-SecretBytes {
    param(
        [Parameter(Mandatory)]
        [byte[]]$SecretBytes,

        [Parameter(Mandatory)]
        [string]$EntropyText,

        [Parameter(Mandatory)]
        [string]$DestinationPath
    )

    $entropyBytes = $null
    $protectedBytes = $null
    $temporaryPath = Join-Path $secretDirectory ('.secret.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    try {
        $entropyBytes = [Text.Encoding]::UTF8.GetBytes($EntropyText)
        $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
            $SecretBytes,
            $entropyBytes,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes($temporaryPath, $protectedBytes)
        Set-RestrictedAcl -LiteralPath $temporaryPath -Kind File
        Move-Item -LiteralPath $temporaryPath -Destination $DestinationPath
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
        if ($entropyBytes) {
            [Array]::Clear($entropyBytes, 0, $entropyBytes.Length)
        }
        if ($protectedBytes) {
            [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
        }
    }
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
    $elevatedProcess = Start-Process `
        -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Verb RunAs `
        -ArgumentList $arguments `
        -Wait `
        -PassThru
    exit $elevatedProcess.ExitCode
}

foreach ($name in $secretDefinitions.Keys) {
    $path = Join-Path $secretDirectory "$name.dpapi"
    if (Test-Path -LiteralPath $path) {
        throw "The governed Keycloak secret already exists at $path. Nothing was overwritten."
    }
}

Add-Type -AssemblyName System.Security
if (-not (Test-Path -LiteralPath $secretDirectory)) {
    New-Item -ItemType Directory -Path $secretDirectory | Out-Null
}
Set-RestrictedAcl -LiteralPath $secretDirectory -Kind Directory

Write-Host 'DLE-OS Keycloak credential initialization'
Write-Host 'Bootstrap/provisioning identity: NT AUTHORITY\SYSTEM'
Write-Host 'Planned runtime identity: NT SERVICE\DleOsKeycloak'
Write-Host "Protected destination: $secretDirectory"
Write-Host 'Each protected prompt displays masking characters only; plaintext is never echoed.'
Write-Host 'Use unique values retained in Miguel''s password manager.'
Write-Host ''

$secrets = @{}
try {
    $secrets['bootstrap-admin-password'] = Read-ConfirmedSecretBytes `
        -Label 'Keycloak bootstrap-admin password'
    $secrets['database-password'] = Read-ConfirmedSecretBytes `
        -Label 'Keycloak SQL login password'
    $secrets['miguel-initial-password'] = Read-ConfirmedSecretBytes `
        -Label 'Miguel initial Keycloak password'

    $clientSecretBytes = [byte[]]::new(48)
    $randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomNumberGenerator.GetBytes($clientSecretBytes)
    }
    finally {
        $randomNumberGenerator.Dispose()
    }
    $clientSecretText = [Convert]::ToBase64String($clientSecretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $secrets['oidc-client-secret'] = [Text.Encoding]::UTF8.GetBytes($clientSecretText)
    [Array]::Clear($clientSecretBytes, 0, $clientSecretBytes.Length)
    $clientSecretText = $null

    foreach ($name in $secretDefinitions.Keys) {
        Protect-SecretBytes `
            -SecretBytes $secrets[$name] `
            -EntropyText $secretDefinitions[$name] `
            -DestinationPath (Join-Path $secretDirectory "$name.dpapi")
    }

    [ordered]@{
        schemaVersion = 1
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        protection = 'DPAPI LocalMachine'
        bootstrapIdentity = 'NT AUTHORITY\SYSTEM'
        plannedRuntimeIdentity = 'NT SERVICE\DleOsKeycloak'
        bootstrapAdminUser = 'dleos-admin'
        initialRealmUser = 'miguel'
        secretNames = @($secretDefinitions.Keys)
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
    Set-RestrictedAcl -LiteralPath $metadataPath -Kind File

    Write-Host ''
    Write-Host 'KEYCLOAK_SECRETS_STORED'
    Write-Host 'All values were DPAPI machine-protected outside Git with SYSTEM/Administrators-only ACLs.'
    Write-Host 'The generated OIDC client secret was not displayed.'
    Write-Host 'You may close this window.'
}
catch {
    Write-Host ''
    Write-Host ('Credential storage failed: {0}' -f $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Any successfully written partial secret files must be reviewed before retrying.' -ForegroundColor Red
    [void](Read-Host 'Press Enter to close this window')
    exit 1
}
finally {
    foreach ($value in $secrets.Values) {
        if ($value) {
            [Array]::Clear($value, 0, $value.Length)
        }
    }
}
