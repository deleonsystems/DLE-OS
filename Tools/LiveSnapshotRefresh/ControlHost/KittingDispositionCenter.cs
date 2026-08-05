using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class KittingDispositionCenter
{
    private const string Route = "/api/kitting-dispositions/v1/work-orders/{workOrderNumber}";

    public static void MapKittingDispositions(this WebApplication app, string policy)
    {
        var service = new KittingDispositionService();
        app.MapGet(Route, async (string workOrderNumber, CancellationToken token) =>
            await Execute(() => service.GetCurrentAsync(workOrderNumber, token))).RequireAuthorization(policy);
        app.MapGet(Route + "/history", async (string workOrderNumber, CancellationToken token) =>
            await Execute(() => service.GetHistoryAsync(workOrderNumber, token))).RequireAuthorization(policy);
        app.MapPost(Route + "/events", async (string workOrderNumber, KittingDispositionRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.AppendAsync(workOrderNumber, request,
                context.User.Identity?.Name ?? "", token))).RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> operation)
    {
        try { return Results.Json(await operation()); }
        catch (KittingDispositionProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message }, statusCode: problem.StatusCode);
        }
        catch (SqlException)
        {
            return Results.Json(new { code = "kitting_disposition_store_unavailable", message = "The governed kitting disposition store is unavailable." }, statusCode: 503);
        }
        catch (HttpRequestException)
        {
            return Results.Json(new { code = "canonical_evidence_unavailable", message = "Current canonical eligibility evidence is unavailable." }, statusCode: 503);
        }
    }
}

internal sealed class KittingDispositionService
{
    private readonly KittingDispositionRepository repository = new();
    private readonly HttpClient canonical;
    private readonly CanonicalKittingEvidenceResolver evidenceResolver;
    private readonly OperationalWorkOrderRelationshipService operationalRelationships;
    private readonly string shortageRoot;
    private readonly string completeRoot;
    private readonly string shipmentStagingPath;

    public KittingDispositionService()
    {
        canonical = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
        shortageRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_SHORTAGE_ROOT") ?? @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
        completeRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_COMPLETE_ROOT") ?? @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
        shipmentStagingPath = Environment.GetEnvironmentVariable("DLE_OS_SHIPMENT_STAGING_PATH") ??
            @"C:\DLE-OS\Repositories\DLE-OS\DATA\shipment-staging\shipment-staging.json";
        evidenceResolver = new CanonicalKittingEvidenceResolver(canonical);
        operationalRelationships = new OperationalWorkOrderRelationshipService(canonical);
    }

