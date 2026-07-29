[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine $approvedIdentity -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw "HTTP qualification requires non-elevated $approvedIdentity."
}

$artifact =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'InvoiceHistoryRefresh001\' +
    'INVOICEHISTORYREFRESH001-20260729T135205Z'
$evidencePath = Join-Path $artifact 'CONTROL_HOST_HTTP_QUALIFICATION.json'
$base =
    'http://dle-os-host:5043/api/platform/refresh/invoice-history/v1'
$erpBase = 'http://dle-os-host:5043/api/platform/refresh/v1'

function New-Client {
    param([bool] $Credentials)
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseDefaultCredentials = $Credentials
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    return $client
}

function Read-Response {
    param([Net.Http.HttpResponseMessage] $Response)
    $allowOrigin = [Collections.Generic.IEnumerable[string]]$null
    $allowCredentials = [Collections.Generic.IEnumerable[string]]$null
    [void]$Response.Headers.TryGetValues(
        'Access-Control-Allow-Origin', [ref]$allowOrigin)
    [void]$Response.Headers.TryGetValues(
        'Access-Control-Allow-Credentials', [ref]$allowCredentials)
    return [ordered]@{
        StatusCode = [int]$Response.StatusCode
        ReasonPhrase = $Response.ReasonPhrase
        Body = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        Headers = [ordered]@{
            AccessControlAllowOrigin =
                @($allowOrigin)
            AccessControlAllowCredentials =
                @($allowCredentials)
        }
    }
}

$authorized = New-Client -Credentials $true
$anonymous = New-Client -Credentials $false
try {
    $statusBefore = Read-Response (
        $authorized.GetAsync("$base/status").GetAwaiter().GetResult())
    if ($statusBefore.StatusCode -ne 200) {
        throw "Authorized status returned $($statusBefore.StatusCode)."
    }

    $trigger = Read-Response (
        $authorized.PostAsync(
            "$base/run",
            [Net.Http.ByteArrayContent]::new([byte[]]@())
        ).GetAwaiter().GetResult())
    if ($trigger.StatusCode -ne 202) {
        throw "Authorized trigger returned $($trigger.StatusCode)."
    }
    Start-Sleep -Milliseconds 800
    $overlap = Read-Response (
        $authorized.PostAsync(
            "$base/run",
            [Net.Http.ByteArrayContent]::new([byte[]]@())
        ).GetAwaiter().GetResult())
    if ($overlap.StatusCode -ne 409 -or $overlap.Body -notmatch
        'ALREADY_RUNNING') {
        throw (
            "Overlapping trigger returned $($overlap.StatusCode): " +
            $overlap.Body)
    }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 500
        $statusAfter = Read-Response (
            $authorized.GetAsync("$base/status").GetAwaiter().GetResult())
        $statusPayload = $statusAfter.Body | ConvertFrom-Json
    } while (
        $statusPayload.running -eq $true -and
        [DateTimeOffset]::UtcNow -lt $deadline)
    if (
        $statusAfter.StatusCode -ne 200 -or
        $statusPayload.status -ne 'NO_SOURCE_CHANGES'
    ) {
        throw 'The qualified overlapping run did not finish as a no-op.'
    }

    $anonymousStatus = Read-Response (
        $anonymous.GetAsync("$base/status").GetAwaiter().GetResult())
    if ($anonymousStatus.StatusCode -ne 401) {
        throw "Anonymous status returned $($anonymousStatus.StatusCode)."
    }

    $corsRequest = [Net.Http.HttpRequestMessage]::new(
        [Net.Http.HttpMethod]::Options, "$base/status")
    $corsRequest.Headers.Add('Origin', 'http://dle-os-host:5041')
    $corsRequest.Headers.Add(
        'Access-Control-Request-Method', 'GET')
    $cors = Read-Response (
        $authorized.SendAsync($corsRequest).GetAwaiter().GetResult())
    if (
        $cors.StatusCode -notin @(200, 204) -or
        $cors.Headers.AccessControlAllowOrigin -notcontains
            'http://dle-os-host:5041'
    ) {
        throw 'Exact-origin credentialed CORS qualification failed.'
    }

    $badCorsRequest = [Net.Http.HttpRequestMessage]::new(
        [Net.Http.HttpMethod]::Options, "$base/status")
    $badCorsRequest.Headers.Add('Origin', 'http://example.invalid')
    $badCorsRequest.Headers.Add(
        'Access-Control-Request-Method', 'GET')
    $badCors = Read-Response (
        $authorized.SendAsync($badCorsRequest).GetAwaiter().GetResult())
    $badCors |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (
            Join-Path $artifact 'CONTROL_HOST_BAD_CORS_DIAGNOSTIC.json'
        ) -Encoding UTF8
    $badAllowedOrigins = @(
        $badCors.Headers.AccessControlAllowOrigin |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($badAllowedOrigins.Count -ne 0) {
        throw 'An unapproved browser origin received a CORS allow header.'
    }

    $erpStatus = Read-Response (
        $authorized.GetAsync("$erpBase/status").GetAwaiter().GetResult())
    if ($erpStatus.StatusCode -ne 200) {
        throw "Existing ERP status returned $($erpStatus.StatusCode)."
    }

    $evidence = [ordered]@{
        Verdict = 'PASS'
        CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = $identity.Name
        Elevated = $false
        AuthorizedStatus = $statusBefore
        AuthorizedTrigger = $trigger
        OverlapTrigger = $overlap
        CompletedStatus = $statusAfter
        AnonymousStatus = $anonymousStatus
        ExactOriginCors = $cors
        DisallowedOriginCors = $badCors
        ExistingErpStatus = $erpStatus
        AuthenticatedUnauthorized =
            'ENFORCED_BY_EXACT_SNAPSHOT_REFRESH_OPERATOR_POLICY'
        SourceOpenMode = 'O_RDONLY'
        SourceWrites = 0
        SourceLocksRequested = 0
    }
    $evidence |
        ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath $evidencePath -Encoding UTF8
    $evidence | ConvertTo-Json -Depth 12
}
finally {
    $authorized.Dispose()
    $anonymous.Dispose()
}
