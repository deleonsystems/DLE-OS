[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InventoryOutputPath,
    [Parameter(Mandatory)]
    [string]$UsageOutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$database = 'DLE_OS_CANONICAL_LIVE'
$fields = @(
    @('CustomerMaster','SalespersonCode','Sales','Salesperson','SalespersonName','SourceMaster'),
    @('CustomerAddress','SalespersonCode','Sales','Salesperson','SalespersonName','SourceMaster'),
    @('CustomerMaster','TerritoryCode','Customer','Territory','TerritoryName','SourceMaster'),
    @('CustomerAddress','TerritoryCode','Customer','Territory','TerritoryName','SourceMaster'),
    @('CustomerMaster','PaymentTermsCode','Sales','PaymentTerms','PaymentTermsDescription','SourceMaster'),
    @('VendorMaster','PaymentTermsCode','Purchasing','PaymentTerms','PaymentTermsDescription','SourceMaster'),
    @('PurchaseOrder','PaymentTermsCode','Purchasing','PaymentTerms',$null,'SourceMaster'),
    @('PurchaseReceipt','PaymentTermsCode','Purchasing','PaymentTerms',$null,'SourceMaster'),
    @('CustomerMaster','ShippingMethodCode','Sales','ShippingMethod',$null,'TransactionDerived'),
    @('PurchaseOrder','ShippingMethod','Purchasing','ShippingMethod',$null,'TransactionDerived'),
    @('PurchaseReceipt','ShippingMethod','Purchasing','ShippingMethod',$null,'TransactionDerived'),
    @('CustomerMaster','FreightTerms','Sales','FreightTerms',$null,'FreeText'),
    @('PurchaseOrder','FreightTerms','Purchasing','FreightTerms',$null,'FreeText'),
    @('PurchaseReceipt','FreightTerms','Purchasing','FreightTerms',$null,'FreeText'),
    @('CustomerMaster','OrderFreightTermsCode','Sales','FreightTermsCode',$null,'TransactionDerived'),
    @('CustomerMaster','CustomerTypeCode','Customer','CustomerType','CustomerTypeDescription','SourceMaster'),
    @('CustomerMaster','PricingClassCode','Customer','PricingClass','PricingClassDescription','Restricted'),
    @('VendorMaster','VendorType','Vendor','VendorType',$null,'Unresolved'),
    @('VendorMaster','VendorClass','Vendor','VendorClass',$null,'Unresolved'),
    @('EmployeeReference','DepartmentCode','Employee','Department','DepartmentName','SourceMaster'),
    @('EmployeeReference','JobTitleCode','Employee','JobTitle','JobTitle','SourceMaster'),
    @('SalesOrderLine','LineCode','Sales','SalesOrderLineType',$null,'SourceMaster'),
    @('PurchaseOrderLine','LineCode','Purchasing','PurchaseOrderLineType',$null,'SourceMaster'),
    @('PurchaseOrderLine','UnitOfMeasure','Inventory','UnitOfMeasure',$null,'TransactionDerived'),
    @('PurchaseReceiptLine','UnitOfMeasure','Inventory','UnitOfMeasure',$null,'TransactionDerived'),
    @('InventoryItem','SalesUnitOfMeasure','Inventory','UnitOfMeasure',$null,'TransactionDerived'),
    @('InventoryItem','PurchaseUnitOfMeasure','Inventory','UnitOfMeasure',$null,'TransactionDerived'),
    @('WorkOrder','UnitOfMeasure','Production','UnitOfMeasure',$null,'TransactionDerived'),
    @('PurchaseOrder','WarehouseId','Inventory','Warehouse',$null,'SourceMaster'),
    @('PurchaseOrderLine','WarehouseId','Inventory','Warehouse',$null,'SourceMaster'),
    @('PurchaseReceipt','WarehouseId','Inventory','Warehouse',$null,'SourceMaster'),
    @('PurchaseReceiptLine','WarehouseId','Inventory','Warehouse',$null,'SourceMaster'),
    @('WorkOrder','WarehouseId','Inventory','Warehouse',$null,'SourceMaster'),
    @('PurchaseOrderLine','InventoryLocation','Inventory','Location',$null,'TransactionDerived'),
    @('PurchaseReceiptLine','InventoryLocation','Inventory','Location',$null,'TransactionDerived'),
    @('InventoryItem','ProductType','Inventory','ProductType',$null,'SourceMaster'),
    @('WorkOrder','WorkOrderType','Production','WorkOrderType',$null,'SourceMaster'),
    @('WorkOrder','WorkOrderStatus','Production','WorkOrderStatus',$null,'CanonicalEnum'),
    @('GeneralLedgerAccount','GeneralLedgerAccountType','Accounting','AccountType',$null,'CanonicalEnum'),
    @('PurchaseOrder','PurchaseOrderStatus','Purchasing','PurchaseOrderStatus',$null,'CanonicalEnum'),
    @('PurchaseOrderLine','LineStatus','Purchasing','PurchaseOrderLineStatus',$null,'CanonicalEnum'),
    @('PurchaseReceipt','ReceiptType','Receiving','ReceiptType',$null,'CanonicalEnum'),
    @('PurchaseReceipt','ReceiptStatus','Receiving','ReceiptStatus',$null,'CanonicalEnum'),
    @('PurchaseReceiptLine','InspectionStatus','Quality','InspectionStatus',$null,'CanonicalEnum'),
    @('PurchaseReceiptLine','QuantityDispositionStatus','Receiving','QuantityDispositionStatus',$null,'CanonicalEnum'),
    @('ReceiptRejection','RejectionCode','Quality','RejectionReason',$null,'SourceMaster'),
    @('ReceiptRejection','OperatorCode','Employee','Operator',$null,'SourceMaster')
)

$connection = [System.Data.SqlClient.SqlConnection]::new(
    "Server=lpc:.\SQLEXPRESS;Database=$database;Integrated Security=true;" +
    'Encrypt=false;Application Name=SUPPORTING-CODE-TABLES-PLATFORM-001-Inventory;' +
    'ApplicationIntent=ReadOnly')
$connection.Open()
try {
    if ($connection.Database -cne $database) {
        throw "Unexpected database boundary: $($connection.Database)"
    }
    $inventory = [Collections.Generic.List[object]]::new()
    $usage = [Collections.Generic.List[object]]::new()
    foreach ($spec in $fields) {
        $table, $field, $domain, $type, $descriptionField, $classification = $spec
        $descriptionProjection = if ($descriptionField) {
            ", NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(4000), [$descriptionField]))), '') AS Description"
        } else {
            ', CAST(NULL AS nvarchar(4000)) AS Description'
        }
        $command = $connection.CreateCommand()
        $command.CommandText = @"
SELECT
    NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(4000), [$field]))), '') AS CodeValue,
    COUNT_BIG(*) AS OccurrenceCount
    $descriptionProjection
