using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed record SimPageResult(
    int Page,
    int PageSize,
    int TotalItems,
    int TotalPages,
    bool HasPreviousPage,
    bool HasNextPage,
    bool HasMore,
    object[] Items,
    string Environment,
    long Generation);

internal sealed record SimWorkOrderVerifiedStatusEvent(
    Guid EventId,
    long EventSequence,
    string WorkOrderNumber,
    string StatusText,
    string? EvidenceSnapshotJson,
    string RecordedBy,
    DateTimeOffset RecordedAtUtc,
    DateTimeOffset CreatedAtUtc,
    Guid RequestCorrelationId);

internal sealed record SimVerifiedStatusAppendResult(
    bool Duplicate,
    SimWorkOrderVerifiedStatusEvent Record);

internal sealed class SimFaultInjectedException : Exception
{
    internal string Code { get; }

    internal SimFaultInjectedException(string code, string message) : base(message)
    {
        Code = code;
    }
}

internal sealed class SimVerifiedStatusProblem : Exception
{
    internal int StatusCode { get; }
    internal string Code { get; }

    private SimVerifiedStatusProblem(int statusCode, string code, string message) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    internal static SimVerifiedStatusProblem BadRequest(string code, string message) =>
        new(StatusCodes.Status400BadRequest, code, message);

    internal static SimVerifiedStatusProblem NotFound(string code, string message) =>
        new(StatusCodes.Status404NotFound, code, message);
}

internal sealed class SimOperationsDataStore
{
    internal const int DatabaseSchemaVersion = 4;
    internal const string FixtureRelativePath = "Tools/SimRuntime/Scenarios/baseline.operations-center.v1.json";

    private readonly string databasePath;
    private readonly string fixturePath;
    private readonly SemaphoreSlim gate = new(1, 1);

    internal SimOperationsDataStore(string repositoryRoot, string stateRoot)
    {
        databasePath = SimRuntimeOptions.ResolveStatePath(stateRoot, "data", "dle-os-sim.db");
        fixturePath = Path.GetFullPath(Path.Combine(repositoryRoot,
            FixtureRelativePath.Replace('/', Path.DirectorySeparatorChar)));
        SimRuntimeOptions.EnsureDescendant(repositoryRoot, fixturePath);
    }

    internal string DatabasePath => databasePath;
    internal bool IsHealthy { get; private set; }
    internal string? ErrorCode { get; private set; }
    internal string? ErrorMessage { get; private set; }

    internal async Task InitializeAsync(SimStateMetadata metadata)
    {
        try
        {
            if (!File.Exists(databasePath)) await RebuildAsync(metadata);
            else await ValidateAsync(metadata);
            MarkHealthy();
        }
        catch (Exception exception) when (exception is IOException or JsonException or SqliteException or InvalidOperationException)
        {
            MarkUnhealthy("DLE_OS_SIM_OPERATIONS_DATA_INVALID",
                "SIM Operations Center data is invalid or incompatible. Reset SIM to rebuild it. " + exception.Message);
        }
    }

