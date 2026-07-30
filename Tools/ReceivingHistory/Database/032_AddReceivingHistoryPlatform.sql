USE [DLE_OS_CANONICAL_LIVE];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.ReceivingHistoryImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.ReceivingHistoryImportRun
    (
        ReceivingHistoryImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_ReceivingHistoryImportRun PRIMARY KEY,
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
        RejectionCount int NOT NULL,
        MalformedOrderDateCount int NOT NULL,
        MalformedReceiptDateCount int NOT NULL,
        MalformedRequiredDateCount int NOT NULL,
        MissingPurchaseOrderCount int NOT NULL,
        CONSTRAINT CK_ReceivingHistoryImportRun_Status
            CHECK (ImportStatus IN (N'PENDING', N'SUCCESS', N'FAILED'))
    );
END;
GO

IF OBJECT_ID(N'canonical.PurchaseReceipt', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.PurchaseReceipt
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
        ReceiverNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceiptDateRaw nvarchar(6) NULL,
        ReceiptDateIso date NULL,
        ReceiptDateResolutionStatus nvarchar(30) NOT NULL,
        ReceiptDateResolutionReason nvarchar(100) NULL,
        OrderDateRaw nvarchar(6) NULL,
        OrderDateIso date NULL,
        OrderDateResolutionStatus nvarchar(30) NOT NULL,
        OrderDateResolutionReason nvarchar(100) NULL,
        WarehouseId nvarchar(2) NULL,
        PurchasingAddressCode nvarchar(2) NULL,
        PackingSlipNumber nvarchar(15) NULL,
        PaymentTermsCode nvarchar(2) NULL,
        FreightTerms nvarchar(15) NULL,
        ShippingMethod nvarchar(15) NULL,
        Acknowledgment nvarchar(20) NULL,
        Fob nvarchar(15) NULL,
        MessageCode nvarchar(3) NULL,
        ReceiptStatus nvarchar(30) NOT NULL,
        ReceiptType nvarchar(30) NOT NULL,
        VendorName nvarchar(60) NULL,
        VendorResolutionStatus nvarchar(40) NOT NULL,
        PurchaseOrderResolutionStatus nvarchar(50) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceivingHistoryImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_PurchaseReceipt_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PurchaseReceipt PRIMARY KEY (SourceRecordIdentity),
        CONSTRAINT FK_PurchaseReceipt_ImportRun FOREIGN KEY
            (ReceivingHistoryImportRunId)
            REFERENCES platform.ReceivingHistoryImportRun
                (ReceivingHistoryImportRunId)
    );
END;
GO

IF COL_LENGTH(
    N'platform.ReceivingHistoryImportRun',
    N'MissingPurchaseOrderCount') IS NULL
BEGIN
    ALTER TABLE platform.ReceivingHistoryImportRun
        ADD MissingPurchaseOrderCount int NOT NULL
            CONSTRAINT DF_ReceivingHistoryImportRun_MissingPurchaseOrderCount
            DEFAULT (0);
END;
GO

IF COL_LENGTH(
    N'platform.ReceivingHistoryImportRun',
    N'MalformedReceiptDateCount') IS NULL
BEGIN
    ALTER TABLE platform.ReceivingHistoryImportRun
        ADD MalformedReceiptDateCount int NOT NULL
            CONSTRAINT DF_ReceivingHistoryImportRun_MalformedReceiptDateCount
            DEFAULT (0),
            MalformedRequiredDateCount int NOT NULL
            CONSTRAINT DF_ReceivingHistoryImportRun_MalformedRequiredDateCount
            DEFAULT (0);
END;
GO

IF COL_LENGTH(
    N'platform.ReceivingHistoryImportRun',
    N'MalformedOrderDateCount') IS NULL
BEGIN
    ALTER TABLE platform.ReceivingHistoryImportRun
        ADD MalformedOrderDateCount int NOT NULL
            CONSTRAINT DF_ReceivingHistoryImportRun_MalformedOrderDateCount
            DEFAULT (0);
END;
GO

IF COL_LENGTH(
    N'canonical.PurchaseReceipt',
    N'OrderDateResolutionStatus') IS NULL
BEGIN
    ALTER TABLE canonical.PurchaseReceipt
        ADD OrderDateResolutionStatus nvarchar(30) NOT NULL
            CONSTRAINT DF_PurchaseReceipt_OrderDateResolutionStatus
            DEFAULT (N'Resolved'),
            OrderDateResolutionReason nvarchar(100) NULL;
END;
GO

IF COL_LENGTH(
    N'canonical.PurchaseReceipt',
    N'ReceiptDateResolutionStatus') IS NULL
