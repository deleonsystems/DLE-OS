[CmdletBinding()]
param(
    [string] $QualifiedPackageRoot =
        'C:\DLE-OS\Canonical\InvoiceHistory\Candidate',
    [string] $EvidencePath =
        'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
        'InvoiceHistoryRefresh001\' +
        'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
        'FULL_RECONCILIATION_QUALIFICATION.json'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedPackage =
    'C:\DLE-OS\Canonical\InvoiceHistory\Candidate'
$resolvedPackage = [IO.Path]::GetFullPath($QualifiedPackageRoot)
if ($resolvedPackage -ine [IO.Path]::GetFullPath($approvedPackage)) {
    throw 'Only the fixed qualified full baseline package is accepted.'
}
$manifestPath = Join-Path $resolvedPackage 'manifest.json'
$hashesPath = Join-Path $resolvedPackage 'hashes.csv'
if (
    -not (Test-Path -LiteralPath $manifestPath) -or
    -not (Test-Path -LiteralPath $hashesPath)
) {
    throw 'The qualified full baseline package is incomplete.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (
    $manifest.schema -ne 'DLE_INVOICE_HISTORY_BASELINE_V1' -or
    $manifest.verdict -ne 'PASS' -or
    $manifest.contractVersion -ne '1.2'
) {
    throw 'The qualified full baseline manifest is invalid.'
}
foreach ($entry in (Import-Csv -LiteralPath $hashesPath)) {
    $path = Join-Path $resolvedPackage ($entry.RelativePath -replace '/', '\')
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ine $entry.Sha256) {
        throw "Qualified package file hash mismatch: $($entry.RelativePath)"
    }
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$workRoot = Join-Path (
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs') (
    "FULLRECONCILIATION-$stamp")
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
$exportScript = Join-Path $PSScriptRoot 'Export-ActiveInvoiceHistory.ps1'
& $exportScript -RunRoot $workRoot | Out-Null

function Read-KeyedRows {
    param(
        [string] $Path,
        [string[]] $KeyFields
    )
    $result = @{}
    foreach ($row in (Import-Csv -LiteralPath $Path)) {
        $key = ($KeyFields | ForEach-Object {
            [string]$row.$_
        }) -join '|'
        if ($result.ContainsKey($key)) {
            throw "Duplicate reconciliation key: $key"
        }
        $values = [ordered]@{}
        foreach ($property in $row.PSObject.Properties) {
            $value = [string]$property.Value
            if ($property.Name -in @(
                'QuantityShipped', 'UnitPrice', 'ExtendedPrice')) {
                $number = [decimal]::Parse(
                    ($value.Trim() -replace ',', ''),
                    [Globalization.CultureInfo]::InvariantCulture)
                $value = $number.ToString(
                    '0.############################',
                    [Globalization.CultureInfo]::InvariantCulture)
            }
            $values[$property.Name] = $value.Trim()
        }
        $result[$key] = $values
    }
    return $result
}

function Compare-Entity {
    param(
        [hashtable] $Qualified,
        [hashtable] $Active
    )
    $missing = @($Qualified.Keys | Where-Object {
        -not $Active.ContainsKey($_)
    })
    $extra = @($Active.Keys | Where-Object {
        -not $Qualified.ContainsKey($_)
    })
    $mismatch = [Collections.Generic.List[object]]::new()
    foreach ($key in ($Qualified.Keys | Where-Object {
        $Active.ContainsKey($_)
    })) {
        foreach ($field in $Qualified[$key].Keys) {
            if (
                $field -eq 'SourceKeyRaw' -or
                -not $Active[$key].Contains($field)
            ) {
                continue
            }
            if ($Qualified[$key][$field] -cne $Active[$key][$field]) {
                $mismatch.Add([pscustomobject]@{
                    Key = $key
                    Field = $field
                    QualifiedValue = $Qualified[$key][$field]
                    ActiveValue = $Active[$key][$field]
                })
            }
        }
    }
    return [pscustomobject]@{
        QualifiedCount = $Qualified.Count
        ActiveCount = $Active.Count
        MissingCount = $missing.Count
        ExtraCount = $extra.Count
        FieldMismatchCount = $mismatch.Count
        MissingKeys = @($missing | Sort-Object | Select-Object -First 25)
        ExtraKeys = @($extra | Sort-Object | Select-Object -First 25)
        FieldMismatches = @($mismatch | Select-Object -First 50)
    }
}

$headerKey = @(
    'FirmId', 'ArType', 'CustomerNumber', 'InvoiceNumber')
$lineKey = $headerKey + 'InvoiceLineNumber'
$qualifiedHeaders = Read-KeyedRows `
    -Path (Join-Path $resolvedPackage 'Canonical\CustomerInvoice.csv') `
    -KeyFields $headerKey
$activeHeaders = Read-KeyedRows `
    -Path (Join-Path $workRoot 'Active\CustomerInvoice.csv') `
    -KeyFields $headerKey
$qualifiedLines = Read-KeyedRows `
    -Path (
        Join-Path $resolvedPackage (
            'Canonical\CustomerInvoiceLine.csv')) `
    -KeyFields $lineKey
$activeLines = Read-KeyedRows `
    -Path (Join-Path $workRoot 'Active\CustomerInvoiceLine.csv') `
    -KeyFields $lineKey

$headerResult = Compare-Entity $qualifiedHeaders $activeHeaders
$lineResult = Compare-Entity $qualifiedLines $activeLines
$verdict = if (
    $headerResult.MissingCount -eq 0 -and
    $headerResult.ExtraCount -eq 0 -and
    $headerResult.FieldMismatchCount -eq 0 -and
    $lineResult.MissingCount -eq 0 -and
    $lineResult.ExtraCount -eq 0 -and
    $lineResult.FieldMismatchCount -eq 0
) { 'PASS' } else { 'PASS_WITH_CLARIFICATIONS' }

$evidence = [ordered]@{
    Verdict = $verdict
    ReconciledAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Operation = 'SEPARATE_DELIBERATE_FULL_RECONCILIATION'
    SourceAccess = 'NONE'
    SqlAccess = 'SELECT_ONLY'
    QualifiedPackageRoot = $resolvedPackage
    QualifiedPackageHash = $manifest.packageContentSha256
    QualifiedPackageRunId = $manifest.runId
    CustomerInvoice = $headerResult
    CustomerInvoiceLine = $lineResult
    MutationPerformed = $false
}
$evidence |
    ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $EvidencePath -Encoding UTF8
$evidence | ConvertTo-Json -Depth 10
