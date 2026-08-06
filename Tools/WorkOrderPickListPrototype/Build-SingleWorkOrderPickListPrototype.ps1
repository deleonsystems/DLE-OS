[CmdletBinding()]
param(
    [string]$ExtractionCsv = 'C:\Add-On\Lab\VProQualificationHarness\WorkOrderReleasedBom003\Attempts\WORKORDER_RELEASED_BOM_003_WOE22_CURSOR-20260806T025301635Z-CE5F98E5\Runtime\WOE22_0115621.csv',
    [string]$SourceVerdict = 'C:\Add-On\Lab\VProQualificationHarness\WorkOrderReleasedBom003\Attempts\WORKORDER_RELEASED_BOM_003_WOE22_CURSOR-20260806T025301635Z-CE5F98E5\attempt-verdict.json',
    [string]$WorkOrderCsv = 'C:\DLE-OS\Canonical\DailyOperationsSync\Runs\DAILYOPSSYNC-20260804T213226Z-4ED2C357\Candidates\WorkOrders\BasePackage\Canonical\WorkOrder.csv',
    [string]$InventoryItemCsv = 'C:\DLE-OS\Canonical\DailyOperationsSync\Runs\DAILYOPSSYNC-20260804T213226Z-4ED2C357\Candidates\WorkOrders\BasePackage\Canonical\InventoryItem.csv',
    [string]$SalesOrderCsv = 'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\Runs\OPENSALESREFRESH-20260804T213342Z-120867A2\Package\Canonical\SalesOrder.csv',
    [string]$SalesOrderLineCsv = 'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\Runs\OPENSALESREFRESH-20260804T213342Z-120867A2\Package\Canonical\SalesOrderLine.csv',
    [string]$CustomerCsv = 'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\Runs\OPENSALESREFRESH-20260804T213342Z-120867A2\Package\Canonical\Customer.csv',
    [string]$OutputDirectory = 'C:\DLE-OS\Repositories\DLE-OS\Artifacts\WorkOrderReleasedBom004\WORKORDER-RELEASED-BOM-004'
)

$ErrorActionPreference = 'Stop'
$targetWorkOrder = '0115621'
$targetPrefix = '01  0115621B'
$emDash = [char]0x2014

function Convert-HexToText {
    param([Parameter(Mandatory)][string]$Hex)
    $bytes = [byte[]]::new($Hex.Length / 2)
    for ($index = 0; $index -lt $bytes.Length; $index++) {
        $bytes[$index] = [Convert]::ToByte($Hex.Substring($index * 2, 2), 16)
    }
    return [Text.Encoding]::GetEncoding(28591).GetString($bytes)
}

function Convert-VProDate {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value.Length -lt 6) { return $null }
    $year = ([int][char]$Value[3]) - 32
    $month = ([int][char]$Value[4]) - 32
    $day = ([int][char]$Value[5]) - 32
    return '{0:00}/{1:00}/{2:00}' -f $month, $day, $year
}

function Convert-IsoToDisplayDate {
    param([Parameter(Mandatory)][string]$Value)
    return [DateTime]::ParseExact(
        $Value,
        'yyyy-MM-dd',
        [Globalization.CultureInfo]::InvariantCulture).ToString('MM/dd/yy')
}

$sourceEvidence = Get-Content -Raw -LiteralPath $SourceVerdict | ConvertFrom-Json
if ($sourceEvidence.Verdict -ne 'PASS' -or $sourceEvidence.SourceAccessMode -ne 'O_RDONLY') {
    throw 'Source evidence does not prove a PASS under O_RDONLY.'
}
if (-not $sourceEvidence.SourceIdentityStable -or $sourceEvidence.SourceWrites -ne 0 -or $sourceEvidence.SourceLocks -ne 0) {
    throw 'Source identity, write, or lock qualification failed.'
}

$descriptionByItem = @{}
foreach ($inventoryRow in (Import-Csv -LiteralPath $InventoryItemCsv)) {
    $descriptionByItem[$inventoryRow.ItemNumber.Trim()] = $inventoryRow.ItemDescription.Trim()
}

