using System.Data;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.SqlClient;

internal static class ShipmentStagingCenter
{
    private const string BaseRoute = "/api/shipment-staging/v1";

    public static void MapShipmentStaging(this WebApplication app, string policy)
    {
        var service = new ShipmentStagingService();
        app.MapPost(BaseRoute + "/shipments", async (ShipmentStagingCreateRequest request,
                HttpContext context, CancellationToken token) => await Execute(context,
                () => service.CreateAsync(request, context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/shipments", async (string? status, string? customerNumber,
                string? salesOrderNumber, string? lineNumber, int? page, int? pageSize,
                HttpContext context, CancellationToken token) => await Execute(context,
                () => service.ListAsync(status, customerNumber, salesOrderNumber, lineNumber,
                    page ?? 1, pageSize ?? 100, token)))
            .RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/shipments/{shipmentStagingId:guid}", async (Guid shipmentStagingId,
                HttpContext context, CancellationToken token) => await Execute(context,
                () => service.GetAsync(shipmentStagingId, token)))
            .RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/shipments/{shipmentStagingId:guid}/history",
                async (Guid shipmentStagingId, HttpContext context, CancellationToken token) =>
                    await Execute(context, () => service.GetHistoryAsync(shipmentStagingId, token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/reconciliation/run", async (ShipmentReconciliationRequest request,
                HttpContext context, CancellationToken token) => await Execute(context,
                () => service.ReconcileAsync(request, context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/shipments/{shipmentStagingId:guid}/confirm-match",
                async (Guid shipmentStagingId, ShipmentMatchDecisionRequest request,
                    HttpContext context, CancellationToken token) => await Execute(context,
                    () => service.DecideAsync(shipmentStagingId, "CONFIRM_MATCH", request,
                        context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/shipments/{shipmentStagingId:guid}/reject-match",
                async (Guid shipmentStagingId, ShipmentMatchDecisionRequest request,
                    HttpContext context, CancellationToken token) => await Execute(context,
                    () => service.DecideAsync(shipmentStagingId, "REJECT_MATCH", request,
                        context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/shipments/{shipmentStagingId:guid}/mark-exception",
                async (Guid shipmentStagingId, ShipmentMatchDecisionRequest request,
                    HttpContext context, CancellationToken token) => await Execute(context,
                    () => service.DecideAsync(shipmentStagingId, "MARK_EXCEPTION", request,
                        context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/shipments/{shipmentStagingId:guid}/cancel",
                async (Guid shipmentStagingId, ShipmentMatchDecisionRequest request,
                    HttpContext context, CancellationToken token) => await Execute(context,
                    () => service.DecideAsync(shipmentStagingId, "CANCEL_SHIPMENT", request,
                        context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(HttpContext context, Func<Task<object>> action)
    {
        var requestId = context.TraceIdentifier;
        context.Response.Headers["X-Request-ID"] = requestId;
        try { return Results.Json(await action()); }
        catch (ShipmentStagingProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message, requestId },
                statusCode: problem.StatusCode);
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            return Results.Json(new { code = "shipment_staging_duplicate",
                message = "This shipment request was already processed.", requestId }, statusCode: 409);
        }
        catch (SqlException error)
        {
            appLog(context).LogError(error, "Shipment staging database request {RequestId} failed.", requestId);
            return Results.Json(new { code = "shipment_staging_database_write_failed",
                message = "The governed Shipment Staging store could not complete the request.", requestId },
                statusCode: 503);
        }
        catch (HttpRequestException error)
        {
            appLog(context).LogError(error, "Shipment invoice evidence request {RequestId} failed.", requestId);
            return Results.Json(new { code = "shipment_invoice_evidence_unavailable",
                message = "Canonical invoice evidence is currently unavailable.", requestId }, statusCode: 503);
        }
        catch (Exception error)
        {
            appLog(context).LogError(error, "Shipment staging request {RequestId} failed.", requestId);
            return Results.Json(new { code = "shipment_staging_store_unavailable",
                message = "The governed Shipment Staging service could not complete the request.", requestId },
                statusCode: 503);
        }
        static ILogger appLog(HttpContext context) =>
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("ShipmentStaging");
    }
}

internal sealed class ShipmentStagingService
{
    private readonly ShipmentStagingRepository repository = new();
    private readonly Func<LineKey, CancellationToken, Task<OperationalRelationshipPresentation>> relationshipLoader;
    private readonly HttpClient canonical;

    public ShipmentStagingService(HttpClient? canonicalClient = null)
    {
        canonical = canonicalClient ?? new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
            Timeout = TimeSpan.FromSeconds(20)
        };
        var relationships = new OperationalWorkOrderRelationshipService(canonical);
        relationshipLoader = relationships.LoadAsync;
    }

    internal ShipmentStagingService(HttpClient canonicalClient,
        Func<LineKey, CancellationToken, Task<OperationalRelationshipPresentation>> relationshipLoader)
    {
        canonical = canonicalClient;
        this.relationshipLoader = relationshipLoader;
    }

    public async Task<object> CreateAsync(ShipmentStagingCreateRequest request, string actor,
        CancellationToken token)
    {
        RequireActor(actor);
        if (request.Lines is not { Count: > 0 })
            throw ShipmentStagingProblem.Validation("At least one shipment line is required.");
        if (string.IsNullOrWhiteSpace(request.RequestId) || request.RequestId.Trim().Length > 100)
            throw ShipmentStagingProblem.Validation("A stable shipment request ID is required.");
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || request.IdempotencyKey.Trim().Length > 130)
            throw ShipmentStagingProblem.Validation("A shipment idempotency key is required.");
        if (request.RequestCorrelationId == Guid.Empty)
            throw ShipmentStagingProblem.Validation("A shipment correlation ID is required.");

        var prepared = new List<PreparedShipmentLine>();
        var lineKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in request.Lines)
        {
            LineKey key;
            try
            {
                key = LineKey.Create(line.CustomerNumber ?? "", line.SalesOrderNumber ?? "",
                    line.SalesOrderLineNumber ?? "");
            }
            catch (ApprovalProblem problem)
            {
                throw ShipmentStagingProblem.Validation(problem.Message);
            }
            if (!lineKeys.Add(key.Customer + "|" + key.SalesOrder + "|" + key.Line))
                throw ShipmentStagingProblem.Validation("A shipment request cannot repeat a Sales Order line.");
            var quantity = line.QuantityProcessed;
            if (quantity <= 0) throw ShipmentStagingProblem.Validation("Shipment quantity must be greater than zero.");
            if (line.CanonicalOpenQuantityAtShipment is <= 0 ||
                quantity > line.CanonicalOpenQuantityAtShipment)
                throw ShipmentStagingProblem.Validation(
                    "Shipment quantity exceeds the governed operational remaining quantity.");
            var operational = await relationshipLoader(key, token);
            prepared.Add(Prepare(request, line, key, operational));
        }
        return await repository.CreateBatchAsync(request, prepared, actor, token);
    }

    internal static PreparedShipmentLine Prepare(ShipmentStagingCreateRequest request,
        ShipmentStagingCreateLine line, LineKey key, OperationalRelationshipPresentation operational)
    {
        string source;
        string? workOrder = operational.ActiveWorkOrderNumber;
        var direct = false;
        if (operational.OperationalRoute == "DIRECT_FULFILLMENT" &&
            operational.OperationalStatus == "NO_WORK_ORDER_REQUIRED" &&
            operational.FulfillmentRequired && operational.ShippingRequired)
        {
            source = "NO_WORK_ORDER_REQUIRED"; workOrder = null; direct = true;
        }
        else if (operational.OperationalRoute == "NORMAL_PRODUCTION" && !string.IsNullOrWhiteSpace(workOrder))
            source = operational.ActiveWorkOrderSource == "APPROVED" ? "GOVERNED_APPROVAL" : "EXACT_CANONICAL";
        else if (operational.OperationalRoute == "RMA_REWORK" &&
                 operational.ActiveWorkOrderSource == "RMA_DECISION" &&
                 !string.IsNullOrWhiteSpace(workOrder) && operational.ShippingRequired)
            source = "RMA_DECISION";
        else
            throw ShipmentStagingProblem.Validation(
                "The current operational route does not permit outbound shipment processing.");

        var item = (line.ItemNumber ?? "").Trim();
        if (item.Length is 0 or > 40) throw ShipmentStagingProblem.Validation("Item number is required.");
        return new(key, (line.CustomerName ?? "").Trim(), item, Trim(line.Revision, 30),
            line.QuantityProcessed, line.CanonicalOpenQuantityAtShipment, Trim(line.UnitOfMeasure, 20), workOrder, source, direct,
            operational.RmaReworkControl?.CaseId, Trim(line.ShipmentReference, 100));
    }

    public Task<object> ListAsync(string? status, string? customer, string? salesOrder,
        string? line, int page, int pageSize, CancellationToken token) =>
        repository.ListAsync(status, customer, salesOrder, line, page, pageSize, token);
    public Task<object> GetAsync(Guid id, CancellationToken token) => repository.GetAsync(id, token);
    public Task<object> GetHistoryAsync(Guid id, CancellationToken token) => repository.GetHistoryAsync(id, token);

    public async Task<object> ReconcileAsync(ShipmentReconciliationRequest request, string actor,
        CancellationToken token)
    {
        RequireActor(actor);
        var correlation = request.RequestCorrelationId == Guid.Empty ? Guid.NewGuid() : request.RequestCorrelationId;
        if (request.InvoiceHistoryImportRunId is Guid importRunId &&
            string.Equals(request.TriggerType, "ERP_INVOICE_REFRESH", StringComparison.Ordinal) &&
            await repository.HasAutomaticRunAsync(importRunId, token))
            return new { reconciliationSkipped = true, reason = "invoice_import_already_reconciled",
                invoiceHistoryImportRunId = importRunId, shipmentCount = 0, proposalCount = 0,
                autoConfirmed = 0 };
        var shipments = await repository.GetReconciliationCandidatesAsync(request.ShipmentStagingId, token);
        var evidence = new Dictionary<Guid, IReadOnlyList<InvoiceEvidence>>();
        foreach (var shipment in shipments)
            evidence[shipment.ShipmentStagingId] = await LoadInvoiceEvidenceAsync(shipment, token);
        return await repository.RecordReconciliationAsync(correlation, request.TriggerType,
            request.InvoiceHistoryImportRunId, shipments,
            evidence, actor, token);
    }

    private async Task<IReadOnlyList<InvoiceEvidence>> LoadInvoiceEvidenceAsync(
        ShipmentStagingRow shipment, CancellationToken token)
    {
        var query = "/api/platform/live/v1/invoice-history?page=1&pageSize=200" +
            "&customerNumber=" + Uri.EscapeDataString(shipment.CustomerNumber) +
            "&salesOrderNumber=" + Uri.EscapeDataString(shipment.SalesOrderNumber) +
            "&itemNumber=" + Uri.EscapeDataString(shipment.ItemNumber);
        using var response = await canonical.GetAsync(query, token);
        response.EnsureSuccessStatusCode();
        var page = await response.Content.ReadFromJsonAsync<InvoiceEvidencePage>(cancellationToken: token)
            ?? new InvoiceEvidencePage();
        return page.Items.Where(item =>
                Normalize(item.CustomerNumber, 6) == shipment.CustomerNumber &&
                Normalize(item.SalesOrderNumber, 7) == shipment.SalesOrderNumber &&
                Normalize(item.SalesOrderLineNumber, 3) == shipment.SalesOrderLineNumber &&
                string.Equals((item.ItemNumber ?? "").Trim(), shipment.ItemNumber,
                    StringComparison.OrdinalIgnoreCase) &&
                (!DateOnly.TryParse(item.InvoiceDate, out var date) ||
                 date >= DateOnly.FromDateTime(shipment.ProcessedAtUtc)))
            .ToArray();
    }

    public Task<object> DecideAsync(Guid id, string decision, ShipmentMatchDecisionRequest request,
        string actor, CancellationToken token)
    {
        RequireActor(actor);
        if (request.RequestCorrelationId == Guid.Empty)
            throw ShipmentStagingProblem.Validation("A decision correlation ID is required.");
        if ((decision is "REJECT_MATCH" or "MARK_EXCEPTION" or "CANCEL_SHIPMENT") &&
            string.IsNullOrWhiteSpace(request.Note))
            throw ShipmentStagingProblem.Validation("A decision explanation is required.");
        var expectedReason = decision switch
        {
            "CONFIRM_MATCH" => "OPERATOR_VERIFIED_CANONICAL_INVOICE",
            "REJECT_MATCH" => "INCORRECT_INVOICE_EVIDENCE",
            "MARK_EXCEPTION" => "ERP_EVIDENCE_CONTRADICTION",
            "CANCEL_SHIPMENT" => "SHIPMENT_CANCELLED_BY_OPERATOR",
            _ => throw ShipmentStagingProblem.Validation("Decision is invalid.")
        };
        if (!string.Equals(request.ReasonCode?.Trim(), expectedReason, StringComparison.Ordinal))
            throw ShipmentStagingProblem.Validation("The governed shipment decision reason is invalid.");
        return repository.DecideAsync(id, decision, request, actor, token);
    }

    private static void RequireActor(string actor)
    {
        if (string.IsNullOrWhiteSpace(actor))
            throw new ShipmentStagingProblem(401, "shipment_authorization_failed",
                "An authenticated operator identity is required.");
    }
    private static string? Trim(string? value, int maximum)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        if (text.Length > maximum) throw ShipmentStagingProblem.Validation("A shipment field exceeds its allowed length.");
        return text;
    }
    private static string Normalize(string? value, int width) => (value ?? "").Trim().PadLeft(width, '0');
}

internal sealed class ShipmentStagingRepository
{
    private static string ConnectionString => ControlHostRuntimeConfiguration.OperationalConnectionString;
    private static SqlConnection Connection() => new(ConnectionString);

    public async Task<object> CreateBatchAsync(ShipmentStagingCreateRequest request,
        IReadOnlyList<PreparedShipmentLine> lines, string actor, CancellationToken token)
    {
        await using var connection = Connection(); await connection.OpenAsync(token);
        await EnsureSchemaAsync(connection, token);
        var requestId = request.RequestId?.Trim()
            ?? throw ShipmentStagingProblem.Validation("A stable shipment request ID is required.");
        var idempotencyBase = request.IdempotencyKey?.Trim()
            ?? throw ShipmentStagingProblem.Validation("A shipment idempotency key is required.");
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        var expectedKeys = lines.Select(line => idempotencyBase + "|" + line.Key.Customer + "|" +
            line.Key.SalesOrder + "|" + line.Key.Line).ToArray();
        var existing = new List<(Guid Id, string Number)>();
        foreach (var key in expectedKeys)
        {
            await using var existingCommand = Command(connection, transaction,
                "SELECT ShipmentStagingId,ShipmentNumber FROM operational.ShipmentStaging WITH (UPDLOCK,HOLDLOCK) WHERE IdempotencyKey=@Key;",
                new Dictionary<string, object?> { ["@Key"] = key });
            await using var reader = await existingCommand.ExecuteReaderAsync(token);
            if (await reader.ReadAsync(token)) existing.Add((reader.GetGuid(0), reader.GetString(1)));
        }
        if (existing.Count > 0 && existing.Count != lines.Count)
            throw ShipmentStagingProblem.Conflict("shipment_staging_idempotency_conflict",
                "The shipment request conflicts with a partially matching idempotency key.");
        if (existing.Count == lines.Count)
        {
            await transaction.CommitAsync(token);
            return new { status = "AWAITING_ERP_EVIDENCE", replayed = true,
                shipments = existing.Select(item => new { shipmentStagingId = item.Id,
                    shipmentNumber = item.Number }).ToArray(), count = existing.Count,
                requestId };
        }

        var created = new List<(Guid Id, string Number)>();
        foreach (var line in lines)
        {
            var id = Guid.NewGuid();
            var number = "SHP-" + DateTime.UtcNow.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + "-" +
                id.ToString("N")[..8].ToUpperInvariant();
            var idempotency = idempotencyBase + "|" + line.Key.Customer + "|" +
                line.Key.SalesOrder + "|" + line.Key.Line;
            const string insert = """
INSERT operational.ShipmentStaging
(ShipmentStagingId,ShipmentNumber,CustomerNumber,CustomerNameSnapshot,SalesOrderNumber,
 SalesOrderLineNumber,ItemNumber,Revision,QuantityProcessed,CanonicalOpenQuantityAtShipment,UnitOfMeasure,WorkOrderNumber,
 WorkOrderRelationshipSource,DirectFulfillment,RmaReworkCaseId,ShipmentReference,RequestId,
 IdempotencyKey,ProcessedAtUtc,ProcessedBy,CurrentStatus,CurrentEventSequence)
VALUES(@Id,@Number,@Customer,@CustomerName,@SalesOrder,@Line,@Item,@Revision,@Quantity,@CanonicalOpen,@Uom,
 @WorkOrder,@Source,@Direct,@Rma,@Reference,@RequestId,@Idempotency,SYSUTCDATETIME(),@Actor,
 N'AWAITING_ERP_EVIDENCE',0);
DECLARE @EventId uniqueidentifier=NEWID();
INSERT operational.ShipmentStagingEvent
(ShipmentStagingEventId,ShipmentStagingId,EventType,ResultingStatus,RecordedBy,CorrelationId,EvidenceJson)
VALUES(@EventId,@Id,N'SHIPMENT_PROCESSED',N'AWAITING_ERP_EVIDENCE',@Actor,@Correlation,@Evidence);
UPDATE operational.ShipmentStaging SET CurrentEventSequence=SCOPE_IDENTITY()
WHERE ShipmentStagingId=@Id;
""";
            var evidence = JsonSerializer.Serialize(new { request.RequestId, line.Source,
                line.DirectFulfillment, line.RmaReworkCaseId });
            await ExecuteAsync(connection, transaction, insert, new Dictionary<string, object?>
            {
                ["@Id"]=id,["@Number"]=number,["@Customer"]=line.Key.Customer,
                ["@CustomerName"]=line.CustomerName,["@SalesOrder"]=line.Key.SalesOrder,
                ["@Line"]=line.Key.Line,["@Item"]=line.ItemNumber,["@Revision"]=line.Revision,
                ["@Quantity"]=line.Quantity,["@CanonicalOpen"]=line.CanonicalOpenQuantityAtShipment,
                ["@Uom"]=line.UnitOfMeasure,["@WorkOrder"]=line.WorkOrder,
                ["@Source"]=line.Source,["@Direct"]=line.DirectFulfillment,["@Rma"]=line.RmaReworkCaseId,
                ["@Reference"]=line.ShipmentReference,["@RequestId"]=requestId,
                ["@Idempotency"]=idempotency,["@Actor"]=actor,
                ["@Correlation"]=request.RequestCorrelationId.ToString("D")+"|"+line.Key.Line,
                ["@Evidence"]=evidence
            }, token);
            created.Add((id, number));
        }
        await transaction.CommitAsync(token);
        return new { status="AWAITING_ERP_EVIDENCE", replayed=false,
            shipments=created.Select(item => new { shipmentStagingId=item.Id,
                shipmentNumber=item.Number }).ToArray(), count=created.Count, requestId };
    }

    public async Task<object> ListAsync(string? status, string? customer, string? salesOrder,
        string? line, int page, int pageSize, CancellationToken token)
    {
        if (page < 1 || pageSize is < 1 or > 200) throw ShipmentStagingProblem.Validation("Paging is invalid.");
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        const string sql="""
SELECT * FROM operational.vw_CurrentShipmentStaging
WHERE (@Status IS NULL OR CurrentStatus=@Status)
AND (@Customer IS NULL OR CustomerNumber=@Customer)
AND (@SalesOrder IS NULL OR SalesOrderNumber=@SalesOrder)
AND (@Line IS NULL OR SalesOrderLineNumber=@Line)
ORDER BY ProcessedAtUtc DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
SELECT COUNT_BIG(*) FROM operational.ShipmentStaging
WHERE (@Status IS NULL OR CurrentStatus=@Status)
AND (@Customer IS NULL OR CustomerNumber=@Customer)
AND (@SalesOrder IS NULL OR SalesOrderNumber=@SalesOrder)
AND (@Line IS NULL OR SalesOrderLineNumber=@Line);
""";
        await using var command=Command(connection,null,sql,new Dictionary<string,object?>{
            ["@Status"]=Null(status),["@Customer"]=Null(customer),["@SalesOrder"]=Null(salesOrder),
            ["@Line"]=Null(line),["@Offset"]=(page-1)*pageSize,["@PageSize"]=pageSize});
        var items=new List<Dictionary<string,object?>>(); await using var reader=await command.ExecuteReaderAsync(token);
        while(await reader.ReadAsync(token)) items.Add(ReadRow(reader)); await reader.NextResultAsync(token);
        await reader.ReadAsync(token); var total=reader.GetInt64(0);
        return new { items,totalItems=total,page,pageSize };
    }

    public Task<object> GetAsync(Guid id,CancellationToken token) => ListByIdAsync(id,token);
    private async Task<object> ListByIdAsync(Guid id,CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        await using var command=Command(connection,null,
            "SELECT * FROM operational.vw_CurrentShipmentStaging WHERE ShipmentStagingId=@Id;",
            new Dictionary<string,object?>{{"@Id",id}}); await using var reader=await command.ExecuteReaderAsync(token);
        if(!await reader.ReadAsync(token)) throw ShipmentStagingProblem.NotFound();
        return ReadRow(reader);
    }

    public async Task<object> GetHistoryAsync(Guid id,CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        const string sql="""
SELECT ShipmentStagingEventId,EventSequence,EventType,ResultingStatus,ReasonCode,DecisionNote,
RecordedAtUtc,RecordedBy,CorrelationId,EvidenceJson FROM operational.ShipmentStagingEvent
WHERE ShipmentStagingId=@Id ORDER BY EventSequence;
SELECT ShipmentInvoiceDecisionEventId,DecisionSequence,DecisionType,ResultingStatus,ReasonCode,
DecisionNote,ConfirmedQuantity,RecordedAtUtc,RecordedBy,CorrelationId,EvidenceSnapshotJson
FROM operational.ShipmentInvoiceDecisionEvent WHERE ShipmentStagingId=@Id ORDER BY DecisionSequence;
""";
        await using var command=Command(connection,null,sql,new Dictionary<string,object?>{{"@Id",id}});
        await using var reader=await command.ExecuteReaderAsync(token); var events=new List<Dictionary<string,object?>>();
        while(await reader.ReadAsync(token)) events.Add(ReadRow(reader)); await reader.NextResultAsync(token);
        var decisions=new List<Dictionary<string,object?>>(); while(await reader.ReadAsync(token)) decisions.Add(ReadRow(reader));
        return new { shipmentStagingId=id,events,decisions };
    }

    public async Task<IReadOnlyList<ShipmentStagingRow>> GetReconciliationCandidatesAsync(Guid? id,CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        const string sql="""
SELECT ShipmentStagingId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,ItemNumber,
QuantityProcessed,WorkOrderNumber,ProcessedAtUtc,CurrentStatus
FROM operational.ShipmentStaging WHERE (@Id IS NULL OR ShipmentStagingId=@Id)
AND CurrentStatus NOT IN (N'ERP_CONFIRMED',N'CANCELLED');
""";
        await using var command=Command(connection,null,sql,new Dictionary<string,object?>{{"@Id",id}}); await using var reader=await command.ExecuteReaderAsync(token);
        var rows=new List<ShipmentStagingRow>(); while(await reader.ReadAsync(token)) rows.Add(new(
            reader.GetGuid(0),reader.GetString(1),reader.GetString(2),reader.GetString(3),reader.GetString(4),
            reader.GetDecimal(5),reader.IsDBNull(6)?null:reader.GetString(6),reader.GetDateTime(7),reader.GetString(8)));
        return rows;
    }

    public async Task<bool> HasAutomaticRunAsync(Guid importRunId, CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        await using var command=Command(connection,null,"""
SELECT COUNT(*) FROM operational.ShipmentReconciliationRun
WHERE InvoiceHistoryImportRunId=@ImportRun AND TriggerType=N'ERP_INVOICE_REFRESH' AND Result=N'SUCCEEDED';
""",new Dictionary<string,object?>{{"@ImportRun",importRunId}});
        return Convert.ToInt32(await command.ExecuteScalarAsync(token)) > 0;
    }

    public async Task<object> RecordReconciliationAsync(Guid correlation,string? trigger,Guid? importRunId,
        IReadOnlyList<ShipmentStagingRow> shipments, IReadOnlyDictionary<Guid,IReadOnlyList<InvoiceEvidence>> evidence,
        string actor,CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        await using var tx=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        var run=Guid.NewGuid();
        await ExecuteAsync(connection,tx,"""
INSERT operational.ShipmentReconciliationRun
(ReconciliationRunId,InvoiceHistoryImportRunId,TriggerType,StartedAtUtc,Result,ShipmentCount,CorrelationId)
VALUES(@Run,@ImportRun,@Trigger,SYSUTCDATETIME(),N'RUNNING',@Count,@Correlation);
""",new Dictionary<string,object?>{{"@Run",run},{"@Trigger",string.IsNullOrWhiteSpace(trigger)?"MANUAL":trigger!.Trim()},
            {"@ImportRun",importRunId},{"@Count",shipments.Count},{"@Correlation",correlation.ToString("D")}},token);
        var proposalCount=0;
        foreach(var shipment in shipments)
        {
            var candidates=evidence.GetValueOrDefault(shipment.ShipmentStagingId)??[];
            var status="AWAITING_ERP_EVIDENCE";
            if(candidates.Count>0)
            {
                status=candidates.Count>1?"MATCH_REVIEW_REQUIRED":
                    candidates[0].QuantityShipped==shipment.QuantityProcessed?"POSSIBLE_MATCH_FOUND":
                    candidates[0].QuantityShipped>shipment.QuantityProcessed?"MISMATCH_EXCEPTION":"MATCH_REVIEW_REQUIRED";
                foreach(var item in candidates)
                {
                    var classification=candidates.Count>1?"MULTIPLE_CANDIDATES":
                        item.QuantityShipped==shipment.QuantityProcessed?"EXACT_ONE_TO_ONE":
                        item.QuantityShipped>shipment.QuantityProcessed?"OVER_INVOICE":"PARTIAL_QUANTITY";
                    var score=80+(item.QuantityShipped==shipment.QuantityProcessed?20:0)+
                        (!string.IsNullOrWhiteSpace(shipment.WorkOrderNumber)&&shipment.WorkOrderNumber==item.WorkOrderNumber?5:0);
                    await ExecuteAsync(connection,tx,"""
INSERT operational.ShipmentInvoiceMatchProposal
(ShipmentInvoiceMatchProposalId,ReconciliationRunId,ShipmentStagingId,InvoiceHistoryLineId,
 InvoiceNumber,InvoiceLineNumber,InvoiceDate,InvoiceQuantity,MatchClassification,MatchScore,
 EvidenceSummary,ContradictionSummary,EvidenceSnapshotJson)
VALUES(NEWID(),@Run,@Id,@InvoiceLineId,@Invoice,@InvoiceLine,@Date,@Quantity,@Class,@Score,
 @Summary,@Contradiction,@Evidence);
""",new Dictionary<string,object?>{{"@Run",run},{"@Id",shipment.ShipmentStagingId},{"@InvoiceLineId",item.InvoiceHistoryLineId!},
                        {"@Invoice",item.InvoiceNumber},{"@InvoiceLine",item.InvoiceLineNumber},
                        {"@Date",DateOnly.TryParse(item.InvoiceDate,out var date)?date.ToDateTime(TimeOnly.MinValue):null},
                        {"@Quantity",item.QuantityShipped},{"@Class",classification},{"@Score",score},
                        {"@Summary","Customer, Sales Order, line, and item agree."},
                        {"@Contradiction",classification=="EXACT_ONE_TO_ONE"?null:"Quantity or candidate cardinality requires review."},
                        {"@Evidence",JsonSerializer.Serialize(item)}},token); proposalCount++;
                }
            }
            await ExecuteAsync(connection,tx,"""
UPDATE operational.ShipmentStaging SET CurrentStatus=@Status,CurrentProposalRunId=@Run
WHERE ShipmentStagingId=@Id;
INSERT operational.ShipmentStagingEvent
(ShipmentStagingEventId,ShipmentStagingId,EventType,ResultingStatus,RecordedBy,CorrelationId,EvidenceJson)
VALUES(NEWID(),@Id,N'RECONCILIATION_RUN',@Status,@Actor,@EventCorrelation,@Evidence);
UPDATE operational.ShipmentStaging SET CurrentEventSequence=SCOPE_IDENTITY()
WHERE ShipmentStagingId=@Id;
""",new Dictionary<string,object?>{{"@Status",status},{"@Run",run},{"@Id",shipment.ShipmentStagingId},{"@Actor",actor},
                    {"@EventCorrelation",correlation.ToString("D")+"|"+shipment.ShipmentStagingId.ToString("D")},
                    {"@Evidence",JsonSerializer.Serialize(new{run,proposalCount=candidates.Count})}},token);
        }
        await ExecuteAsync(connection,tx,"UPDATE operational.ShipmentReconciliationRun SET Result=N'SUCCEEDED',CompletedAtUtc=SYSUTCDATETIME() WHERE ReconciliationRunId=@Run;",new Dictionary<string,object?>{{"@Run",run}},token);
        await tx.CommitAsync(token); return new{reconciliationRunId=run,shipmentCount=shipments.Count,proposalCount,autoConfirmed=0,
            lines=shipments.Select(item=>new{customerNumber=item.CustomerNumber,salesOrderNumber=item.SalesOrderNumber,
                lineNumber=item.SalesOrderLineNumber}).ToArray()};
    }

    public async Task<object> DecideAsync(Guid id,string decision,ShipmentMatchDecisionRequest request,string actor,CancellationToken token)
    {
        await using var connection=Connection(); await connection.OpenAsync(token); await EnsureSchemaAsync(connection,token);
        await using var tx=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        const string select="""
SELECT s.QuantityProcessed,s.CurrentStatus,p.ShipmentInvoiceMatchProposalId,p.InvoiceHistoryLineId,
p.InvoiceQuantity,p.EvidenceSnapshotJson FROM operational.ShipmentStaging s
LEFT JOIN operational.ShipmentInvoiceMatchProposal p ON p.ShipmentInvoiceMatchProposalId=@Proposal
AND p.ShipmentStagingId=s.ShipmentStagingId WHERE s.ShipmentStagingId=@Id;
""";
        await using var command=Command(connection,tx,select,new Dictionary<string,object?>{{"@Id",id},{"@Proposal",request.ProposalId}});
        decimal shipmentQuantity; string current; Guid? proposal=null; string? invoiceLine=null; decimal invoiceQuantity=0; string? snapshot=null;
        await using(var reader=await command.ExecuteReaderAsync(token))
        {if(!await reader.ReadAsync(token))throw ShipmentStagingProblem.NotFound(); shipmentQuantity=reader.GetDecimal(0);current=reader.GetString(1);
            if(!reader.IsDBNull(2)){proposal=reader.GetGuid(2);invoiceLine=reader.GetString(3);invoiceQuantity=reader.GetDecimal(4);snapshot=reader.GetString(5);}}
        if(current is "ERP_CONFIRMED" or "CANCELLED") throw ShipmentStagingProblem.Conflict("shipment_match_conflict","This shipment is already final.");
        if(decision=="CONFIRM_MATCH"&&proposal is null)throw ShipmentStagingProblem.Validation("A current invoice proposal is required.");
        var resulting=decision switch{"CONFIRM_MATCH"=>"ERP_CONFIRMED","REJECT_MATCH"=>"AWAITING_ERP_EVIDENCE","MARK_EXCEPTION"=>"MISMATCH_EXCEPTION","CANCEL_SHIPMENT"=>"CANCELLED",_=>throw ShipmentStagingProblem.Validation("Decision is invalid.")};
        var confirmed=decision=="CONFIRM_MATCH"?(request.ConfirmedQuantity??shipmentQuantity):(decimal?)null;
        if(confirmed is <=0)throw ShipmentStagingProblem.Validation("Confirmed quantity must be positive.");
        if(decision=="CONFIRM_MATCH")
        {
            await using var allocation=Command(connection,tx,"SELECT COALESCE(SUM(AllocatedQuantity),0) FROM operational.ShipmentInvoiceAllocation WITH (UPDLOCK,HOLDLOCK) WHERE InvoiceHistoryLineId=@Line;",new Dictionary<string,object?>{{"@Line",invoiceLine}});
            var allocated=Convert.ToDecimal(await allocation.ExecuteScalarAsync(token));
            if(allocated+confirmed>invoiceQuantity)throw ShipmentStagingProblem.Conflict("shipment_match_conflict","The invoice quantity is already allocated or would be over-allocated.");
        }
        var decisionId=Guid.NewGuid();
        await ExecuteAsync(connection,tx,"""
INSERT operational.ShipmentInvoiceDecisionEvent
(ShipmentInvoiceDecisionEventId,ShipmentStagingId,ShipmentInvoiceMatchProposalId,DecisionType,
 ResultingStatus,ReasonCode,DecisionNote,ConfirmedQuantity,RecordedBy,CorrelationId,EvidenceSnapshotJson)
VALUES(@Decision,@Id,@Proposal,@Type,@Status,@Reason,@Note,@Quantity,@Actor,@Correlation,@Evidence);
IF @Type=N'CONFIRM_MATCH'
 INSERT operational.ShipmentInvoiceAllocation
 (ShipmentInvoiceAllocationId,ShipmentInvoiceDecisionEventId,ShipmentStagingId,InvoiceHistoryLineId,AllocatedQuantity)
 VALUES(NEWID(),@Decision,@Id,@InvoiceLine,@Quantity);
INSERT operational.ShipmentStagingEvent
(ShipmentStagingEventId,ShipmentStagingId,EventType,ResultingStatus,ReasonCode,DecisionNote,RecordedBy,CorrelationId,EvidenceJson)
VALUES(NEWID(),@Id,@Type,@Status,@Reason,@Note,@Actor,@EventCorrelation,@Evidence);
UPDATE operational.ShipmentStaging SET CurrentStatus=@Status,ConfirmedDecisionEventId=
CASE WHEN @Type=N'CONFIRM_MATCH' THEN @Decision ELSE ConfirmedDecisionEventId END,
CurrentEventSequence=SCOPE_IDENTITY() WHERE ShipmentStagingId=@Id;
""",new Dictionary<string,object?>{{"@Decision",decisionId},{"@Id",id},{"@Proposal",proposal},{"@Type",decision},
            {"@Status",resulting},{"@Reason",Null(request.ReasonCode)},{"@Note",Null(request.Note)},
            {"@Quantity",confirmed},{"@Actor",actor},{"@Correlation",request.RequestCorrelationId.ToString("D")},
            {"@EventCorrelation",request.RequestCorrelationId.ToString("D")+"|event"},{"@Evidence",snapshot},
            {"@InvoiceLine",invoiceLine}},token);
        await tx.CommitAsync(token);return new{shipmentStagingId=id,status=resulting,decisionEventId=decisionId};
    }

    private static async Task EnsureSchemaAsync(SqlConnection connection,CancellationToken token)
    {await using var command=new SqlCommand("SELECT CASE WHEN OBJECT_ID(N'operational.ShipmentStaging',N'U') IS NULL THEN 0 ELSE 1 END;",connection);if(Convert.ToInt32(await command.ExecuteScalarAsync(token))!=1)throw new ShipmentStagingProblem(503,"shipment_staging_schema_unavailable","The governed Shipment Staging schema is unavailable.");}
    private static SqlCommand Command(SqlConnection c,SqlTransaction? t,string sql,IReadOnlyDictionary<string,object?> values){var command=new SqlCommand(sql,c,t);foreach(var pair in values)command.Parameters.AddWithValue(pair.Key,pair.Value??DBNull.Value);return command;}
    private static async Task ExecuteAsync(SqlConnection c,SqlTransaction t,string sql,IReadOnlyDictionary<string,object?> values,CancellationToken token){await using var command=Command(c,t,sql,values);await command.ExecuteNonQueryAsync(token);}
    private static object? Null(string? value)=>string.IsNullOrWhiteSpace(value)?null:value.Trim();
    private static Dictionary<string,object?> ReadRow(SqlDataReader reader){var row=new Dictionary<string,object?>(StringComparer.OrdinalIgnoreCase);for(var i=0;i<reader.FieldCount;i++)row[char.ToLowerInvariant(reader.GetName(i)[0])+reader.GetName(i)[1..]]=reader.IsDBNull(i)?null:reader.GetValue(i);return row;}
}

internal sealed class ShipmentReconciliationMonitor : BackgroundService
{
    private readonly ILogger<ShipmentReconciliationMonitor> logger;
    private readonly HttpClient canonical = new(new HttpClientHandler { UseDefaultCredentials = true })
    {
        BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
        Timeout = TimeSpan.FromSeconds(20)
    };

    public ShipmentReconciliationMonitor(ILogger<ShipmentReconciliationMonitor> logger) =>
        this.logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var response = await canonical.GetAsync(
                    "/api/platform/live/v1/invoice-history/metadata", stoppingToken);
                response.EnsureSuccessStatusCode();
                var metadata = await response.Content.ReadFromJsonAsync<InvoiceEvidenceMetadata>(
                    cancellationToken: stoppingToken);
                if (metadata?.InvoiceHistoryImportRunId is Guid importRunId && importRunId != Guid.Empty)
                {
                    var service = new ShipmentStagingService(canonical);
                    await service.ReconcileAsync(new ShipmentReconciliationRequest
                    {
                        RequestCorrelationId = Guid.NewGuid(),
                        TriggerType = "ERP_INVOICE_REFRESH",
                        InvoiceHistoryImportRunId = importRunId
                    }, @"DLE-OS-HOST\DLE-OS", stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogWarning(error,
                    "Shipment reconciliation monitor could not process the current invoice import; the canonical refresh remains successful.");
            }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    public override void Dispose()
    {
        canonical.Dispose();
        base.Dispose();
    }
}

internal sealed class ShipmentStagingCreateRequest
{
    public string? RequestId { get; set; }
    public string? IdempotencyKey { get; set; }
    public Guid RequestCorrelationId { get; set; }
    public List<ShipmentStagingCreateLine> Lines { get; set; }=[];
}
internal sealed class ShipmentStagingCreateLine
{
    public string? CustomerNumber { get; set; } public string? CustomerName { get; set; }
    public string? SalesOrderNumber { get; set; } public string? SalesOrderLineNumber { get; set; }
    public string? ItemNumber { get; set; } public string? Revision { get; set; }
    public decimal QuantityProcessed { get; set; } public string? UnitOfMeasure { get; set; }
    public decimal CanonicalOpenQuantityAtShipment { get; set; }
    public string? ShipmentReference { get; set; }
}
internal sealed class ShipmentReconciliationRequest{public Guid? ShipmentStagingId{get;set;}public Guid RequestCorrelationId{get;set;}public string? TriggerType{get;set;}public Guid? InvoiceHistoryImportRunId{get;set;}}
internal sealed class ShipmentMatchDecisionRequest{public Guid? ProposalId{get;set;}public decimal? ConfirmedQuantity{get;set;}public string? ReasonCode{get;set;}public string? Note{get;set;}public Guid RequestCorrelationId{get;set;}}
internal sealed record PreparedShipmentLine(LineKey Key,string CustomerName,string ItemNumber,string? Revision,decimal Quantity,decimal CanonicalOpenQuantityAtShipment,string? UnitOfMeasure,string? WorkOrder,string Source,bool DirectFulfillment,Guid? RmaReworkCaseId,string? ShipmentReference);
internal sealed record ShipmentStagingRow(Guid ShipmentStagingId,string CustomerNumber,string SalesOrderNumber,string SalesOrderLineNumber,string ItemNumber,decimal QuantityProcessed,string? WorkOrderNumber,DateTime ProcessedAtUtc,string CurrentStatus);
internal sealed class InvoiceEvidencePage{public List<InvoiceEvidence> Items{get;set;}=[];}
internal sealed class InvoiceEvidenceMetadata{public Guid? InvoiceHistoryImportRunId{get;set;}}
internal sealed class InvoiceEvidence{public string? InvoiceHistoryLineId{get;set;}public string? CustomerNumber{get;set;}public string? InvoiceNumber{get;set;}public string? InvoiceLineNumber{get;set;}public string? InvoiceDate{get;set;}public string? SalesOrderNumber{get;set;}public string? SalesOrderLineNumber{get;set;}public string? ItemNumber{get;set;}public decimal QuantityShipped{get;set;}public string? WorkOrderNumber{get;set;}}
internal sealed class ShipmentStagingProblem(int statusCode,string code,string message):Exception(message)
{
    public int StatusCode{get;}=statusCode;public string Code{get;}=code;
    public static ShipmentStagingProblem Validation(string message)=>new(400,"shipment_staging_validation_failed",message);
    public static ShipmentStagingProblem Conflict(string code,string message)=>new(409,code,message);
    public static ShipmentStagingProblem NotFound()=>new(404,"shipment_staging_not_found","The Shipment Staging record was not found.");
}
