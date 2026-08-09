[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredIdentity = 'NT SERVICE\DleOsKeycloak'
$keycloakHome = 'C:\Program Files\DLE-OS\Keycloak\current'
$javaHome = 'C:\Program Files\DLE-OS\Java\jdk-21'
$secretRoot = 'C:\ProgramData\DLE-OS\Keycloak\Secrets'
$bootstrapMarker = 'C:\ProgramData\DLE-OS\Keycloak\State\bootstrap-complete.json'

if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $requiredIdentity) {
    throw "Keycloak startup requires the dedicated identity $requiredIdentity."
}

function Unprotect-Secret {
    param([string]$Name, [string]$EntropyText)
    Add-Type -AssemblyName System.Security
    $protectedBytes = $null
    $entropyBytes = $null
    $plainBytes = $null
    try {
        $protectedBytes = [IO.File]::ReadAllBytes((Join-Path $secretRoot "$Name.dpapi"))
        $entropyBytes = [Text.Encoding]::UTF8.GetBytes($EntropyText)
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $entropyBytes,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
        return [Text.Encoding]::UTF8.GetString($plainBytes)
    }
    finally {
        if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
        if ($entropyBytes) { [Array]::Clear($entropyBytes, 0, $entropyBytes.Length) }
        if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    }
}

$bootstrapPassword = $null
try {
    $env:JAVA_HOME = $javaHome
    $env:PATH = "$javaHome\bin;$env:PATH"
    $env:JAVA_OPTS_KC_HEAP = '-Xms256m -Xmx768m'
    if (-not (Test-Path -LiteralPath $bootstrapMarker)) {
        $bootstrapPassword = Unprotect-Secret `
            'bootstrap-admin-password' `
            'DLE-OS|Keycloak|Bootstrap-Admin|v1'
        $env:KC_BOOTSTRAP_ADMIN_USERNAME = 'dleos-bootstrap-admin'
        $env:KC_BOOTSTRAP_ADMIN_PASSWORD = $bootstrapPassword
    }

    & (Join-Path $keycloakHome 'bin\kc.bat') start --optimized
    exit $LASTEXITCODE
}
finally {
    $bootstrapPassword = $null
    $env:KC_BOOTSTRAP_ADMIN_USERNAME = $null
    $env:KC_BOOTSTRAP_ADMIN_PASSWORD = $null
}
