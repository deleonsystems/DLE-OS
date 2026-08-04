using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record VendorMasterFilter(
    string? VendorNumber,
    string? VendorName,
    string? PostalCode,
    string? ContactName,
    string? PaymentTermsCode);

public sealed class VendorMasterRepository
{
    private const string WhereSql = """
WHERE (@VendorNumber IS NULL OR VendorNumber = @VendorNumber)
  AND (@VendorName IS NULL OR VendorName LIKE N'%' + @VendorName + N'%')
  AND (@PostalCode IS NULL OR PostalCode = @PostalCode)
  AND (@ContactName IS NULL
       OR PrimaryContactName LIKE N'%' + @ContactName + N'%')
  AND (@PaymentTermsCode IS NULL
       OR PaymentTermsCode = @PaymentTermsCode)
""";

    private const string SelectSql = """
SELECT
    VendorMasterId, FirmId, VendorNumber, VendorName, VendorStatus,
    IsActive, VendorType, VendorClass, AddressLine1, AddressLine2,
    AddressLine3, PostalCode, Country, PrimaryContactName, PrimaryPhone,
    PrimaryPhoneExtension, PaymentTermsCode, PaymentTermsDescription,
    ApprovedSupplierStatus, SourceRecordIdentity,
    VendorMasterImportRunId, ImportedAtUtc, PurchasingAddressCount
FROM canonical.VendorMasterViewer
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public VendorMasterRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<VendorMasterDto>> GetPageAsync(
        PageRequest page,
        VendorMasterFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.VendorNumber,
            filter.VendorName,
            filter.PostalCode,
            filter.ContactName,
            filter.PaymentTermsCode,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.VendorMasterViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<VendorMasterDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY VendorNumber, FirmId "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<VendorMasterDto>(rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<VendorMasterDto>> GetByIdAsync(
        string vendorMasterId,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<VendorMasterDto>(
            new CommandDefinition(
                SelectSql + "\nWHERE VendorMasterId = @VendorMasterId;",
                new { VendorMasterId = vendorMasterId },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<VendorMasterDto>(rows.AsList());
    }

    public async Task<IReadOnlyList<VendorAddressDto>> GetAddressesAsync(
        string firmId,
        string vendorNumber,
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    FirmId, VendorNumber, AddressCode, AddressType, AddressName,
    AddressLine1, AddressLine2, AddressLine3, PostalCode, Country,
    ContactName, Phone, PhoneExtension, IsPrimary, IsActive
FROM canonical.VendorAddress
WHERE FirmId = @FirmId AND VendorNumber = @VendorNumber
ORDER BY AddressCode;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<VendorAddressDto>(
            new CommandDefinition(
                sql,
                new { FirmId = firmId, VendorNumber = vendorNumber },
                cancellationToken: cancellationToken));
        return rows.AsList();
    }

    public async Task<VendorMasterMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    VendorMasterImportRunId, SourceQualificationRunId, PackageSha256,
    ContractVersion, SnapshotAsOfUtc, VendorCount, VendorAddressCount,
    OrphanAddressCount, OrphanDetailCount, ImportStatus
FROM liveapi.VendorMasterMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<
            VendorMasterMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