    public async Task<object> GetCurrentAsync(string workOrderNumber, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderNumber);
        var current = await repository.GetCurrentAsync(workOrder, token);
        return new { workOrderNumber = workOrder, currentDisposition = current?.ResultingDisposition ?? "NOT_DISPOSITIONED", currentEvent = current };
    }

    public async Task<object> GetHistoryAsync(string workOrderNumber, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderNumber);
        return new { workOrderNumber = workOrder, history = await repository.GetHistoryAsync(workOrder, token) };
    }

    public async Task<object> AppendAsync(string workOrderNumber, KittingDispositionRequest request,
        string authenticatedUser, CancellationToken token)
    {
        var submittedWorkOrder = ValidateSubmittedWorkOrder(workOrderNumber);
        if (string.IsNullOrWhiteSpace(authenticatedUser))
            throw KittingDispositionProblem.Unauthorized("authenticated_identity_required", "An authenticated employee identity is required.");
        var eligibility = await LoadEligibilityAsync(submittedWorkOrder, request, token);
        var workOrder = eligibility.CanonicalWorkOrderNumber;
        var current = await repository.GetCurrentAsync(workOrder, token);
        var rule = ValidateRequest(request, current);
        var normalized = new NormalizedDispositionRequest(rule.ResultingDisposition, rule.ReasonCode, rule.Note);
        var evidence = CaptureDocumentEvidence(workOrder);
        var appended = await repository.AppendAsync(workOrder, normalized, current, eligibility,
            evidence, authenticatedUser, token);
        return new
        {
            submittedWorkOrderNumber = submittedWorkOrder,
            workOrderNumber = workOrder,
            currentDisposition = appended.ResultingDisposition,
            currentEvent = appended,
            history = await repository.GetHistoryAsync(workOrder, token)
        };
    }

    internal static KittingDispositionRuleResult ValidateRequest(KittingDispositionRequest request, KittingDispositionEvent? current)
    {
        try { return KittingDispositionRules.Validate(request.ResultingDisposition, request.ReasonCode, request.Note,
            request.ExpectedCurrentEventId, current?.EventId, current?.ResultingDisposition); }
        catch (KittingDispositionRuleException error)
        {
            if (error.Code == "current_disposition_changed")
                throw KittingDispositionProblem.Conflict(error.Code, error.Message);
            throw KittingDispositionProblem.BadRequest(error.Code, error.Message);
        }
    }

    private async Task<KittingEligibility> LoadEligibilityAsync(string submittedWorkOrder, KittingDispositionRequest request, CancellationToken token)
    {
        var customer = NormalizeDigits(request.CustomerNumber, 6, "Customer number");
        var salesOrder = NormalizeDigits(request.OriginSalesOrderNumber, 7, "Origin Sales Order");
        var line = NormalizeDigits(request.OriginSalesOrderLineNumber, 3, "Origin Sales Order line");
        var operational = await operationalRelationships.LoadAsync(
            LineKey.Create(customer, salesOrder, line), token);
        var submittedCanonical = CanonicalWorkOrderIdentity.NormalizeCanonical(submittedWorkOrder);
        if (operational.OperationalRoute != "NORMAL_PRODUCTION" ||
            operational.ActiveWorkOrderNumber != submittedCanonical)
            throw KittingDispositionProblem.BadRequest("operational_work_order_not_actionable",
                "RMA/return review or another governed interpretation prevents ordinary production kitting for this Sales Order line.");
        var resolved = await evidenceResolver.ResolveAsync(submittedWorkOrder, customer, salesOrder, line, token);
        var erpOpen = Number(resolved.SalesOrderLine, "erpQuantityOpen");
        var pending = LoadPendingInvoiceQuantity(customer, salesOrder, line);
        var operationalOpen = Math.Max(erpOpen - pending, 0m);
        if (operationalOpen <= 0)
            throw KittingDispositionProblem.BadRequest("positive_open_quantity_required", "The governed Work Order must have positive operational open quantity.");

        return new(resolved.CanonicalWorkOrderNumber, customer,
            Text(resolved.WorkOrder, "itemNumber") ?? "",
            Text(resolved.WorkOrder, "drawingRevision") ?? Text(resolved.WorkOrder, "bomRevision"), salesOrder, line,
            resolved.CanonicalAnchorSalesOrderNumber, resolved.CanonicalAnchorSalesOrderLineNumber,
            resolved.GoverningSource);
    }

    private decimal LoadPendingInvoiceQuantity(string customer, string salesOrder, string line)
    {
        if (!File.Exists(shipmentStagingPath)) return 0m;
        using var document = JsonDocument.Parse(File.ReadAllText(shipmentStagingPath));
        if (!document.RootElement.TryGetProperty("records", out var records)) return 0m;
        decimal total = 0;
        foreach (var record in records.EnumerateArray())
            if (string.Equals(Text(record, "status"), "Pending Invoice", StringComparison.OrdinalIgnoreCase) &&
                NormalizeLoose(Text(record, "customerNumber"), 6) == customer &&
                NormalizeLoose(Text(record, "salesOrder"), 7) == salesOrder &&
                NormalizeLoose(Text(record, "salesOrderLine"), 3) == line)
                total += Number(record, "quantityShipped");
        return total;
    }

    private KittingDocumentSnapshot CaptureDocumentEvidence(string workOrder)
    {
        var aliases = new[] { workOrder, workOrder.TrimStart('0') }.Where(value => value.Length > 0).Distinct().ToArray();
        string? Find(string root) => aliases.Select(alias => alias + ".pdf").FirstOrDefault(file => File.Exists(Path.Combine(root, file)));
        var complete = Find(completeRoot);
        var shortage = Find(shortageRoot);
        var status = complete is not null && shortage is not null ? "KIT_COMPLETE_WITH_PRIOR_SHORTAGE_EVIDENCE" :
            complete is not null ? "KIT_COMPLETE_EVIDENCE" : shortage is not null ? "KIT_SHORT_EVIDENCE" : "NO_KITTED_BOM_EVIDENCE";
        return new(status, complete, shortage);
    }

    internal static string NormalizeWorkOrder(string? value) => NormalizeDigits(value, 7, "Work Order");
    internal static string ValidateSubmittedWorkOrder(string? value)
    {
        if (!CanonicalWorkOrderIdentity.TryValidateSubmitted(value, out var submitted))
            throw KittingDispositionProblem.BadRequest("malformed_identifier", "Work Order is malformed.");
        return submitted;
    }
    private static string NormalizeDigits(string? value, int width, string label)
    {
        value = (value ?? "").Trim();
        if (!Regex.IsMatch(value, $"^[0-9]{{1,{width}}}$"))
            throw KittingDispositionProblem.BadRequest("malformed_identifier", label + " is malformed.");
        return value.PadLeft(width, '0');
    }
    private static string NormalizeLoose(string? value, int width) => (value ?? "").Trim().PadLeft(width, '0');
    private static string? Text(JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString().Trim() : null;
    private static decimal Number(JsonElement element, string name) => element.TryGetProperty(name, out var value) && decimal.TryParse(value.ToString(), out var number) ? number : 0m;
}

