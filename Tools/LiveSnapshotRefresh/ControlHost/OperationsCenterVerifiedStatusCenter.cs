using System.Text.Json;
using Microsoft.Data.SqlClient;

internal static class OperationsCenterVerifiedStatusCenter
{
    public static void MapOperationsCenterVerifiedStatuses(this WebApplication app, string policy)
    {
        var repository = new OperationsCenterVerifiedStatusRepository();
        app.MapPost("/api/operations-center/v1/verified-statuses/latest",
                async (OperationsCenterVerifiedStatusLatestRequest request, CancellationToken token) =>
                    await Execute(() => repository.GetLatestAsync(request.MasterRecordKeys, token)))
            .RequireAuthorization(policy);

        app.MapGet("/api/operations-center/v1/lines/{masterRecordKey}/verified-status-history",
                async (string masterRecordKey, CancellationToken token) =>
                    await Execute(() => repository.GetHistoryAsync(masterRecordKey, token)))
            .RequireAuthorization(policy);

        app.MapPost("/api/operations-center/v1/lines/{masterRecordKey}/verified-status-events",
                async (string masterRecordKey, OperationsCenterVerifiedStatusAppendRequest request,
                    HttpContext context, CancellationToken token) =>
                    await Execute(() => repository.AppendAsync(masterRecordKey, request,
                        TrustedDevelopmentIdentity.RequireActorName(context), token), StatusCodes.Status201Created))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> action, int statusCode = StatusCodes.Status200OK)
    {
        try { return Results.Json(await action(), statusCode: statusCode); }
        catch (OperationsCenterVerifiedStatusProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (SqlException)
        {
            return Results.Json(new
            {
                code = "operations_center_verified_status_store_unavailable",
                message = "The governed Operations Center verified status store is unavailable."
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

internal sealed class OperationsCenterVerifiedStatusRepository
{
    public async Task<object> GetLatestAsync(IEnumerable<string>? masterRecordKeys, CancellationToken token)
    {
        var keys = NormalizeMasterRecordKeys(masterRecordKeys);
        if (keys.Count == 0) return new { records = Array.Empty<OperationsCenterVerifiedStatusEvent>() };

        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.OperationalConnectionString);
        await connection.OpenAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = @"
DECLARE @Keys TABLE(MasterRecordKey nvarchar(128) NOT NULL PRIMARY KEY);
INSERT @Keys(MasterRecordKey)
SELECT DISTINCT LTRIM(RTRIM([value])) FROM OPENJSON(@KeysJson)
WHERE LEN(LTRIM(RTRIM([value]))) > 0;

WITH Ranked AS
(
    SELECT event.*,
           ROW_NUMBER() OVER (PARTITION BY event.MasterRecordKey ORDER BY event.EventSequence DESC) AS CurrentRank
    FROM operational.OperationsCenterVerifiedStatusEvent event
    JOIN @Keys keys ON keys.MasterRecordKey = event.MasterRecordKey
)
SELECT EventId,EventSequence,MasterRecordKey,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,
       WorkOrderNumber,ItemNumber,Description,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM Ranked
WHERE CurrentRank = 1
ORDER BY EventSequence DESC;";
        command.Parameters.AddWithValue("@KeysJson", JsonSerializer.Serialize(keys));
        return new { records = await ReadEventsAsync(command, token) };
    }

    public async Task<object> GetHistoryAsync(string masterRecordKey, CancellationToken token)
    {
        var key = NormalizeMasterRecordKey(masterRecordKey);
        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.OperationalConnectionString);
        await connection.OpenAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = @"
SELECT TOP(100) EventId,EventSequence,MasterRecordKey,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,
       WorkOrderNumber,ItemNumber,Description,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM operational.OperationsCenterVerifiedStatusEvent
WHERE MasterRecordKey=@MasterRecordKey
ORDER BY EventSequence DESC;";
        command.Parameters.AddWithValue("@MasterRecordKey", key);
        return new { masterRecordKey = key, records = await ReadEventsAsync(command, token) };
    }

    public async Task<object> AppendAsync(string masterRecordKey,
        OperationsCenterVerifiedStatusAppendRequest request, string actor, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(actor))
            throw OperationsCenterVerifiedStatusProblem.Forbidden("authenticated_identity_required",
                "An authenticated DLE-OS user is required.");
        var key = ParseMasterRecordKey(masterRecordKey);
        var status = (request.StatusText ?? "").Trim();
        if (status.Length is < 1 or > 1000)
            throw OperationsCenterVerifiedStatusProblem.BadRequest("verified_status_text_required",
                "Last Verified Status text is required and must be 1,000 characters or less.");
        var correlation = request.RequestCorrelationId is { } supplied && supplied != Guid.Empty
            ? supplied
            : Guid.NewGuid();
        var evidenceJson = JsonSerializer.Serialize(request.EvidenceSnapshot ?? new Dictionary<string, object?>());

        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.OperationalConnectionString);
        await connection.OpenAsync(token);
        var existing = await GetByCorrelationAsync(connection, correlation, token);
        if (existing is not null) return new { duplicate = true, record = existing };

        await using var command = connection.CreateCommand();
        command.CommandText = @"
INSERT operational.OperationsCenterVerifiedStatusEvent
    (EventId,MasterRecordKey,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,
     WorkOrderNumber,ItemNumber,Description,StatusText,EvidenceSnapshotJson,RecordedBy,RequestCorrelationId)
OUTPUT inserted.EventId,inserted.EventSequence,inserted.MasterRecordKey,inserted.CustomerNumber,
       inserted.SalesOrderNumber,inserted.SalesOrderLineNumber,inserted.WorkOrderNumber,
       inserted.ItemNumber,inserted.Description,inserted.StatusText,inserted.EvidenceSnapshotJson,
       inserted.RecordedBy,inserted.RecordedAtUtc,inserted.CreatedAtUtc,inserted.RequestCorrelationId
VALUES
    (@EventId,@MasterRecordKey,@CustomerNumber,@SalesOrderNumber,@SalesOrderLineNumber,
     @WorkOrderNumber,@ItemNumber,@Description,@StatusText,@EvidenceSnapshotJson,@RecordedBy,@RequestCorrelationId);";
        command.Parameters.AddWithValue("@EventId", Guid.NewGuid());
        command.Parameters.AddWithValue("@MasterRecordKey", key.MasterRecordKey);
        command.Parameters.AddWithValue("@CustomerNumber", key.CustomerNumber);
        command.Parameters.AddWithValue("@SalesOrderNumber", key.SalesOrderNumber);
        command.Parameters.AddWithValue("@SalesOrderLineNumber", key.LineNumber);
        command.Parameters.AddWithValue("@WorkOrderNumber", DbValue(request.WorkOrderNumber, 7));
        command.Parameters.AddWithValue("@ItemNumber", DbValue(request.ItemNumber, 64));
        command.Parameters.AddWithValue("@Description", DbValue(request.Description, 256));
        command.Parameters.AddWithValue("@StatusText", status);
        command.Parameters.AddWithValue("@EvidenceSnapshotJson", evidenceJson);
        command.Parameters.AddWithValue("@RecordedBy", actor);
        command.Parameters.AddWithValue("@RequestCorrelationId", correlation);

        try
        {
            var records = await ReadEventsAsync(command, token);
            return new { duplicate = false, record = records.Single() };
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            var duplicate = await GetByCorrelationAsync(connection, correlation, token);
            if (duplicate is not null) return new { duplicate = true, record = duplicate };
            throw;
        }
    }

    private static async Task<OperationsCenterVerifiedStatusEvent?> GetByCorrelationAsync(
        SqlConnection connection, Guid correlation, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = @"
SELECT TOP(1) EventId,EventSequence,MasterRecordKey,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,
       WorkOrderNumber,ItemNumber,Description,StatusText,EvidenceSnapshotJson,RecordedBy,
       RecordedAtUtc,CreatedAtUtc,RequestCorrelationId
FROM operational.OperationsCenterVerifiedStatusEvent
WHERE RequestCorrelationId=@RequestCorrelationId;";
        command.Parameters.AddWithValue("@RequestCorrelationId", correlation);
        return (await ReadEventsAsync(command, token)).FirstOrDefault();
    }

    private static async Task<List<OperationsCenterVerifiedStatusEvent>> ReadEventsAsync(
        SqlCommand command, CancellationToken token)
    {
        var records = new List<OperationsCenterVerifiedStatusEvent>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
        {
            records.Add(new OperationsCenterVerifiedStatusEvent(
                reader.GetGuid(0), reader.GetInt64(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.GetString(9), reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.GetString(11), reader.GetDateTime(12), reader.GetDateTime(13),
                reader.GetGuid(14)));
        }
        return records;
    }

    private static List<string> NormalizeMasterRecordKeys(IEnumerable<string>? values) =>
        (values ?? []).Select(NormalizeMasterRecordKey).Distinct(StringComparer.Ordinal).Take(500).ToList();

    private static string NormalizeMasterRecordKey(string value) => ParseMasterRecordKey(value).MasterRecordKey;

    private static OperationsCenterLineKey ParseMasterRecordKey(string value)
    {
        var parts = Uri.UnescapeDataString(Convert.ToString(value ?? "")).Split('|');
        if (parts.Length != 3)
            throw OperationsCenterVerifiedStatusProblem.BadRequest("master_record_key_malformed",
                "The Operations Center row identity is malformed.");
        var customer = NormalizeDigits(parts[0], 6, "customer_number_malformed", "Customer number is malformed.");
        var salesOrder = NormalizeDigits(parts[1], 7, "sales_order_number_malformed", "Sales Order number is malformed.");
        var line = NormalizeDigits(parts[2], 3, "sales_order_line_malformed", "Sales Order line number is malformed.");
        return new OperationsCenterLineKey(customer, salesOrder, line);
    }

    private static string NormalizeDigits(string value, int width, string code, string message)
    {
        var text = Convert.ToString(value ?? "")!.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(text, "^[0-9]{1," + width + "}$"))
            throw OperationsCenterVerifiedStatusProblem.BadRequest(code, message);
        return text.PadLeft(width, '0');
    }

    private static object DbValue(string? value, int maxLength)
    {
        var text = (value ?? "").Trim();
        if (text.Length > maxLength) text = text[..maxLength];
        return string.IsNullOrWhiteSpace(text) ? DBNull.Value : text;
    }
}

internal sealed record OperationsCenterLineKey(string CustomerNumber, string SalesOrderNumber, string LineNumber)
{
    public string MasterRecordKey => CustomerNumber + "|" + SalesOrderNumber + "|" + LineNumber;
}

internal sealed record OperationsCenterVerifiedStatusLatestRequest(string[]? MasterRecordKeys);

internal sealed record OperationsCenterVerifiedStatusAppendRequest(
    string? StatusText,
    string? WorkOrderNumber,
    string? ItemNumber,
    string? Description,
    Dictionary<string, object?>? EvidenceSnapshot,
    Guid? RequestCorrelationId);

internal sealed record OperationsCenterVerifiedStatusEvent(
    Guid EventId, long EventSequence, string MasterRecordKey, string CustomerNumber,
    string SalesOrderNumber, string SalesOrderLineNumber, string? WorkOrderNumber,
    string? ItemNumber, string? Description, string StatusText, string? EvidenceSnapshotJson,
    string RecordedBy, DateTime RecordedAtUtc, DateTime CreatedAtUtc, Guid RequestCorrelationId);

internal sealed class OperationsCenterVerifiedStatusProblem : Exception
{
    public int StatusCode { get; }
    public string Code { get; }

    private OperationsCenterVerifiedStatusProblem(int statusCode, string code, string message) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    public static OperationsCenterVerifiedStatusProblem BadRequest(string code, string message) =>
        new(StatusCodes.Status400BadRequest, code, message);

    public static OperationsCenterVerifiedStatusProblem Forbidden(string code, string message) =>
        new(StatusCodes.Status403Forbidden, code, message);
}
