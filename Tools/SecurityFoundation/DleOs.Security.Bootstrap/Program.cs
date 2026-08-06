using System.Text.Json;
using System.Text.RegularExpressions;
using DleOs.Security;
using Microsoft.Data.SqlClient;

const string database = "DLE_OS_SECURITY_DEV";
const string connectionString =
    @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;" +
    "Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;";

if (!string.Equals(
    Environment.GetEnvironmentVariable("DLE_OS_SECURITY_DEVELOPMENT"),
    "true",
    StringComparison.Ordinal))
    throw new InvalidOperationException(
        "Set DLE_OS_SECURITY_DEVELOPMENT=true for the isolated development bootstrap.");

var builder = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(builder.InitialCatalog, database, StringComparison.Ordinal) ||
    builder.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase) ||
    !string.Equals(builder.DataSource, @"lpc:.\SQLEXPRESS", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The security bootstrap database boundary is invalid.");

var repository = Directory.GetCurrentDirectory();
var migrationPath = Path.Combine(
    repository,
    "Tools",
    "SecurityFoundation",
    "Database",
    "001_AddSecurityFoundation.sql");
if (!File.Exists(migrationPath))
    throw new FileNotFoundException("Security migration not found.", migrationPath);

var before = await Counts();
await using (var connection = new SqlConnection(connectionString))
{
    await connection.OpenAsync();
    var script = await File.ReadAllTextAsync(migrationPath);
    foreach (var batch in Regex.Split(script, @"(?im)^\s*GO\s*$"))
    {
        if (string.IsNullOrWhiteSpace(batch))
            continue;
        await using var command = new SqlCommand(batch, connection) { CommandTimeout = 60 };
        await command.ExecuteNonQueryAsync();
    }
}

var bootstrapper = new SecurityBootstrapper(connectionString, new CurrentWindowsIdentitySource());
var result = await bootstrapper.BootstrapMiguelAsync();
var after = await Counts();
var resolver = new SqlIdentityResolver(connectionString);
var resolved = await resolver.ResolveAsync("WINDOWS", SecurityBootstrapper.ExpectedIdentity)
    ?? throw new InvalidOperationException("Miguel did not resolve after bootstrap.");

var evidence = new
{
    verdict = "PASS",
    server = builder.DataSource,
    database,
    nonProductionEvidence = "Dedicated DLE_OS_SECURITY_DEV database; fixed guard rejects LIVE and all other catalogs.",
    executedBy = new CurrentWindowsIdentitySource().Name,
    completedAtUtc = DateTimeOffset.UtcNow,
    countsBefore = before,
    countsAfter = after,
    bootstrap = result,
    resolution = new
    {
        resolved.UserId,
        resolved.UserName,
        resolved.DisplayName,
        resolved.AccountStatus,
        roles = resolved.Roles.Select(role => role.RoleCode),
        resolved.IsSuperAdmin
    }
};
var evidenceDirectory = Path.Combine(repository, ".tmp", "security-foundation");
Directory.CreateDirectory(evidenceDirectory);
var evidencePath = Path.Combine(evidenceDirectory, "phase2-bootstrap.json");
await File.WriteAllTextAsync(
    evidencePath,
    JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine(JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));

async Task<Dictionary<string, long?>> Counts()
{
    var names = new[] { "User", "ExternalIdentity", "Role", "Permission", "UserRole", "RolePermission", "AuditEvent" };
    var counts = names.ToDictionary(name => name, _ => (long?)null, StringComparer.Ordinal);
    await using var connection = new SqlConnection(connectionString);
    try { await connection.OpenAsync(); }
    catch (SqlException) { return counts; }
    foreach (var name in names)
    {
        await using var exists = new SqlCommand(
            "SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id " +
            "WHERE s.name=N'security' AND t.name=@TableName;",
            connection);
        exists.Parameters.AddWithValue("@TableName", name);
        if (Convert.ToInt32(await exists.ExecuteScalarAsync()) == 0)
            continue;
        await using var count = new SqlCommand(
            "SELECT COUNT_BIG(*) FROM security.[" + name + "];",
            connection);
        counts[name] = Convert.ToInt64(await count.ExecuteScalarAsync());
    }
    return counts;
}
