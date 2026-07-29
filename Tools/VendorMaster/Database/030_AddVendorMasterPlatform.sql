USE [DLE_OS_CANONICAL_LIVE];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.VendorMasterImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.VendorMasterImportRun
    (
        VendorMasterImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_VendorMasterImportRun PRIMARY KEY,
        SourceQualificationRunId nvarchar(100) NOT NULL,
        PackageSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ManifestSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PackageSchema nvarchar(80) NOT NULL,
        PackageSchemaVersion nvarchar(20) NOT NULL,
        ContractVersion nvarchar(40) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        CompletedAtUtc datetime2(3) NULL,
        ImportStatus nvarchar(20) NOT NULL,
        IsCommitted bit NOT NULL,
        IsNoOp bit NOT NULL,
        VendorCount int NOT NULL,
        VendorAddressCount int NOT NULL,
        OrphanAddressCount int NOT NULL,
        OrphanDetailCount int NOT NULL,
        CONSTRAINT CK_VendorMasterImportRun_Status
            CHECK (ImportStatus IN (N'PENDING', N'SUCCESS', N'FAILED'))
    );
END;
GO

IF OBJECT_ID(N'canonical.VendorMaster', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.VendorMaster
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorName nvarchar(30) NULL,
        VendorStatus nvarchar(20) NULL,
        IsActive bit NULL,
        VendorType nvarchar(20) NULL,
        VendorClass nvarchar(20) NULL,
        AddressLine1 nvarchar(24) NULL,
        AddressLine2 nvarchar(24) NULL,
        AddressLine3 nvarchar(24) NULL,
        PostalCode nvarchar(9) NULL,
        Country nvarchar(24) NULL,
        PrimaryContactName nvarchar(20) NULL,
        PrimaryPhone nvarchar(10) NULL,
        PrimaryPhoneExtension nvarchar(4) NULL,
        PaymentTermsCode nvarchar(2) NULL,
        PaymentTermsDescription nvarchar(20) NULL,
        ApprovedSupplierStatus nvarchar(20) NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        VendorMasterImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_VendorMaster_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_VendorMaster PRIMARY KEY (FirmId, VendorNumber),
        CONSTRAINT FK_VendorMaster_ImportRun FOREIGN KEY
            (VendorMasterImportRunId)
            REFERENCES platform.VendorMasterImportRun
                (VendorMasterImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.VendorAddress', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.VendorAddress
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        VendorNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        AddressCode nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        AddressType nvarchar(20) NOT NULL,
        AddressName nvarchar(30) NULL,
        AddressLine1 nvarchar(24) NULL,
        AddressLine2 nvarchar(24) NULL,
        AddressLine3 nvarchar(24) NULL,
        PostalCode nvarchar(9) NULL,
        Country nvarchar(24) NULL,
        ContactName nvarchar(20) NULL,
        Phone nvarchar(10) NULL,
        PhoneExtension nvarchar(4) NULL,
        IsPrimary bit NOT NULL,
        IsActive bit NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        VendorMasterImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_VendorAddress_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_VendorAddress PRIMARY KEY
            (FirmId, VendorNumber, AddressCode),
        CONSTRAINT FK_VendorAddress_Vendor FOREIGN KEY
            (FirmId, VendorNumber)
            REFERENCES canonical.VendorMaster (FirmId, VendorNumber),
        CONSTRAINT FK_VendorAddress_ImportRun FOREIGN KEY
            (VendorMasterImportRunId)
            REFERENCES platform.VendorMasterImportRun
                (VendorMasterImportRunId)
    );
END;
GO

CREATE OR ALTER VIEW canonical.VendorMasterViewer
AS
SELECT
    CONCAT(vendor.FirmId, vendor.VendorNumber) AS VendorMasterId,
    vendor.FirmId,
    vendor.VendorNumber,
    vendor.VendorName,
    vendor.VendorStatus,
    vendor.IsActive,
    vendor.VendorType,
    vendor.VendorClass,
    vendor.AddressLine1,
    vendor.AddressLine2,
    vendor.AddressLine3,
    vendor.PostalCode,
    vendor.Country,
    vendor.PrimaryContactName,
    vendor.PrimaryPhone,
    vendor.PrimaryPhoneExtension,
    vendor.PaymentTermsCode,
    vendor.PaymentTermsDescription,
    vendor.ApprovedSupplierStatus,
    vendor.SourceRecordIdentity,
    vendor.VendorMasterImportRunId,
    vendor.ImportedAtUtc,
    (
        SELECT COUNT_BIG(*)
        FROM canonical.VendorAddress AS address
        WHERE address.FirmId = vendor.FirmId
          AND address.VendorNumber = vendor.VendorNumber
    ) AS PurchasingAddressCount
FROM canonical.VendorMaster AS vendor;
GO

CREATE OR ALTER VIEW liveapi.VendorMasterMetadata
AS
SELECT TOP (1)
    VendorMasterImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    VendorCount,
    VendorAddressCount,
    OrphanAddressCount,
    OrphanDetailCount,
    ImportStatus
FROM platform.VendorMasterImportRun
WHERE ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.VendorMasterViewer
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.VendorAddress
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::liveapi.VendorMasterMetadata
        TO [dle_live_api_reader];
END;
GO
