USE [DLE_OS_CANONICAL_LIVE];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.CustomerMasterImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.CustomerMasterImportRun
    (
        CustomerMasterImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_CustomerMasterImportRun PRIMARY KEY,
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
        CustomerCount int NOT NULL,
        CustomerAddressCount int NOT NULL,
        OrphanAddressCount int NOT NULL,
        CONSTRAINT CK_CustomerMasterImportRun_Status
            CHECK (ImportStatus IN (N'PENDING', N'SUCCESS', N'FAILED'))
    );
END;
GO

IF OBJECT_ID(N'canonical.CustomerMaster', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.CustomerMaster
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CustomerNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CustomerName nvarchar(30) NULL,
        CustomerStatus nvarchar(20) NULL,
        IsActive bit NULL,
        AddressLine1 nvarchar(24) NULL,
        AddressLine2 nvarchar(24) NULL,
        AddressLine3 nvarchar(24) NULL,
        AddressLine4 nvarchar(24) NULL,
        AddressLine5 nvarchar(24) NULL,
        PostalCode nvarchar(9) NULL,
        Country nvarchar(24) NULL,
        PrimaryContactName nvarchar(20) NULL,
        PrimaryPhone nvarchar(10) NULL,
        PrimaryPhoneExtension nvarchar(4) NULL,
        SalespersonCode nvarchar(3) NULL,
        SalespersonName nvarchar(20) NULL,
        TerritoryCode nvarchar(3) NULL,
        TerritoryName nvarchar(20) NULL,
        PaymentTermsCode nvarchar(2) NULL,
        PaymentTermsDescription nvarchar(20) NULL,
        ShippingMethodCode nvarchar(10) NULL,
        FreightTerms nvarchar(15) NULL,
        OrderFreightTermsCode nvarchar(2) NULL,
        CustomerTypeCode nvarchar(3) NULL,
        CustomerTypeDescription nvarchar(20) NULL,
        PricingClassCode nvarchar(4) NULL,
        PricingClassDescription nvarchar(20) NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        CustomerMasterImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_CustomerMaster_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CustomerMaster PRIMARY KEY (FirmId, CustomerNumber),
        CONSTRAINT FK_CustomerMaster_ImportRun FOREIGN KEY
            (CustomerMasterImportRunId)
            REFERENCES platform.CustomerMasterImportRun
                (CustomerMasterImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.CustomerAddress', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.CustomerAddress
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CustomerNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
        AddressCode nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
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
        SalespersonCode nvarchar(3) NULL,
        SalespersonName nvarchar(20) NULL,
        TerritoryCode nvarchar(3) NULL,
        TerritoryName nvarchar(20) NULL,
        IsPrimary bit NOT NULL,
        IsActive bit NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        CustomerMasterImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_CustomerAddress_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CustomerAddress PRIMARY KEY
            (FirmId, CustomerNumber, AddressCode),
        CONSTRAINT FK_CustomerAddress_Customer FOREIGN KEY
            (FirmId, CustomerNumber)
            REFERENCES canonical.CustomerMaster (FirmId, CustomerNumber),
        CONSTRAINT FK_CustomerAddress_ImportRun FOREIGN KEY
            (CustomerMasterImportRunId)
            REFERENCES platform.CustomerMasterImportRun
                (CustomerMasterImportRunId)
    );
END;
GO

CREATE OR ALTER VIEW canonical.CustomerMasterViewer
AS
SELECT
    CONCAT(customer.FirmId, customer.CustomerNumber) AS CustomerMasterId,
    customer.FirmId,
    customer.CustomerNumber,
    customer.CustomerName,
    customer.CustomerStatus,
    customer.IsActive,
    customer.AddressLine1,
    customer.AddressLine2,
    customer.AddressLine3,
    customer.AddressLine4,
    customer.AddressLine5,
    customer.PostalCode,
    customer.Country,
    customer.PrimaryContactName,
    customer.PrimaryPhone,
    customer.PrimaryPhoneExtension,
    customer.SalespersonCode,
    customer.SalespersonName,
    customer.TerritoryCode,
    customer.TerritoryName,
    customer.PaymentTermsCode,
    customer.PaymentTermsDescription,
    customer.ShippingMethodCode,
    customer.FreightTerms,
    customer.OrderFreightTermsCode,
    customer.CustomerTypeCode,
    customer.CustomerTypeDescription,
    customer.PricingClassCode,
    customer.PricingClassDescription,
    customer.SourceRecordIdentity,
    customer.CustomerMasterImportRunId,
    customer.ImportedAtUtc,
    (
        SELECT COUNT_BIG(*)
        FROM canonical.CustomerAddress AS address
        WHERE address.FirmId = customer.FirmId
          AND address.CustomerNumber = customer.CustomerNumber
    ) AS AlternateShipToCount
FROM canonical.CustomerMaster AS customer;
GO

CREATE OR ALTER VIEW liveapi.CustomerMasterMetadata
AS
SELECT TOP (1)
    CustomerMasterImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    CustomerCount,
    CustomerAddressCount,
    OrphanAddressCount,
    ImportStatus
FROM platform.CustomerMasterImportRun
WHERE ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.CustomerMasterViewer
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.CustomerAddress
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::liveapi.CustomerMasterMetadata
        TO [dle_live_api_reader];
END;
GO