internal sealed class CanonicalKittingEvidenceResolver
{
    private readonly HttpClient canonical;

    public CanonicalKittingEvidenceResolver(HttpClient canonical) => this.canonical = canonical;

    public async Task<ResolvedCanonicalKittingEvidence> ResolveAsync(string submittedWorkOrder, string customer,
        string salesOrder, string line, CancellationToken token)
    {
        var identity = await ResolveWorkOrderAsync(submittedWorkOrder, token);
        var relationship = await GetUniquePageItemAsync(
            "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=2" +
            $"&customerNumber={customer}&salesOrderNumber={salesOrder}&salesOrderLineNumber={line}",
            "sales_order_relationship_missing", "sales_order_relationship_ambiguous",
            "No governed relationship evidence exists for the submitted Sales Order line.",
            "Multiple governed relationship records exist for the submitted Sales Order line.", token);

        var relationshipStatus = Text(relationship, "resolutionStatus") ?? Text(relationship, "status") ?? "UNRESOLVED";
        var actionable = NormalizeOptionalWorkOrder(Text(relationship, "actionableWorkOrderNumber"));
        var governingSource = "";
        if (relationshipStatus == "EXACT_LINE_UNIQUE" && actionable == identity.CanonicalWorkOrderNumber)
            governingSource = "EXACT";
        else
        {
            var approval = await new ApprovalRepository().GetCurrentAsync(LineKey.Create(customer, salesOrder, line), token);
            if (NormalizeOptionalWorkOrder(approval?.ApprovedWorkOrderNumber) == identity.CanonicalWorkOrderNumber)
                governingSource = "APPROVED";
        }
        if (governingSource.Length == 0)
            throw KittingDispositionProblem.BadRequest("work_order_not_governed",
                "The Work Order is not governed by the exact relationship or current approval for this Sales Order line.");

        var workOrderCustomer = NormalizeOptionalDigits(Text(identity.WorkOrder, "customerNumber"), 6);
        var workOrderSalesOrder = NormalizeOptionalDigits(Text(identity.WorkOrder, "salesOrderNumber"), 7);
        var workOrderLine = NormalizeOptionalDigits(Text(identity.WorkOrder, "salesOrderLineNumber"), 3);
        var relationshipAnchor = NormalizeOptionalDigits(Text(relationship, "anchorSalesOrderLine"), 3);
        if (workOrderCustomer != customer || workOrderSalesOrder != salesOrder || workOrderLine is null ||
            (governingSource == "EXACT" && (workOrderLine != line || relationshipAnchor != line)))
            throw KittingDispositionProblem.BadRequest("relationship_anchor_mismatch",
                "The canonical Work Order anchor does not match the governed Sales Order relationship.");

        var salesOrderLineId = customer + salesOrder + line;
        var salesOrderLine = await GetExactAsync(
            "/api/platform/live/v1/sales-orders/" + Uri.EscapeDataString(salesOrderLineId),
            "open_sales_order_line_missing", "The governed open Sales Order line was not found.", token);
        if (NormalizeOptionalDigits(Text(salesOrderLine, "customerNumber"), 6) != customer ||
            NormalizeOptionalDigits(Text(salesOrderLine, "salesOrderNumber"), 7) != salesOrder ||
            NormalizeOptionalDigits(Text(salesOrderLine, "lineNumber"), 3) != line)
            throw KittingDispositionProblem.BadRequest("sales_order_line_identity_mismatch",
                "The canonical Sales Order line returned for the governed identity did not match its requested key.");

        return new(identity.SubmittedWorkOrderNumber, identity.CanonicalWorkOrderNumber, identity.WorkOrder,
            relationship, salesOrderLine, workOrderSalesOrder, workOrderLine, governingSource);
    }

