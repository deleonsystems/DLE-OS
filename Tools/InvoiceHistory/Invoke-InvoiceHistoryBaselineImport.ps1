[CmdletBinding()]
param(
    [switch]$QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
$runId = 'INVOICEHISTORYPLATFORM001-' +
    [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$packageBuilder = 'C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\build_invoice_history_package.py'
$python = 'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$importer = 'C:\DLE-OS\Repositories\DLE-OS-Server\Tools\Import-InvoiceHistoryBaseline.ps1'
$schemaScript = 'C:\DLE-OS\Repositories\DLE-OS-Server\Database\Scripts\019_AddInvoiceHistoryPlatform.sql'
$sourceDefinitions = @(
    @{
        Name = 'ART-03'
        Path = 'X:\AON\ADATA\ART-03'
        Sha256 = '2C74E6FE76D5FA6C7506AB7839CEFA32E9C9E60E03356660B80DD4A02B56B9CF'
    },
    @{
        Name = 'ART-13'
        Path = 'X:\AON\ADATA\ART-13'
        Sha256 = '300266F4C955C9DBF2857E598C2D8F5429EEBA64D8A0637269014AE438C9AEC2'
    }
)

function Get-QualifiedSourceIdentity {
    param([hashtable]$Definition)

    if (-not (Test-Path -LiteralPath $Definition.Path -PathType Leaf)) {
        throw "Required source is unavailable: $($Definition.Name)"
    }
    $item = Get-Item -LiteralPath $Definition.Path
    $hash = (Get-FileHash -LiteralPath $Definition.Path -Algorithm SHA256).Hash
    if ($hash -ne $Definition.Sha256) {
        throw (
            "$($Definition.Name) no longer matches the qualified read-only " +
            'source identity. A new O_RDONLY qualification is required.'
        )
    }
    [pscustomobject]@{
        Name = $Definition.Name
        Path = $Definition.Path
        Length = $item.Length
        LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
        Sha256 = $hash
        Access = 'read-only OS identity verification'
    }
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or
    -not (Test-Path -LiteralPath $packageBuilder -PathType Leaf) -or
    -not (Test-Path -LiteralPath $importer -PathType Leaf) -or
    -not (Test-Path -LiteralPath $schemaScript -PathType Leaf)) {
    throw 'The fixed Invoice History implementation paths are incomplete.'
}

$before = @($sourceDefinitions | ForEach-Object {
    Get-QualifiedSourceIdentity -Definition $_
})

& $python $packageBuilder --run-id $runId
if ($LASTEXITCODE -ne 0) {
    throw "Invoice History package build failed with code $LASTEXITCODE."
}

$after = @($sourceDefinitions | ForEach-Object {
    Get-QualifiedSourceIdentity -Definition $_
})
if (($before | ConvertTo-Json -Compress) -ne
    ($after | ConvertTo-Json -Compress)) {
    throw 'A qualified source identity changed during package construction.'
}

$arguments = @()
if ($QualificationInduceFailure) {
    $arguments += '-QualificationInduceFailure'
}
& $importer @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Invoice History import failed with code $LASTEXITCODE."
}

[pscustomobject]@{
    Verdict = 'PASS'
    RunId = $runId
    Sources = $after
    Package = 'C:\DLE-OS\Canonical\InvoiceHistory\Candidate'
    SourceWrites = 0
    LocksRequested = 0
} | ConvertTo-Json -Depth 5
