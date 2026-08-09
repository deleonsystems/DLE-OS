[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resultPath = 'C:\ProgramData\DLE-OS\Keycloak\State\email-optional.json'
$secretPath = 'C:\ProgramData\DLE-OS\Keycloak\Secrets\bootstrap-admin-password.dpapi'
$entropyText = 'DLE-OS|Keycloak|Bootstrap-Admin|v1'
$baseUri = 'http://127.0.0.1:8180'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

function Invoke-KeycloakRequest {
    param(
        [ValidateSet('GET','PUT')][string]$Method,
        [string]$Path,
        [hashtable]$Headers,
        $Body=$null
    )
    $parameters = @{
        UseBasicParsing = $true
        Method = $Method
        Uri = "$baseUri$Path"
        Headers = $Headers
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }
    return Invoke-WebRequest @parameters
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Realm = 'dle-os'
    Attribute = 'email'
    IntendedPolicy = 'OPTIONAL'
    ServiceRestarted = $false
}
$protectedBytes = $null
$entropyBytes = $null
$plainBytes = $null
$adminPassword = $null
$token = $null
$headers = $null

try {
    $service = Get-Service -Name DleOsKeycloak
    if ($service.Status -ne 'Running') { throw 'The Keycloak service is not running.' }
    if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
        throw 'The protected Keycloak administrator secret is absent.'
    }

    Add-Type -AssemblyName System.Security
    $protectedBytes = [IO.File]::ReadAllBytes($secretPath)
    $entropyBytes = [Text.Encoding]::UTF8.GetBytes($entropyText)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $entropyBytes,
        [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $adminPassword = [Text.Encoding]::UTF8.GetString($plainBytes)

    $tokenResponse = Invoke-RestMethod -UseBasicParsing -Method Post `
        -Uri "$baseUri/realms/master/protocol/openid-connect/token" `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body @{grant_type='password';client_id='admin-cli';username='dleos-admin';password=$adminPassword}
    $token = [string]$tokenResponse.access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'Keycloak did not issue an administrator token.' }
    $headers = @{Authorization="Bearer $token"}

    $profile = (Invoke-KeycloakRequest GET '/admin/realms/dle-os/users/profile' $headers).Content |
        ConvertFrom-Json
    $emailAttributes = @($profile.attributes | Where-Object name -EQ 'email')
    if ($emailAttributes.Count -ne 1) { throw 'The realm email profile attribute is not unique.' }
    $emailAttributes[0].PSObject.Properties.Remove('required')
    [void](Invoke-KeycloakRequest PUT '/admin/realms/dle-os/users/profile' $headers $profile)

    $verifiedProfile = (Invoke-KeycloakRequest GET '/admin/realms/dle-os/users/profile' $headers).Content |
        ConvertFrom-Json
    $verifiedEmail = @($verifiedProfile.attributes | Where-Object name -EQ 'email')
    if ($verifiedEmail.Count -ne 1 -or
        $verifiedEmail[0].PSObject.Properties.Name -contains 'required') {
        throw 'The Keycloak email attribute remains required.'
    }

    $users = @(((Invoke-KeycloakRequest GET `
        '/admin/realms/dle-os/users?username=miguel&exact=true' $headers).Content | ConvertFrom-Json))
    if ($users.Count -ne 1) { throw 'The Miguel Keycloak account is not unique.' }
    if (@($users[0].requiredActions).Count -ne 0) {
        throw 'Miguel has an explicit required action that was not approved for this correction.'
    }

    $evidence.EffectivePolicy = 'OPTIONAL'
    $emailProperty = $users[0].PSObject.Properties['email']
    $evidence.MiguelEmailStored = $null -ne $emailProperty -and
        -not [string]::IsNullOrWhiteSpace([string]$emailProperty.Value)
    $evidence.MiguelRequiredActionCount = 0
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    if ($headers) { $headers.Clear() }
    $token = $null
    $adminPassword = $null
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($entropyBytes) { [Array]::Clear($entropyBytes, 0, $entropyBytes.Length) }
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

[pscustomobject]$evidence
