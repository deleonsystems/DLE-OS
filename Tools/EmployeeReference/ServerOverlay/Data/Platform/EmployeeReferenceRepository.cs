using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record EmployeeReferenceFilter(
    string? EmployeeNumber,
    string? EmployeeName,
    string? Department,
    string? JobTitle,
    bool? IsActive,
    string? OperationalCode,
    string? CodeType);

public sealed class EmployeeReferenceRepository
{
    private const string WhereSql = """
WHERE (@EmployeeNumber IS NULL OR EmployeeNumber = @EmployeeNumber)
  AND (@EmployeeName IS NULL OR DisplayName LIKE N'%' + @EmployeeName + N'%')
  AND (@Department IS NULL
       OR DepartmentCode = @Department
       OR DepartmentName LIKE N'%' + @Department + N'%')
  AND (@JobTitle IS NULL
       OR JobTitleCode = @JobTitle
       OR JobTitle LIKE N'%' + @JobTitle + N'%')
  AND (@IsActive IS NULL OR IsActive = @IsActive)
  AND (
      (@OperationalCode IS NULL AND @CodeType IS NULL)
      OR EXISTS
      (
          SELECT 1
          FROM canonical.EmployeeOperationalCode AS code
          WHERE code.FirmId = canonical.EmployeeReferenceViewer.FirmId
            AND code.EmployeeNumber =
                canonical.EmployeeReferenceViewer.EmployeeNumber
            AND (@OperationalCode IS NULL
                 OR code.OperationalCode = @OperationalCode)
            AND (@CodeType IS NULL OR code.CodeType = @CodeType)
      )
  )
""";

    private const string SelectSql = """
SELECT
    EmployeeReferenceId, FirmId, EmployeeNumber, DisplayName, FirstName,
    LastName, DepartmentCode, DepartmentName, JobTitleCode, JobTitle,
    EmployeeStatus, IsActive, OperationalCodeCount, SourceSystem,
    SourceRecordIdentity, EmployeeReferenceImportRunId, ImportedAtUtc
FROM canonical.EmployeeReferenceViewer
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public EmployeeReferenceRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<EmployeeReferenceDto>> GetPageAsync(
        PageRequest page,
        EmployeeReferenceFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.EmployeeNumber,
            filter.EmployeeName,
            filter.Department,
            filter.JobTitle,
            filter.IsActive,
            filter.OperationalCode,
            filter.CodeType,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.EmployeeReferenceViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<EmployeeReferenceDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY FirmId, EmployeeNumber "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<EmployeeReferenceDto>(
            rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<EmployeeReferenceDto>>
        GetEmployeeAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<EmployeeReferenceDto>(
            new CommandDefinition(
                SelectSql + "\nWHERE EmployeeReferenceId = @Id;",
                new { Id = id },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<EmployeeReferenceDto>(rows.AsList());
    }

    public async Task<IReadOnlyList<EmployeeOperationalCodeDto>> GetCodesAsync(
        string firmId,
        string employeeNumber,
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    CodeScope, FirmId, EmployeeNumber, CodeType, OperationalCode, CodeDescription,
    ResolutionStatus, IsActive, SourceSystem, SourceRecordIdentity,
    EmployeeReferenceImportRunId, ImportedAtUtc
FROM canonical.EmployeeOperationalCode
WHERE FirmId = @FirmId
  AND EmployeeNumber = @EmployeeNumber
ORDER BY CodeType, OperationalCode;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<EmployeeOperationalCodeDto>(
            new CommandDefinition(
                sql,
                new { FirmId = firmId, EmployeeNumber = employeeNumber },
                cancellationToken: cancellationToken));
        return rows.AsList();
    }

    public async Task<EmployeeReferenceMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    EmployeeReferenceImportRunId, SourceQualificationRunId, PackageSha256,
    ContractVersion, SnapshotAsOfUtc, EmployeeCount, OperationalCodeCount,
    DepartmentCount, JobTitleCount, ActiveEmployeeCount,
    InactiveEmployeeCount, UnresolvedCodeCount, AmbiguousCodeCount,
    GenericSystemCodeCount, ImportStatus
FROM liveapi.EmployeeReferenceMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<
            EmployeeReferenceMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
