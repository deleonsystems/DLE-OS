USE [DLE_OS_CANONICAL_LIVE];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.InvoiceHistoryRefreshRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.InvoiceHistoryRefreshRun
    (
        InvoiceHistoryRefreshRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_InvoiceHistoryRefreshRun PRIMARY KEY,
        RefreshExecutionRunId nvarchar(128) NOT NULL
            CONSTRAINT UQ_InvoiceHistoryRefreshRun_Execution UNIQUE,
        PackageContentHash char(64) NOT NULL,
        PackageManifestHash char(64) NOT NULL,
        WindowStart date NOT NULL,
        WindowEnd date NOT NULL,
        StartedAtUtc datetime2(7) NOT NULL,
        CompletedAtUtc datetime2(7) NULL,
        RefreshStatus nvarchar(32) NOT NULL,
        IsCommitted bit NOT NULL,
        HeaderInsertCount int NOT NULL,
        HeaderUpdateCount int NOT NULL,
        HeaderUnchangedCount int NOT NULL,
        HeaderMissingCount int NOT NULL,
        LineInsertCount int NOT NULL,
        LineUpdateCount int NOT NULL,
        LineUnchangedCount int NOT NULL,
        LineMissingCount int NOT NULL,
        CandidateHeaderCount int NOT NULL,
        CandidateLineCount int NOT NULL,
        SourceArt03Identity nvarchar(max) NOT NULL,
        SourceArt13Identity nvarchar(max) NOT NULL,
        FailureMessage nvarchar(2048) NULL,
        CONSTRAINT CK_InvoiceHistoryRefreshRun_Status CHECK
        (
            RefreshStatus IN
            (
                N'PENDING',
                N'SUCCESS',
                N'SUCCESS_WITH_CLARIFICATIONS',
                N'NO_SOURCE_CHANGES',
                N'FAILED'
            )
        ),
        CONSTRAINT CK_InvoiceHistoryRefreshRun_Window
            CHECK (WindowStart <= WindowEnd),
        CONSTRAINT CK_InvoiceHistoryRefreshRun_Hash
            CHECK
            (
                PackageContentHash NOT LIKE '%[^0-9A-F]%'
                AND LEN(PackageContentHash) = 64
            )
    );
END;
GO

IF COL_LENGTH(
    N'canonical.CustomerInvoice',
    N'LastInvoiceHistoryRefreshRunId') IS NULL
BEGIN
    ALTER TABLE canonical.CustomerInvoice
        ADD LastInvoiceHistoryRefreshRunId uniqueidentifier NULL;
    ALTER TABLE canonical.CustomerInvoice
        ADD CONSTRAINT FK_CustomerInvoice_LastRefresh
        FOREIGN KEY (LastInvoiceHistoryRefreshRunId)
        REFERENCES platform.InvoiceHistoryRefreshRun(
            InvoiceHistoryRefreshRunId);
END;
GO

IF COL_LENGTH(
    N'canonical.CustomerInvoiceLine',
    N'LastInvoiceHistoryRefreshRunId') IS NULL
BEGIN
    ALTER TABLE canonical.CustomerInvoiceLine
        ADD LastInvoiceHistoryRefreshRunId uniqueidentifier NULL;
    ALTER TABLE canonical.CustomerInvoiceLine
        ADD CONSTRAINT FK_CustomerInvoiceLine_LastRefresh
        FOREIGN KEY (LastInvoiceHistoryRefreshRunId)
        REFERENCES platform.InvoiceHistoryRefreshRun(
            InvoiceHistoryRefreshRunId);
END;
GO

CREATE OR ALTER VIEW liveapi.InvoiceHistoryRefreshStatus
AS
SELECT TOP (1)
    InvoiceHistoryRefreshRunId,
    RefreshExecutionRunId,
    PackageContentHash,
    WindowStart,
    WindowEnd,
    StartedAtUtc,
    CompletedAtUtc,
    RefreshStatus,
    IsCommitted,
    HeaderInsertCount,
    HeaderUpdateCount,
    HeaderUnchangedCount,
    HeaderMissingCount,
    LineInsertCount,
    LineUpdateCount,
    LineUnchangedCount,
    LineMissingCount,
    CandidateHeaderCount,
    CandidateLineCount,
    FailureMessage
FROM platform.InvoiceHistoryRefreshRun
ORDER BY StartedAtUtc DESC;
GO

GRANT SELECT ON OBJECT::liveapi.InvoiceHistoryRefreshStatus
    TO [dle_live_api_reader];
DENY INSERT, UPDATE, DELETE, ALTER
    ON OBJECT::liveapi.InvoiceHistoryRefreshStatus
    TO [dle_live_api_reader];
GO
