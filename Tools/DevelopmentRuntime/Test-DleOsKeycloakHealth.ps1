[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostname = 'auth.internal.dlemfg.com'
$result = [ordered]@{
    Verdict = 'FAIL'
    CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Hostname = $hostname
}
$healthRoot = 'C:\ProgramData\DLE-OS\Keycloak\Health'
$healthPath = Join-Path $healthRoot 'status.json'

try {
    $certificate = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $hostname -in @($_.DnsNameList.Unicode) } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
    if (-not $certificate -or -not $certificate.HasPrivateKey)
        { throw 'The Keycloak HTTPS certificate/private key is absent.' }
    $remainingDays = [Math]::Floor(($certificate.NotAfter.ToUniversalTime() - [DateTime]::UtcNow).TotalDays)
    if ($remainingDays -lt 21) { throw "The Keycloak certificate has only $remainingDays days remaining." }

    $binding = netsh http show sslcert "hostnameport=$hostname`:443" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch $certificate.Thumbprint.ToLowerInvariant())
        { throw 'The Keycloak HTTP.sys binding does not use the current certificate.' }

    $service = Get-CimInstance Win32_Service -Filter "Name='DleOsKeycloak'"
    if (-not $service -or $service.State -ne 'Running' -or
        $service.StartName -ine 'NT SERVICE\DleOsKeycloak')
        { throw 'The dedicated Keycloak service is not healthy.' }

    $loopback = & curl.exe --silent --show-error --max-time 20 --output NUL `
        --write-out '%{http_code}' 'http://127.0.0.1:9190/health/ready'
    if ($LASTEXITCODE -ne 0 -or $loopback -ne '200')
        { throw "Keycloak loopback readiness failed with status $loopback." }
    $discovery = & curl.exe --silent --show-error --max-time 20 --output NUL `
        --write-out '%{http_code}' "https://$hostname/realms/dle-os/.well-known/openid-configuration"
    if ($LASTEXITCODE -ne 0 -or $discovery -ne '200')
        { throw "Keycloak HTTPS discovery failed with status $discovery." }

    $result.Verdict = 'PASS'
    $result.ServiceIdentity = $service.StartName
    $result.CertificateThumbprint = $certificate.Thumbprint
    $result.CertificateNotAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('o')
    $result.RemainingDays = $remainingDays
    $result.LoopbackReadinessStatus = [int]$loopback
    $result.DiscoveryStatus = [int]$discovery
}
catch {
    $result.Error = $_.Exception.Message
    if ([Diagnostics.EventLog]::SourceExists('DLE-OS Keycloak')) {
        Write-EventLog -LogName Application -Source 'DLE-OS Keycloak' -EventId 6204 `
            -EntryType Error -Message "DLE-OS Keycloak health failed: $($_.Exception.Message)"
    }
    throw
}
finally {
    if (-not (Test-Path -LiteralPath $healthRoot))
        { New-Item -ItemType Directory -Path $healthRoot | Out-Null }
    $temporary = Join-Path $healthRoot ('.status.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $healthPath -Force
}

[pscustomobject]$result
