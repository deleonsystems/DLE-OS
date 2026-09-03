[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('create', 'delete')]
    [string]$Operation,

    [Parameter(Mandatory, Position = 1)]
    [string]$Identifier,

    [Parameter(Mandatory, Position = 2)]
    [string]$RecordName,

    [Parameter(Mandatory, Position = 3)]
    [string]$Token
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$zone = 'dlemfg.com'
$approvedIdentifiers = @(
    'dle-os.internal.dlemfg.com',
    'dev.dle-os.internal.dlemfg.com',
    'auth.internal.dlemfg.com',
    'sim-adan.dle-os.internal.dlemfg.com'
)
$secretPath = 'C:\ProgramData\DLE-OS\ACME\Secrets\godaddy-pat.dpapi'
$stateDirectory = 'C:\ProgramData\DLE-OS\ACME\State'
$entropyText = 'DLE-OS|ACME|GoDaddy-PAT|v1'

$normalizedIdentifier = $Identifier.TrimEnd('.').ToLowerInvariant()
$normalizedRecordName = $RecordName.TrimEnd('.').ToLowerInvariant()
$expectedRecordName = "_acme-challenge.$normalizedIdentifier"

if ($normalizedIdentifier -notin $approvedIdentifiers) {
    throw "DNS-01 identifier is outside the approved DLE-OS scope: $normalizedIdentifier"
}
if ($normalizedRecordName -ne $expectedRecordName) {
    throw "DNS-01 record name does not match the approved identifier: $normalizedRecordName"
}
if (-not $normalizedRecordName.EndsWith(".$zone", [StringComparison]::OrdinalIgnoreCase)) {
    throw "DNS-01 record is outside the approved zone: $normalizedRecordName"
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'DNS-01 token is empty.'
}

$nodeName = $normalizedRecordName.Substring(0, $normalizedRecordName.Length - $zone.Length - 1)
$stateKeyInput = "$Operation|$normalizedIdentifier|$normalizedRecordName|$Token"
if ($Operation -eq 'delete') {
    $stateKeyInput = "create|$normalizedIdentifier|$normalizedRecordName|$Token"
}
$stateKeyBytes = [Text.Encoding]::UTF8.GetBytes($stateKeyInput)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $stateKey = ([BitConverter]::ToString($sha256.ComputeHash($stateKeyBytes))).Replace('-', '').ToLowerInvariant()
}
finally {
    $sha256.Dispose()
    [Array]::Clear($stateKeyBytes, 0, $stateKeyBytes.Length)
    $stateKeyInput = $null
}
$statePath = Join-Path $stateDirectory ("godaddy-dns01-$stateKey.json")

$protectedBytes = $null
$entropyBytes = $null
$plainBytes = $null
$pat = $null
$headers = $null

try {
    Add-Type -AssemblyName System.Security
    $protectedBytes = [IO.File]::ReadAllBytes($secretPath)
    $entropyBytes = [Text.Encoding]::UTF8.GetBytes($entropyText)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $entropyBytes,
        [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $pat = [Text.Encoding]::UTF8.GetString($plainBytes)
    $headers = @{
        Authorization = "Bearer $pat"
        Accept = 'application/json'
    }

    $baseUri = "https://api.godaddy.com/v3/domains/zones/$zone/dns-records"

    if ($Operation -eq 'create') {
        if (Test-Path -LiteralPath $statePath) {
            Write-Output 'DNS_CREATE_ALREADY_RECORDED'
            exit 0
        }

        $body = [ordered]@{
            type = 'TXT'
            name = $nodeName
            data = $Token
            ttl = 600
        } | ConvertTo-Json -Compress

        $createdRecord = Invoke-RestMethod `
            -Method Post `
            -Uri $baseUri `
            -Headers $headers `
            -ContentType 'application/json' `
            -Body $body

        if ([string]::IsNullOrWhiteSpace([string]$createdRecord.recordId)) {
            throw 'GoDaddy created the TXT record but returned no recordId for governed cleanup.'
        }

        if (-not (Test-Path -LiteralPath $stateDirectory)) {
            New-Item -ItemType Directory -Path $stateDirectory | Out-Null
        }
        [ordered]@{
            recordId = [string]$createdRecord.recordId
            zone = $zone
            recordName = $normalizedRecordName
            identifier = $normalizedIdentifier
            createdUtc = [DateTime]::UtcNow.ToString('o')
        } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

        Write-Output 'DNS_CREATE_PASS'
        exit 0
    }

    if (-not (Test-Path -LiteralPath $statePath)) {
        Write-Output 'DNS_DELETE_STATE_ABSENT'
        exit 0
    }

    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$state.recordId)) {
        throw 'Governed DNS-01 state contains no recordId.'
    }

    $recordId = [Uri]::EscapeDataString([string]$state.recordId)
    try {
        Invoke-RestMethod -Method Delete -Uri "$baseUri/$recordId" -Headers $headers | Out-Null
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -ne 404) {
            throw
        }
    }

    Remove-Item -LiteralPath $statePath -Force
    Write-Output 'DNS_DELETE_PASS'
}
finally {
    if ($headers) {
        $headers.Clear()
    }
    $pat = $null
    if ($plainBytes) {
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    if ($entropyBytes) {
        [Array]::Clear($entropyBytes, 0, $entropyBytes.Length)
    }
    if ($protectedBytes) {
        [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    }
}