BEGIN
    ALTER TABLE canonical.PurchaseReceipt
        ADD ReceiptDateResolutionStatus nvarchar(30) NOT NULL
            CONSTRAINT DF_PurchaseReceipt_ReceiptDateResolutionStatus
            DEFAULT (N'Resolved'),
            ReceiptDateResolutionReason nvarchar(100) NULL;
END;
GO

IF OBJECT_ID(N'canonical.PurchaseReceiptLine', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.PurchaseReceiptLine
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
        ReceiverNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceiptLineNumber nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceiptDateIso date NULL,
        LineCode nvarchar(2) NULL,
        LineType nvarchar(20) NOT NULL,
        PurchaseOrderLineNumber nvarchar(3) NULL,
        RequiredDateRaw nvarchar(6) NULL,
        RequiredDateIso date NULL,
        RequiredDateResolutionStatus nvarchar(30) NOT NULL,
        RequiredDateResolutionReason nvarchar(100) NULL,
        UnitOfMeasure nvarchar(2) NULL,
        InventoryLocation nvarchar(10) NULL,
        WarehouseId nvarchar(2) NULL,
        ItemNumber nvarchar(20) NULL,
        ItemDescription nvarchar(60) NULL,
        OrderMemo nvarchar(40) NULL,
        WorkOrderNumber nvarchar(7) NULL,
        SalesOrderNumber nvarchar(7) NULL,
        SalesOrderLineNumber nvarchar(3) NULL,
        QuantityPostedSigned decimal(19,6) NOT NULL,
        QuantityReceived decimal(19,6) NOT NULL,
        QuantityAccepted decimal(19,6) NOT NULL,
        QuantityRejected decimal(19,6) NOT NULL,
        QuantityReturned decimal(19,6) NOT NULL,
        QuantityInvoiced decimal(19,6) NOT NULL,
        QuantityDispositionStatus nvarchar(40) NOT NULL,
        InspectionStatus nvarchar(60) NOT NULL,
        PurchaseOrderResolutionStatus nvarchar(50) NOT NULL,
        InventoryResolutionStatus nvarchar(50) NOT NULL,
        WorkOrderResolutionStatus nvarchar(50) NOT NULL,
        PurchaseReceiptSourceRecordIdentity nvarchar(64)
            COLLATE Latin1_General_100_BIN2 NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceivingHistoryImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_PurchaseReceiptLine_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PurchaseReceiptLine PRIMARY KEY (SourceRecordIdentity),
        CONSTRAINT FK_PurchaseReceiptLine_Header FOREIGN KEY
            (PurchaseReceiptSourceRecordIdentity)
            REFERENCES canonical.PurchaseReceipt (SourceRecordIdentity),
        CONSTRAINT FK_PurchaseReceiptLine_ImportRun FOREIGN KEY
            (ReceivingHistoryImportRunId)
            REFERENCES platform.ReceivingHistoryImportRun
                (ReceivingHistoryImportRunId),
        CONSTRAINT CK_PurchaseReceiptLine_Quantities CHECK
        (
            QuantityReceived >= 0
            AND QuantityAccepted >= 0
            AND QuantityRejected >= 0
            AND QuantityReturned >= 0
            AND
            (
                (QuantityPostedSigned >= 0
                 AND QuantityReceived = QuantityPostedSigned
                 AND QuantityReturned = 0)
                OR
                (QuantityPostedSigned < 0
                 AND QuantityReceived = 0
                 AND QuantityReturned = -QuantityPostedSigned)
            )
        )
    );
END;
GO

IF COL_LENGTH(
    N'canonical.PurchaseReceiptLine',
    N'RequiredDateResolutionStatus') IS NULL
BEGIN
    ALTER TABLE canonical.PurchaseReceiptLine
        ADD RequiredDateResolutionStatus nvarchar(30) NOT NULL
            CONSTRAINT DF_PurchaseReceiptLine_RequiredDateResolutionStatus
            DEFAULT (N'Resolved'),
            RequiredDateResolutionReason nvarchar(100) NULL;
END;
GO

IF OBJECT_ID(N'canonical.ReceiptRejection', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.ReceiptRejection
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PurchaseOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
        ReceiverNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceiptLineNumber nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
        RejectionSequence nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
        RejectionCode nvarchar(3) NULL,
        OperatorCode nvarchar(3) NULL,
        ReturnAuthorizationNumber nvarchar(15) NULL,
        QuantityRejected decimal(19,6) NOT NULL,
        PurchaseReceiptLineSourceRecordIdentity nvarchar(64)
            COLLATE Latin1_General_100_BIN2 NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ReceivingHistoryImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_ReceiptRejection_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReceiptRejection PRIMARY KEY (SourceRecordIdentity),
        CONSTRAINT FK_ReceiptRejection_Line FOREIGN KEY
            (PurchaseReceiptLineSourceRecordIdentity)
            REFERENCES canonical.PurchaseReceiptLine (SourceRecordIdentity),
        CONSTRAINT FK_ReceiptRejection_ImportRun FOREIGN KEY
            (ReceivingHistoryImportRunId)
            REFERENCES platform.ReceivingHistoryImportRun
                (ReceivingHistoryImportRunId),
        CONSTRAINT CK_ReceiptRejection_Quantity CHECK (QuantityRejected >= 0)
    );
