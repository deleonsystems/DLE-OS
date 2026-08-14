using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class KittingCaseSchema
{
    internal static async Task EnsureAsync(CancellationToken token = default)
    {
        var configuredDatabase = new SqlConnectionStringBuilder(
            ControlHostRuntimeConfiguration.OperationalConnectionString).InitialCatalog;
        if (!string.Equals(configuredDatabase, "DLE_OS_OPERATIONAL_DEV", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Kitting Case migrations are restricted to DLE_OS_OPERATIONAL_DEV.");
        var migrationPaths = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "KittingCaseMigration.sql"),
            Path.Combine(AppContext.BaseDirectory, "KittingCaseRunMigration.sql"),
            Path.Combine(AppContext.BaseDirectory, "LegacyKittingMaterialEvidenceMigration.sql")
        };
        if (migrationPaths.Any(path => !File.Exists(path)))
            throw new InvalidOperationException("A governed Kitting Case migration is missing from the runtime.");

        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.OperationalConnectionString);
        await connection.OpenAsync(token);
        foreach (var migrationPath in migrationPaths)
        {
            var script = await File.ReadAllTextAsync(migrationPath, token);
            foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(batch)) continue;
                await using var command = new SqlCommand(batch, connection) { CommandTimeout = 60 };
                await command.ExecuteNonQueryAsync(token);
            }
        }
    }
}
