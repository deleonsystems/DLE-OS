using Microsoft.Data.SqlClient;

public sealed record EmployeeDirectoryItem(
    Guid EmployeeId,
    string? EmployeeNumber,
    string DisplayName,
    string? DepartmentName,
    string? JobTitle,
    string SourceEmploymentStatus,
    string DleWorkforceStatus,
    bool AccessEligible,
    bool TrainingEligible,
    string ProvisioningStatus,
    string? ProposedUserName,
    string? DleOsUserName,
    string? DleOsUserDisplayName,
    string? DleOsAccountStatus,
    string? DleOsRoleCode,
    bool HasDleOsAccess,
    string AccessReadiness,
    bool MissingFromSource,
    string? SourceReviewReason);

public sealed record EmployeeDirectoryResult(
    IReadOnlyList<EmployeeDirectoryItem> Items,
    int TotalEmployees,
    int CurrentEmployees,
    int HistoricalRetainedEmployees,
    int ReviewEmployees,
    int LinkedUsers,
    int UnprovisionedEmployees);

public static class EmployeeDirectoryAuthorization
{
    public static bool CanAdminister(CurrentUserResolution current) =>
        current.Status == CurrentUserStatus.Active && current.User?.IsSuperAdmin == true;
}

public sealed class EmployeeDirectoryService(string connectionString)
{
    public async Task<EmployeeDirectoryResult> GetAsync(
        bool includeHistorical,
        CancellationToken cancellationToken = default)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        const string select = """
            SELECT EmployeeId,EmployeeNumber,DisplayName,DepartmentName,JobTitle,
                   SourceEmploymentStatus,DleWorkforceStatus,AccessEligible,TrainingEligible,
                   ProvisioningStatus,ProposedUserName,DleOsUserName,DleOsUserDisplayName,
                   DleOsAccountStatus,DleOsRoleCode,HasDleOsAccess,AccessReadiness,
                   MissingFromSource,SourceReviewReason
            FROM hr.EmployeeDirectoryView
            WHERE @IncludeHistorical=1 OR DleWorkforceStatus<>'HISTORICAL_RETAINED'
            ORDER BY CASE DleWorkforceStatus WHEN 'CURRENT' THEN 0 WHEN 'SOURCE_REVIEW' THEN 1
                         WHEN 'INACTIVE' THEN 2 ELSE 3 END,
                     EmployeeNumber,DisplayName;

            SELECT COUNT(*),
                   SUM(CASE WHEN DleWorkforceStatus='CURRENT' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN DleWorkforceStatus='HISTORICAL_RETAINED' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN DleWorkforceStatus='SOURCE_REVIEW' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN DleOsUserName IS NOT NULL THEN 1 ELSE 0 END),
                   SUM(CASE WHEN ProvisioningStatus='NOT_PROVISIONED' THEN 1 ELSE 0 END)
            FROM hr.EmployeeDirectoryView;
            """;
        await using var command = new SqlCommand(select, connection);
        command.Parameters.AddWithValue("@IncludeHistorical", includeHistorical);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var items = new List<EmployeeDirectoryItem>();
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new EmployeeDirectoryItem(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetBoolean(7),
                reader.GetBoolean(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.IsDBNull(13) ? null : reader.GetString(13),
                reader.IsDBNull(14) ? null : reader.GetString(14),
                reader.GetBoolean(15),
                reader.GetString(16),
                reader.GetBoolean(17),
                reader.IsDBNull(18) ? null : reader.GetString(18)));
        }
        await reader.NextResultAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException("Employee Directory summary was not returned.");
        int Value(int ordinal) => reader.IsDBNull(ordinal) ? 0 : reader.GetInt32(ordinal);
        return new EmployeeDirectoryResult(
            items,Value(0),Value(1),Value(2),Value(3),Value(4),Value(5));
    }
}
