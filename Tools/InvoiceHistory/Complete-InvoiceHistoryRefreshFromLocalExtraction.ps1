[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunId,

    [switch] $QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Local refresh completion requires non-elevated DLE-OS.'
}
if (
    $RunId -notmatch
    '^INVOICEHISTORYREFRESH-\d{8}T\d{6}Z-[0-9A-F]{8}$'
) {
    throw 'Invalid governed refresh run ID.'
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$runRoot = Join-Path (
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs') $RunId
$extraction = Join-Path $runRoot 'Extraction'
$active = Join-Path $runRoot 'Active'
$summary = Import-Csv -LiteralPath (
    Join-Path $extraction 'BOUNDED_SUMMARY.csv')
$metrics = @{}
foreach ($row in $summary) { $metrics[$row.metric] = $row.value }
$windowStart = [DateTime]::ParseExact(
    $metrics.overlap_start, 'yyyy-MM-dd', $null)
$windowEnd = [DateTime]::ParseExact(
    $metrics.overlap_end, 'yyyy-MM-dd', $null)

$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$builder = Join-Path $repo (
    'Tools\InvoiceHistory\build_invoice_history_refresh_package.py')
$importer = Join-Path $repo (
    'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1')

$manifestPath = Join-Path $runRoot 'Package\manifest.json'
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $builderOutput = Get-Content -LiteralPath $manifestPath -Raw
}
else {
    $builderOutput = & $python $builder `
        --run-id $RunId `
        --input-root $extraction `
        --active-header-csv (Join-Path $active 'CustomerInvoice.csv') `
        --active-line-csv (Join-Path $active 'CustomerInvoiceLine.csv') `
        --window-start $windowStart.ToString('yyyy-MM-dd') `
        --window-end $windowEnd.ToString('yyyy-MM-dd') `
        --snapshot-year $windowEnd.Year
    if ($LASTEXITCODE -ne 0) {
        throw 'Local refresh package construction failed.'
    }
}
$importArguments = @{
    PackagePath = Join-Path $runRoot 'Package'
}
if ($QualificationInduceFailure) {
    $importArguments.QualificationInduceFailure = $true
}
$importOutput = & $importer @importArguments
[pscustomobject]@{
    Verdict = 'PASS'
    Package = $builderOutput | ConvertFrom-Json
    Import = $importOutput | ConvertFrom-Json
    SourceAccess = 'NONE_LOCAL_COMPLETION'
} | ConvertTo-Json -Depth 8