    internal async Task RebuildAsync(SimStateMetadata metadata)
    {
        await gate.WaitAsync();
        try
        {
            var fixtureBytes = await File.ReadAllBytesAsync(fixturePath);
            var fixtureHash = Convert.ToHexString(SHA256.HashData(fixtureBytes));
            using var fixture = JsonDocument.Parse(fixtureBytes);
            ValidateFixture(fixture.RootElement, metadata);

            Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
            var temporaryPath = databasePath + ".reset-" + Guid.NewGuid().ToString("N");
            SimRuntimeOptions.EnsureDescendant(Path.GetDirectoryName(databasePath)!, temporaryPath);
            try
            {
                await CreateDatabaseAsync(temporaryPath, fixture.RootElement, metadata, fixtureHash);
                File.Move(temporaryPath, databasePath, true);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
            MarkHealthy();
        }
        catch (Exception exception) when (exception is IOException or JsonException or SqliteException or InvalidOperationException)
        {
            MarkUnhealthy("DLE_OS_SIM_OPERATIONS_DATA_REBUILD_FAILED",
                "SIM Operations Center data could not be rebuilt safely. " + exception.Message);
            throw new InvalidOperationException(ErrorMessage, exception);
        }
        finally
        {
            gate.Release();
        }
    }

    internal object StatusContract() => new
    {
        health = IsHealthy ? "READY" : "INVALID",
        code = ErrorCode,
        message = ErrorMessage,
        database = "data/dle-os-sim.db",
        schemaVersion = DatabaseSchemaVersion,
        fixture = FixtureRelativePath,
        externalProviders = Array.Empty<string>()
    };

    internal async Task<SimPageResult> ReadSalesOrderLinesAsync(IQueryCollection query, long generation)
    {
        EnsureHealthy();
        var paging = ParsePaging(query);
        var filters = new List<string>();
        var parameters = new List<SqliteParameter>();
        AddExact(query, filters, parameters, "customerNumber", "CustomerNumber");
        AddContains(query, filters, parameters, "customerName", "CustomerName");
        AddExact(query, filters, parameters, "salesOrderNumber", "SalesOrderNumber");
        AddContains(query, filters, parameters, "customerPurchaseOrderNumber", "CustomerPurchaseOrderNumber");
        AddTrimmedExact(query, filters, parameters, "itemNumber", "ItemNumber");
        AddExact(query, filters, parameters, "estimatedShipDate", "EstimatedShipDate");
        AddBoolean(query, filters, parameters, "negativeQuantity", "QuantityOrdered < 0");
        AddBoolean(query, filters, parameters, "unresolvedWorkOrder",
            "EXISTS (SELECT 1 FROM SalesOrderWorkOrderRelationship r WHERE r.CustomerNumber=SalesOrderLine.CustomerNumber AND r.SalesOrderNumber=SalesOrderLine.SalesOrderNumber AND r.SalesOrderLineNumber=SalesOrderLine.LineNumber AND r.ResolutionStatus='UNRESOLVED')");
        if (TryValue(query, "workOrderNumber", out var workOrder))
        {
            filters.Add("EXISTS (SELECT 1 FROM SalesOrderWorkOrderRelationship r LEFT JOIN RelationshipCandidate c ON c.CustomerNumber=r.CustomerNumber AND c.SalesOrderNumber=r.SalesOrderNumber AND c.SalesOrderLineNumber=r.SalesOrderLineNumber WHERE r.CustomerNumber=SalesOrderLine.CustomerNumber AND r.SalesOrderNumber=SalesOrderLine.SalesOrderNumber AND r.SalesOrderLineNumber=SalesOrderLine.LineNumber AND (r.ActionableWorkOrderNumber=@workOrderNumber OR c.WorkOrderNumber=@workOrderNumber))");
            parameters.Add(new("@workOrderNumber", workOrder));
        }
        var page = await ReadPageAsync("SalesOrderLine", filters, parameters,
            "SalesOrderNumber, LineNumber", paging, generation);
        return await AddEmbeddedKittingProjectionsAsync(page);
    }

    internal async Task<SimPageResult> ReadWorkOrdersAsync(IQueryCollection query, long generation)
    {
        EnsureHealthy();
        var paging = ParsePaging(query);
        var filters = new List<string>();
        var parameters = new List<SqliteParameter>();
        AddExact(query, filters, parameters, "workOrderNumber", "WorkOrderNumber");
        AddTrimmedExact(query, filters, parameters, "itemNumber", "ItemNumber");
        AddExact(query, filters, parameters, "status", "WorkOrderStatus");
        return await ReadPageAsync("WorkOrder", filters, parameters,
            "WorkOrderNumber", paging, generation);
    }

    internal async Task<SimPageResult> ReadRelationshipsAsync(IQueryCollection query, long generation)
    {
        EnsureHealthy();
        var paging = ParsePaging(query);
        var filters = new List<string>();
        var parameters = new List<SqliteParameter>();
        AddExact(query, filters, parameters, "customerNumber", "CustomerNumber");
        AddExact(query, filters, parameters, "salesOrderNumber", "SalesOrderNumber");
        AddExact(query, filters, parameters, "salesOrderLineNumber", "SalesOrderLineNumber");
        if (TryValue(query, "workOrderNumber", out var workOrder))
        {
            filters.Add("(ActionableWorkOrderNumber=@workOrderNumber OR EXISTS (SELECT 1 FROM RelationshipCandidate c WHERE c.CustomerNumber=SalesOrderWorkOrderRelationship.CustomerNumber AND c.SalesOrderNumber=SalesOrderWorkOrderRelationship.SalesOrderNumber AND c.SalesOrderLineNumber=SalesOrderWorkOrderRelationship.SalesOrderLineNumber AND c.WorkOrderNumber=@workOrderNumber))");
            parameters.Add(new("@workOrderNumber", workOrder));
        }
        return await ReadRelationshipPageAsync(filters, parameters, paging, generation);
    }

    internal async Task<SimPageResult> ReadInvoiceHistoryAsync(IQueryCollection query, long generation)
    {
        EnsureHealthy();
        var paging = ParsePaging(query);
        var filters = new List<string>();
        var parameters = new List<SqliteParameter>();
        AddDateBoundary(query, filters, parameters, "invoiceDateFrom", "InvoiceDate", ">=");
        AddDateBoundary(query, filters, parameters, "invoiceDateTo", "InvoiceDate", "<=");
        AddExact(query, filters, parameters, "customerNumber", "CustomerNumber");
        AddExact(query, filters, parameters, "invoiceNumber", "InvoiceNumber");
        AddExact(query, filters, parameters, "salesOrderNumber", "SalesOrderNumber");
        AddTrimmedExact(query, filters, parameters, "itemNumber", "ItemNumber");
        AddExact(query, filters, parameters, "workOrderNumber", "WorkOrderNumber");
        return await ReadPageAsync("InvoiceHistoryLine", filters, parameters,
            "InvoiceDate DESC, InvoiceNumber DESC, InvoiceLineNumber", paging, generation);
    }

    internal async Task<object> ReadInvoiceHistoryMetadataAsync(long generation)
    {
        EnsureHealthy();
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT PayloadJson FROM InvoiceHistoryMetadata LIMIT 1;";
        var value = await command.ExecuteScalarAsync();
        if (value is not string json)
            throw new InvalidOperationException("Invoice History metadata is missing.");
        var metadata = JsonSerializer.Deserialize<Dictionary<string, object?>>(json)!;
        metadata["environment"] = "SIM";
        metadata["generation"] = generation;
        return metadata;
    }

    internal async Task<object?> ReadRecordAsync(string table, string identifierColumn, string identifier)
    {
        EnsureHealthy();
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = $"SELECT PayloadJson FROM {table} WHERE {identifierColumn}=@identifier LIMIT 1;";
        command.Parameters.AddWithValue("@identifier", identifier);
        var value = await command.ExecuteScalarAsync();
        return value is string json ? ParseObject(json) : null;
    }

    internal async Task<object?> ReadKittingCaseAsync(string workOrderNumber, long generation)
    {
        EnsureHealthy();
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT PayloadJson FROM KittingReadState WHERE WorkOrderNumber=@workOrder LIMIT 1;";
        command.Parameters.AddWithValue("@workOrder", workOrderNumber);
        var value = await command.ExecuteScalarAsync();
        if (value is not string json) return null;
        using var document = JsonDocument.Parse(json);
        var materialStatus = document.RootElement.GetProperty("materialStatus");
        var kittingCase = materialStatus.GetProperty("kittingCase");
        return new
        {
            workOrderNumber,
            kittingCase = kittingCase.ValueKind == JsonValueKind.Null
                ? null : JsonSerializer.Deserialize<object>(kittingCase.GetRawText()),
            legacyMaterialStatus = (object?)null,
            hasPersistentKittingHistory = materialStatus.GetProperty("hasPersistentKittingHistory").GetBoolean(),
            readOnly = true,
            synthetic = true,
            environment = "SIM",
            generation
        };
    }

    internal async Task<object> ReadWorkOrderVerifiedStatusLatestAsync(IEnumerable<string>? workOrderNumbers)
    {
        EnsureHealthy();
        var normalized = (workOrderNumbers ?? []).Select(NormalizeWorkOrderNumber)
            .Distinct(StringComparer.Ordinal).Take(500).ToArray();
        if (normalized.Length == 0) return new { records = Array.Empty<SimWorkOrderVerifiedStatusEvent>() };
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var placeholders = normalized.Select((_, index) => "@workOrder" + index).ToArray();
        var command = connection.CreateCommand();
        command.CommandText = $"""
WITH Ranked AS (
  SELECT *,ROW_NUMBER() OVER(PARTITION BY WorkOrderNumber ORDER BY EventSequence DESC) AS CurrentRank
  FROM WorkOrderVerifiedStatusEvent
  WHERE WorkOrderNumber IN ({string.Join(',', placeholders)})
)
SELECT EventId,EventSequence,WorkOrderNumber,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM Ranked WHERE CurrentRank=1 ORDER BY EventSequence DESC;
""";
        for (var index = 0; index < normalized.Length; index++)
            command.Parameters.AddWithValue(placeholders[index], normalized[index]);
        return new { records = await ReadVerifiedStatusEventsAsync(command) };
    }

    internal async Task<object> ReadWorkOrderVerifiedStatusHistoryAsync(string workOrderNumber)
    {
        EnsureHealthy();
        var normalized = NormalizeWorkOrderNumber(workOrderNumber);
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
SELECT EventId,EventSequence,WorkOrderNumber,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM WorkOrderVerifiedStatusEvent WHERE WorkOrderNumber=@workOrder
ORDER BY EventSequence DESC LIMIT 100;
""";
        command.Parameters.AddWithValue("@workOrder", normalized);
        return new { workOrderNumber = normalized, records = await ReadVerifiedStatusEventsAsync(command) };
    }

    internal async Task<SimVerifiedStatusAppendResult> AppendWorkOrderVerifiedStatusAsync(string workOrderNumber,
        SimWorkOrderVerifiedStatusAppendRequest request, SimPersona actor, SimStateMetadata metadata,
        Func<bool>? failBeforeCommit = null)
    {
        EnsureHealthy();
        var normalized = NormalizeWorkOrderNumber(workOrderNumber);
        var status = (request.StatusText ?? "").Trim();
        if (status.Length is < 1 or > 1000)
            throw SimVerifiedStatusProblem.BadRequest("verified_status_text_required",
                "Last Verified Status text is required and must be 1,000 characters or less.");

        await gate.WaitAsync();
        try
        {
            await using var connection = OpenReadWrite();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            if (request.RequestCorrelationId is { } supplied && supplied != Guid.Empty)
            {
                var existing = await ReadVerifiedStatusByCorrelationAsync(connection,
                    (SqliteTransaction)transaction, supplied);
                if (existing is not null)
                {
                    await transaction.CommitAsync();
                    return new SimVerifiedStatusAppendResult(true, existing);
                }
            }

            var exists = connection.CreateCommand();
            exists.Transaction = (SqliteTransaction)transaction;
            exists.CommandText = "SELECT COUNT(*) FROM WorkOrder WHERE WorkOrderNumber=@workOrder;";
            exists.Parameters.AddWithValue("@workOrder", normalized);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture) != 1)
                throw SimVerifiedStatusProblem.NotFound("work_order_not_found",
                    "The requested Work Order does not exist in the active SIM scenario.");

            if (failBeforeCommit?.Invoke() == true)
                throw new SimFaultInjectedException("DLE_OS_SIM_VERIFIED_STATUS_WRITE_UNAVAILABLE",
                    "The Verified Status store is intentionally unavailable before commit under the active SIM fault profile.");

            var sequenceCommand = connection.CreateCommand();
            sequenceCommand.Transaction = (SqliteTransaction)transaction;
            sequenceCommand.CommandText = "SELECT COALESCE(MAX(EventSequence),0)+1 FROM WorkOrderVerifiedStatusEvent;";
            var sequence = Convert.ToInt64(await sequenceCommand.ExecuteScalarAsync(),
                System.Globalization.CultureInfo.InvariantCulture);
            var previousCommand = connection.CreateCommand();
            previousCommand.Transaction = (SqliteTransaction)transaction;
            previousCommand.CommandText = "SELECT StatusText FROM WorkOrderVerifiedStatusEvent WHERE WorkOrderNumber=@workOrder ORDER BY EventSequence DESC LIMIT 1;";
            previousCommand.Parameters.AddWithValue("@workOrder", normalized);
            var previous = (await previousCommand.ExecuteScalarAsync()) as string;
            var correlation = request.RequestCorrelationId is { } requested && requested != Guid.Empty
                ? requested : DeterministicGuid($"correlation|{metadata.Generation}|{sequence}|{normalized}");
            var eventId = DeterministicGuid($"event|{metadata.Generation}|{sequence}|{normalized}");
            var recordedAt = metadata.DeterministicClockStartUtc.AddMinutes(sequence);
            var evidenceJson = JsonSerializer.Serialize(
                request.EvidenceSnapshot ?? new Dictionary<string, object?>());

            var insert = connection.CreateCommand();
            insert.Transaction = (SqliteTransaction)transaction;
            insert.CommandText = """
INSERT INTO WorkOrderVerifiedStatusEvent
 (EventId,EventSequence,WorkOrderNumber,PreviousStatusText,StatusText,EvidenceSnapshotJson,
  RecordedBy,PersonaId,RecordedAtUtc,CreatedAtUtc,RequestCorrelationId,StateGeneration,ScenarioId)
VALUES
 (@eventId,@sequence,@workOrder,@previous,@status,@evidence,@recordedBy,@persona,
  @recordedAt,@createdAt,@correlation,@generation,@scenario);
""";
            insert.Parameters.AddWithValue("@eventId", eventId.ToString());
            insert.Parameters.AddWithValue("@sequence", sequence);
            insert.Parameters.AddWithValue("@workOrder", normalized);
            insert.Parameters.AddWithValue("@previous", previous is null ? DBNull.Value : previous);
            insert.Parameters.AddWithValue("@status", status);
            insert.Parameters.AddWithValue("@evidence", evidenceJson);
            insert.Parameters.AddWithValue("@recordedBy", actor.UserName);
            insert.Parameters.AddWithValue("@persona", actor.Id);
            insert.Parameters.AddWithValue("@recordedAt", recordedAt.ToString("O"));
            insert.Parameters.AddWithValue("@createdAt", recordedAt.ToString("O"));
            insert.Parameters.AddWithValue("@correlation", correlation.ToString());
            insert.Parameters.AddWithValue("@generation", metadata.Generation);
            insert.Parameters.AddWithValue("@scenario", metadata.ScenarioId);
            await insert.ExecuteNonQueryAsync();

            var record = new SimWorkOrderVerifiedStatusEvent(eventId, sequence, normalized, status,
                evidenceJson, actor.UserName, recordedAt, recordedAt, correlation);
            await transaction.CommitAsync();
            return new SimVerifiedStatusAppendResult(false, record);
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<SimWorkOrderVerifiedStatusEvent?> ReadVerifiedStatusByCorrelationAsync(
        SqliteConnection connection, SqliteTransaction transaction, Guid correlation)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
SELECT EventId,EventSequence,WorkOrderNumber,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM WorkOrderVerifiedStatusEvent WHERE RequestCorrelationId=@correlation LIMIT 1;
""";
        command.Parameters.AddWithValue("@correlation", correlation.ToString());
        return (await ReadVerifiedStatusEventsAsync(command)).SingleOrDefault();
    }

    private static async Task<List<SimWorkOrderVerifiedStatusEvent>> ReadVerifiedStatusEventsAsync(
        SqliteCommand command)
    {
        var records = new List<SimWorkOrderVerifiedStatusEvent>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            records.Add(new SimWorkOrderVerifiedStatusEvent(
                Guid.Parse(reader.GetString(0)), reader.GetInt64(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetString(5),
                DateTimeOffset.Parse(reader.GetString(6), System.Globalization.CultureInfo.InvariantCulture),
                DateTimeOffset.Parse(reader.GetString(7), System.Globalization.CultureInfo.InvariantCulture),
                Guid.Parse(reader.GetString(8))));
        return records;
    }

    private static string NormalizeWorkOrderNumber(string value)
    {
        var text = Convert.ToString(value ?? "")!.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(text, "^[0-9]{1,7}$"))
            throw SimVerifiedStatusProblem.BadRequest("work_order_number_malformed",
                "Work Order number is malformed.");
        return text.PadLeft(7, '0');
    }

    private static Guid DeterministicGuid(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes[..16]);
    }

