[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostname = 'dle-os.internal.dlemfg.com'
$hostnamePort = "$hostname`:443"
$renewalTaskName = 'win-acme renew (acme-v02.api.letsencrypt.org)'
$healthDirectory = 'C:\ProgramData\DLE-OS\ACME\Health'
$healthPath = Join-Path $healthDirectory 'status.json'
$eventSource = 'DLE-OS ACME'
$result = [ordered]@{
    Verdict = 'FAIL'
    CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Hostname = $hostname
}

try {
    $certificates = @(
        Get-ChildItem Cert:\LocalMachine\My |
            Where-Object { $hostname -in @($_.DnsNameList.Unicode) } |
            Sort-Object NotAfter -Descending
    )
    if ($certificates.Count -eq 0) {
        throw 'No DLE-OS HTTPS certificate exists in LocalMachine\My.'
    }
    $certificate = $certificates[0]
    if (-not $certificate.HasPrivateKey) {
        throw 'The DLE-OS HTTPS certificate has no private key.'
    }
    $remainingDays = [Math]::Floor(($certificate.NotAfter.ToUniversalTime() - [DateTime]::UtcNow).TotalDays)
    if ($remainingDays -lt 21) {
        throw "The DLE-OS HTTPS certificate has only $remainingDays days remaining."
    }

    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        if (-not $chain.Build($certificate)) {
            $statuses = @($chain.ChainStatus | ForEach-Object { [string]$_.Status }) -join ','
            throw "The DLE-OS HTTPS certificate chain is not trusted: $statuses"
        }
        $result.ChainSubjects = @($chain.ChainElements | ForEach-Object { $_.Certificate.Subject })
    }
    finally {
        $chain.Dispose()
    }

    $sslBinding = netsh http show sslcert "hostnameport=$hostnamePort" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $sslBinding -notmatch $certificate.Thumbprint.ToLowerInvariant()) {
        throw 'HTTP.sys is not bound to the current DLE-OS HTTPS certificate.'
    }

    $resolvedAddresses = @(
        Resolve-DnsName $hostname -Type A -DnsOnly -ErrorAction Stop |
            Where-Object Type -eq A |
            Select-Object -ExpandProperty IPAddress -Unique
    )
    if ('192.168.0.105' -notin $resolvedAddresses) {
        throw 'The governed hostname does not resolve to 192.168.0.105.'
    }

    $httpsStatus = & curl.exe --silent --show-error --max-time 20 --output NUL --write-out '%{http_code}' "https://$hostname/shared"
    if ($LASTEXITCODE -ne 0 -or $httpsStatus -ne '200') {
        throw "HTTPS /shared health check failed with status $httpsStatus."
    }
    $rollbackStatus = & curl.exe --silent --show-error --max-time 20 --output NUL --write-out '%{http_code}' 'http://192.168.0.105:5051/shared'
    if ($LASTEXITCODE -ne 0 -or $rollbackStatus -ne '200') {
        throw "HTTP rollback health check failed with status $rollbackStatus."
    }

    $renewalTask = Get-ScheduledTask -TaskName $renewalTaskName -ErrorAction Stop
    if ($renewalTask.Principal.UserId -notin @('SYSTEM', 'NT AUTHORITY\SYSTEM')) {
        throw 'The win-acme renewal task does not run as SYSTEM.'
    }
    $renewalTaskInfo = Get-ScheduledTaskInfo -TaskName $renewalTaskName
    if ($renewalTaskInfo.LastTaskResult -ne 0) {
        throw "The win-acme renewal task last result is $($renewalTaskInfo.LastTaskResult)."
    }

    $result.Verdict = 'PASS'
    $result.CertificateSubject = $certificate.Subject
    $result.CertificateThumbprint = $certificate.Thumbprint
    $result.CertificateNotAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('o')
    $result.RemainingDays = $remainingDays
    $result.DnsAddresses = $resolvedAddresses
    $result.HttpsStatus = [int]$httpsStatus
    $result.HttpRollbackStatus = [int]$rollbackStatus
    $result.RenewalTask = $renewalTaskName
    $result.RenewalIdentity = $renewalTask.Principal.UserId
    $result.RenewalLastResult = $renewalTaskInfo.LastTaskResult
}
catch {
    $result.Error = $_.Exception.Message
    if ([Diagnostics.EventLog]::SourceExists($eventSource)) {
        Write-EventLog -LogName Application -Source $eventSource -EventId 6202 -EntryType Error `
            -Message "DLE-OS ACME health check failed: $($_.Exception.Message)"
    }
    throw
}
finally {
    if (-not (Test-Path -LiteralPath $healthDirectory)) {
        New-Item -ItemType Directory -Path $healthDirectory | Out-Null
    }
    $temporaryPath = Join-Path $healthDirectory ('.status.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $healthPath -Force
}

if ([Diagnostics.EventLog]::SourceExists($eventSource)) {
    Write-EventLog -LogName Application -Source $eventSource -EventId 6201 -EntryType Information `
        -Message "DLE-OS ACME health check passed. Certificate expires $($result.CertificateNotAfterUtc)."
}

[pscustomobject]$result
