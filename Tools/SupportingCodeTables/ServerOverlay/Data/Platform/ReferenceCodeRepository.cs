using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record ReferenceCodeFilter(
    string? CodeDomain,
    string? CodeType,
    string? CodeValue,
    string? Description,
    string? ResolutionStatus,
    string? SourceType);

public sealed class ReferenceCodeRepository
{
    private const string WhereSql = """
WHERE (@CodeDomain IS NULL OR CodeDomain = @CodeDomain)
  AND (@CodeType IS NULL OR CodeType = @CodeType)
  AND (@CodeValue IS NULL OR CodeValue = @CodeValue)
  AND (@Description IS NULL
       OR CodeDescription LIKE N'%' + @Description + N'%')
  AND (@ResolutionStatus IS NULL
       OR ResolutionStatus = @ResolutionStatus)
  AND (@SourceType IS NULL OR SourceType = @SourceType)
""";

    private const string SelectSql = """
SELECT
    ReferenceCodeId, FirmId, CodeDomain, CodeType, CodeValue,
    CodeDescription, ShortDescription, ParentCodeValue, SortOrder, IsActive,
    SourceType, AccessClassification, ResolutionStatus, SourceRecordIdentity,
    UsageCount, ReferenceCodeImportRunId, ImportedAtUtc
FROM canonical.ReferenceCodeViewer
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public ReferenceCodeRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<ReferenceCodeDto>> GetPageAsync(
        PageRequest page,
        ReferenceCodeFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.CodeDomain,
            filter.CodeType,
            filter.CodeValue,
            filter.Description,
            filter.ResolutionStatus,
            filter.SourceType,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.ReferenceCodeViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<ReferenceCodeDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY CodeDomain, CodeType, CodeValue, FirmId "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<ReferenceCodeDto>(rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<ReferenceCodeDto>> GetCodeAsync(
        string firmId,
        string domain,
        string type,
        string value,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ReferenceCodeDto>(
            new CommandDefinition(
                SelectSql + """

WHERE FirmId = @FirmId
  AND CodeDomain = @Domain
  AND CodeType = @Type
  AND CodeValue = @Value;
""",
                new { FirmId = firmId, Domain = domain, Type = type, Value = value },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<ReferenceCodeDto>(rows.AsList());
    }

    public async Task<CanonicalLookupResult<ReferenceCodeDto>> GetCodeByIdAsync(
        long id,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ReferenceCodeDto>(
            new CommandDefinition(
                SelectSql + "\nWHERE ReferenceCodeId = @Id;",
                new { Id = id },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<ReferenceCodeDto>(rows.AsList());
    }

    public async Task<ReferenceCodeMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    ReferenceCodeImportRunId, SourceQualificationRunId, PackageSha256,
    ContractVersion, SnapshotAsOfUtc, ReferenceCodeCount, RelationshipCount,
    UsageEvidenceCount, ResolvedCount, UnresolvedCount, AmbiguousCount,
    GenericSystemCount, CanonicalEnumCount, RestrictedSourceRecordCount,
    ImportStatus
FROM liveapi.ReferenceCodeMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ReferenceCodeMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