    private async Task<SimPageResult> AddEmbeddedKittingProjectionsAsync(SimPageResult page)
    {
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        foreach (var item in page.Items.Cast<Dictionary<string, object?>>())
        {
            var customer = item["customerNumber"]?.ToString() ?? "";
            var salesOrder = item["salesOrderNumber"]?.ToString() ?? "";
            var line = item["lineNumber"]?.ToString() ?? "";
            var command = connection.CreateCommand();
            command.CommandText = """
SELECT r.ActionableWorkOrderNumber,k.PayloadJson
FROM SalesOrderWorkOrderRelationship r
LEFT JOIN KittingReadState k ON k.WorkOrderNumber=r.ActionableWorkOrderNumber
WHERE r.CustomerNumber=@customer AND r.SalesOrderNumber=@salesOrder
  AND r.SalesOrderLineNumber=@line AND r.ResolutionStatus='EXACT_LINE_UNIQUE'
LIMIT 1;
""";
            command.Parameters.AddWithValue("@customer", customer);
            command.Parameters.AddWithValue("@salesOrder", salesOrder);
            command.Parameters.AddWithValue("@line", line);
            await using var reader = await command.ExecuteReaderAsync();
            item["rmaReworkMembership"] = null;
            item["workOrderApprovalReview"] = null;
            if (await reader.ReadAsync() && !reader.IsDBNull(0) && !reader.IsDBNull(1))
            {
                var workOrder = reader.GetString(0);
                using var document = JsonDocument.Parse(reader.GetString(1));
                item["materialStatusWorkOrderNumber"] = workOrder;
                item["materialStatus"] = JsonSerializer.Deserialize<object>(
                    document.RootElement.GetProperty("materialStatus").GetRawText());
            }
            else
            {
                item["materialStatusWorkOrderNumber"] = "";
                item["materialStatus"] = null;
            }
        }
        return page;
    }

