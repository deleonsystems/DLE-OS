[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Fa-f0-9]{40,128}$')]
    [string]$NewThumbprint,

    [string]$OldThumbprint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostname = 'dle-os.internal.dlemfg.com'
$hostnamePort = "$hostname`:443"
$applicationId = '{f6c755fb-cb3f-4fa2-8e94-6e53634a12db}'
$normalizedThumbprint = $NewThumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$normalizedThumbprint"

if (-not $certificate.HasPrivateKey) {
    throw 'The renewed DLE-OS HTTPS certificate has no machine-accessible private key.'
}
if ($certificate.NotAfter -le (Get-Date)) {
    throw 'The renewed DLE-OS HTTPS certificate is already expired.'
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
    throw "HTTP.sys SSL certificate binding failed: $netshOutput"
}

$serviceState = netsh http show servicestate view=requestq 2>&1 | Out-String
if ($serviceState -notmatch 'HTTPS://DLE-OS\.INTERNAL\.DLEMFG\.COM:443/') {
    Write-Output 'HTTPS_BINDING_PASS; ENDPOINT_VALIDATION_DEFERRED_UNTIL_LISTENER_DEPLOYMENT'
    exit 0
}

$curlOutput = & curl.exe `
    --silent `
    --show-error `
    --fail `
    --max-time 20 `
    --output NUL `
    --write-out '%{http_code}' `
    "https://$hostname/shared"
if ($LASTEXITCODE -ne 0 -or $curlOutput -ne '200') {
    throw "Post-renewal HTTPS validation failed with HTTP status $curlOutput."
}

Write-Output 'HTTPS_BINDING_AND_VALIDATION_PASS'
