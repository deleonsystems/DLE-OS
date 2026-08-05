using System.Data;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class OperationalWorkOrderRelationshipCenter
{
    private const string Route = "/api/operational-work-order-relationships/v1/sales-order-lines/{customerNumber}/{salesOrderNumber}/{lineNumber}";

    public static void MapOperationalWorkOrderRelationships(this WebApplication app, string policy)
    {
        var service = new OperationalWorkOrderRelationshipService();
        app.MapGet(Route, async (string customerNumber, string salesOrderNumber, string lineNumber,
                CancellationToken token) => await Execute(() => service.GetAsync(
                    LineKey.Create(customerNumber, salesOrderNumber, lineNumber), token)))
            .RequireAuthorization(policy);
        app.MapPost(Route + "/events", async (string customerNumber, string salesOrderNumber,
                string lineNumber, OperationalInterpretationRequest request, HttpContext context,
                CancellationToken token) => await Execute(() => service.AppendAsync(
                    LineKey.Create(customerNumber, salesOrderNumber, lineNumber), request,
                    context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> action)
    {
        try { return Results.Json(await action()); }
        catch (OperationalRelationshipProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            return Results.Json(new
            {
                code = "interpretation_correlation_conflict",
                message = "This interpretation request was already recorded."
            }, statusCode: StatusCodes.Status409Conflict);
        }
        catch (SqlException)
        {
            return Results.Json(new
            {
                code = "operational_relationship_store_unavailable",
                message = "The governed operational Work Order interpretation store is unavailable."
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (HttpRequestException)
        {
            return Results.Json(new
            {
                code = "canonical_evidence_unavailable",
                message = "Current canonical Work Order evidence is unavailable."
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

internal sealed class OperationalWorkOrderRelationshipService
{
    private readonly OperationalInterpretationRepository interpretations = new();
    private readonly ApprovalRepository approvals = new();
    private readonly RmaReworkRepository rma = new();
    private readonly HttpClient canonical;

    public OperationalWorkOrderRelationshipService(HttpClient? canonicalClient = null)
    {
        canonical = canonicalClient ?? new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
    }

    public async Task<object> GetAsync(LineKey key, CancellationToken token)
        => await LoadAsync(key, token);

    internal async Task<OperationalRelationshipPresentation> LoadAsync(LineKey key,
        CancellationToken token)
    {
        var line = await GetExactAsync("/api/platform/live/v1/sales-orders/" +
            Uri.EscapeDataString(key.Customer + key.SalesOrder + key.Line), token);
        var canonicalRelationship = await LoadRelationshipAsync(key, token);
        var currentApproval = await approvals.GetCurrentAsync(key, token);
        var memberships = await rma.GetActiveMembershipsAsync(
            [new RmaReworkLineIdentity(key.Customer, key.SalesOrder, key.Line)], token);
        var membership = memberships.GetValueOrDefault(key.Customer + "|" + key.SalesOrder + "|" + key.Line);
        var currentInterpretation = await interpretations.GetCurrentAsync(key, token);
        var quantity = Number(line, "quantityOrdered");
        var occurrenceDate = Date(Text(line, "orderDate"));
        var historical = await LoadHistoricalEvidenceAsync(key, canonicalRelationship,
            occurrenceDate, token);
        if (currentInterpretation?.HistoricalWorkOrderNumber is { Length: > 0 } recorded &&
            historical.All(item => item.WorkOrderNumber != recorded))
        {
            historical.Add(new HistoricalWorkOrderEvidence(recorded,
                currentInterpretation.RelationshipRole, true, false, null,
                "Governed append-only operational interpretation."));
        }

        var input = new OperationalRelationshipInput(
            key, quantity, canonicalRelationship, currentApproval,
            membership, currentInterpretation, historical);
        return OperationalWorkOrderRelationshipRules.Resolve(input);
    }

    public async Task<object> AppendAsync(LineKey key, OperationalInterpretationRequest request,
        string actor, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(actor))
            throw OperationalRelationshipProblem.Unauthorized("authenticated_identity_required",
                "An authenticated employee identity is required.");
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length is < 10 or > 500)
            throw OperationalRelationshipProblem.BadRequest("interpretation_reason_required",
                "A correction reason between 10 and 500 characters is required.");

        var current = await LoadAsync(key, token);
        var status = NormalizeStatus(request.ResultingOperationalStatus);
        var role = NormalizeRole(request.RelationshipRole);
        var active = NormalizeWorkOrder(request.ActiveWorkOrderNumber);
        var historical = NormalizeWorkOrder(request.HistoricalWorkOrderNumber);
        if (status == "RMA_WORK_ORDER_ASSIGNED")
        {
            if (current.RmaReworkControl is null)
                throw OperationalRelationshipProblem.Conflict("active_rma_membership_required",
                    "An explicit RMA Work Order decision requires active RMA/Rework membership.");
            if (active is null || role != "RMA_ASSIGNED")
                throw OperationalRelationshipProblem.BadRequest("invalid_rma_work_order_decision",
                    "An RMA-assigned interpretation requires an active Work Order and RMA_ASSIGNED role.");
            if (!await WorkOrderExistsAsync(active, token))
                throw OperationalRelationshipProblem.BadRequest("canonical_work_order_missing",
                    "The assigned Work Order does not exist in current canonical evidence.");
        }
        else
        {
            if (active is not null || historical is null || role is not ("ORIGINAL_BUILD" or "HISTORICAL_REFERENCE"))
                throw OperationalRelationshipProblem.BadRequest("invalid_historical_interpretation",
                    "A protected return interpretation requires one historical Work Order and no active Work Order.");
            if (status == "RMA_DECISION_PENDING" && current.RmaReworkControl is null)
                throw OperationalRelationshipProblem.Conflict("active_rma_membership_required",
                    "RMA decision pending requires active RMA/Rework membership.");
            if (status == "RETURN_REVIEW_REQUIRED" && current.QuantityOrdered >= 0)
                throw OperationalRelationshipProblem.BadRequest("negative_quantity_required",
                    "Return-review protection requires a negative current quantity.");
        }

        var membership = current.RmaReworkControl;
        if (request.RmaCaseId is not null && request.RmaCaseId != membership?.CaseId)
            throw OperationalRelationshipProblem.Conflict("rma_membership_changed",
                "The active RMA/Rework case changed. Reload the relationship before recording a decision.");
        if (request.RmaMemberSequence is not null && request.RmaMemberSequence != membership?.MemberSequence)
            throw OperationalRelationshipProblem.Conflict("rma_membership_changed",
                "The active RMA/Rework member changed. Reload the relationship before recording a decision.");

        var appended = await interpretations.AppendAsync(key,
            membership?.CaseId, membership?.MemberSequence, active, historical, role, status,
            reason, actor, request.ExpectedPriorEventId,
            request.RequestCorrelationId is { } correlation && correlation != Guid.Empty
                ? correlation : Guid.NewGuid(), token);
        return await LoadAsync(key, token) with { RequestCorrelationId = appended.RequestCorrelationId };
    }

    private async Task<CanonicalRelationship> LoadRelationshipAsync(LineKey key, CancellationToken token)
    {
        using var page = await GetPageAsync(
            "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=2" +
            $"&customerNumber={key.Customer}&salesOrderNumber={key.SalesOrder}&salesOrderLineNumber={key.Line}", token);
        var items = page.RootElement.GetProperty("items");
        if (items.GetArrayLength() != 1)
            throw OperationalRelationshipProblem.NotFound("sales_order_line_relationship_not_found",
                "The current canonical relationship record was not found.");
        return CanonicalRelationship.From(items[0]);
    }

    private async Task<List<HistoricalWorkOrderEvidence>> LoadHistoricalEvidenceAsync(LineKey key,
        CanonicalRelationship relationship, DateTime? occurrenceDate, CancellationToken token)
    {
        var positiveInvoiceWorkOrders = new HashSet<string>(StringComparer.Ordinal);
        using (var invoicePage = await GetPageAsync(
            "/api/platform/live/v1/invoice-history?page=1&pageSize=100" +
            $"&customerNumber={key.Customer}&salesOrderNumber={key.SalesOrder}&salesOrderLineNumber={key.Line}", token))
        {
            foreach (var invoice in invoicePage.RootElement.GetProperty("items").EnumerateArray())
            {
                var number = NormalizeWorkOrder(Text(invoice, "workOrderNumber"));
                var invoiceDate = Date(Text(invoice, "invoiceDate"));
                if (number is not null && Number(invoice, "quantityShipped") > 0 &&
                    (occurrenceDate is null || invoiceDate is null || invoiceDate < occurrenceDate))
                    positiveInvoiceWorkOrders.Add(number);
            }
        }

        var results = new List<HistoricalWorkOrderEvidence>();
        foreach (var number in relationship.EvidenceWorkOrders)
        {
            using var page = await GetPageAsync(
                "/api/platform/live/v1/work-orders?page=1&pageSize=2&workOrderNumber=" +
                Uri.EscapeDataString(number), token);
            var items = page.RootElement.GetProperty("items");
            DateTime? opened = null;
            if (items.GetArrayLength() == 1)
                opened = Date(Text(items[0], "workOrderOpenedDateIso"));
            var predates = occurrenceDate is not null && opened is not null && opened < occurrenceDate;
            var original = predates && positiveInvoiceWorkOrders.Contains(number);
            results.Add(new HistoricalWorkOrderEvidence(number,
                original ? "ORIGINAL_BUILD" : "HISTORICAL_REFERENCE", predates,
                positiveInvoiceWorkOrders.Contains(number), opened,
                original
                    ? "Work Order predates the current return and is supported by earlier positive invoice history."
                    : "Canonical Work Order evidence retained as historical context for protected return review."));
        }
        return results;
    }

    private async Task<bool> WorkOrderExistsAsync(string number, CancellationToken token)
    {
        using var page = await GetPageAsync(
            "/api/platform/live/v1/work-orders?page=1&pageSize=2&workOrderNumber=" +
            Uri.EscapeDataString(number), token);
        return page.RootElement.GetProperty("items").GetArrayLength() == 1;
    }

    private async Task<JsonElement> GetExactAsync(string path, CancellationToken token)
    {
        using var response = await canonical.GetAsync(path, token);
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw OperationalRelationshipProblem.NotFound("sales_order_line_not_found",
                "The current canonical Sales Order line was not found.");
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        return document.RootElement.Clone();
    }

    private async Task<JsonDocument> GetPageAsync(string path, CancellationToken token)
    {
        using var response = await canonical.GetAsync(path, token);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
    }

    private static string NormalizeStatus(string? value)
    {
        var status = (value ?? "").Trim().ToUpperInvariant();
        if (status is not ("RETURN_REVIEW_REQUIRED" or "RMA_DECISION_PENDING" or "RMA_WORK_ORDER_ASSIGNED"))
            throw OperationalRelationshipProblem.BadRequest("invalid_operational_status",
                "The resulting operational status is not supported.");
        return status;
    }

    private static string NormalizeRole(string? value)
    {
        var role = (value ?? "").Trim().ToUpperInvariant();
        if (role is not ("ORIGINAL_BUILD" or "HISTORICAL_REFERENCE" or "RMA_ASSIGNED"))
            throw OperationalRelationshipProblem.BadRequest("invalid_relationship_role",
                "The Work Order relationship role is not supported.");
        return role;
    }

    internal static string? NormalizeWorkOrder(string? value)
    {
        value = (value ?? "").Trim();
        if (value.Length == 0) return null;
        if (!Regex.IsMatch(value, "^[0-9]{1,7}$"))
            throw OperationalRelationshipProblem.BadRequest("malformed_work_order",
                "The Work Order number is malformed.");
        return value.PadLeft(7, '0');
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.ToString().Trim() : null;
    private static decimal Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && decimal.TryParse(value.ToString(), out var number)
            ? number : 0m;
    private static DateTime? Date(string? value) =>
        DateTime.TryParse(value, out var result) ? result.Date : null;
}

internal static class OperationalWorkOrderRelationshipRules
{
    public static OperationalRelationshipPresentation Resolve(OperationalRelationshipInput input)
    {
        var negative = input.QuantityOrdered < 0;
        var rma = input.RmaMembership;
        var recorded = input.CurrentInterpretation;
        var active = (string?)null;
        var source = "NONE";
        string status;
        string route;
        string decision;
        string reason;

        if (rma is not null && recorded?.ResultingOperationalStatus == "RMA_WORK_ORDER_ASSIGNED" &&
            !string.IsNullOrWhiteSpace(recorded.ActiveWorkOrderNumber))
        {
            active = recorded.ActiveWorkOrderNumber;
            source = "RMA_DECISION";
            status = "RMA_WORK_ORDER_ASSIGNED";
            route = "RMA_REWORK";
            decision = "Existing Work Order Assigned";
            reason = recorded.Reason;
        }
        else if (rma is not null)
        {
            status = "RMA_DECISION_PENDING";
            route = "RMA_REWORK";
            decision = "Decision Pending";
            reason = "Active RMA/Rework membership controls this Sales Order line; normal production Work Order evidence is historical only.";
        }
        else if (negative)
        {
            status = "RETURN_REVIEW_REQUIRED";
            route = "RETURN_RMA_REVIEW_REQUIRED";
            decision = "Return Review Required";
            reason = "Negative current quantity blocks automatic normal-production Work Order interpretation pending RMA/return review.";
        }
        else if (input.CurrentApproval?.DecisionClassification == "NO_WORK_ORDER_REQUIRED_COMPONENT")
        {
            status = "NO_WORK_ORDER_REQUIRED";
            route = "DIRECT_FULFILLMENT";
            decision = "No Work Order Required";
            reason = input.CurrentApproval.DecisionReason;
        }
        else if (!string.IsNullOrWhiteSpace(input.CurrentApproval?.ApprovedWorkOrderNumber))
        {
            active = input.CurrentApproval.ApprovedWorkOrderNumber;
            source = "APPROVED";
            status = "ACTIVE_PRODUCTION_WORK_ORDER";
            route = "NORMAL_PRODUCTION";
            decision = "Approved Work Order";
            reason = "Current governed normal-production Work Order approval.";
        }
        else if (input.CanonicalRelationship.Status == "EXACT_LINE_UNIQUE" &&
                 !string.IsNullOrWhiteSpace(input.CanonicalRelationship.ExactWorkOrder))
        {
            active = input.CanonicalRelationship.ExactWorkOrder;
            source = "CANONICAL_EXACT";
            status = "ACTIVE_PRODUCTION_WORK_ORDER";
            route = "NORMAL_PRODUCTION";
            decision = "ERP Confirmed";
            reason = "Positive normal-production line with an exact canonical ERP relationship.";
        }
        else
        {
            status = input.CanonicalRelationship.Status;
            route = "NORMAL_PRODUCTION_REVIEW";
            decision = "Work Order Review Required";
            reason = "Canonical evidence is not an actionable exact or approved Work Order.";
        }

        return new OperationalRelationshipPresentation(
            input.Key.Customer, input.Key.SalesOrder, input.Key.Line, input.QuantityOrdered,
            input.CanonicalRelationship.Raw, active, source, input.HistoricalWorkOrders,
            status, route, decision, reason,
            rma is null ? null : new OperationalRmaControl(rma.CaseId, rma.MemberSequence,
                rma.CaseReference), recorded, null,
            FulfillmentRequired: true,
            ShippingRequired: true,
            ProductionWorkOrderRequired: route is "NORMAL_PRODUCTION" or "NORMAL_PRODUCTION_REVIEW");
    }
}

internal sealed class OperationalInterpretationRepository
{
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;

    public async Task<OperationalInterpretationEvent?> GetCurrentAsync(LineKey key, CancellationToken token,
        SqlConnection? connection = null, SqlTransaction? transaction = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand("""
SELECT EventId,RmaCaseId,RmaMemberSequence,ActiveWorkOrderNumber,HistoricalWorkOrderNumber,
       RelationshipRole,ResultingOperationalStatus,Reason,RecordedBy,RecordedAtUtc,
       SupersedesEventId,RequestCorrelationId
FROM operational.vw_CurrentSalesOrderLineWorkOrderInterpretation
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line;
""", connection, transaction);
            AddKey(command, key);
            await using var reader = await command.ExecuteReaderAsync(token);
            return await reader.ReadAsync(token) ? OperationalInterpretationEvent.From(reader) : null;
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }

    public async Task<OperationalInterpretationEvent> AppendAsync(LineKey key, Guid? caseId,
        int? memberSequence, string? active, string? historical, string role, string status,
        string reason, string actor, Guid? expectedPrior, Guid correlation, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(
            IsolationLevel.Serializable, token);
        var actual = await GetCurrentAsync(key, token, connection, transaction);
        if (actual?.EventId != expectedPrior)
            throw OperationalRelationshipProblem.Conflict("interpretation_changed",
                "The operational Work Order interpretation changed. Reload before recording a decision.");
        var eventId = Guid.NewGuid();
        var command = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderInterpretationEvent
(EventId,RmaCaseId,RmaMemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,
 ActiveWorkOrderNumber,HistoricalWorkOrderNumber,RelationshipRole,ResultingOperationalStatus,
 Reason,RecordedBy,SupersedesEventId,RequestCorrelationId)
VALUES
(@EventId,@CaseId,@MemberSequence,@Customer,@SalesOrder,@Line,@Active,@Historical,@Role,
 @Status,@Reason,@Actor,@Supersedes,@Correlation);
""", connection, transaction);
        AddKey(command, key);
        command.Parameters.AddWithValue("@EventId", eventId);
        command.Parameters.AddWithValue("@CaseId", (object?)caseId ?? DBNull.Value);
        command.Parameters.AddWithValue("@MemberSequence", (object?)memberSequence ?? DBNull.Value);
        command.Parameters.AddWithValue("@Active", (object?)active ?? DBNull.Value);
        command.Parameters.AddWithValue("@Historical", (object?)historical ?? DBNull.Value);
        command.Parameters.AddWithValue("@Role", role);
        command.Parameters.AddWithValue("@Status", status);
        command.Parameters.AddWithValue("@Reason", reason);
        command.Parameters.AddWithValue("@Actor", actor);
        command.Parameters.AddWithValue("@Supersedes", (object?)expectedPrior ?? DBNull.Value);
        command.Parameters.AddWithValue("@Correlation", correlation);
        await command.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
        return new OperationalInterpretationEvent(eventId, caseId, memberSequence, active,
            historical, role, status, reason, actor, DateTime.UtcNow, expectedPrior, correlation);
    }

    private static void AddKey(SqlCommand command, LineKey key)
    {
        command.Parameters.AddWithValue("@Customer", key.Customer);
        command.Parameters.AddWithValue("@SalesOrder", key.SalesOrder);
        command.Parameters.AddWithValue("@Line", key.Line);
    }
}

internal sealed record OperationalRelationshipInput(LineKey Key, decimal QuantityOrdered,
    CanonicalRelationship CanonicalRelationship, DecisionRecord? CurrentApproval,
    RmaReworkMembership? RmaMembership, OperationalInterpretationEvent? CurrentInterpretation,
    IReadOnlyList<HistoricalWorkOrderEvidence> HistoricalWorkOrders);

internal sealed record OperationalRelationshipPresentation(string CustomerNumber,
    string SalesOrderNumber, string SalesOrderLineNumber, decimal QuantityOrdered,
    JsonElement CanonicalRelationship, string? ActiveWorkOrderNumber, string ActiveWorkOrderSource,
    IReadOnlyList<HistoricalWorkOrderEvidence> HistoricalWorkOrders,
    string OperationalStatus, string OperationalRoute, string WorkOrderDecision, string Reason,
    OperationalRmaControl? RmaReworkControl, OperationalInterpretationEvent? CurrentInterpretation,
    Guid? RequestCorrelationId, bool FulfillmentRequired, bool ShippingRequired,
    bool ProductionWorkOrderRequired);

internal sealed record HistoricalWorkOrderEvidence(string WorkOrderNumber, string RelationshipRole,
    bool PredatesCurrentOccurrence, bool PositiveInvoiceEvidence, DateTime? WorkOrderOpenedDate,
    string EvidenceSummary);

internal sealed record OperationalRmaControl(Guid CaseId, int MemberSequence, string CaseReference);

internal sealed record OperationalInterpretationEvent(Guid EventId, Guid? RmaCaseId,
    int? RmaMemberSequence, string? ActiveWorkOrderNumber, string? HistoricalWorkOrderNumber,
    string RelationshipRole, string ResultingOperationalStatus, string Reason, string RecordedBy,
    DateTime RecordedAtUtc, Guid? SupersedesEventId, Guid RequestCorrelationId)
{
    public static OperationalInterpretationEvent From(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.IsDBNull(1) ? null : reader.GetGuid(1),
        reader.IsDBNull(2) ? null : reader.GetInt32(2), reader.IsDBNull(3) ? null : reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetString(5), reader.GetString(6),
        reader.GetString(7), reader.GetString(8), reader.GetDateTime(9),
        reader.IsDBNull(10) ? null : reader.GetGuid(10), reader.GetGuid(11));
}

internal sealed class OperationalInterpretationRequest
{
    public Guid? RmaCaseId { get; set; }
    public int? RmaMemberSequence { get; set; }
    public string? ActiveWorkOrderNumber { get; set; }
    public string? HistoricalWorkOrderNumber { get; set; }
    public string? RelationshipRole { get; set; }
    public string? ResultingOperationalStatus { get; set; }
    public string? Reason { get; set; }
    public Guid? ExpectedPriorEventId { get; set; }
    public Guid? RequestCorrelationId { get; set; }
}

internal sealed class OperationalRelationshipProblem : Exception
{
    public int StatusCode { get; }
    public string Code { get; }
    private OperationalRelationshipProblem(int statusCode, string code, string message) : base(message)
        => (StatusCode, Code) = (statusCode, code);
    public static OperationalRelationshipProblem BadRequest(string code, string message) => new(400, code, message);
    public static OperationalRelationshipProblem Unauthorized(string code, string message) => new(401, code, message);
    public static OperationalRelationshipProblem NotFound(string code, string message) => new(404, code, message);
    public static OperationalRelationshipProblem Conflict(string code, string message) => new(409, code, message);
}