    internal async Task<ResolvedCanonicalWorkOrder> ResolveWorkOrderAsync(string submittedWorkOrder, CancellationToken token)
    {
        var aliases = CanonicalWorkOrderIdentity.GetLookupAliases(submittedWorkOrder);
        JsonElement? resolved = null;
        string? resolvedNumber = null;
        foreach (var alias in aliases)
        {
            var page = await GetPageAsync("/api/platform/live/v1/work-orders?page=1&pageSize=200&workOrderNumber=" +
                Uri.EscapeDataString(alias), token);
            if (page.TotalItems > 1 || page.Items.GetArrayLength() > 1)
                throw KittingDispositionProblem.BadRequest("canonical_work_order_ambiguous",
                    $"Multiple canonical Work Order records matched alias {alias}.");
            if (page.TotalItems == 0) continue;
            if (page.Items.GetArrayLength() != 1)
                throw KittingDispositionProblem.BadRequest("canonical_work_order_incomplete",
                    "The canonical Work Order query returned an incomplete result page.");
            var candidate = page.Items[0].Clone();
            var candidateNumber = CanonicalWorkOrderIdentity.NormalizeCanonical(Text(candidate, "workOrderNumber"));
            if (candidateNumber is null)
                throw KittingDispositionProblem.BadRequest("canonical_work_order_identity_invalid",
                    "The canonical Work Order record has an invalid Work Order identity.");
            if (resolvedNumber is not null && resolvedNumber != candidateNumber)
                throw KittingDispositionProblem.BadRequest("canonical_work_order_ambiguous",
                    "The submitted Work Order aliases resolve to different canonical Work Orders.");
            resolved = candidate;
            resolvedNumber = candidateNumber;
        }
        if (resolved is null || resolvedNumber is null)
            throw KittingDispositionProblem.BadRequest("canonical_work_order_not_found",
                "No canonical Work Order matched the submitted identity or its governed leading-zero alias.");
        return new(submittedWorkOrder, resolvedNumber, resolved.Value);
    }

    private async Task<JsonElement> GetUniquePageItemAsync(string path, string missingCode, string ambiguousCode,
        string missingMessage, string ambiguousMessage, CancellationToken token)
    {
        var page = await GetPageAsync(path, token);
        if (page.TotalItems == 0) throw KittingDispositionProblem.BadRequest(missingCode, missingMessage);
        if (page.TotalItems != 1 || page.Items.GetArrayLength() != 1)
            throw KittingDispositionProblem.BadRequest(ambiguousCode, ambiguousMessage);
        return page.Items[0].Clone();
    }

    private async Task<CanonicalPage> GetPageAsync(string path, CancellationToken token)
    {
        using var response = await canonical.GetAsync(path, token);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        var root = document.RootElement;
        var items = root.GetProperty("items").Clone();
        var totalItems = root.TryGetProperty("totalItems", out var total) && total.TryGetInt32(out var count)
            ? count : items.GetArrayLength();
        return new(items, totalItems);
    }

    private async Task<JsonElement> GetExactAsync(string path, string missingCode, string missingMessage,
        CancellationToken token)
    {
        using var response = await canonical.GetAsync(path, token);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            throw KittingDispositionProblem.BadRequest(missingCode, missingMessage);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        return document.RootElement.Clone();
    }

    private static string? NormalizeOptionalWorkOrder(string? value) => CanonicalWorkOrderIdentity.NormalizeCanonical(value);
    private static string? NormalizeOptionalDigits(string? value, int width) =>
        Regex.IsMatch((value ?? "").Trim(), $"^[0-9]{{1,{width}}}$") ? value!.Trim().PadLeft(width, '0') : null;
    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString().Trim() : null;
}

