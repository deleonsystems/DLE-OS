[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^DAILYOPSSYNC-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$')]
    [string] $RunId,
    [switch] $QualificationInduceFailure
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root='C:\DLE-OS\Canonical\DailyOperationsSync\Runs'
$runRoot=Join-Path $root $RunId
$manifestPath=Join-Path $runRoot 'manifest.json'
if([IO.Path]::GetFullPath($runRoot).TrimEnd('\') -ine (Join-Path $root $RunId).TrimEnd('\') -or
   -not(Test-Path $manifestPath)){throw 'Daily Operations package boundary is invalid.'}
$manifest=Get-Content $manifestPath -Raw|ConvertFrom-Json
if($manifest.Schema -cne 'dle-daily-operations-snapshot' -or $manifest.RunId -cne $RunId -or
   @($manifest.HeavyDatasetsRefreshed).Count -ne 0){throw 'Daily Operations manifest was rejected.'}
$customerRoot=[IO.Path]::GetFullPath([string]$manifest.CustomerPackagePath)
$salesRoot=[IO.Path]::GetFullPath([string]$manifest.SalesOrderPackagePath)
$workRoot=[IO.Path]::GetFullPath([string]$manifest.WorkOrderPackagePath)
if(-not $customerRoot.StartsWith('C:\DLE-OS\Canonical\CustomerMaster\Refresh\Runs\',[StringComparison]::OrdinalIgnoreCase) -or
   -not $salesRoot.StartsWith('C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\Runs\',[StringComparison]::OrdinalIgnoreCase) -or
   $workRoot -ine (Join-Path $runRoot 'Candidates\WorkOrders')){throw 'A candidate path is outside its governed boundary.'}
$required=@(
    (Join-Path $customerRoot 'Customer.csv'),(Join-Path $customerRoot 'CustomerAddress.csv'),
    (Join-Path $customerRoot 'metadata.json'),(Join-Path $customerRoot 'package.sha256'),
    (Join-Path $salesRoot 'Canonical\Customer.csv'),
    (Join-Path $salesRoot 'Canonical\SalesOrder.csv'),(Join-Path $salesRoot 'Canonical\SalesOrderLine.csv'),
    (Join-Path $salesRoot 'Canonical\SalesOrderWorkOrderRelationship.csv'),
    (Join-Path $salesRoot 'package.sha256'),(Join-Path $workRoot 'Canonical\WorkOrder.csv'),
    (Join-Path $workRoot 'manifest.json'),(Join-Path $workRoot 'package.sha256'))
foreach($path in $required){if(-not(Test-Path $path)){throw "Required candidate file is missing: $path"}}
$customers=@(Import-Csv (Join-Path $customerRoot 'Customer.csv'))
$addresses=@(Import-Csv (Join-Path $customerRoot 'CustomerAddress.csv'))
$salesCustomers=@(Import-Csv (Join-Path $salesRoot 'Canonical\Customer.csv'))
$orders=@(Import-Csv (Join-Path $salesRoot 'Canonical\SalesOrder.csv'))
$lines=@(Import-Csv (Join-Path $salesRoot 'Canonical\SalesOrderLine.csv'))
$relationships=@(Import-Csv (Join-Path $salesRoot 'Canonical\SalesOrderWorkOrderRelationship.csv'))
$workOrders=@(Import-Csv (Join-Path $workRoot 'Canonical\WorkOrder.csv'))
if($customers.Count -ne [long]$manifest.Counts.CustomerMaster -and
   ($customers.Count+$addresses.Count) -ne [long]$manifest.Counts.CustomerMaster){
    throw 'Customer Master count differs from the composite manifest.'
}
if($lines.Count -ne [long]$manifest.Counts.SalesOrders -or
   $workOrders.Count -ne [long]$manifest.Counts.WorkOrders -or
   $relationships.Count -ne [long]$manifest.Counts.WorkOrderRelationships){
    throw 'Operational candidate counts differ from the composite manifest.'
}
$customerPackageHash=(Get-Content (Join-Path $customerRoot 'package.sha256') -Raw).Trim()
$salesPackageHash=(Get-Content (Join-Path $salesRoot 'package.sha256') -Raw).Trim()
$workPackageHash=(Get-Content (Join-Path $workRoot 'package.sha256') -Raw).Trim()
if($customerPackageHash -cne [string]$manifest.CustomerPackageSha256 -or
   $salesPackageHash -cne [string]$manifest.SalesOrderPackageSha256 -or
   $workPackageHash -cne [string]$manifest.WorkOrderPackageSha256){
    throw 'A component package hash differs from the atomic composite manifest.'
}

$connection=[Data.SqlClient.SqlConnection]::new(
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Application Name=DLE-OS Daily Operations Sync')
$connection.Open()
function Command([string]$Text,[Data.SqlClient.SqlTransaction]$Transaction){
    $cmd=$connection.CreateCommand();$cmd.CommandText=$Text;$cmd.CommandTimeout=240;$cmd.Transaction=$Transaction;return $cmd
}
function Table([object[]]$Rows,[Collections.Specialized.OrderedDictionary]$Columns){
    $table=[Data.DataTable]::new();foreach($name in $Columns.Keys){[void]$table.Columns.Add($name,$Columns[$name])}
    foreach($source in $Rows){$row=$table.NewRow();foreach($name in $Columns.Keys){
        $value=$source.$name
        if($null -eq $value -or ($value -is [string] -and $value -eq '')){$row[$name]=[DBNull]::Value}
        elseif($Columns[$name] -eq [bool]){$row[$name]=[bool]::Parse([string]$value)}
        else{$row[$name]=$value}}
        [void]$table.Rows.Add($row)}
    return ,$table
}
function Bulk([Data.DataTable]$Table,[string]$Destination,[Data.SqlClient.SqlTransaction]$Transaction){
    $copy=[Data.SqlClient.SqlBulkCopy]::new($connection,[Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,$Transaction)
    $copy.DestinationTableName=$Destination;$copy.BatchSize=1000;$copy.BulkCopyTimeout=240
    foreach($column in $Table.Columns){[void]$copy.ColumnMappings.Add($column.ColumnName,$column.ColumnName)}
    $copy.WriteToServer($Table);$copy.Dispose()
}
function AddParams($Command,[hashtable]$Values){foreach($pair in $Values.GetEnumerator()){
    $parameterValue=if($null -eq $pair.Value){[DBNull]::Value}else{$pair.Value}
    [void]$Command.Parameters.AddWithValue($pair.Key,$parameterValue)}}

$transaction=$connection.BeginTransaction([Data.IsolationLevel]::Serializable)
$importRunId=[Guid]::NewGuid();$customerRunId=[Guid]::NewGuid();$salesRunId=[Guid]::NewGuid()
$packageHash=(Get-FileHash $manifestPath -Algorithm SHA256).Hash
$workManifest=Get-Content (Join-Path $workRoot 'manifest.json') -Raw|ConvertFrom-Json
$salesManifest=Get-Content (Join-Path $salesRoot 'manifest.json') -Raw|ConvertFrom-Json
$customerManifest=Get-Content (Join-Path $customerRoot 'metadata.json') -Raw|ConvertFrom-Json
try{
    $parentCmd=Command @'
SELECT TOP (1) ImportRunId,MirrorRunId,PackageHash
FROM platform.ImportRun WITH (UPDLOCK,HOLDLOCK)
WHERE ImportStatus=N'SUCCESS' AND IsCommitted=1 AND IsNoOp=0
ORDER BY CompletedAtUtc DESC;
'@ $transaction
    $reader=$parentCmd.ExecuteReader()
    try {
        if(-not $reader.Read()){throw 'No committed canonical parent snapshot exists.'}
        $parentRunId=[Guid]$reader['ImportRunId']
        $parentMirror=[string]$reader['MirrorRunId']
    }
    finally {
        $reader.Dispose()
    }

    $schema=Command @'
IF OBJECT_ID(N'platform.DailyOperationsSyncRun',N'U') IS NULL
BEGIN
 CREATE TABLE platform.DailyOperationsSyncRun(
  DailyOperationsSyncRunId nvarchar(64) NOT NULL PRIMARY KEY,
  ImportRunId uniqueidentifier NOT NULL REFERENCES platform.ImportRun(ImportRunId),
  CustomerMasterImportRunId uniqueidentifier NOT NULL,
  SalesOrderExtensionRunId uniqueidentifier NOT NULL,
  PackageHash char(64) NOT NULL,StartedAtUtc datetime2(7) NOT NULL,
  CompletedAtUtc datetime2(7) NOT NULL,Status nvarchar(32) NOT NULL,
  CustomerCount int NOT NULL,SalesOrderLineCount int NOT NULL,
  WorkOrderCount int NOT NULL,RelationshipCount int NOT NULL);
END;
IF COL_LENGTH(N'platform.SalesOrderExtensionRun',N'SalesOrderWorkOrderRelationshipCount') IS NULL
BEGIN
 ALTER TABLE platform.SalesOrderExtensionRun ADD SalesOrderWorkOrderRelationshipCount int NOT NULL
  CONSTRAINT DF_SalesOrderExtensionRun_RelationshipCount DEFAULT(0);
END;
IF OBJECT_ID(N'canonical.SalesOrderWorkOrderRelationshipEvidence',N'U') IS NULL
BEGIN
 CREATE TABLE canonical.SalesOrderWorkOrderRelationshipEvidence(
  CustomerNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
  SalesOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
  AnchorSalesOrderLine nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
  WorkOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
  WorkOrderItemNumber nvarchar(20) COLLATE Latin1_General_100_BIN2 NULL,
  ScheduledProductionQuantity decimal(38,10) NULL,BomRevision nvarchar(2) NULL,
  DrawingNumber nvarchar(25) NULL,DrawingRevision nvarchar(5) NULL,
  RelationshipSource nvarchar(32) NOT NULL,SourceSnapshotId nvarchar(128) NOT NULL,
  SourceImportRunId uniqueidentifier NOT NULL,SalesOrderExtensionRunId uniqueidentifier NOT NULL,
  Woe03SourceKeyRaw nvarchar(256) COLLATE Latin1_General_100_BIN2 NULL,
  Woe03SourceRecordHash char(64) NULL,
  WorkOrderSourceKeyRaw nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
  WorkOrderSourceRecordHash char(64) NOT NULL,
  CONSTRAINT PK_SalesOrderWorkOrderRelationshipEvidence PRIMARY KEY
   (CustomerNumber,SalesOrderNumber,AnchorSalesOrderLine,WorkOrderNumber),
  CONSTRAINT FK_DailyOpsRelationship_ImportRun FOREIGN KEY(SourceImportRunId)
   REFERENCES platform.ImportRun(ImportRunId),
  CONSTRAINT FK_DailyOpsRelationship_ExtensionRun FOREIGN KEY(SalesOrderExtensionRunId)
   REFERENCES platform.SalesOrderExtensionRun(SalesOrderExtensionRunId),
  CONSTRAINT CK_DailyOpsRelationship_Source CHECK(RelationshipSource IN
   (N'WOE01_DIRECT',N'WOE03_B',N'WOE03_B+WOE01_DIRECT')));
END;
EXEC(N'CREATE OR ALTER VIEW canonical.SalesOrderWorkOrderRelationshipEvidenceViewer AS
 SELECT CustomerNumber,SalesOrderNumber,AnchorSalesOrderLine,WorkOrderNumber,
 WorkOrderItemNumber,ScheduledProductionQuantity,BomRevision,DrawingNumber,
 DrawingRevision,RelationshipSource,SourceSnapshotId,SourceImportRunId,
 SalesOrderExtensionRunId FROM canonical.SalesOrderWorkOrderRelationshipEvidence;');
IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
 GRANT SELECT ON OBJECT::canonical.SalesOrderWorkOrderRelationshipEvidenceViewer TO dle_live_api_reader;
 DENY INSERT,UPDATE,DELETE,ALTER ON OBJECT::canonical.SalesOrderWorkOrderRelationshipEvidenceViewer TO dle_live_api_reader;
END;
'@ $transaction;[void]$schema.ExecuteNonQuery()

    $start=Command @'
INSERT platform.ImportRun(ImportRunId,EnvironmentId,MirrorRunId,PackageHash,ContractVersion,
 ImportOperation,StartedAtUtc,ImportStatus,IsCommitted,IsNoOp)
VALUES(@ImportRunId,N'LIVE',@RunId,@PackageHash,N'V1.2',N'IMPORT',
 SYSUTCDATETIME(),N'PENDING',0,0);
UPDATE canonical.BillOfMaterial SET ImportRunId=@ImportRunId WHERE ImportRunId=@ParentRunId;
UPDATE canonical.InventoryItem SET ImportRunId=@ImportRunId WHERE ImportRunId=@ParentRunId;
UPDATE canonical.GeneralLedgerAccount SET ImportRunId=@ImportRunId WHERE ImportRunId=@ParentRunId;
DELETE FROM canonical.SalesOrderWorkOrderRelationshipEvidence;
DELETE FROM canonical.SalesOrderLine;DELETE FROM canonical.SalesOrder;DELETE FROM canonical.Customer;
DELETE FROM canonical.WorkOrder;
DELETE FROM canonical.CustomerAddress;DELETE FROM canonical.CustomerMaster;
'@ $transaction
    AddParams $start @{'@ImportRunId'=$importRunId;'@RunId'=$RunId;'@PackageHash'=$packageHash;'@ParentRunId'=$parentRunId}
    [void]$start.ExecuteNonQuery()
    if($QualificationInduceFailure){throw 'Controlled failure after transactional deletes.'}

    $now=[DateTime]::UtcNow
    $workRows=foreach($s in $workOrders){[pscustomobject]@{
        WorkOrderNumber=$s.WorkOrderNumber;WorkOrderType=$s.WorkOrderType;WorkOrderStatus=$s.WorkOrderStatus
        WorkOrderOpenedDate=$s.WorkOrderOpenedDate;WorkOrderClosedDate=$s.WorkOrderClosedDate
        WorkOrderOpenedDateIso=$s.WorkOrderOpenedDateIso;WorkOrderClosedDateIso=$s.WorkOrderClosedDateIso
        CustomerNumber=$s.CustomerNumber;SalesOrderNumber=$s.SalesOrderNumber;SalesOrderLineNumber=$s.SalesOrderLineNumber
        UnitOfMeasure=$s.UnitOfMeasure;BomRevision=$s.BomRevision;WarehouseId=$s.WarehouseId;ItemNumber=$s.ItemNumber
        ItemDescription=$s.ItemDescription;DrawingNumber=$s.DrawingNumber;DrawingRevision=$s.DrawingRevision
        SchProdQuantity=$s.SchProdQuantity;NonStockDescriptionLine1=$s.NonStockDescriptionLine1
        NonStockDescriptionLine2=$s.NonStockDescriptionLine2;ImportRunId=$importRunId;MirrorRunId=$RunId
        SourceFile='WOE-01';SourceKeyRaw=$s.SourceKeyRaw;SourceRecordHash=$s.SourceRecordHash
        SourceFileHash=[string]$workManifest.sourceExtractSha256;ContractVersion='V1.2';ImportedAtUtc=$now}}
    $workColumns=[ordered]@{WorkOrderNumber=[string];WorkOrderType=[string];WorkOrderStatus=[string];
        WorkOrderOpenedDate=[string];WorkOrderClosedDate=[string];WorkOrderOpenedDateIso=[DateTime];WorkOrderClosedDateIso=[DateTime];
        CustomerNumber=[string];SalesOrderNumber=[string];SalesOrderLineNumber=[string];UnitOfMeasure=[string];BomRevision=[string];
        WarehouseId=[string];ItemNumber=[string];ItemDescription=[string];DrawingNumber=[string];DrawingRevision=[string];
        SchProdQuantity=[string];NonStockDescriptionLine1=[string];NonStockDescriptionLine2=[string];ImportRunId=[Guid];
        MirrorRunId=[string];SourceFile=[string];SourceKeyRaw=[string];SourceRecordHash=[string];SourceFileHash=[string];
        ContractVersion=[string];ImportedAtUtc=[DateTime]}
    Bulk (Table $workRows $workColumns) 'canonical.WorkOrder' $transaction

    $cmStart=Command @'
INSERT platform.CustomerMasterImportRun(CustomerMasterImportRunId,SourceQualificationRunId,PackageSha256,ManifestSha256,
 PackageSchema,PackageSchemaVersion,ContractVersion,StartedAtUtc,ImportStatus,IsCommitted,IsNoOp,
 CustomerCount,CustomerAddressCount,OrphanAddressCount)
VALUES(@Id,@Source,@Hash,@ManifestHash,N'dle-customer-master-package',N'1.0',N'CUSTOMER_MASTER_1.0',
 SYSUTCDATETIME(),N'PENDING',0,0,@Customers,@Addresses,0);
'@ $transaction
    AddParams $cmStart @{'@Id'=$customerRunId;'@Source'=[string]$customerManifest.sourceQualificationRunId;
        '@Hash'=$customerPackageHash;'@ManifestHash'=(Get-FileHash (Join-Path $customerRoot 'metadata.json') -Algorithm SHA256).Hash;
        '@Customers'=$customers.Count;'@Addresses'=$addresses.Count};[void]$cmStart.ExecuteNonQuery()
    $customerRows=foreach($s in $customers){$o=[ordered]@{};foreach($n in @('FirmId','CustomerNumber','CustomerName','CustomerStatus','IsActive','AddressLine1','AddressLine2','AddressLine3','AddressLine4','AddressLine5','PostalCode','Country','PrimaryContactName','PrimaryPhone','PrimaryPhoneExtension','SalespersonCode','SalespersonName','TerritoryCode','TerritoryName','PaymentTermsCode','PaymentTermsDescription','ShippingMethodCode','FreightTerms','OrderFreightTermsCode','CustomerTypeCode','CustomerTypeDescription','PricingClassCode','PricingClassDescription','SourceRecordIdentity')){$o[$n]=$s.$n};$o.CustomerMasterImportRunId=$customerRunId;[pscustomobject]$o}
    $cc=[ordered]@{};foreach($n in @('FirmId','CustomerNumber','CustomerName','CustomerStatus')){$cc[$n]=[string]};$cc['IsActive']=[bool]
    foreach($n in @('AddressLine1','AddressLine2','AddressLine3','AddressLine4','AddressLine5','PostalCode','Country','PrimaryContactName','PrimaryPhone','PrimaryPhoneExtension','SalespersonCode','SalespersonName','TerritoryCode','TerritoryName','PaymentTermsCode','PaymentTermsDescription','ShippingMethodCode','FreightTerms','OrderFreightTermsCode','CustomerTypeCode','CustomerTypeDescription','PricingClassCode','PricingClassDescription','SourceRecordIdentity')){$cc[$n]=[string]};$cc['CustomerMasterImportRunId']=[Guid]
    Bulk (Table $customerRows $cc) 'canonical.CustomerMaster' $transaction
    $addressRows=foreach($s in $addresses){$o=[ordered]@{};foreach($n in @('FirmId','CustomerNumber','AddressCode','AddressType','AddressName','AddressLine1','AddressLine2','AddressLine3','PostalCode','Country','ContactName','Phone','PhoneExtension','SalespersonCode','SalespersonName','TerritoryCode','TerritoryName','IsPrimary','IsActive','SourceRecordIdentity')){$o[$n]=$s.$n};$o.CustomerMasterImportRunId=$customerRunId;[pscustomobject]$o}
    $ac=[ordered]@{};foreach($n in @('FirmId','CustomerNumber','AddressCode','AddressType','AddressName','AddressLine1','AddressLine2','AddressLine3','PostalCode','Country','ContactName','Phone','PhoneExtension','SalespersonCode','SalespersonName','TerritoryCode','TerritoryName')){$ac[$n]=[string]};$ac['IsPrimary']=[bool];$ac['IsActive']=[bool];$ac['SourceRecordIdentity']=[string];$ac['CustomerMasterImportRunId']=[Guid]
    Bulk (Table $addressRows $ac) 'canonical.CustomerAddress' $transaction

    $salesStart=Command @'
INSERT platform.SalesOrderExtensionRun(SalesOrderExtensionRunId,ParentImportRunId,QualificationRunId,ExtensionPackageHash,
 SourceManifestHash,StartedAtUtc,ImportStatus,IsCommitted,CustomerCount,SalesOrderCount,SalesOrderLineCount,SalesOrderWorkOrderRelationshipCount)
VALUES(@Id,@Parent,@Qualification,@Hash,@ManifestHash,SYSUTCDATETIME(),N'PENDING',0,@Customers,@Orders,@Lines,@Relationships);
'@ $transaction
    AddParams $salesStart @{'@Id'=$salesRunId;'@Parent'=$importRunId;'@Qualification'=[string]$salesManifest.runId;
        '@Hash'=[string]$manifest.SalesOrderPackageSha256;'@ManifestHash'=(Get-FileHash (Join-Path $salesRoot 'manifest.json') -Algorithm SHA256).Hash;
        '@Customers'=$salesCustomers.Count;'@Orders'=$orders.Count;'@Lines'=$lines.Count;'@Relationships'=$relationships.Count};[void]$salesStart.ExecuteNonQuery()
    $scRows=foreach($s in $salesCustomers){[pscustomobject]@{CustomerNumber=$s.CustomerNumber;CustomerName=$s.CustomerName;ImportRunId=$importRunId;SalesOrderExtensionRunId=$salesRunId;SourceKeyRaw=$s.SourceKeyRaw;SourceRecordHash=$s.SourceRecordHash}}
    Bulk (Table $scRows ([ordered]@{CustomerNumber=[string];CustomerName=[string];ImportRunId=[Guid];SalesOrderExtensionRunId=[Guid];SourceKeyRaw=[string];SourceRecordHash=[string]})) 'canonical.Customer' $transaction
    $soRows=foreach($s in $orders){[pscustomobject]@{SalesOrderNumber=$s.SalesOrderNumber;CustomerNumber=$s.CustomerNumber;CustomerPurchaseOrderNumber=$s.CustomerPurchaseOrderNumber;OrderDateRaw=$s.OrderDateRaw;OrderDate=$s.OrderDate;ImportRunId=$importRunId;SalesOrderExtensionRunId=$salesRunId;SourceKeyRaw=$s.SourceKeyRaw;SourceRecordHash=$s.SourceRecordHash}}
    Bulk (Table $soRows ([ordered]@{SalesOrderNumber=[string];CustomerNumber=[string];CustomerPurchaseOrderNumber=[string];OrderDateRaw=[string];OrderDate=[DateTime];ImportRunId=[Guid];SalesOrderExtensionRunId=[Guid];SourceKeyRaw=[string];SourceRecordHash=[string]})) 'canonical.SalesOrder' $transaction
    $slRows=foreach($s in $lines){[pscustomobject]@{CustomerNumber=$s.CustomerNumber;SalesOrderNumber=$s.SalesOrderNumber;LineNumber=$s.LineNumber;ItemNumber=$s.ItemNumber;OrderMemo=$s.OrderMemo;EstimatedShipDateRaw=$s.EstimatedShipDateRaw;EstimatedShipDate=$s.EstimatedShipDate;UnitPrice=[decimal]$s.UnitPrice;QuantityOrdered=[decimal]$s.QuantityOrdered;LineCode=$s.LineCode;WorkOrderNumber=$s.WorkOrderNumber;ImportRunId=$importRunId;SalesOrderExtensionRunId=$salesRunId;SourceKeyRaw=$s.SourceKeyRaw;SourceRecordHash=$s.SourceRecordHash}}
    Bulk (Table $slRows ([ordered]@{CustomerNumber=[string];SalesOrderNumber=[string];LineNumber=[string];ItemNumber=[string];OrderMemo=[string];EstimatedShipDateRaw=[string];EstimatedShipDate=[DateTime];UnitPrice=[decimal];QuantityOrdered=[decimal];LineCode=[string];WorkOrderNumber=[string];ImportRunId=[Guid];SalesOrderExtensionRunId=[Guid];SourceKeyRaw=[string];SourceRecordHash=[string]})) 'canonical.SalesOrderLine' $transaction
    $relRows=foreach($s in $relationships){[pscustomobject]@{CustomerNumber=$s.CustomerNumber;SalesOrderNumber=$s.SalesOrderNumber;AnchorSalesOrderLine=$s.AnchorSalesOrderLine;WorkOrderNumber=$s.WorkOrderNumber;WorkOrderItemNumber=$s.WorkOrderItemNumber;ScheduledProductionQuantity=if($s.ScheduledProductionQuantity -eq ''){$null}else{[decimal]$s.ScheduledProductionQuantity};BomRevision=$s.BomRevision;DrawingNumber=$s.DrawingNumber;DrawingRevision=$s.DrawingRevision;RelationshipSource=$s.RelationshipSource;SourceSnapshotId=$RunId;SourceImportRunId=$importRunId;SalesOrderExtensionRunId=$salesRunId;Woe03SourceKeyRaw=$s.Woe03SourceKeyRaw;Woe03SourceRecordHash=$s.Woe03SourceRecordHash;WorkOrderSourceKeyRaw=$s.WorkOrderSourceKeyRaw;WorkOrderSourceRecordHash=$s.WorkOrderSourceRecordHash}}
    $rc=[ordered]@{CustomerNumber=[string];SalesOrderNumber=[string];AnchorSalesOrderLine=[string];WorkOrderNumber=[string];WorkOrderItemNumber=[string];ScheduledProductionQuantity=[decimal];BomRevision=[string];DrawingNumber=[string];DrawingRevision=[string];RelationshipSource=[string];SourceSnapshotId=[string];SourceImportRunId=[Guid];SalesOrderExtensionRunId=[Guid];Woe03SourceKeyRaw=[string];Woe03SourceRecordHash=[string];WorkOrderSourceKeyRaw=[string];WorkOrderSourceRecordHash=[string]}
    Bulk (Table $relRows $rc) 'canonical.SalesOrderWorkOrderRelationshipEvidence' $transaction

    $finish=Command @'
INSERT platform.ImportSource(ImportRunId,CanonicalEntity,MirrorFileName,SourceFileHash,MirrorRowCount,ImportedRowCount,Reconciled,ValidationStatus)
SELECT @ImportRunId,CanonicalEntity,MirrorFileName,SourceFileHash,MirrorRowCount,ImportedRowCount,Reconciled,ValidationStatus
FROM platform.ImportSource WHERE ImportRunId=@ParentRunId AND CanonicalEntity<>N'WorkOrder';
INSERT platform.ImportSource VALUES(@ImportRunId,N'WorkOrder',N'WorkOrder.csv',@WorkHash,@WorkCount,@WorkCount,1,N'PASS');
INSERT platform.ImportEntityResult(ImportRunId,CanonicalEntity,ExpectedRowCount,ParsedRowCount,InsertedRowCount,DuplicateKeyCount,BlankKeyCount,EntityStatus,OutputTable)
SELECT @ImportRunId,CanonicalEntity,ExpectedRowCount,ParsedRowCount,InsertedRowCount,DuplicateKeyCount,BlankKeyCount,EntityStatus,OutputTable
FROM platform.ImportEntityResult WHERE ImportRunId=@ParentRunId AND CanonicalEntity<>N'WorkOrder';
INSERT platform.ImportEntityResult VALUES(@ImportRunId,N'WorkOrder',@WorkCount,@WorkCount,@WorkCount,0,0,N'PASS',N'canonical.WorkOrder');
UPDATE platform.ImportRun SET CompletedAtUtc=SYSUTCDATETIME(),ImportStatus=N'SUCCESS',IsCommitted=1 WHERE ImportRunId=@ImportRunId;
UPDATE platform.CustomerMasterImportRun SET CompletedAtUtc=SYSUTCDATETIME(),ImportStatus=N'SUCCESS',IsCommitted=1 WHERE CustomerMasterImportRunId=@CustomerRunId;
UPDATE platform.SalesOrderExtensionRun SET CompletedAtUtc=SYSUTCDATETIME(),ImportStatus=N'SUCCESS',IsCommitted=1 WHERE SalesOrderExtensionRunId=@SalesRunId;
UPDATE platform.LiveSnapshotOperationalStatus SET ImportRunId=@ImportRunId,MirrorRunId=@RunId,PackageHash=@PackageHash,
 SnapshotAsOfUtc=SYSUTCDATETIME(),SourceCheckedAtUtc=SYSUTCDATETIME(),QualificationCompletedAtUtc=SYSUTCDATETIME(),
 LastSourceCheckResult=N'DAILY_OPERATIONS_SYNC_QUALIFIED',SourceChangeStatus=N'Qualified',
 SourceIndicatorFingerprint=@PackageHash,UpdatedAtUtc=SYSUTCDATETIME() WHERE StatusId=1;
INSERT platform.DailyOperationsSyncRun VALUES(@RunId,@ImportRunId,@CustomerRunId,@SalesRunId,@PackageHash,
 SYSUTCDATETIME(),SYSUTCDATETIME(),N'PASSED_PROMOTED',@CustomerCount,@LineCount,@WorkCount,@RelationshipCount);
IF (SELECT COUNT_BIG(*) FROM canonical.WorkOrder)<>@WorkCount OR
   (SELECT COUNT_BIG(*) FROM canonical.SalesOrderLine)<>@LineCount OR
   (SELECT COUNT_BIG(*) FROM canonical.SalesOrderWorkOrderRelationshipEvidence)<>@RelationshipCount
 THROW 51401,'Daily Operations SQL reconciliation failed.',1;
'@ $transaction
    AddParams $finish @{'@ImportRunId'=$importRunId;'@ParentRunId'=$parentRunId;'@WorkHash'=[string]$workManifest.sourceExtractSha256;
        '@WorkCount'=$workOrders.Count;'@CustomerRunId'=$customerRunId;'@SalesRunId'=$salesRunId;'@RunId'=$RunId;
        '@PackageHash'=$packageHash;'@CustomerCount'=$customers.Count;'@LineCount'=$lines.Count;'@RelationshipCount'=$relationships.Count}
    [void]$finish.ExecuteNonQuery()
    $transaction.Commit()
    [ordered]@{Verdict='PASS';Behavior='ATOMIC_IMPORT';RunId=$RunId;ImportRunId=$importRunId;
        CustomerMasterImportRunId=$customerRunId;SalesOrderExtensionRunId=$salesRunId;PackageHash=$packageHash;
        Counts=[ordered]@{Customers=$customers.Count;SalesOrderLines=$lines.Count;WorkOrders=$workOrders.Count;Relationships=$relationships.Count}}|ConvertTo-Json -Depth 8
}
catch{if($transaction.Connection){$transaction.Rollback()};throw}
finally{$transaction.Dispose();$connection.Dispose()}