$decodedRows = @()
foreach ($sourceRow in (Import-Csv -LiteralPath $ExtractionCsv)) {
    $sourceKey = Convert-HexToText -Hex $sourceRow.source_key_hex
    $w0 = Convert-HexToText -Hex $sourceRow.w0_hex
    $w1 = Convert-HexToText -Hex $sourceRow.w1_hex
    $sequence = $w0.Substring(12, 3)
    $lineType = $w1.Substring(90, 1)
    $item = $w1.Substring(26, 20).TrimEnd()
    $message = $w1.Substring(91, 60).TrimEnd()
    $classification = if ($lineType -eq 'M') { 'MESSAGE' } elseif ($item) { 'COMPONENT' } else { 'UNRESOLVED' }

    if (-not $sourceKey.StartsWith($targetPrefix, [StringComparison]::Ordinal)) {
        throw "Out-of-scope WOE-22 key encountered: $sourceKey"
    }

    $decodedRows += [ordered]@{
        sourceOrder = $decodedRows.Count + 1
        sequence = $sequence
        lineType = $lineType
        classification = $classification
        itemNumber = $item
        description = if ($item -and $descriptionByItem.ContainsKey($item)) { $descriptionByItem[$item] } else { '' }
        materialMessage = $message
        unitOfMeasure = $w1.Substring(0, 2).TrimEnd()
        requiredDate = Convert-VProDate -Value $w1
        warehouse = $w1.Substring(24, 2).TrimEnd()
        operationSequence = $w1.Substring(46, 3).TrimEnd()
        requiredEach = [double]$sourceRow.n05
        divisor = [double]$sourceRow.n04
        alternateFactor = [double]$sourceRow.n06
        scrapFactor = [double]$sourceRow.n08
        totalWorkOrderUnits = [double]$sourceRow.n02
        exactSourceKey = $sourceKey
        exactSourceKeyHex = $sourceRow.source_key_hex
    }
}

$components = @($decodedRows | Where-Object classification -eq 'COMPONENT')
$messages = @($decodedRows | Where-Object classification -eq 'MESSAGE')
$unresolved = @($decodedRows | Where-Object classification -eq 'UNRESOLVED')
if ($decodedRows.Count -ne 100 -or $components.Count -ne 52 -or $messages.Count -ne 48 -or $unresolved.Count -ne 0) {
    throw "Count qualification failed: total=$($decodedRows.Count), component=$($components.Count), message=$($messages.Count), unresolved=$($unresolved.Count)"
}

$workOrder = Import-Csv -LiteralPath $WorkOrderCsv | Where-Object WorkOrderNumber -eq $targetWorkOrder
if (@($workOrder).Count -ne 1) { throw 'Canonical Work Order header was not uniquely resolved.' }
$salesOrder = Import-Csv -LiteralPath $SalesOrderCsv | Where-Object {
    $_.CustomerNumber -eq $workOrder.CustomerNumber -and $_.SalesOrderNumber -eq $workOrder.SalesOrderNumber
}
$salesOrderLine = Import-Csv -LiteralPath $SalesOrderLineCsv | Where-Object {
    $_.CustomerNumber -eq $workOrder.CustomerNumber -and
    $_.SalesOrderNumber -eq $workOrder.SalesOrderNumber -and
    $_.LineNumber -eq $workOrder.SalesOrderLineNumber -and
    $_.ItemNumber.Trim() -eq $workOrder.ItemNumber.Trim()
}
$customer = Import-Csv -LiteralPath $CustomerCsv | Where-Object CustomerNumber -eq $workOrder.CustomerNumber
if (@($salesOrder).Count -ne 1 -or @($salesOrderLine).Count -ne 1 -or @($customer).Count -ne 1) {
    throw 'Supported Sales Order line/customer header data was not uniquely resolved.'
}

$anchorExpectations = @{
    '026' = @{ classification = 'COMPONENT'; itemNumber = 'CDR32BX103BKUS7370' }
    '027' = @{ classification = 'MESSAGE'; materialMessage = '(6)C17' }
    '030' = @{ classification = 'COMPONENT'; itemNumber = 'CDR32BX223AKUS'; requiredEach = 1.0; totalWorkOrderUnits = 10.0 }
    '031' = @{ classification = 'COMPONENT'; itemNumber = 'CDR32BX223AKUS7185' }
}
foreach ($anchorSequence in $anchorExpectations.Keys) {
    $actual = $decodedRows | Where-Object sequence -eq $anchorSequence
    if (@($actual).Count -ne 1) { throw "Anchor $anchorSequence was not uniquely resolved." }
    foreach ($property in $anchorExpectations[$anchorSequence].Keys) {
        if ($actual.$property -ne $anchorExpectations[$anchorSequence][$property]) {
            throw "Anchor $anchorSequence failed property $property."
        }
    }
}