internal sealed record CanonicalPage(JsonElement Items, int TotalItems);
internal sealed record ResolvedCanonicalWorkOrder(string SubmittedWorkOrderNumber, string CanonicalWorkOrderNumber, JsonElement WorkOrder);
internal sealed record ResolvedCanonicalKittingEvidence(string SubmittedWorkOrderNumber, string CanonicalWorkOrderNumber,
    JsonElement WorkOrder, JsonElement Relationship, JsonElement SalesOrderLine,
    string CanonicalAnchorSalesOrderNumber, string CanonicalAnchorSalesOrderLineNumber, string GoverningSource);

internal sealed class KittingDispositionRepository
{
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;
    private const string Columns = "EventId,EventType,ResultingDisposition,PreviousDisposition,ReasonCode,Note,CustomerNumber,AssemblyItemNumber,Revision,OriginSalesOrderNumber,OriginSalesOrderLineNumber,CanonicalAnchorSalesOrderNumber,CanonicalAnchorSalesOrderLineNumber,GoverningRelationshipSource,RecordedBy,RecordedAtUtc,SupersedesEventId,ExpectedPriorEventId,DocumentEvidenceStatus,CompleteEvidenceFileName,ShortageEvidenceFileName,CreatedAtUtc,RequestCorrelationId";

    public async Task<KittingDispositionEvent?> GetCurrentAsync(string workOrder, CancellationToken token, SqlConnection? connection = null, SqlTransaction? transaction = null)
    {
        var owns = connection is null; connection ??= new SqlConnection(connectionString); if (owns) await connection.OpenAsync(token);
        try { var command = new SqlCommand($"SELECT {Columns} FROM operational.vw_CurrentKittingDisposition WHERE WorkOrderNumber=@WorkOrder;", connection, transaction); command.Parameters.AddWithValue("@WorkOrder", workOrder); await using var reader = await command.ExecuteReaderAsync(token); return await reader.ReadAsync(token) ? KittingDispositionEvent.From(reader) : null; }
        finally { if (owns) await connection.DisposeAsync(); }
    }

    public async Task<IReadOnlyList<KittingDispositionEvent>> GetHistoryAsync(string workOrder, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var command = new SqlCommand($"SELECT TOP (100) {Columns} FROM operational.KittingDispositionEvent WHERE WorkOrderNumber=@WorkOrder ORDER BY EventSequence DESC;", connection); command.Parameters.AddWithValue("@WorkOrder", workOrder);
        var events = new List<KittingDispositionEvent>(); await using var reader = await command.ExecuteReaderAsync(token); while (await reader.ReadAsync(token)) events.Add(KittingDispositionEvent.From(reader)); return events;
    }

    public async Task<KittingDispositionEvent> AppendAsync(string workOrder, NormalizedDispositionRequest request,
        KittingDispositionEvent? expected, KittingEligibility eligibility, KittingDocumentSnapshot evidence,
        string recordedBy, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        var actual = await GetCurrentAsync(workOrder, token, connection, transaction);
        if (actual?.EventId != expected?.EventId) throw KittingDispositionProblem.Conflict("current_disposition_changed", "The current disposition changed while the event was being recorded.");
        var id = Guid.NewGuid(); var correlation = Guid.NewGuid();
        var command = new SqlCommand("""
INSERT operational.KittingDispositionEvent
(EventId,WorkOrderNumber,EventType,ResultingDisposition,PreviousDisposition,ReasonCode,Note,CustomerNumber,AssemblyItemNumber,Revision,OriginSalesOrderNumber,OriginSalesOrderLineNumber,CanonicalAnchorSalesOrderNumber,CanonicalAnchorSalesOrderLineNumber,GoverningRelationshipSource,RecordedBy,SupersedesEventId,ExpectedPriorEventId,DocumentEvidenceStatus,CompleteEvidenceFileName,ShortageEvidenceFileName,RequestCorrelationId)
VALUES (@Id,@WorkOrder,@Type,@Result,@Previous,@Reason,@Note,@Customer,@Assembly,@Revision,@OriginSO,@OriginLine,@AnchorSO,@AnchorLine,@Source,@By,@Supersedes,@Expected,@Evidence,@Complete,@Shortage,@Correlation);
""", connection, transaction);
        void Add(string name, object? value) => command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        Add("@Id", id); Add("@WorkOrder", workOrder); Add("@Type", actual is null ? request.ResultingDisposition : "KIT_DISPOSITION_CHANGED"); Add("@Result", request.ResultingDisposition); Add("@Previous", actual?.ResultingDisposition ?? "NOT_DISPOSITIONED"); Add("@Reason", request.ReasonCode); Add("@Note", request.Note); Add("@Customer", eligibility.CustomerNumber); Add("@Assembly", eligibility.AssemblyItemNumber); Add("@Revision", eligibility.Revision); Add("@OriginSO", eligibility.OriginSalesOrderNumber); Add("@OriginLine", eligibility.OriginSalesOrderLineNumber); Add("@AnchorSO", eligibility.CanonicalAnchorSalesOrderNumber); Add("@AnchorLine", eligibility.CanonicalAnchorSalesOrderLineNumber); Add("@Source", eligibility.GoverningSource); Add("@By", recordedBy); Add("@Supersedes", actual?.EventId); Add("@Expected", expected?.EventId); Add("@Evidence", evidence.Status); Add("@Complete", evidence.CompleteFileName); Add("@Shortage", evidence.ShortageFileName); Add("@Correlation", correlation);
        await command.ExecuteNonQueryAsync(token); await transaction.CommitAsync(token);
        return (await GetCurrentAsync(workOrder, token))!;
    }
}

