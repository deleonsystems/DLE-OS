using Microsoft.Data.SqlClient;

// DEV-safe database projection shared by the Kitting case reader. The production
// filesystem assessment/backfill route remains in LegacyKittingMaterialStatusCenter
// and is intentionally not compiled into the DEV-only 5054 host.
internal sealed class LegacyKittingMaterialStatusRepository
{
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;

    internal async Task<LegacyKittingMaterialProjection?> GetAsync(string workOrder, CancellationToken token,
        SqlConnection? connection = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand("""
IF EXISTS (SELECT 1 FROM operational.KittingCase WHERE WorkOrderNumber=@WorkOrder)
  SELECT CAST(1 AS bit),NULL,NULL,NULL,NULL,NULL;
ELSE
  SELECT CAST(0 AS bit),MaterialStatus,EvidenceSource,ReconciliationClassification,
         BackfilledAtUtc,BackfilledBy
  FROM operational.LegacyKittingMaterialEvidence WHERE WorkOrderNumber=@WorkOrder;
""", connection);
            command.Parameters.AddWithValue("@WorkOrder", workOrder);
            await using var reader = await command.ExecuteReaderAsync(token);
            if (!await reader.ReadAsync(token)) return null;
            var hasPersistentHistory = reader.GetBoolean(0);
            return new(hasPersistentHistory,
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetDateTime(4),
                reader.IsDBNull(5) ? null : reader.GetString(5));
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }
}

internal sealed record LegacyKittingMaterialProjection(bool HasPersistentKittingHistory, string? MaterialStatus,
    string? EvidenceSource, string? ReconciliationClassification, DateTime? BackfilledAtUtc, string? BackfilledBy);
