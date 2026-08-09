[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Fa-f0-9]{40,128}$')]
    [string]$NewThumbprint,

    [string]$OldThumbprint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostname = 'auth.internal.dlemfg.com'
$hostnamePort = "$hostname`:443"
$applicationId = '{9cd849bd-70a4-45cb-a36b-87813eca9882}'
$normalizedThumbprint = $NewThumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$normalizedThumbprint"

if (-not $certificate.HasPrivateKey) {
    throw 'The renewed Keycloak HTTPS certificate has no machine-accessible private key.'
}
if ($certificate.NotAfter -le (Get-Date)) {
    throw 'The renewed Keycloak HTTPS certificate is already expired.'
}
if ($hostname -notin @($certificate.DnsNameList.Unicode)) {
    throw "The renewed certificate does not contain the required SAN $hostname."
}

$existingBinding = netsh http show sslcert "hostnameport=$hostnamePort" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -and $existingBinding -match 'Certificate Hash') {
    $netshOutput = netsh http update sslcert `
        "hostnameport=$hostnamePort" `
        "certhash=$normalizedThumbprint" `
        "appid=$applicationId" `
        'certstorename=MY' 2>&1 | Out-String
}
else {
    $netshOutput = netsh http add sslcert `
        "hostnameport=$hostnamePort" `
        "certhash=$normalizedThumbprint" `
        "appid=$applicationId" `
        'certstorename=MY' 2>&1 | Out-String
}
if ($LASTEXITCODE -ne 0) {
    throw "HTTP.sys Keycloak SSL certificate binding failed: $netshOutput"
}

$serviceState = netsh http show servicestate view=requestq 2>&1 | Out-String
if ($serviceState -notmatch 'HTTPS://AUTH\.INTERNAL\.DLEMFG\.COM:443/') {
    Write-Output 'KEYCLOAK_HTTPS_BINDING_PASS; ENDPOINT_VALIDATION_DEFERRED_UNTIL_GATEWAY_DEPLOYMENT'
    exit 0
}

$discoveryStatus = & curl.exe `
    --silent `
    --show-error `
    --fail `
    --max-time 20 `
    --output NUL `
    --write-out '%{http_code}' `
    "https://$hostname/realms/dle-os/.well-known/openid-configuration"
if ($LASTEXITCODE -ne 0 -or $discoveryStatus -ne '200') {
    throw "Post-renewal Keycloak discovery validation failed with HTTP status $discoveryStatus."
}

Write-Output 'KEYCLOAK_HTTPS_BINDING_AND_VALIDATION_PASS'
