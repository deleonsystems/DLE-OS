using System.Data;
using System.Net;
using System.Reflection;
using System.Text.Json;
using DleOs.Security;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
var connectionString = Environment.GetEnvironmentVariable("DLE_OS_SECURITY_CONNECTION_STRING")
    ?? throw new InvalidOperationException("DLE_OS_SECURITY_CONNECTION_STRING is required.");
var boundary = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(Environment.GetEnvironmentVariable("DLE_OS_SECURITY_DEVELOPMENT"), "true", StringComparison.Ordinal) ||
    !string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Employee Directory tests require DLE_OS_SECURITY_DEV.");

var service = new EmployeeDirectoryService(connectionString);
var directory = await service.GetAsync(true);
Check(directory.TotalEmployees == 11 && directory.Items.Count == 11,
    "11 qualified source employees map to 11 durable employee records");
Check(directory.CurrentEmployees == 10 && directory.HistoricalRetainedEmployees == 1 &&
      directory.ReviewEmployees == 0,
    "workforce population is 10 CURRENT, 1 HISTORICAL_RETAINED, 0 SOURCE_REVIEW");
Check(directory.LinkedUsers == 1 && directory.UnprovisionedEmployees == 9,
    "only Miguel is linked and nine current employees remain unprovisioned");
await using (var populationConnection = new SqlConnection(connectionString))
{
    await populationConnection.OpenAsync();
    await using var userCount = new SqlCommand("SELECT COUNT(*) FROM security.[User];", populationConnection);
    Check(Convert.ToInt32(await userCount.ExecuteScalarAsync()) == 1,
        "employee sync creates no additional security users");
}
Check(directory.Items.Select(item => item.EmployeeId).Distinct().Count() == 11,
    "every employee has a unique immutable EmployeeId");
Check(directory.Items.Where(item => item.EmployeeNumber is not null)
        .Select(item => item.EmployeeNumber).Distinct(StringComparer.Ordinal).Count() == 11,
    "normalized employee numbers are unique");

var founder = directory.Items.Single(item => item.EmployeeNumber == "0001");
Check(founder.DisplayName == "MIGUEL DE LEON" &&
      founder.SourceEmploymentStatus == "ACTIVE" &&
      founder.DleWorkforceStatus == "HISTORICAL_RETAINED" &&
      founder.ProvisioningStatus == "BLOCKED" && !founder.AccessEligible &&
      !founder.TrainingEligible && founder.DleOsUserName is null,
    "0001 is retained historically, blocked, training-ineligible, and unlinked");

var miguelEmployee = directory.Items.Single(item => item.EmployeeNumber == "0054");
Check(miguelEmployee.DisplayName == "MIGUEL DE LEON, JR." &&
      miguelEmployee.DleWorkforceStatus == "CURRENT" &&
      miguelEmployee.ProvisioningStatus == "ACTIVE" &&
      miguelEmployee.ProposedUserName == "miguel" &&
      miguelEmployee.DleOsUserName == "Miguel" && miguelEmployee.HasDleOsAccess,
    "0054 is explicitly linked to the existing active Miguel user");
Check(directory.Items.Where(item => item.EmployeeNumber is not ("0001" or "0054"))
        .All(item => item.DleWorkforceStatus == "CURRENT" &&
                     item.ProvisioningStatus == "NOT_PROVISIONED" &&
                     item.DleOsUserName is null && item.TrainingEligible),
    "all other current employees are training-eligible and unprovisioned");
Check(directory.Items.Where(item => item.DleWorkforceStatus == "CURRENT")
        .All(item => !string.IsNullOrWhiteSpace(item.ProposedUserName)),
    "all current employees have reviewable username proposals");

var resolver = new SqlIdentityResolver(connectionString);
var miguelUser = await resolver.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Miguel")
    ?? throw new Exception("Miguel did not resolve.");
Check(EmployeeDirectoryAuthorization.CanAdminister(
        new CurrentUserResolution(CurrentUserStatus.Active, @"DLE-OS-HOST\Miguel", miguelUser)),
    "active SUPER_ADMIN can administer the Employee Directory");
var ordinary = new ResolvedSecurityUser(Guid.NewGuid(), "Ordinary", "Ordinary User", "ACTIVE", [],
    new HashSet<string>(StringComparer.Ordinal));
Check(!EmployeeDirectoryAuthorization.CanAdminister(
        new CurrentUserResolution(CurrentUserStatus.Active, @"DLE-OS-HOST\Ordinary", ordinary)),
    "active non-SUPER_ADMIN cannot administer the Employee Directory");

var publicFields = typeof(EmployeeDirectoryItem).GetProperties(BindingFlags.Public | BindingFlags.Instance)
    .Select(property => property.Name).ToHashSet(StringComparer.Ordinal);
