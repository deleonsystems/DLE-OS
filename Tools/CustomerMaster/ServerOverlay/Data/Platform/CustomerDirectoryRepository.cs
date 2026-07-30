using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;

namespace DLE_OS_Server.Data.Platform;

public sealed class CustomerDirectoryRepository
{
    private const string SearchSql = """
WITH Candidate AS
(
    SELECT
        CustomerNumber,
        NULLIF(LTRIM(RTRIM(CustomerName)), N'') AS CustomerName,
        N'Customer Master' AS SourceName,
        1 AS NamePrecedence,
        CAST(NULL AS date) AS ActivityDate,
        0 AS OpenOrderRecords,
        0 AS SalesOrderRecords,
        0 AS InvoiceHistoryRecords,
        1 AS CustomerMasterRecords
    FROM canonical.CustomerMasterViewer
    WHERE CustomerNumber IS NOT NULL

    UNION ALL

    SELECT
        CustomerNumber,
        NULLIF(LTRIM(RTRIM(CustomerName)), N''),
        N'Sales Orders',
        3,
        OrderDate,
        1,
        1,
        0,
        0
    FROM canonical.SalesOrderViewer
    WHERE CustomerNumber IS NOT NULL

    UNION ALL

    SELECT
        CustomerNumber,
        NULLIF(LTRIM(RTRIM(CustomerName)), N''),
        N'Invoice History',
        2,
        InvoiceDate,
        0,
        0,
        1,
        0
    FROM canonical.InvoiceHistoryViewer
    WHERE CustomerNumber IS NOT NULL
),
MatchingCustomer AS
(
    SELECT DISTINCT CustomerNumber
    FROM Candidate
    WHERE
        @Query IS NULL
        OR CustomerNumber LIKE N'%' + @Query + N'%'
        OR (
            @NumericQuery IS NOT NULL
            AND TRY_CONVERT(bigint, CustomerNumber) = @NumericQuery
        )
        OR LOWER(CustomerName) LIKE N'%' + LOWER(@Query) + N'%'
),
Ranked AS
(
    SELECT candidate.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY candidate.CustomerNumber
            ORDER BY
                CASE WHEN candidate.CustomerName IS NULL THEN 1 ELSE 0 END,
                candidate.NamePrecedence,
                candidate.ActivityDate DESC,
                candidate.CustomerName
        ) AS PreferredNameRank
    FROM Candidate candidate
    INNER JOIN MatchingCustomer match
        ON match.CustomerNumber = candidate.CustomerNumber
),
CustomerMatch AS
(
    SELECT
        CustomerNumber,
        MAX(CASE WHEN PreferredNameRank = 1 THEN CustomerName END)
            AS CustomerName,
        SUM(OpenOrderRecords) AS OpenOrderRecords,
        SUM(SalesOrderRecords) AS SalesOrderRecords,
        SUM(InvoiceHistoryRecords) AS InvoiceHistoryRecords,
        SUM(CustomerMasterRecords) AS CustomerMasterRecords,
        MAX(ActivityDate) AS MostRecentActivityDate
    FROM Ranked
    GROUP BY CustomerNumber
    ORDER BY
        CASE
            WHEN CustomerNumber = @Query THEN 0
            WHEN @NumericQuery IS NOT NULL
                 AND TRY_CONVERT(bigint, CustomerNumber) = @NumericQuery THEN 1
            WHEN MAX(CASE WHEN PreferredNameRank = 1 THEN CustomerName END)
                 = @Query THEN 2
            ELSE 3
        END,
        CustomerNumber
)
SELECT
    match.CustomerNumber,
    match.CustomerName,
    match.OpenOrderRecords,
    match.SalesOrderRecords,
    match.InvoiceHistoryRecords,
    match.CustomerMasterRecords,
    match.MostRecentActivityDate,
    COUNT_BIG(*) OVER () AS TotalItems,
    STUFF((
        SELECT N'|' + names.CustomerName
        FROM (
            SELECT DISTINCT candidate.CustomerName
            FROM Candidate candidate
            WHERE candidate.CustomerNumber = match.CustomerNumber
              AND candidate.CustomerName IS NOT NULL
              AND candidate.CustomerName <> match.CustomerName
        ) names
        ORDER BY names.CustomerName
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 1, N'')
        AS AliasesText
FROM CustomerMatch match
ORDER BY
    CASE
        WHEN match.CustomerNumber = @Query THEN 0
        WHEN @NumericQuery IS NOT NULL
             AND TRY_CONVERT(bigint, match.CustomerNumber) = @NumericQuery THEN 1
        WHEN match.CustomerName = @Query THEN 2
        ELSE 3
    END,
    match.CustomerName,
    match.CustomerNumber
OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public CustomerDirectoryRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<CustomerDirectorySearchResponseDto> SearchAsync(
        string? query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var numericQuery = query is not null
            && query.All(char.IsAsciiDigit)
            && long.TryParse(query, out var numericValue)
            ? numericValue
            : (long?)null;
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<CustomerDirectoryRow>(
            new CommandDefinition(
                SearchSql,
                new
                {
                    Query = query,
                    NumericQuery = numericQuery,
                    Offset = (page - 1) * pageSize,
                    PageSize = pageSize
                },
                cancellationToken: cancellationToken))).AsList();
        var totalItems = rows.FirstOrDefault()?.TotalItems ?? 0;
        var totalPages = totalItems == 0
            ? 0
            : (long)Math.Ceiling(totalItems / (double)pageSize);
        var items = rows.Select(ToDto).ToArray();
        return new CustomerDirectorySearchResponseDto
        {
            Query = query,
            Items = items,
            ReturnedCount = items.Length,
            TotalItems = totalItems,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalPages,
            HasMore = page < totalPages
        };
    }

    private static CustomerDirectoryResultDto ToDto(CustomerDirectoryRow row)
    {
        var sources = new List<string>();
        if (row.CustomerMasterRecords > 0)
            sources.Add("Customer Master");
        if (row.SalesOrderRecords > 0)
        {
            sources.Add("Open Orders");
            sources.Add("Sales Orders");
        }
        if (row.InvoiceHistoryRecords > 0)
            sources.Add("Invoice History");
        return new CustomerDirectoryResultDto
        {
            CustomerNumber = row.CustomerNumber,
            CustomerName = row.CustomerName ?? row.CustomerNumber,
            Aliases = (row.AliasesText ?? "")
                .Split('|', StringSplitOptions.RemoveEmptyEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            Sources = sources,
            OpenOrderRecords = row.OpenOrderRecords,
            SalesOrderRecords = row.SalesOrderRecords,
            InvoiceHistoryRecords = row.InvoiceHistoryRecords,
            CustomerMasterRecords = row.CustomerMasterRecords,
            MostRecentActivityDate = row.MostRecentActivityDate
        };
    }

    private sealed class CustomerDirectoryRow
    {
        public required string CustomerNumber { get; init; }
        public string? CustomerName { get; init; }
        public string? AliasesText { get; init; }
        public int OpenOrderRecords { get; init; }
        public int SalesOrderRecords { get; init; }
        public int InvoiceHistoryRecords { get; init; }
        public int CustomerMasterRecords { get; init; }
        public DateTime? MostRecentActivityDate { get; init; }
        public long TotalItems { get; init; }
    }
}
