USE [DLE_OS_CANONICAL_LIVE];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.PurchaseOrderImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.PurchaseOrderImportRun
    (
        PurchaseOrderImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_PurchaseOrderImportRun PRIMARY KEY,
        SourceQualificationRunId nvarchar(100) NOT NULL,
        PackageSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ManifestSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ContractVersion nvarchar(40) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        CompletedAtUtc datetime2(3) NULL,
        ImportStatus nvarchar(20) NOT NULL,
        IsCommitted bit NOT NULL,
        IsNoOp bit NOT NULL,
        HeaderCount int NOT NULL,
        LineCount int NOT NULL,
        SourceOrphanLineCount int NOT NULL,
        CONSTRAINT CK_PurchaseOrderImportRun_Status
            CHECK (ImportStatus IN (N'PENDING', N'SUCCESS', N'FAILED'))
    );
END;
GO

IF OBJECT_ID(N'canonical.PurchaseOrder', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.PurchaseOrder
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorName nvarchar(30) NULL,
        WarehouseId nvarchar(2) NULL,
        PurchasingAddressCode nvarchar(2) NULL,
        OrderDateRaw nvarchar(6) NULL,
        OrderDateIso date NULL,
        PromisedDateRaw nvarchar(6) NULL,
        PromisedDateIso date NULL,
        NotBeforeDateRaw nvarchar(6) NULL,
        NotBeforeDateIso date NULL,
        RequiredDateRaw nvarchar(6) NULL,
        RequiredDateIso date NULL,
        LastReceiptDateRaw nvarchar(6) NULL,
        LastReceiptDateIso date NULL,
        HoldFlag nvarchar(1) NULL,
        PrintStatus nvarchar(1) NULL,
        PaymentTermsCode nvarchar(2) NULL,
        FreightTerms nvarchar(15) NULL,
        ShippingMethod nvarchar(15) NULL,
        Acknowledgment nvarchar(20) NULL,
        Fob nvarchar(15) NULL,
        MessageCode nvarchar(3) NULL,
        RequisitionNumber nvarchar(7) NULL,
        PurchaseOrderStatus nvarchar(30) NOT NULL,
        IsOpen bit NOT NULL,
        IsClosed bit NOT NULL,
        IsCanceled bit NOT NULL,
        VendorResolutionStatus nvarchar(30) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_PurchaseOrder_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PurchaseOrder PRIMARY KEY
            (FirmId, VendorNumber, PurchaseOrderNumber),
        CONSTRAINT FK_PurchaseOrder_ImportRun FOREIGN KEY
            (PurchaseOrderImportRunId)
            REFERENCES platform.PurchaseOrderImportRun
                (PurchaseOrderImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.PurchaseOrderLine', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.PurchaseOrderLine
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderLineNumber nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
        LineCode nvarchar(2) NULL,
        LineType nvarchar(20) NOT NULL,
        RequiredDateRaw nvarchar(6) NULL,
        RequiredDateIso date NULL,
        PromisedDateRaw nvarchar(6) NULL,
        PromisedDateIso date NULL,
        NotBeforeDateRaw nvarchar(6) NULL,
        NotBeforeDateIso date NULL,
        UnitOfMeasure nvarchar(2) NULL,
        InventoryLocation nvarchar(10) NULL,
        SourceCode nvarchar(1) NULL,
        MessageCode nvarchar(3) NULL,
        WorkOrderNumber nvarchar(7) NULL,
        CustomerNumber nvarchar(6) NULL,
        SalesOrderNumber nvarchar(7) NULL,
        SalesOrderLineNumber nvarchar(3) NULL,
        ShipToNumber nvarchar(6) NULL,
        WarehouseId nvarchar(2) NULL,
        ItemNumber nvarchar(20) NULL,
        ItemDescription nvarchar(60) NULL,
        OrderMemo nvarchar(40) NULL,
        ConversionFactor decimal(19,6) NOT NULL,
        QuantityRequested decimal(19,6) NOT NULL,
        QuantityOrdered decimal(19,6) NOT NULL,
        QuantityReceived decimal(19,6) NOT NULL,
        QuantityOpen decimal(19,6) NOT NULL,
        QuantityInQualityWip decimal(19,6) NOT NULL,
        QuantityAcceptedFromQuality decimal(19,6) NOT NULL,
        QuantityRejected decimal(19,6) NOT NULL,
        QuantityInvoiced decimal(19,6) NOT NULL,
        LineStatus nvarchar(30) NOT NULL,
        IsOpen bit NOT NULL,
        IsClosed bit NOT NULL,
        IsCanceled bit NOT NULL,
        InventoryResolutionStatus nvarchar(30) NOT NULL,
        WorkOrderResolutionStatus nvarchar(30) NOT NULL,
        SalesOrderResolutionStatus nvarchar(30) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_PurchaseOrderLine_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PurchaseOrderLine PRIMARY KEY
            (FirmId, VendorNumber, PurchaseOrderNumber, PurchaseOrderLineNumber),
        CONSTRAINT FK_PurchaseOrderLine_Header FOREIGN KEY
            (FirmId, VendorNumber, PurchaseOrderNumber)
            REFERENCES canonical.PurchaseOrder
                (FirmId, VendorNumber, PurchaseOrderNumber),
        CONSTRAINT FK_PurchaseOrderLine_ImportRun FOREIGN KEY
            (PurchaseOrderImportRunId)
            REFERENCES platform.PurchaseOrderImportRun
                (PurchaseOrderImportRunId),
        CONSTRAINT CK_PurchaseOrderLine_OpenQuantity
            CHECK (QuantityOpen = QuantityOrdered - QuantityReceived)
    );
END;
GO

CREATE OR ALTER VIEW canonical.PurchaseOrderViewer
AS
SELECT
    CONCAT(po.FirmId, po.VendorNumber, po.PurchaseOrderNumber, line.PurchaseOrderLineNumber)
        AS PurchaseOrderLineId,
    po.FirmId,
    po.VendorNumber,
    po.VendorName,
    po.PurchaseOrderNumber,
    line.PurchaseOrderLineNumber,
    po.OrderDateIso,
    po.PurchaseOrderStatus,
    po.HoldFlag,
    po.PaymentTermsCode,
    po.FreightTerms,
    po.ShippingMethod,
    po.Fob,
    line.LineCode,
    line.LineType,
    line.ItemNumber,
    line.ItemDescription,
    line.OrderMemo,
    line.UnitOfMeasure,
    line.QuantityOrdered,
    line.QuantityReceived,
    line.QuantityOpen,
    line.RequiredDateIso,
    line.PromisedDateIso,
    line.WorkOrderNumber,
    line.CustomerNumber,
    line.SalesOrderNumber,
    line.SalesOrderLineNumber,
    line.LineStatus,
    line.IsOpen,
    line.IsClosed,
    line.IsCanceled,
    po.VendorResolutionStatus,
    line.InventoryResolutionStatus,
    line.WorkOrderResolutionStatus,
    line.SalesOrderResolutionStatus,
    po.PurchaseOrderImportRunId,
    po.ImportedAtUtc
FROM canonical.PurchaseOrder AS po
JOIN canonical.PurchaseOrderLine AS line
  ON line.FirmId = po.FirmId
 AND line.VendorNumber = po.VendorNumber
 AND line.PurchaseOrderNumber = po.PurchaseOrderNumber;
GO

CREATE OR ALTER VIEW liveapi.PurchaseOrderMetadata
AS
SELECT TOP (1)
    PurchaseOrderImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    HeaderCount,
    LineCount,
    SourceOrphanLineCount,
    ImportStatus
FROM platform.PurchaseOrderImportRun
WHERE ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_purchase_order_importer') IS NULL
BEGIN
    CREATE ROLE [dle_purchase_order_importer] AUTHORIZATION [dbo];
END;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_purchase_order_import_executor') IS NULL
BEGIN
    CREATE USER [dle_purchase_order_import_executor] WITHOUT LOGIN;
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.database_role_members
    WHERE role_principal_id =
          DATABASE_PRINCIPAL_ID(N'dle_purchase_order_importer')
      AND member_principal_id =
          DATABASE_PRINCIPAL_ID(N'dle_purchase_order_import_executor')
)
BEGIN
    ALTER ROLE [dle_purchase_order_importer]
        ADD MEMBER [dle_purchase_order_import_executor];
END;
GO

GRANT SELECT, INSERT, UPDATE
    ON OBJECT::platform.PurchaseOrderImportRun
    TO [dle_purchase_order_importer];
GRANT SELECT, INSERT, DELETE
    ON OBJECT::canonical.PurchaseOrder
    TO [dle_purchase_order_importer];
GRANT SELECT, INSERT, DELETE
    ON OBJECT::canonical.PurchaseOrderLine
    TO [dle_purchase_order_importer];
DENY EXECUTE TO [dle_purchase_order_importer];
GO

IF DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS') IS NOT NULL
BEGIN
    GRANT IMPERSONATE
        ON USER::[dle_purchase_order_import_executor]
        TO [DLE-OS-HOST\DLE-OS];
END;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.PurchaseOrderViewer
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.PurchaseOrder
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.PurchaseOrderLine
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::liveapi.PurchaseOrderMetadata
        TO [dle_live_api_reader];
END;
GO