var prohibitedTokens = new[] { "Pay", "Salary", "Ssn", "Tax", "Bank", "Address", "Medical", "Password", "Pin" };
Check(prohibitedTokens.All(token => publicFields.All(field => !field.Contains(token, StringComparison.OrdinalIgnoreCase))),
    "Employee Directory API contract exposes no payroll, credential, or private-HR fields");

await TransactionalSyncQualification();
await HttpQualification();

var report = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    database = boundary.InitialCatalog,
    checks,
    population = new
    {
        directory.TotalEmployees,
        directory.CurrentEmployees,
        directory.HistoricalRetainedEmployees,
        directory.ReviewEmployees,
        directory.LinkedUsers,
        directory.UnprovisionedEmployees
    }
};
var output = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", "employee-directory", "phase52b-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(report,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} Employee Directory checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

async Task TransactionalSyncQualification()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
    var before = await EmployeeIds(connection, transaction);
    var rows = await SourceRows(connection, transaction);
    await ExecuteSync(connection, transaction, rows, miguelUser.UserId, "QUALIFICATION_REPEAT");
    var after = await EmployeeIds(connection, transaction);
    Check(before.Count == after.Count && before.All(pair => after[pair.Key] == pair.Value),
        "duplicate sync preserves EmployeeId and creates no duplicates");

    await using (var proposal = new SqlCommand(
        "UPDATE hr.Employee SET ProvisioningStatus='PROPOSED' WHERE SourceSystem='VPRO5_PRM01' AND SourceEmployeeIdRaw='006300000';",
        connection, transaction))
        await proposal.ExecuteNonQueryAsync();
    await ExecuteSync(connection, transaction, rows, miguelUser.UserId, "QUALIFICATION_PRESERVE_DECISION");
    await using (var proposalCheck = new SqlCommand(
        "SELECT ProvisioningStatus FROM hr.Employee WHERE SourceSystem='VPRO5_PRM01' AND SourceEmployeeIdRaw='006300000';",
        connection, transaction))
        Check((string?)await proposalCheck.ExecuteScalarAsync() == "PROPOSED",
            "repeat sync preserves an existing provisioning decision");

    var missingRows = rows.Where(row => row.SourceEmployeeIdRaw != "009100000").ToArray();
    await ExecuteSync(connection, transaction, missingRows, miguelUser.UserId, "QUALIFICATION_MISSING_SOURCE");
    await using (var missingCheck = new SqlCommand(
        "SELECT DleWorkforceStatus,MissingFromSource,SourceReviewReason FROM hr.Employee " +
        "WHERE SourceSystem='VPRO5_PRM01' AND SourceEmployeeIdRaw='009100000';",
        connection, transaction))
    await using (var reader = await missingCheck.ExecuteReaderAsync())
    {
        Check(await reader.ReadAsync() && reader.GetString(0) == "SOURCE_REVIEW" &&
              reader.GetBoolean(1) && reader.GetString(2) == "MISSING_FROM_SOURCE",
            "employee omitted by a source pass is retained and marked SOURCE_REVIEW");
    }

    var invalidRows = rows.Concat(new[]
    {
        new SourceRow("01","ABCD12345","INVALID","SOURCE","INVALID SOURCE FORMAT",
            "99","Review","99","Review","ACTIVE","invalid.source")
    }).ToArray();
    await ExecuteSync(connection, transaction, invalidRows, miguelUser.UserId, "QUALIFICATION_INVALID_RAW");
    await using (var command = new SqlCommand(
        "SELECT EmployeeNumber,DleWorkforceStatus,SourceReviewReason FROM hr.Employee " +
        "WHERE SourceSystem='VPRO5_PRM01' AND FirmId='01' AND SourceEmployeeIdRaw='ABCD12345';",
        connection, transaction))
    await using (var reader = await command.ExecuteReaderAsync())
    {
        Check(await reader.ReadAsync() && reader.IsDBNull(0) && reader.GetString(1) == "SOURCE_REVIEW" &&
              reader.GetString(2) == "INVALID_RAW_EMPLOYEE_ID",
            "invalid raw employee key is retained exactly and routed to SOURCE_REVIEW");
    }

    var otherEmployee = directory.Items.Single(item => item.EmployeeNumber == "0063").EmployeeId;
    try
    {
        await using var duplicateLink = new SqlCommand(
            "INSERT security.UserEmployeeLink(UserEmployeeLinkId,UserId,EmployeeId,IsActive," +
            "LinkEvidenceCode,LinkedByUserId) VALUES(NEWID(),@UserId,@EmployeeId,1,'QUALIFICATION',@UserId);",
            connection, transaction);
        duplicateLink.Parameters.AddWithValue("@UserId", miguelUser.UserId);
        duplicateLink.Parameters.AddWithValue("@EmployeeId", otherEmployee);
        await duplicateLink.ExecuteNonQueryAsync();
        throw new Exception("FAILED: employee/user one-to-one constraint");
    }
    catch (SqlException error) when (error.Number is 2601 or 2627)
    {
        checks.Add("employee/user active one-to-one link is enforced by a unique constraint");
    }
    await transaction.RollbackAsync();
}

