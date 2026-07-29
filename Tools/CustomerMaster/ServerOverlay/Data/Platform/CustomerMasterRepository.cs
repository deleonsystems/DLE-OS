using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record CustomerMasterFilter(
    string? CustomerNumber,
    string? CustomerName,
    string? PostalCode,
    string? ContactName,
    string? SalespersonCode,
    string? TerritoryCode);

public sealed class CustomerMasterRepository
{
    private const string WhereSql = """
WHERE (@CustomerNumber IS NULL OR CustomerNumber = @CustomerNumber)
  AND (@CustomerName IS NULL
       OR CustomerName LIKE N'%' + @CustomerName + N'%')
  AND (@PostalCode IS NULL OR PostalCode = @PostalCode)
  AND (@ContactName IS NULL
       OR PrimaryContactName LIKE N'%' + @ContactName + N'%')
  AND (@SalespersonCode IS NULL OR SalespersonCode = @SalespersonCode)
  AND (@TerritoryCode IS NULL OR TerritoryCode = @TerritoryCode)
""";

    private const string SelectSql = """
SELECT
    CustomerMasterId,
    FirmId,
    CustomerNumber,
    CustomerName,
    CustomerStatus,
    IsActive,
    AddressLine1,
    AddressLine2,
    AddressLine3,
    AddressLine4,
    AddressLine5,
    PostalCode,
    Country,
    PrimaryContactName,
    PrimaryPhone,
    PrimaryPhoneExtension,
    SalespersonCode,
    SalespersonName,
    TerritoryCode,
    TerritoryName,
    PaymentTermsCode,
    PaymentTermsDescription,
    ShippingMethodCode,
    FreightTerms,
    OrderFreightTermsCode,
    CustomerTypeCode,
    CustomerTypeDescription,
    PricingClassCode,
    PricingClassDescription,
    SourceRecordIdentity,
    CustomerMasterImportRunId,
    ImportedAtUtc,
    AlternateShipToCount
FROM canonical.CustomerMasterViewer
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public CustomerMasterRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<CustomerMasterDto>> GetPageAsync(
        PageRequest page,
        CustomerMasterFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.CustomerNumber,
            filter.CustomerName,
            filter.PostalCode,
            filter.ContactName,
            filter.SalespersonCode,
            filter.TerritoryCode,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.CustomerMasterViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<CustomerMasterDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY CustomerNumber, FirmId "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<CustomerMasterDto>(
            rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<CustomerMasterDto>> GetByIdAsync(
        string customerMasterId,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<CustomerMasterDto>(
            new CommandDefinition(
                SelectSql + "\nWHERE CustomerMasterId = @CustomerMasterId;",
                new { CustomerMasterId = customerMasterId },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<CustomerMasterDto>(rows.AsList());
    }

    public async Task<IReadOnlyList<CustomerAddressDto>> GetAddressesAsync(
        string firmId,
        string customerNumber,
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    FirmId,
    CustomerNumber,
    AddressCode,
    AddressType,
    AddressName,
    AddressLine1,
    AddressLine2,
    AddressLine3,
    PostalCode,
    Country,
    ContactName,
    Phone,
    PhoneExtension,
    SalespersonCode,
    SalespersonName,
    TerritoryCode,
    TerritoryName,
    IsPrimary,
    IsActive
FROM canonical.CustomerAddress
WHERE FirmId = @FirmId
  AND CustomerNumber = @CustomerNumber
ORDER BY AddressCode;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<CustomerAddressDto>(
            new CommandDefinition(
                sql,
                new { FirmId = firmId, CustomerNumber = customerNumber },
                cancellationToken: cancellationToken));
        return rows.AsList();
    }

    public async Task<CustomerMasterMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    CustomerMasterImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    SnapshotAsOfUtc,
    CustomerCount,
    CustomerAddressCount,
    OrphanAddressCount,
    ImportStatus
FROM liveapi.CustomerMasterMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<
            CustomerMasterMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