END;
GO

CREATE OR ALTER VIEW canonical.ReceivingHistoryViewer
AS
SELECT
    line.SourceRecordIdentity AS PurchaseReceiptLineId,
    receipt.FirmId,
    receipt.ReceiverNumber,
    receipt.ReceiptDateRaw,
    receipt.ReceiptDateIso,
    receipt.ReceiptDateResolutionStatus,
    receipt.ReceiptDateResolutionReason,
    receipt.OrderDateRaw,
    receipt.OrderDateIso,
    receipt.OrderDateResolutionStatus,
    receipt.OrderDateResolutionReason,
    receipt.PurchaseOrderNumber,
    line.PurchaseOrderLineNumber,
    line.RequiredDateRaw,
    line.RequiredDateIso,
    line.RequiredDateResolutionStatus,
    line.RequiredDateResolutionReason,
    receipt.VendorNumber,
    receipt.VendorName,
    line.LineCode,
    line.LineType,
    line.ItemNumber,
    line.ItemDescription,
    line.OrderMemo,
    line.UnitOfMeasure,
    line.QuantityPostedSigned,
    line.QuantityReceived,
    line.QuantityAccepted,
    line.QuantityRejected,
    line.QuantityReturned,
    line.QuantityInvoiced,
    receipt.PackingSlipNumber,
    line.WarehouseId,
    line.InventoryLocation,
    line.WorkOrderNumber,
    line.SalesOrderNumber,
    line.SalesOrderLineNumber,
    line.QuantityDispositionStatus,
    line.InspectionStatus,
    receipt.VendorResolutionStatus,
    line.PurchaseOrderResolutionStatus,
    line.InventoryResolutionStatus,
    line.WorkOrderResolutionStatus,
    receipt.ReceivingHistoryImportRunId,
    receipt.ImportedAtUtc
FROM canonical.PurchaseReceipt AS receipt
JOIN canonical.PurchaseReceiptLine AS line
  ON line.PurchaseReceiptSourceRecordIdentity = receipt.SourceRecordIdentity;
GO

CREATE OR ALTER VIEW liveapi.ReceivingHistoryMetadata
AS
SELECT TOP (1)
    ReceivingHistoryImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    HeaderCount,
    LineCount,
    RejectionCount,
    MalformedOrderDateCount,
    MalformedReceiptDateCount,
    MalformedRequiredDateCount,
    MissingPurchaseOrderCount,
    ImportStatus
FROM platform.ReceivingHistoryImportRun
WHERE ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_receiving_history_importer') IS NULL
    CREATE ROLE [dle_receiving_history_importer] AUTHORIZATION [dbo];
GO
IF DATABASE_PRINCIPAL_ID(N'dle_receiving_history_import_executor') IS NULL
    CREATE USER [dle_receiving_history_import_executor] WITHOUT LOGIN;
GO
IF NOT EXISTS
(
    SELECT 1 FROM sys.database_role_members
    WHERE role_principal_id =
          DATABASE_PRINCIPAL_ID(N'dle_receiving_history_importer')
      AND member_principal_id =
          DATABASE_PRINCIPAL_ID(N'dle_receiving_history_import_executor')
)
    ALTER ROLE [dle_receiving_history_importer]
        ADD MEMBER [dle_receiving_history_import_executor];
GO

GRANT SELECT, INSERT, UPDATE
    ON OBJECT::platform.ReceivingHistoryImportRun
    TO [dle_receiving_history_importer];
GRANT SELECT, INSERT, DELETE
    ON OBJECT::canonical.PurchaseReceipt
    TO [dle_receiving_history_importer];
GRANT SELECT, INSERT, DELETE
    ON OBJECT::canonical.PurchaseReceiptLine
    TO [dle_receiving_history_importer];
GRANT SELECT, INSERT, DELETE
    ON OBJECT::canonical.ReceiptRejection
    TO [dle_receiving_history_importer];
DENY EXECUTE TO [dle_receiving_history_importer];
GO

IF DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS') IS NOT NULL
    GRANT IMPERSONATE
        ON USER::[dle_receiving_history_import_executor]
        TO [DLE-OS-HOST\DLE-OS];
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.ReceivingHistoryViewer
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.PurchaseReceipt
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.PurchaseReceiptLine
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.ReceiptRejection
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::liveapi.ReceivingHistoryMetadata
        TO [dle_live_api_reader];
END;
GO
