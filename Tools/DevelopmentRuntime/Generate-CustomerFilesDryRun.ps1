[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$artifactRoot = Join-Path $repository (
    "Artifacts\CustomerFiles001\CUSTOMERFILES001-$stamp"
)
$manifestPath = Join-Path $artifactRoot (
    'CUSTOMER_FILES_DRY_RUN_MANIFEST.json'
)
$manifest = Invoke-RestMethod `
    -UseDefaultCredentials `
    -Uri (
        'http://dle-os-host:5053/' +
        'api/customer-files/v1/manifest/dry-run'
    ) `
    -TimeoutSec 60
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $manifestPath -Encoding UTF8
[pscustomobject]@{
    ManifestPath = $manifestPath
    CanonicalCustomerCount = $manifest.canonicalCustomerCount
    Counts = $manifest.counts
}