internal sealed record KittingDispositionEvent(Guid EventId, string EventType, string ResultingDisposition,
    string? PreviousDisposition, string? ReasonCode, string? Note, string CustomerNumber, string AssemblyItemNumber,
    string? Revision, string OriginSalesOrderNumber, string OriginSalesOrderLineNumber,
    string CanonicalAnchorSalesOrderNumber, string CanonicalAnchorSalesOrderLineNumber, string GoverningRelationshipSource,
    string RecordedBy, DateTime RecordedAtUtc, Guid? SupersedesEventId, Guid? ExpectedPriorEventId,
    string DocumentEvidenceStatus, string? CompleteEvidenceFileName, string? ShortageEvidenceFileName,
    DateTime CreatedAtUtc, Guid RequestCorrelationId)
{
    public static KittingDispositionEvent From(SqlDataReader r) => new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),r.GetString(6),r.GetString(7),r.IsDBNull(8)?null:r.GetString(8),r.GetString(9),r.GetString(10),r.GetString(11),r.GetString(12),r.GetString(13),r.GetString(14),r.GetDateTime(15),r.IsDBNull(16)?null:r.GetGuid(16),r.IsDBNull(17)?null:r.GetGuid(17),r.GetString(18),r.IsDBNull(19)?null:r.GetString(19),r.IsDBNull(20)?null:r.GetString(20),r.GetDateTime(21),r.GetGuid(22));
}

internal sealed class KittingDispositionRequest
{
    public string? ResultingDisposition { get; set; }
    public string? ReasonCode { get; set; }
    public string? Note { get; set; }
    public Guid? ExpectedCurrentEventId { get; set; }
    public string? CustomerNumber { get; set; }
    public string? OriginSalesOrderNumber { get; set; }
    public string? OriginSalesOrderLineNumber { get; set; }
    public string? AssemblyItemNumber { get; set; }
}
internal sealed record NormalizedDispositionRequest(string ResultingDisposition, string? ReasonCode, string? Note);
internal sealed record KittingEligibility(string CanonicalWorkOrderNumber,string CustomerNumber,string AssemblyItemNumber,string? Revision,string OriginSalesOrderNumber,string OriginSalesOrderLineNumber,string CanonicalAnchorSalesOrderNumber,string CanonicalAnchorSalesOrderLineNumber,string GoverningSource);
internal sealed record KittingDocumentSnapshot(string Status,string? CompleteFileName,string? ShortageFileName);

internal sealed class KittingDispositionProblem : Exception
{
    public int StatusCode { get; } public string Code { get; }
    private KittingDispositionProblem(int status, string code, string message) : base(message) => (StatusCode,Code)=(status,code);
    public static KittingDispositionProblem BadRequest(string code,string message)=>new(400,code,message);
    public static KittingDispositionProblem Unauthorized(string code,string message)=>new(401,code,message);
    public static KittingDispositionProblem Conflict(string code,string message)=>new(409,code,message);
}