$reportData = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    sourceLabel = "Stored VPro5 Work Order Material Requirements $emDash WOE-22"
    developmentOnly = $true
    header = [ordered]@{
        company = 'DE LEON ENTERPRISES'
        workOrder = $workOrder.WorkOrderNumber
        enteredAlias = '115621'
        type = "S $emDash LABOR & MAT./BOM"
        status = "O $emDash OPEN"
        category = "I $emDash INVENTORY"
        billNumber = $workOrder.ItemNumber.Trim()
        description = $workOrder.ItemDescription.Trim()
        drawing = $workOrder.DrawingNumber.Trim()
        revision = $workOrder.DrawingRevision.Trim()
        scheduledProduction = [double]$workOrder.SchProdQuantity
        yield = 100.0
        unitOfMeasure = $workOrder.UnitOfMeasure.Trim()
        customer = $customer.CustomerName.Trim()
        customerNumber = $workOrder.CustomerNumber
        salesOrder = $workOrder.SalesOrderNumber
        salesOrderLine = $workOrder.SalesOrderLineNumber
        customerPurchaseOrder = $salesOrder.CustomerPurchaseOrderNumber.Trim()
        warehouse = $workOrder.WarehouseId
        openDate = Convert-IsoToDisplayDate -Value $workOrder.WorkOrderOpenedDateIso
    }
    orderSchedule = @(
        [ordered]@{
            salesOrderLine = $salesOrderLine.LineNumber
            itemNumber = $salesOrderLine.ItemNumber.Trim()
            quantityOrdered = [double]$salesOrderLine.QuantityOrdered
            unitOfMeasure = $workOrder.UnitOfMeasure.Trim()
            estimatedShip = Convert-IsoToDisplayDate -Value $salesOrderLine.EstimatedShipDate
        }
    )
    orderScheduleAssessment = [ordered]@{
        title = 'Order Schedule'
        semantics = 'Sales Order line with estimated shipment information'
        customerReleaseIdentifier = 'Unavailable'
        requestedDate = 'Unavailable'
        openQuantity = 'Unavailable'
        salesOrderStatus = 'Unavailable'
        estimatedShipClassification = 'Estimated shipment information'
        unrelatedSalesOrderLinesIncluded = 0
    }
    counts = [ordered]@{
        total = $decodedRows.Count
        component = $components.Count
        message = $messages.Count
        unresolved = $unresolved.Count
    }
    sourceIdentity = [ordered]@{
        path = $sourceEvidence.SourceIdentityBefore.Path
        accessMode = $sourceEvidence.SourceAccessMode
        sizeBefore = $sourceEvidence.SourceIdentityBefore.Length
        sizeAfter = $sourceEvidence.SourceIdentityAfter.Length
        timestampBeforeUtc = $sourceEvidence.SourceIdentityBefore.LastWriteTimeUtc
        timestampAfterUtc = $sourceEvidence.SourceIdentityAfter.LastWriteTimeUtc
        identityStable = $sourceEvidence.SourceIdentityStable
        writes = $sourceEvidence.SourceWrites
        locks = $sourceEvidence.SourceLocks
        prefixText = $targetPrefix
        prefixHex = '303120203031313536323142'
    }
    rows = $decodedRows
}

$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $outputPath.StartsWith('C:\DLE-OS\Repositories\DLE-OS\Artifacts\WorkOrderReleasedBom004\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Output path is outside the approved development artifact scope: $outputPath"
}
[IO.Directory]::CreateDirectory($outputPath) | Out-Null

$json = $reportData | ConvertTo-Json -Depth 8
$dataPath = Join-Path $outputPath 'work-order-0115621.json'
[IO.File]::WriteAllText($dataPath, $json, [Text.UTF8Encoding]::new($false))

$templatePath = Join-Path $PSScriptRoot 'work-order-pick-list-template.html'
$html = [IO.File]::ReadAllText($templatePath).Replace('__REPORT_DATA__', $json)
$htmlPath = Join-Path $outputPath 'index.html'
[IO.File]::WriteAllText($htmlPath, $html, [Text.UTF8Encoding]::new($false))

$qualification = [ordered]@{
    verdict = 'PASS'
    workOrder = $targetWorkOrder
    totalRows = $decodedRows.Count
    componentRows = $components.Count
    messageRows = $messages.Count
    unresolvedRows = $unresolved.Count
    anchorsMatched = @('026', '027', '030', '031')
    sourceAccessMode = $sourceEvidence.SourceAccessMode
    sourceIdentityStable = $sourceEvidence.SourceIdentityStable
    sourceWrites = $sourceEvidence.SourceWrites
    sourceLocks = $sourceEvidence.SourceLocks
    htmlPath = $htmlPath
    dataPath = $dataPath
}
$qualificationPath = Join-Path $outputPath 'qualification.json'
[IO.File]::WriteAllText($qualificationPath, ($qualification | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$qualification | ConvertTo-Json -Depth 5