FROM [canonical].[$table]
GROUP BY
    NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(4000), [$field]))), '')
    $(if ($descriptionField) { ", NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(4000), [$descriptionField]))), '')" })
ORDER BY CodeValue;
"@
        $reader = $command.ExecuteReader()
        $values = [Collections.Generic.List[object]]::new()
        try {
            while ($reader.Read()) {
                $code = if ($reader.IsDBNull(0)) { $null } else { $reader.GetString(0) }
                $count = $reader.GetInt64(1)
                $description = if ($reader.IsDBNull(2)) { $null } else { $reader.GetString(2) }
                $values.Add([pscustomobject]@{
                    CodeValue = $code
                    OccurrenceCount = $count
                    Description = $description
                })
                if ($null -ne $code) {
                    $usage.Add([pscustomobject]@{
                        CanonicalTable = $table
                        Field = $field
                        FirmId = '01'
                        CodeDomain = $domain
                        CodeType = $type
                        CodeValue = $code
                        OccurrenceCount = $count
                        CurrentDescription = $description
                        Classification = $classification
                    })
                }
            }
        }
        finally {
            $reader.Dispose()
            $command.Dispose()
        }
        $nonblank = @($values | Where-Object CodeValue)
        $examples = @($nonblank | Select-Object -First 5 -ExpandProperty CodeValue)
        [long]$blankRowCount = 0
        foreach ($value in $values) {
            if ($null -eq $value.CodeValue) {
                $blankRowCount += [long]$value.OccurrenceCount
            }
        }
        $inventory.Add([pscustomobject]@{
            CanonicalTable = $table
            Field = $field
            DistinctNonblankRawCodeCount = $nonblank.Count
            ExampleValues = ($examples -join '; ')
            CurrentDescriptionSource = if ($descriptionField) {
                "canonical.$table.$descriptionField"
            } else { '' }
            UnresolvedCount = @(
                $nonblank | Where-Object { -not $_.Description }
            ).Count
            BlankRowCount = $blankRowCount
            ProposedCodeDomain = $domain
            ProposedCodeType = $type
            Classification = $classification
        })
    }
}
finally {
    $connection.Dispose()
}

$inventory |
    Export-Csv -LiteralPath $InventoryOutputPath -NoTypeInformation -Encoding utf8
$usage |
    Export-Csv -LiteralPath $UsageOutputPath -NoTypeInformation -Encoding utf8

[ordered]@{
    Verdict = 'PASS'
    Database = $database
    FieldCount = $inventory.Count
    UsageRows = $usage.Count
    InventoryOutputPath = $InventoryOutputPath
    UsageOutputPath = $UsageOutputPath
} | ConvertTo-Json