    private async Task<SimPageResult> ReadPageAsync(string table, List<string> filters,
        List<SqliteParameter> parameters, string orderBy, (int Page, int PageSize) paging, long generation)
    {
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var where = filters.Count == 0 ? "" : " WHERE " + string.Join(" AND ", filters);
        var total = await CountAsync(connection, table, where, parameters);
        var command = connection.CreateCommand();
        command.CommandText = $"SELECT PayloadJson FROM {table}{where} ORDER BY {orderBy} LIMIT @limit OFFSET @offset;";
        foreach (var parameter in parameters) command.Parameters.Add(new(parameter.ParameterName, parameter.Value));
        command.Parameters.AddWithValue("@limit", paging.PageSize);
        command.Parameters.AddWithValue("@offset", (paging.Page - 1) * paging.PageSize);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) items.Add(ParseObject(reader.GetString(0)));
        return Page(paging, total, items.ToArray(), generation);
    }

    private async Task<SimPageResult> ReadRelationshipPageAsync(List<string> filters,
        List<SqliteParameter> parameters, (int Page, int PageSize) paging, long generation)
    {
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var where = filters.Count == 0 ? "" : " WHERE " + string.Join(" AND ", filters);
        var total = await CountAsync(connection, "SalesOrderWorkOrderRelationship", where, parameters);
        var command = connection.CreateCommand();
        command.CommandText = $"SELECT PayloadJson,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber FROM SalesOrderWorkOrderRelationship{where} ORDER BY SalesOrderNumber,SalesOrderLineNumber LIMIT @limit OFFSET @offset;";
        foreach (var parameter in parameters) command.Parameters.Add(new(parameter.ParameterName, parameter.Value));
        command.Parameters.AddWithValue("@limit", paging.PageSize);
        command.Parameters.AddWithValue("@offset", (paging.Page - 1) * paging.PageSize);
        var rows = new List<(string Json, string Customer, string SalesOrder, string Line)>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                rows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        }
        var items = new List<object>();
        foreach (var row in rows)
        {
            var relationship = JsonSerializer.Deserialize<Dictionary<string, object?>>(row.Json)!;
            var candidates = await ReadCandidatesAsync(connection, row.Customer, row.SalesOrder, row.Line);
            relationship["candidateCount"] = candidates.Length;
            relationship["candidates"] = candidates;
            items.Add(relationship);
        }
        return Page(paging, total, items.ToArray(), generation);
    }

    private static async Task<object[]> ReadCandidatesAsync(SqliteConnection connection,
        string customer, string salesOrder, string line)
    {
        var command = connection.CreateCommand();
        command.CommandText = "SELECT PayloadJson FROM RelationshipCandidate WHERE CustomerNumber=@customer AND SalesOrderNumber=@salesOrder AND SalesOrderLineNumber=@line ORDER BY CandidateOrdinal;";
        command.Parameters.AddWithValue("@customer", customer);
        command.Parameters.AddWithValue("@salesOrder", salesOrder);
        command.Parameters.AddWithValue("@line", line);
        var values = new List<object>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) values.Add(ParseObject(reader.GetString(0)));
        return values.ToArray();
    }

    private static async Task<int> CountAsync(SqliteConnection connection, string table,
        string where, List<SqliteParameter> parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {table}{where};";
        foreach (var parameter in parameters) command.Parameters.Add(new(parameter.ParameterName, parameter.Value));
        return Convert.ToInt32(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static SimPageResult Page((int Page, int PageSize) paging, int total,
        object[] items, long generation)
    {
        var pages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)paging.PageSize);
        var hasNext = paging.Page < pages;
        return new(paging.Page, paging.PageSize, total, pages, paging.Page > 1, hasNext, hasNext,
            items, "SIM", generation);
    }

    private async Task ValidateAsync(SimStateMetadata metadata)
    {
        var fixtureHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(fixturePath)));
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT ScenarioId,ScenarioVersion,StateGeneration,SchemaVersion,FixtureSha256 FROM SimDatabaseMetadata LIMIT 1;";
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync() || reader.GetString(0) != metadata.ScenarioId ||
            reader.GetInt32(1) != metadata.ScenarioVersion || reader.GetInt64(2) != metadata.Generation ||
            reader.GetInt32(3) != DatabaseSchemaVersion || reader.GetString(4) != fixtureHash)
            throw new InvalidOperationException("SQLite metadata does not match the active SIM generation.");
    }

    private async Task CreateDatabaseAsync(string path, JsonElement fixture,
        SimStateMetadata metadata, string fixtureHash)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false
        }.ToString();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        var schema = connection.CreateCommand();
        schema.CommandText = """
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=DELETE;
PRAGMA user_version=4;
CREATE TABLE SimDatabaseMetadata(ScenarioId TEXT NOT NULL,ScenarioVersion INTEGER NOT NULL,StateGeneration INTEGER NOT NULL,SchemaVersion INTEGER NOT NULL,FixtureSha256 TEXT NOT NULL);
CREATE TABLE SalesOrderLine(SalesOrderLineId TEXT PRIMARY KEY,CustomerNumber TEXT NOT NULL,CustomerName TEXT NOT NULL,CustomerPurchaseOrderNumber TEXT NOT NULL,SalesOrderNumber TEXT NOT NULL,LineNumber TEXT NOT NULL,ItemNumber TEXT NOT NULL,EstimatedShipDate TEXT NOT NULL,QuantityOrdered REAL NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(CustomerNumber,SalesOrderNumber,LineNumber));
CREATE TABLE WorkOrder(WorkOrderNumber TEXT PRIMARY KEY,ItemNumber TEXT NOT NULL,WorkOrderStatus TEXT NOT NULL,PayloadJson TEXT NOT NULL);
CREATE TABLE KittingReadState(KittingReadStateId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL UNIQUE,MachineValue TEXT NOT NULL,PayloadJson TEXT NOT NULL,FOREIGN KEY(WorkOrderNumber) REFERENCES WorkOrder(WorkOrderNumber));
CREATE TABLE WorkOrderVerifiedStatusEvent(EventId TEXT PRIMARY KEY,EventSequence INTEGER NOT NULL UNIQUE,WorkOrderNumber TEXT NOT NULL,PreviousStatusText TEXT NULL,StatusText TEXT NOT NULL,EvidenceSnapshotJson TEXT NULL,RecordedBy TEXT NOT NULL,PersonaId TEXT NOT NULL,RecordedAtUtc TEXT NOT NULL,CreatedAtUtc TEXT NOT NULL,RequestCorrelationId TEXT NOT NULL UNIQUE,StateGeneration INTEGER NOT NULL,ScenarioId TEXT NOT NULL,FOREIGN KEY(WorkOrderNumber) REFERENCES WorkOrder(WorkOrderNumber),CHECK(length(trim(StatusText)) BETWEEN 1 AND 1000));
CREATE TABLE SalesOrderWorkOrderRelationship(CustomerNumber TEXT NOT NULL,SalesOrderNumber TEXT NOT NULL,SalesOrderLineNumber TEXT NOT NULL,ResolutionStatus TEXT NOT NULL,ActionableWorkOrderNumber TEXT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber),FOREIGN KEY(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber) REFERENCES SalesOrderLine(CustomerNumber,SalesOrderNumber,LineNumber));
CREATE TABLE RelationshipCandidate(CustomerNumber TEXT NOT NULL,SalesOrderNumber TEXT NOT NULL,SalesOrderLineNumber TEXT NOT NULL,CandidateOrdinal INTEGER NOT NULL,WorkOrderNumber TEXT NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,CandidateOrdinal),FOREIGN KEY(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber) REFERENCES SalesOrderWorkOrderRelationship(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber),FOREIGN KEY(WorkOrderNumber) REFERENCES WorkOrder(WorkOrderNumber));
CREATE TABLE InvoiceHeader(FirmId TEXT NOT NULL,ArType TEXT NOT NULL,CustomerNumber TEXT NOT NULL,InvoiceNumber TEXT NOT NULL,InvoiceDate TEXT NOT NULL,CustomerName TEXT NOT NULL,AccountsReceivablePurchaseOrderNumber TEXT NOT NULL,SalesOrderNumber TEXT NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(FirmId,ArType,CustomerNumber,InvoiceNumber));
CREATE TABLE InvoiceHistoryLine(InvoiceHistoryLineId TEXT PRIMARY KEY,FirmId TEXT NOT NULL,ArType TEXT NOT NULL,CustomerNumber TEXT NOT NULL,InvoiceNumber TEXT NOT NULL,InvoiceLineNumber TEXT NOT NULL,InvoiceDate TEXT NOT NULL,SalesOrderNumber TEXT NOT NULL,SalesOrderLineNumber TEXT NOT NULL,ItemNumber TEXT NOT NULL,WorkOrderNumber TEXT NULL,QuantityShipped TEXT NOT NULL,UnitPrice TEXT NOT NULL,ExtendedPrice TEXT NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber),FOREIGN KEY(FirmId,ArType,CustomerNumber,InvoiceNumber) REFERENCES InvoiceHeader(FirmId,ArType,CustomerNumber,InvoiceNumber));
CREATE TABLE InvoiceHistoryMetadata(Id INTEGER PRIMARY KEY CHECK(Id=1),PayloadJson TEXT NOT NULL);
CREATE INDEX IX_SalesOrderLine_Order ON SalesOrderLine(SalesOrderNumber,LineNumber);
CREATE INDEX IX_SalesOrderLine_Customer ON SalesOrderLine(CustomerNumber);
CREATE INDEX IX_WorkOrder_ItemStatus ON WorkOrder(ItemNumber,WorkOrderStatus);
CREATE INDEX IX_WorkOrderVerifiedStatusEvent_WorkOrder ON WorkOrderVerifiedStatusEvent(WorkOrderNumber,EventSequence DESC);
CREATE INDEX IX_Relationship_ActionableWorkOrder ON SalesOrderWorkOrderRelationship(ActionableWorkOrderNumber);
CREATE INDEX IX_InvoiceHistoryLine_Date ON InvoiceHistoryLine(InvoiceDate DESC,InvoiceNumber DESC,InvoiceLineNumber);
CREATE INDEX IX_InvoiceHistoryLine_CustomerInvoice ON InvoiceHistoryLine(CustomerNumber,InvoiceNumber);
CREATE INDEX IX_InvoiceHistoryLine_SalesOrder ON InvoiceHistoryLine(SalesOrderNumber);
CREATE INDEX IX_InvoiceHistoryLine_ItemWorkOrder ON InvoiceHistoryLine(ItemNumber,WorkOrderNumber);
""";
        await schema.ExecuteNonQueryAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteAsync(connection, transaction,
            "INSERT INTO SimDatabaseMetadata VALUES(@scenario,@scenarioVersion,@generation,@schemaVersion,@hash);",
            ("@scenario", metadata.ScenarioId), ("@scenarioVersion", metadata.ScenarioVersion),
            ("@generation", metadata.Generation), ("@schemaVersion", DatabaseSchemaVersion), ("@hash", fixtureHash));

        foreach (var item in fixture.GetProperty("salesOrderLines").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO SalesOrderLine VALUES(@id,@customer,@customerName,@po,@order,@line,@item,@shipDate,@quantity,@json);",
                ("@id", Text(item,"salesOrderLineId")), ("@customer",Text(item,"customerNumber")),
                ("@customerName",Text(item,"customerName")), ("@po",Text(item,"customerPurchaseOrderNumber")),
                ("@order",Text(item,"salesOrderNumber")), ("@line",Text(item,"lineNumber")),
                ("@item",Text(item,"itemNumber")), ("@shipDate",Text(item,"estimatedShipDate")),
                ("@quantity",item.GetProperty("quantityOrdered").GetDecimal()), ("@json",item.GetRawText()));

        foreach (var item in fixture.GetProperty("workOrders").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO WorkOrder VALUES(@number,@item,@status,@json);",
                ("@number",Text(item,"workOrderNumber")), ("@item",Text(item,"itemNumber")),
                ("@status",Text(item,"workOrderStatus")), ("@json",item.GetRawText()));

        foreach (var item in fixture.GetProperty("kittingReadStates").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO KittingReadState VALUES(@id,@workOrder,@state,@json);",
                ("@id",Text(item,"kittingReadStateId")), ("@workOrder",Text(item,"workOrderNumber")),
                ("@state",Text(item.GetProperty("materialStatus"),"machineValue")), ("@json",item.GetRawText()));

        foreach (var item in fixture.GetProperty("workOrderVerifiedStatusEvents").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO WorkOrderVerifiedStatusEvent VALUES(@eventId,@sequence,@workOrder,@previous,@status,@evidence,@recordedBy,@persona,@recordedAt,@createdAt,@correlation,@generation,@scenario);",
                ("@eventId",Text(item,"eventId")), ("@sequence",item.GetProperty("eventSequence").GetInt64()),
                ("@workOrder",Text(item,"workOrderNumber")), ("@previous",NullableText(item,"previousStatusText")),
                ("@status",Text(item,"statusText")), ("@evidence",item.GetProperty("evidenceSnapshot").GetRawText()),
                ("@recordedBy",Text(item,"recordedBy")), ("@persona",Text(item,"personaId")),
                ("@recordedAt",Text(item,"recordedAtUtc")), ("@createdAt",Text(item,"createdAtUtc")),
                ("@correlation",Text(item,"requestCorrelationId")), ("@generation",metadata.Generation),
                ("@scenario",metadata.ScenarioId));

        foreach (var relationship in fixture.GetProperty("relationships").EnumerateArray())
        {
            var customer = Text(relationship,"customerNumber");
            var order = Text(relationship,"salesOrderNumber");
            var line = Text(relationship,"salesOrderLineNumber");
            await ExecuteAsync(connection, transaction,
                "INSERT INTO SalesOrderWorkOrderRelationship VALUES(@customer,@order,@line,@status,@actionable,@json);",
                ("@customer",customer), ("@order",order), ("@line",line),
                ("@status",Text(relationship,"resolutionStatus")),
                ("@actionable",NullableText(relationship,"actionableWorkOrderNumber")),
                ("@json",relationship.GetRawText()));
            var ordinal = 0;
            foreach (var candidate in relationship.GetProperty("candidates").EnumerateArray())
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO RelationshipCandidate VALUES(@customer,@order,@line,@ordinal,@workOrder,@json);",
                    ("@customer",customer), ("@order",order), ("@line",line), ("@ordinal",ordinal++),
                    ("@workOrder",Text(candidate,"workOrderNumber")), ("@json",candidate.GetRawText()));
        }

        foreach (var item in fixture.GetProperty("invoiceHeaders").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO InvoiceHeader VALUES(@firm,@arType,@customer,@invoice,@date,@customerName,@po,@salesOrder,@json);",
                ("@firm",Text(item,"firmId")), ("@arType",Text(item,"arType")),
                ("@customer",Text(item,"customerNumber")), ("@invoice",Text(item,"invoiceNumber")),
                ("@date",Text(item,"invoiceDate")), ("@customerName",Text(item,"customerName")),
                ("@po",Text(item,"accountsReceivablePurchaseOrderNumber")),
                ("@salesOrder",Text(item,"salesOrderNumber")), ("@json",item.GetRawText()));

        foreach (var item in fixture.GetProperty("invoiceHistoryLines").EnumerateArray())
            await ExecuteAsync(connection, transaction,
                "INSERT INTO InvoiceHistoryLine VALUES(@id,@firm,@arType,@customer,@invoice,@line,@date,@salesOrder,@salesOrderLine,@item,@workOrder,@quantity,@unitPrice,@extendedPrice,@json);",
                ("@id",Text(item,"invoiceHistoryLineId")), ("@firm",Text(item,"firmId")),
                ("@arType",Text(item,"arType")), ("@customer",Text(item,"customerNumber")),
                ("@invoice",Text(item,"invoiceNumber")), ("@line",Text(item,"invoiceLineNumber")),
                ("@date",Text(item,"invoiceDate")), ("@salesOrder",Text(item,"salesOrderNumber")),
                ("@salesOrderLine",Text(item,"salesOrderLineNumber")), ("@item",Text(item,"itemNumber")),
                ("@workOrder",NullableText(item,"workOrderNumber")),
                ("@quantity",item.GetProperty("quantityShipped").GetDecimal().ToString(System.Globalization.CultureInfo.InvariantCulture)),
                ("@unitPrice",item.GetProperty("unitPrice").GetDecimal().ToString(System.Globalization.CultureInfo.InvariantCulture)),
                ("@extendedPrice",item.GetProperty("extendedPrice").GetDecimal().ToString(System.Globalization.CultureInfo.InvariantCulture)),
                ("@json",item.GetRawText()));

        await ExecuteAsync(connection, transaction,
            "INSERT INTO InvoiceHistoryMetadata VALUES(1,@json);",
            ("@json",fixture.GetProperty("invoiceHistoryMetadata").GetRawText()));
        await transaction.CommitAsync();
    }

    private static async Task ExecuteAsync(SqliteConnection connection, System.Data.Common.DbTransaction transaction,
        string sql, params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }

    private static void ValidateFixture(JsonElement fixture, SimStateMetadata metadata)
    {
        if (Text(fixture,"schema") != "dle-os-sim.operations-center-fixture.v1" ||
            Text(fixture,"scenarioId") != metadata.ScenarioId ||
            fixture.GetProperty("scenarioVersion").GetInt32() != metadata.ScenarioVersion ||
            !fixture.GetProperty("synthetic").GetBoolean())
            throw new InvalidOperationException("Operations Center fixture does not match the active synthetic scenario.");
        if (fixture.GetProperty("salesOrderLines").GetArrayLength() == 0 ||
            fixture.GetProperty("workOrders").GetArrayLength() == 0 ||
            fixture.GetProperty("relationships").GetArrayLength() != fixture.GetProperty("salesOrderLines").GetArrayLength() ||
            fixture.GetProperty("invoiceHeaders").GetArrayLength() == 0 ||
            fixture.GetProperty("invoiceHistoryLines").GetArrayLength() == 0)
            throw new InvalidOperationException("SIM business fixture is incomplete.");

        var workOrderNumbers = fixture.GetProperty("workOrders").EnumerateArray()
            .Select(item => Text(item,"workOrderNumber")).ToHashSet(StringComparer.Ordinal);
        var kittingStates = fixture.GetProperty("kittingReadStates").EnumerateArray().ToArray();
        var expectedKittingStates = new HashSet<string>(
            ["NEEDS_KITTING", "KIT_SHORT", "KIT_COMPLETE"], StringComparer.Ordinal);
        if (kittingStates.Length != 3 ||
            kittingStates.Select(item => Text(item,"kittingReadStateId")).Distinct(StringComparer.Ordinal).Count() != 3 ||
            !kittingStates.Select(item => Text(item.GetProperty("materialStatus"),"machineValue"))
                .ToHashSet(StringComparer.Ordinal).SetEquals(expectedKittingStates))
            throw new InvalidOperationException("Phase 8 must define one stable record for each required Kitting state.");
        foreach (var item in kittingStates)
        {
            var workOrder = Text(item,"workOrderNumber");
            var status = item.GetProperty("materialStatus");
            var machineValue = Text(status,"machineValue");
            var kittingCase = status.GetProperty("kittingCase");
            if (!workOrderNumbers.Contains(workOrder) || Text(status,"workOrderNumber") != workOrder ||
                (machineValue == "NEEDS_KITTING") != (kittingCase.ValueKind == JsonValueKind.Null))
                throw new InvalidOperationException("Kitting read state is orphaned or has invalid case evidence.");
        }

        var statusEvents = fixture.GetProperty("workOrderVerifiedStatusEvents").EnumerateArray().ToArray();
        if (statusEvents.Length == 0 ||
            statusEvents.Select(item => Text(item,"eventId")).Distinct(StringComparer.Ordinal).Count() != statusEvents.Length ||
            statusEvents.Select(item => item.GetProperty("eventSequence").GetInt64()).Distinct().Count() != statusEvents.Length ||
            statusEvents.Select(item => Text(item,"requestCorrelationId")).Distinct(StringComparer.Ordinal).Count() != statusEvents.Length)
            throw new InvalidOperationException("Verified Status baseline event identities must be stable and unique.");
        long expectedSequence = 1;
        foreach (var item in statusEvents.OrderBy(item => item.GetProperty("eventSequence").GetInt64()))
        {
            if (!workOrderNumbers.Contains(Text(item,"workOrderNumber")) ||
                item.GetProperty("eventSequence").GetInt64() != expectedSequence++ ||
                Text(item,"statusText").Trim().Length is < 1 or > 1000 ||
                !Guid.TryParse(Text(item,"eventId"), out _) ||
                !Guid.TryParse(Text(item,"requestCorrelationId"), out _))
                throw new InvalidOperationException("Verified Status baseline event is invalid or orphaned.");
        }

        var headers = fixture.GetProperty("invoiceHeaders").EnumerateArray().ToArray();
        var lines = fixture.GetProperty("invoiceHistoryLines").EnumerateArray().ToArray();
        var headerKeys = headers.Select(item => string.Join('|', Text(item,"firmId"), Text(item,"arType"),
            Text(item,"customerNumber"), Text(item,"invoiceNumber"))).ToHashSet(StringComparer.Ordinal);
        var lineKeys = new HashSet<string>(StringComparer.Ordinal);
        decimal signedTotal = 0;
        foreach (var item in lines)
        {
            var headerKey = string.Join('|', Text(item,"firmId"), Text(item,"arType"),
                Text(item,"customerNumber"), Text(item,"invoiceNumber"));
            if (!headerKeys.Contains(headerKey))
                throw new InvalidOperationException("An Invoice History line does not have a matching header.");
            var lineKey = headerKey + "|" + Text(item,"invoiceLineNumber");
            if (!lineKeys.Add(lineKey))
                throw new InvalidOperationException("Invoice History natural keys must be unique.");
            var quantity = item.GetProperty("quantityShipped").GetDecimal();
            var unitPrice = item.GetProperty("unitPrice").GetDecimal();
            var extendedPrice = item.GetProperty("extendedPrice").GetDecimal();
            if (quantity * unitPrice != extendedPrice)
                throw new InvalidOperationException("Invoice History extended prices must equal signed quantity times unit price.");
            signedTotal += extendedPrice;
            var resolution = Text(item,"workOrderResolutionStatus");
            var workOrder = NullableText(item,"workOrderNumber");
            var candidates = item.GetProperty("workOrderCandidateCount").GetInt32();
            if (resolution is not ("Unique" or "Ambiguous" or "Unresolved") ||
                (resolution == "Unique") != (workOrder is not null && candidates == 1) ||
                (resolution == "Ambiguous" && (workOrder is not null || candidates < 2)) ||
                (resolution == "Unresolved" && (workOrder is not null || candidates != 0)))
                throw new InvalidOperationException("Invoice History Work Order resolution cardinality is invalid.");
        }
        var invoiceMetadata = fixture.GetProperty("invoiceHistoryMetadata");
        if (invoiceMetadata.GetProperty("customerInvoiceCount").GetInt32() != headers.Length ||
            invoiceMetadata.GetProperty("customerInvoiceLineCount").GetInt32() != lines.Length ||
            invoiceMetadata.GetProperty("signedExtendedPriceTotal").GetDecimal() != signedTotal)
            throw new InvalidOperationException("Invoice History metadata does not reconcile with the fixture.");
    }

    private SqliteConnection OpenReadOnly() => new(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadOnly,
        Cache = SqliteCacheMode.Private,
        Pooling = false
    }.ToString());

    private SqliteConnection OpenReadWrite() => new(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadWrite,
        Cache = SqliteCacheMode.Private,
        Pooling = false
    }.ToString());

    private static (int Page, int PageSize) ParsePaging(IQueryCollection query)
    {
        var page = ParseInteger(query, "page", 1);
        var pageSize = ParseInteger(query, "pageSize", 50);
        if (page < 1 || pageSize is < 1 or > 200)
            throw new ArgumentException("page must be at least 1 and pageSize must be between 1 and 200.");
        return (page, pageSize);
    }

    private static int ParseInteger(IQueryCollection query, string name, int fallback) =>
        TryValue(query, name, out var value) && int.TryParse(value, out var parsed) ? parsed :
        TryValue(query, name, out _) ? throw new ArgumentException(name + " must be an integer.") : fallback;

    private static void AddExact(IQueryCollection query, List<string> filters,
        List<SqliteParameter> parameters, string queryName, string column)
    {
        if (!TryValue(query, queryName, out var value)) return;
        filters.Add(column + "=@" + queryName);
        parameters.Add(new("@" + queryName, value));
    }

    private static void AddContains(IQueryCollection query, List<string> filters,
        List<SqliteParameter> parameters, string queryName, string column)
    {
        if (!TryValue(query, queryName, out var value)) return;
        filters.Add(column + " LIKE @" + queryName + " ESCAPE '\\' COLLATE NOCASE");
        parameters.Add(new("@" + queryName, "%" + EscapeLike(value) + "%"));
    }

    private static void AddTrimmedExact(IQueryCollection query, List<string> filters,
        List<SqliteParameter> parameters, string queryName, string column)
    {
        if (!TryValue(query, queryName, out var value)) return;
        filters.Add("RTRIM(" + column + ")=RTRIM(@" + queryName + ")");
        parameters.Add(new("@" + queryName, value));
    }

    private static void AddBoolean(IQueryCollection query, List<string> filters,
        List<SqliteParameter> parameters, string queryName, string trueSql)
    {
        if (!TryValue(query, queryName, out var value)) return;
        if (!bool.TryParse(value, out var enabled)) throw new ArgumentException(queryName + " must be true or false.");
        filters.Add(enabled ? trueSql : "NOT (" + trueSql + ")");
    }

    private static void AddDateBoundary(IQueryCollection query, List<string> filters,
        List<SqliteParameter> parameters, string queryName, string column, string comparison)
    {
        if (!TryValue(query, queryName, out var value)) return;
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out _))
            throw new ArgumentException(queryName + " must be an ISO date in YYYY-MM-DD form.");
        filters.Add(column + comparison + "@" + queryName);
        parameters.Add(new("@" + queryName, value));
    }

    private static bool TryValue(IQueryCollection query, string name, out string value)
    {
        value = query.TryGetValue(name, out var values) ? values.ToString().Trim() : "";
        return value.Length > 0;
    }

    private static string EscapeLike(string value) => value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
    private static string Text(JsonElement item, string name) => item.GetProperty(name).GetString() ?? "";
    private static object? NullableText(JsonElement item, string name) =>
        item.GetProperty(name).ValueKind == JsonValueKind.Null ? null : item.GetProperty(name).GetString();
    private static object ParseObject(string json) => JsonSerializer.Deserialize<Dictionary<string, object?>>(json)!;

    private void EnsureHealthy()
    {
        if (!IsHealthy) throw new InvalidOperationException(ErrorMessage ?? "SIM Operations Center data is unavailable.");
    }

    private void MarkHealthy()
    {
        IsHealthy = true;
        ErrorCode = null;
        ErrorMessage = null;
    }

    private void MarkUnhealthy(string code, string message)
    {
        IsHealthy = false;
        ErrorCode = code;
        ErrorMessage = message;
    }
}
