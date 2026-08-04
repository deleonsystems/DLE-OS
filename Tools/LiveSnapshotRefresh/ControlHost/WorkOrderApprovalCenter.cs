using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using Microsoft.Data.SqlClient;

[assembly: InternalsVisibleTo("DleOs.WorkOrderApproval.Tests")]

internal static class WorkOrderApprovalCenter
{
    private const string Route = "/api/work-order-approvals/v1/sales-order-lines/{customerNumber}/{salesOrderNumber}/{lineNumber}";

    public static void MapWorkOrderApprovals(this WebApplication app, string policy)
    {
        var service = new WorkOrderApprovalService();
        app.MapGet(Route, async (string customerNumber, string salesOrderNumber,
                string lineNumber, CancellationToken cancellationToken) =>
            await Execute(() => service.GetReviewAsync(
                LineKey.Create(customerNumber, salesOrderNumber, lineNumber), cancellationToken)))
            .RequireAuthorization(policy);

        MapAction(app, service, policy, "approve", "APPROVE");
        MapAction(app, service, policy, "replace", "REPLACE");
        MapAction(app, service, policy, "revoke", "REVOKE");
    }

    private static void MapAction(WebApplication app, WorkOrderApprovalService service,
        string policy, string routeAction, string decisionAction)
    {
        app.MapPost(Route + "/" + routeAction,
            async (string customerNumber, string salesOrderNumber, string lineNumber,
                ApprovalActionRequest request, HttpContext context, CancellationToken cancellationToken) =>
                await Execute(() => service.DecideAsync(
                    LineKey.Create(customerNumber, salesOrderNumber, lineNumber),
                    decisionAction, request, context.User.Identity!.Name!, cancellationToken)))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> action)
    {
        try { return Results.Json(await action()); }
        catch (ApprovalProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (SqlException)
        {
            return Results.Json(new
            {
                code = "approval_store_unavailable",
                message = "The governed Work Order approval store is unavailable."
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (HttpRequestException)
        {
            return Results.Json(new
            {
                code = "canonical_evidence_unavailable",
                message = "Current canonical Work Order relationship evidence is unavailable."
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

internal sealed class WorkOrderApprovalService
{
    private readonly ApprovalRepository _repository = new();
    private readonly HttpClient _canonical;

    public WorkOrderApprovalService()
    {
        _canonical = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(Environment.GetEnvironmentVariable("DLE_OS_CANONICAL_API_BASE_URL")
                ?? "http://DLE-OS-HOST:5042"),
            Timeout = TimeSpan.FromSeconds(15)
        };
    }

    public async Task<object> GetReviewAsync(LineKey key, CancellationToken cancellationToken)
    {
        var relationship = await LoadRelationshipAsync(key, cancellationToken);
        var current = await _repository.GetCurrentAsync(key, cancellationToken);
        var choices = relationship.ApprovalChoices;
        var workOrderExists = current is null || string.IsNullOrEmpty(current.ApprovedWorkOrderNumber) ||
            await WorkOrderExistsAsync(current.ApprovedWorkOrderNumber, cancellationToken);
        var classification = Classify(current?.ApprovedWorkOrderNumber, relationship, workOrderExists);
        var history = await _repository.GetHistoryAsync(key, cancellationToken);
        return BuildReview(key, relationship, current, history, classification, choices);
    }

    public async Task<object> DecideAsync(LineKey key, string action, ApprovalActionRequest request,
        string authenticatedUser, CancellationToken cancellationToken)
    {
        var reason = (request.DecisionReason ?? "").Trim();
        if (reason.Length is < 3 or > 500)
            throw ApprovalProblem.BadRequest("decision_reason_required",
                "A decision reason between 3 and 500 characters is required.");

        var relationship = await LoadRelationshipAsync(key, cancellationToken);
        var current = await _repository.GetCurrentAsync(key, cancellationToken);
        var currentToken = CreateEvidenceToken(key, relationship, current?.DecisionId);
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(currentToken), Encoding.UTF8.GetBytes(request.EvidenceToken ?? "")))
            throw ApprovalProblem.Conflict("stale_relationship_evidence",
                "Canonical relationship evidence or the current approval changed. Reload and review again.");

        if (request.ExpectedCurrentDecisionId != current?.DecisionId)
            throw ApprovalProblem.Conflict("current_decision_changed",
                "The governing approval changed. Reload and review again.");

        string? selected = null;
        if (action is "APPROVE" or "REPLACE")
        {
            selected = NormalizeWorkOrder(request.SelectedWorkOrderNumber);
            if (selected is null || !relationship.ApprovalChoices.Contains(selected, StringComparer.Ordinal))
                throw ApprovalProblem.BadRequest("work_order_outside_current_evidence",
                    "Select a Work Order from the current canonical relationship evidence.");
            if (!await WorkOrderExistsAsync(selected, cancellationToken))
                throw ApprovalProblem.BadRequest("canonical_work_order_missing",
                    "The selected Work Order does not exist in the current canonical Work Order dataset.");
        }

        if (action == "APPROVE" && current is not null)
            throw ApprovalProblem.Conflict("approval_already_exists", "This Sales Order line already has an approval.");
        if (action is "REPLACE" or "REVOKE" && current is null)
            throw ApprovalProblem.Conflict("approval_not_current", "There is no current approval to supersede.");
        if (action == "REPLACE" && selected == current!.ApprovedWorkOrderNumber)
            throw ApprovalProblem.BadRequest("replacement_must_change_work_order",
                "Replacement must select a different canonical Work Order.");

        var decision = await _repository.AppendAsync(key, action, selected, current?.DecisionId,
            relationship, reason, authenticatedUser, cancellationToken);
        var refreshed = await _repository.GetCurrentAsync(key, cancellationToken);
        var history = await _repository.GetHistoryAsync(key, cancellationToken);
        var exists = refreshed is null || string.IsNullOrEmpty(refreshed.ApprovedWorkOrderNumber) ||
            await WorkOrderExistsAsync(refreshed.ApprovedWorkOrderNumber, cancellationToken);
        return BuildReview(key, relationship, refreshed, history,
            Classify(refreshed?.ApprovedWorkOrderNumber, relationship, exists),
            relationship.ApprovalChoices, decision.RequestCorrelationId);
    }

    private object BuildReview(LineKey key, CanonicalRelationship relationship,
        DecisionRecord? current, IReadOnlyList<DecisionRecord> history, string classification,
        IReadOnlyList<string> choices, Guid? correlationId = null) => new
    {
        identity = new { customerNumber = key.Customer, salesOrderNumber = key.SalesOrder, salesOrderLineNumber = key.Line },
        canonicalRelationship = relationship.Raw,
        currentApproval = current,
        decisionHistory = history,
        conflictClassification = classification,
        evidenceToken = CreateEvidenceToken(key, relationship, current?.DecisionId),
        availableApprovalChoices = choices,
        permissions = new
        {
            canApprove = current is null && choices.Count > 0,
            canReplace = current is not null && choices.Any(value => value != current.ApprovedWorkOrderNumber),
            canRevoke = current is not null
        },
        requestCorrelationId = correlationId
    };

    internal static string Classify(string? approved, CanonicalRelationship relationship, bool workOrderExists)
    {
        if (string.IsNullOrEmpty(approved)) return "NO_APPROVAL";
        if (!workOrderExists) return "APPROVED_WORK_ORDER_MISSING";
        if (relationship.Status == "EXACT_LINE_UNIQUE")
            return approved == relationship.ExactWorkOrder
                ? "APPROVED_AGREES_EXACT" : "APPROVED_CONFLICTS_EXACT";
        if (relationship.Status == "AMBIGUOUS" && relationship.ApprovalChoices.Contains(approved))
            return "APPROVED_WITH_CURRENT_AMBIGUITY";
        if (relationship.ApprovalChoices.Contains(approved))
            return "APPROVED_SUPPORTED_CANDIDATE";
        return "APPROVED_NOT_IN_CURRENT_CANDIDATES";
    }

    private async Task<CanonicalRelationship> LoadRelationshipAsync(LineKey key, CancellationToken cancellationToken)
    {
        var path = "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=2" +
            $"&customerNumber={Uri.EscapeDataString(key.Customer)}" +
            $"&salesOrderNumber={Uri.EscapeDataString(key.SalesOrder)}" +
            $"&salesOrderLineNumber={Uri.EscapeDataString(key.Line)}";
        using var response = await _canonical.GetAsync(path, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        var items = document.RootElement.TryGetProperty("items", out var itemArray) ? itemArray : default;
        if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() != 1)
            throw ApprovalProblem.NotFound("sales_order_line_not_found",
                "The Sales Order line does not exist in the current canonical snapshot.");
        return CanonicalRelationship.From(items[0]);
    }

    private async Task<bool> WorkOrderExistsAsync(string workOrderNumber, CancellationToken cancellationToken)
    {
        var path = "/api/platform/live/v1/work-orders?page=1&pageSize=1&workOrderNumber=" +
            Uri.EscapeDataString(workOrderNumber);
        using var response = await _canonical.GetAsync(path, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        return document.RootElement.TryGetProperty("totalItems", out var total) && total.GetInt64() == 1;
    }

    private static string CreateEvidenceToken(LineKey key, CanonicalRelationship relationship, Guid? decisionId)
    {
        var material = string.Join("|", key.Customer, key.SalesOrder, key.Line,
            relationship.Status, relationship.ExactWorkOrder ?? "", relationship.SnapshotId ?? "",
            relationship.ImportRunId ?? "",
            relationship.CandidateSetHash, decisionId?.ToString("D") ?? "");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }

    private static string? NormalizeWorkOrder(string? value)
    {
        value = (value ?? "").Trim();
        return Regex.IsMatch(value, "^[0-9]{1,7}$") ? value.PadLeft(7, '0') : null;
    }
}

internal sealed class ApprovalRepository
{
    private readonly string _connectionString = Environment.GetEnvironmentVariable(
        "DLE_OS_WORK_ORDER_APPROVAL_CONNECTION_STRING") ??
        @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;";

    public async Task<DecisionRecord?> GetCurrentAsync(LineKey key, CancellationToken token,
        SqlConnection? connection = null, SqlTransaction? transaction = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(_connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand("""
SELECT DecisionId, DecisionAction, ApprovedWorkOrderNumber, SupersedesDecisionId,
       CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
       CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
       CandidateSetHash, CandidateSetJson, SelectionSource,
       DecisionReason, ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line;
""", connection, transaction);
            AddKey(command, key);
            await using var reader = await command.ExecuteReaderAsync(token);
            return await reader.ReadAsync(token) ? DecisionRecord.From(reader) : null;
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }

    public async Task<IReadOnlyList<DecisionRecord>> GetHistoryAsync(LineKey key, CancellationToken token)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(token);
        var command = new SqlCommand("""
SELECT TOP (50) DecisionId, DecisionAction, ApprovedWorkOrderNumber, SupersedesDecisionId,
       CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
       CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
       CandidateSetHash, CandidateSetJson, SelectionSource,
       DecisionReason, ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM operational.SalesOrderLineWorkOrderDecisionEvent
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line
ORDER BY DecisionSequence DESC;
""", connection);
        AddKey(command, key);
        var results = new List<DecisionRecord>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) results.Add(DecisionRecord.From(reader));
        return results;
    }

    public async Task<DecisionRecord> AppendAsync(LineKey key, string action, string? selected,
        Guid? expectedCurrent, CanonicalRelationship relationship, string reason, string approvedBy,
        CancellationToken token)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        var actual = await GetCurrentAsync(key, token, connection, transaction);
        if (actual?.DecisionId != expectedCurrent)
            throw ApprovalProblem.Conflict("current_decision_changed",
                "The governing approval changed while this decision was being recorded.");

        var decisionId = Guid.NewGuid();
        var correlationId = Guid.NewGuid();
        var command = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId, CustomerNumber, SalesOrderNumber, SalesOrderLineNumber, DecisionAction,
 ApprovedWorkOrderNumber, SupersedesDecisionId, CandidateResolutionStatusAtDecision,
 CanonicalExactWorkOrderAtDecision, CandidateSnapshotIdAtDecision,
 CandidateSnapshotImportRunId, CandidateSetHash,
 CandidateSetJson, SelectionSource, DecisionReason, ApprovedBy, ApprovedAtUtc, RequestCorrelationId)
VALUES
(@DecisionId,@Customer,@SalesOrder,@Line,@Action,@Selected,@Supersedes,@Status,@Exact,
 @SnapshotId,@ImportRun,@CandidateHash,@CandidateJson,@SelectionSource,@Reason,@ApprovedBy,SYSUTCDATETIME(),@CorrelationId);
""", connection, transaction);
        AddKey(command, key);
        command.Parameters.AddWithValue("@DecisionId", decisionId);
        command.Parameters.AddWithValue("@Action", action);
        command.Parameters.AddWithValue("@Selected", (object?)selected ?? DBNull.Value);
        command.Parameters.AddWithValue("@Supersedes", (object?)expectedCurrent ?? DBNull.Value);
        command.Parameters.AddWithValue("@Status", relationship.Status);
        command.Parameters.AddWithValue("@Exact", (object?)relationship.ExactWorkOrder ?? DBNull.Value);
        command.Parameters.AddWithValue("@SnapshotId", (object?)relationship.SnapshotId ?? DBNull.Value);
        command.Parameters.AddWithValue("@ImportRun", (object?)relationship.ImportRunId ?? DBNull.Value);
        command.Parameters.AddWithValue("@CandidateHash", relationship.CandidateSetHash);
        command.Parameters.AddWithValue("@CandidateJson", relationship.CandidateSetJson);
        command.Parameters.AddWithValue("@SelectionSource", relationship.SelectionSource(selected));
        command.Parameters.AddWithValue("@Reason", reason);
        command.Parameters.AddWithValue("@ApprovedBy", approvedBy);
        command.Parameters.AddWithValue("@CorrelationId", correlationId);
        await command.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
        _ = Guid.TryParse(relationship.ImportRunId, out var importRunId);
        return new DecisionRecord(decisionId, action, selected, expectedCurrent,
            relationship.Status, relationship.ExactWorkOrder, relationship.SnapshotId,
            importRunId == Guid.Empty ? null : importRunId, relationship.CandidateSetHash,
            relationship.CandidateSetJson, relationship.SelectionSource(selected), reason,
            approvedBy, DateTime.UtcNow, correlationId);
    }

    private static void AddKey(SqlCommand command, LineKey key)
    {
        command.Parameters.AddWithValue("@Customer", key.Customer);
        command.Parameters.AddWithValue("@SalesOrder", key.SalesOrder);
        command.Parameters.AddWithValue("@Line", key.Line);
    }
}

internal sealed record LineKey(string Customer, string SalesOrder, string Line)
{
    public static LineKey Create(string customer, string salesOrder, string line)
    {
        static string Normalize(string value, int width, string name)
        {
            value = (value ?? "").Trim();
            if (!Regex.IsMatch(value, $"^[0-9]{{1,{width}}}$"))
                throw ApprovalProblem.BadRequest("malformed_identifier", $"{name} is malformed.");
            return value.PadLeft(width, '0');
        }
        return new(Normalize(customer, 6, "Customer number"),
            Normalize(salesOrder, 7, "Sales Order number"), Normalize(line, 3, "Line number"));
    }
}

internal sealed class CanonicalRelationship
{
    public required JsonElement Raw { get; init; }
    public required string Status { get; init; }
    public string? ExactWorkOrder { get; init; }
    public required IReadOnlyList<string> EvidenceWorkOrders { get; init; }
    public required IReadOnlyList<string> ApprovalChoices { get; init; }
    public string? SnapshotId { get; init; }
    public string? ImportRunId { get; init; }
    public required string CandidateSetHash { get; init; }
    public required string CandidateSetJson { get; init; }

    public static CanonicalRelationship From(JsonElement source)
    {
        var status = Text(source, "resolutionStatus") ?? Text(source, "status") ?? "UNRESOLVED";
        var exact = Normalize(Text(source, "actionableWorkOrderNumber"));
        var values = new List<string>();
        var itemMatches = new List<string>();
        var salesOrderItem = Text(source, "salesOrderItemNumber")?.Trim();
        string? snapshot = null;
        string? import = null;
        JsonElement[] candidateEvidence = [];
        if (source.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array)
        {
            candidateEvidence = candidates.EnumerateArray()
                .OrderBy(candidate => Normalize(Text(candidate, "workOrderNumber")) ?? "", StringComparer.Ordinal)
                .Select(candidate => candidate.Clone()).ToArray();
            foreach (var candidate in candidates.EnumerateArray())
            {
                var number = Normalize(Text(candidate, "workOrderNumber"));
                if (number is not null)
                {
                    values.Add(number);
                    if (!string.IsNullOrEmpty(salesOrderItem) &&
                        string.Equals(Text(candidate, "itemNumber")?.Trim(), salesOrderItem, StringComparison.Ordinal))
                        itemMatches.Add(number);
                }
                snapshot ??= Text(candidate, "sourceSnapshotId");
                import ??= Text(candidate, "sourceImportRunId");
            }
        }
        if (exact is not null) values.Add(exact);
        var normalized = values.Distinct(StringComparer.Ordinal).Order().ToArray();
        var normalizedSetJson = JsonSerializer.Serialize(normalized);
        var evidenceJson = JsonSerializer.Serialize(candidateEvidence);
        IReadOnlyList<string> choices = status switch
        {
            "EXACT_LINE_UNIQUE" when exact is not null => [exact],
            "SALES_ORDER_ITEM_UNIQUE_CANDIDATE" => itemMatches.Distinct().ToArray(),
            "SALES_ORDER_LEVEL_CANDIDATE" when normalized.Length == 1 => normalized,
            "AMBIGUOUS" => normalized,
            _ => []
        };
        return new CanonicalRelationship
        {
            Raw = source.Clone(), Status = status, ExactWorkOrder = exact,
            EvidenceWorkOrders = normalized, ApprovalChoices = choices,
            SnapshotId = snapshot, ImportRunId = import, CandidateSetJson = evidenceJson,
            CandidateSetHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedSetJson)))
        };
    }

    public string SelectionSource(string? selected) => selected is null ? "REVOCATION" :
        selected == ExactWorkOrder ? "EXACT_RELATIONSHIP" :
        Status == "AMBIGUOUS" ? "AMBIGUOUS_CANDIDATE_SELECTION" : "UNIQUE_CANDIDATE";
    private static string? Text(JsonElement value, string property) =>
        value.TryGetProperty(property, out var result) && result.ValueKind == JsonValueKind.String
            ? result.GetString() : null;
    private static string? Normalize(string? value)
    {
        value = (value ?? "").Trim();
        return Regex.IsMatch(value, "^[0-9]{1,7}$") ? value.PadLeft(7, '0') : null;
    }
}

internal sealed record DecisionRecord(Guid DecisionId, string DecisionAction,
    string? ApprovedWorkOrderNumber, Guid? SupersedesDecisionId,
    string CandidateResolutionStatusAtDecision, string? CanonicalExactWorkOrderAtDecision,
    string? CandidateSnapshotIdAtDecision, Guid? CandidateSnapshotImportRunId,
    string CandidateSetHash, string CandidateSetJson, string SelectionSource,
    string DecisionReason, string ApprovedBy, DateTime ApprovedAtUtc, Guid RequestCorrelationId)
{
    public static DecisionRecord From(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetGuid(3), reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetGuid(7), reader.GetString(8), reader.GetString(9),
        reader.GetString(10), reader.GetString(11), reader.GetString(12), reader.GetDateTime(13),
        reader.GetGuid(14));
}

internal sealed class ApprovalActionRequest
{
    public string? SelectedWorkOrderNumber { get; set; }
    public string? DecisionReason { get; set; }
    public string? EvidenceToken { get; set; }
    public Guid? ExpectedCurrentDecisionId { get; set; }
    // ApprovedBy and timestamps are intentionally absent: identity and UTC time are server-derived.
}

internal sealed class ApprovalProblem : Exception
{
    public int StatusCode { get; }
    public string Code { get; }
    private ApprovalProblem(int statusCode, string code, string message) : base(message)
        => (StatusCode, Code) = (statusCode, code);
    public static ApprovalProblem BadRequest(string code, string message) => new(400, code, message);
    public static ApprovalProblem NotFound(string code, string message) => new(404, code, message);
    public static ApprovalProblem Conflict(string code, string message) => new(409, code, message);
}