async Task HttpQualification()
{
    using var authenticated = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
    {
        BaseAddress = new Uri("http://dle-os-host:5051"), Timeout = TimeSpan.FromSeconds(20)
    };
    using var response = await authenticated.GetAsync(
        "/api/development/employees/v1/directory?includeHistorical=true");
    var json = await response.Content.ReadAsStringAsync();
    Check(response.StatusCode == HttpStatusCode.OK, "Miguel can read the authenticated Employee Directory API");
    using var document = JsonDocument.Parse(json);
    Check(document.RootElement.GetProperty("totalEmployees").GetInt32() == 11 &&
          document.RootElement.GetProperty("items").GetArrayLength() == 11,
        "live Employee Directory API returns the complete safe population");
    var serialized = json.ToLowerInvariant();
    Check(!new[] { "salary", "ssn", "taxid", "bank", "password", "payrate" }
        .Any(token => serialized.Contains(token, StringComparison.Ordinal)),
        "live Employee Directory response contains no sensitive field names");

    using var anonymous = new HttpClient(new HttpClientHandler { UseDefaultCredentials = false })
    {
        BaseAddress = authenticated.BaseAddress, Timeout = authenticated.Timeout
    };
    using var denied = await anonymous.GetAsync("/api/development/employees/v1/directory");
    Check(denied.StatusCode == HttpStatusCode.Unauthorized,
        "unauthenticated caller cannot access Employee Directory administration");
}

async Task<Dictionary<string,Guid>> EmployeeIds(SqlConnection connection, SqlTransaction transaction)
{
    var result = new Dictionary<string,Guid>(StringComparer.Ordinal);
    await using var command = new SqlCommand(
        "SELECT FirmId+'|'+SourceEmployeeIdRaw,EmployeeId FROM hr.Employee WHERE SourceSystem='VPRO5_PRM01';",
        connection, transaction);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) result[reader.GetString(0)] = reader.GetGuid(1);
    return result;
}

async Task<SourceRow[]> SourceRows(SqlConnection connection, SqlTransaction transaction)
{
    var result = new List<SourceRow>();
    await using var command = new SqlCommand(
        "SELECT FirmId,SourceEmployeeIdRaw,FirstName,LastName,DisplayName,DepartmentCode," +
        "DepartmentName,JobTitleCode,JobTitle,SourceEmploymentStatus,ProposedUserName " +
        "FROM hr.Employee WHERE SourceSystem='VPRO5_PRM01' ORDER BY SourceEmployeeIdRaw;",
        connection, transaction);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        result.Add(new SourceRow(reader.GetString(0),reader.GetString(1),reader.GetString(2),
            reader.GetString(3),reader.GetString(4),reader.IsDBNull(5)?null:reader.GetString(5),
            reader.IsDBNull(6)?null:reader.GetString(6),reader.IsDBNull(7)?null:reader.GetString(7),
            reader.IsDBNull(8)?null:reader.GetString(8),reader.GetString(9),
            reader.IsDBNull(10)?null:reader.GetString(10)));
    return result.ToArray();
}

async Task ExecuteSync(SqlConnection connection, SqlTransaction transaction, SourceRow[] rows,
    Guid miguelUserId, string qualification)
{
    await using var command = new SqlCommand("hr.usp_SyncEmployeeDirectory", connection, transaction)
    {
        CommandType = CommandType.StoredProcedure
    };
    command.Parameters.AddWithValue("@SourceSystem", "VPRO5_PRM01");
    command.Parameters.AddWithValue("@SourceQualificationRunId", qualification);
    command.Parameters.AddWithValue("@SourcePackageSha256", new string('A',64));
    command.Parameters.Add("@SourceRowsJson", SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(rows);
    command.Parameters.AddWithValue("@MiguelUserId", miguelUserId);
    command.Parameters.AddWithValue("@ExecutedBy", "QUALIFICATION");
    await command.ExecuteNonQueryAsync();
}

sealed record SourceRow(
    string FirmId,string SourceEmployeeIdRaw,string FirstName,string LastName,string DisplayName,
    string? DepartmentCode,string? DepartmentName,string? JobTitleCode,string? JobTitle,
    string EmployeeStatus,string? ProposedUserName);
