using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
var database = "DLE_OS_SHIPMENT_STAGING_TEST_" + Guid.NewGuid().ToString("N")[..10];
var master = @"Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;";
var connection = $@"Server=lpc:.\SQLEXPRESS;Database={database};Integrated Security=True;Encrypt=False;TrustServerCertificate=True;";

try
{
    await Execute(master, $"CREATE DATABASE [{database}];");
    Environment.SetEnvironmentVariable("DLE_OS_ISOLATED_DEVELOPMENT", "true");
    Environment.SetEnvironmentVariable("DLE_OS_OPERATIONAL_CONNECTION_STRING", connection);
    Environment.SetEnvironmentVariable("DLE_OS_CANONICAL_API_BASE_URL", "http://canonical.test");
    await ApplyMigration(connection);

    var handler = new InvoiceHandler();
    var canonical = new HttpClient(handler) { BaseAddress = new Uri("http://canonical.test") };
    var service = new ShipmentStagingService(canonical, LoadRelationship);

    var normal = Request("REQ-NORMAL", "001", "ITEM-EXACT", 5);
    var created = Json(await service.CreateAsync(normal, Actor(), default));
    Equal("AWAITING_ERP_EVIDENCE", created.RootElement.GetProperty("status").GetString(), "create status");
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging;"), "one persisted record");
    Check(await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStagingEvent WHERE EventType=N'SHIPMENT_PROCESSED';") == 1, "creation audit event");

    var replay = Json(await service.CreateAsync(normal, Actor(), default));
    Check(replay.RootElement.GetProperty("replayed").GetBoolean(), "idempotent replay reported");
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging;"), "idempotent replay creates no duplicate");

    await service.CreateAsync(Request("REQ-DIRECT", "002", "ITEM-NONE", 2), Actor(), default);
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE DirectFulfillment=1 AND WorkOrderNumber IS NULL;"), "direct fulfillment remains shippable");

    await ExpectProblem(() => service.CreateAsync(Request("REQ-CANDIDATE", "003", "ITEM-X", 1), Actor(), default), "candidate-only blocked");
    await ExpectProblem(() => service.CreateAsync(Request("REQ-RMA-BLOCK", "004", "ITEM-X", 1), Actor(), default), "RMA without decision blocked");
    await service.CreateAsync(Request("REQ-RMA-ASSIGNED", "005", "ITEM-NONE", 1), Actor(), default);
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE WorkOrderRelationshipSource=N'RMA_DECISION';"), "explicit RMA work order shippable");

    var overOperationalRemaining = Request("REQ-OVER-REMAINING", "009", "ITEM-NONE", 2);
    overOperationalRemaining.Lines[0].CanonicalOpenQuantityAtShipment = 1;
    await ExpectProblem(() => service.CreateAsync(overOperationalRemaining, Actor(), default),
        "quantity over operational remaining rejected");

    var beforeFailedBatch = await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging;");
    var failedBatch = Request("REQ-FAILED-BATCH", "006", "ITEM-NONE", 1);
    failedBatch.Lines.Add(Line("003", "ITEM-X", 1));
    await ExpectProblem(() => service.CreateAsync(failedBatch, Actor(), default), "invalid batch rejected");
    Equal(beforeFailedBatch, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging;"), "failed batch writes no partial record");

    await service.CreateAsync(Request("REQ-MULTI", "006", "ITEM-MULTI", 5), Actor(), default);
    await service.CreateAsync(Request("REQ-PARTIAL", "007", "ITEM-PARTIAL", 5), Actor(), default);
    await service.CreateAsync(Request("REQ-OVER", "008", "ITEM-OVER", 5), Actor(), default);
    var reconciliation = Json(await service.ReconcileAsync(new ShipmentReconciliationRequest
    {
        RequestCorrelationId = Guid.NewGuid(), TriggerType = "MANUAL"
    }, Actor(), default));
    Equal(0, reconciliation.RootElement.GetProperty("autoConfirmed").GetInt32(), "no auto-confirmation");
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE CurrentStatus=N'POSSIBLE_MATCH_FOUND';"), "exact evidence proposes match");
    Check(await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE CurrentStatus=N'MATCH_REVIEW_REQUIRED';") >= 2, "multiple and partial evidence require review");
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE CurrentStatus=N'MISMATCH_EXCEPTION';"), "over-invoice routes to exception");
    Check(await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentStaging WHERE CurrentStatus=N'AWAITING_ERP_EVIDENCE';") >= 2, "no evidence remains awaiting");

    var exact = await ReadRecord(connection, "REQ-NORMAL");
    await service.DecideAsync(exact.Id, "CONFIRM_MATCH", new ShipmentMatchDecisionRequest
    {
        ProposalId = exact.ProposalId, ConfirmedQuantity = 5,
        ReasonCode = "OPERATOR_VERIFIED_CANONICAL_INVOICE", RequestCorrelationId = Guid.NewGuid()
    }, Actor(), default);
    Equal("ERP_CONFIRMED", await TextScalar(connection, $"SELECT CurrentStatus FROM operational.ShipmentStaging WHERE ShipmentStagingId='{exact.Id}';"), "manual confirmation finalizes");
    Equal(1, await Scalar(connection, "SELECT COUNT(*) FROM operational.ShipmentInvoiceAllocation;"), "confirmed allocation recorded");

    var multi = await ReadRecord(connection, "REQ-MULTI");
    await service.DecideAsync(multi.Id, "REJECT_MATCH", new ShipmentMatchDecisionRequest
    {
        ProposalId = multi.ProposalId, ReasonCode = "INCORRECT_INVOICE_EVIDENCE",
        Note = "The invoice belongs to a different physical shipment.", RequestCorrelationId = Guid.NewGuid()
    }, Actor(), default);
    Equal("AWAITING_ERP_EVIDENCE", await TextScalar(connection, $"SELECT CurrentStatus FROM operational.ShipmentStaging WHERE ShipmentStagingId='{multi.Id}';"), "rejection remains pending");
    Equal(1, await Scalar(connection, $"SELECT COUNT(*) FROM operational.ShipmentInvoiceDecisionEvent WHERE ShipmentStagingId='{multi.Id}' AND DecisionType=N'REJECT_MATCH';"), "rejection audited");

    var direct = await ReadRecord(connection, "REQ-DIRECT");
    await service.DecideAsync(direct.Id, "CANCEL_SHIPMENT", new ShipmentMatchDecisionRequest
    {
        ReasonCode = "SHIPMENT_CANCELLED_BY_OPERATOR", Note = "Shipment was cancelled before ERP invoicing.",
        RequestCorrelationId = Guid.NewGuid()
    }, Actor(), default);
    Equal("CANCELLED", await TextScalar(connection, $"SELECT CurrentStatus FROM operational.ShipmentStaging WHERE ShipmentStagingId='{direct.Id}';"), "cancellation is a status not deletion");

    await ExpectProblem(() => service.DecideAsync(multi.Id, "REJECT_MATCH", new ShipmentMatchDecisionRequest
    {
        ProposalId = multi.ProposalId, ReasonCode = "UNKNOWN", Note = "Invalid governed code.",
        RequestCorrelationId = Guid.NewGuid()
    }, Actor(), default), "unknown decision reason rejected");
    await ExpectSql(connection, "UPDATE operational.ShipmentStagingEvent SET DecisionNote=N'rewrite';", 51031, "append-only staging event");
    await ExpectSql(connection, "DELETE FROM operational.ShipmentInvoiceDecisionEvent;", 51032, "append-only decision event");

    var automaticImport = Guid.NewGuid();
    await service.ReconcileAsync(new ShipmentReconciliationRequest
    {
        RequestCorrelationId = Guid.NewGuid(), TriggerType = "ERP_INVOICE_REFRESH",
        InvoiceHistoryImportRunId = automaticImport
    }, Actor(), default);
    var skipped = Json(await service.ReconcileAsync(new ShipmentReconciliationRequest
    {
        RequestCorrelationId = Guid.NewGuid(), TriggerType = "ERP_INVOICE_REFRESH",
        InvoiceHistoryImportRunId = automaticImport
    }, Actor(), default));
    Check(skipped.RootElement.GetProperty("reconciliationSkipped").GetBoolean(), "same canonical import reconciles once");
    Equal(0, handler.NonGetRequests, "canonical API remains read-only");

    var restartedService = new ShipmentStagingService(canonical, LoadRelationship);
    var persisted = Json(await restartedService.GetAsync(exact.Id, default));
    Equal("ERP_CONFIRMED", persisted.RootElement.GetProperty("currentStatus").GetString(), "state survives service restart");

    var repository = Directory.GetCurrentDirectory();
    var stagingServiceSource = await File.ReadAllTextAsync(Path.Combine(repository, "SRC", "modules", "shipment-staging", "shipment-staging-service.js"));
    var shippingSource = await File.ReadAllTextAsync(Path.Combine(repository, "SRC", "modules", "shipping", "shipping-workspace.js"));
    Check(stagingServiceSource.Contains("getShipmentStaging") && shippingSource.Contains("createShipmentStaging"), "5051 uses operational API");
    Check(stagingServiceSource.Contains("operationalShipmentStagingPoll") &&
        stagingServiceSource.Contains("publishOperationalLineStateChange"),
        "open staging view observes refresh and publishes shared event");
    Check(!shippingSource.Contains("persistShipmentStagingDataset(\"Shipment Processed\")") || shippingSource.Contains("if (operationalStaging)"), "legacy write is outside development branch");
    Check((await File.ReadAllTextAsync(Path.Combine(repository, "DATA", "shipment-staging", "shipment-staging.json"))).Length > 0, "legacy staging evidence remains readable");
    Check((await File.ReadAllTextAsync(Path.Combine(repository, "DATA", "shipment-history", "shipment-history.json"))).Length > 0, "legacy history evidence remains readable");

    Console.WriteLine($"PASS: {checks.Count} Shipment Staging reconciliation checks.");
    foreach (var check in checks) Console.WriteLine("  " + check);
}
finally
{
    SqlConnection.ClearAllPools();
    if (database.StartsWith("DLE_OS_SHIPMENT_STAGING_TEST_", StringComparison.Ordinal))
    {
        try { await Execute(master, $"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}];"); }
        catch (Exception error) { Console.Error.WriteLine("Test database cleanup failed: " + error.Message); }
    }
}

string Actor() => @"DLE-OS-HOST\DLE-OS";
ShipmentStagingCreateRequest Request(string requestId, string line, string item, decimal quantity) => new()
{
    RequestId = requestId, IdempotencyKey = "test:" + requestId,
    RequestCorrelationId = Guid.NewGuid(), Lines = [Line(line, item, quantity)]
};
ShipmentStagingCreateLine Line(string line, string item, decimal quantity) => new()
{
    CustomerNumber = "1238", CustomerName = "Qualification Customer", SalesOrderNumber = "12087",
    SalesOrderLineNumber = line, ItemNumber = item, QuantityProcessed = quantity,
    CanonicalOpenQuantityAtShipment = quantity, UnitOfMeasure = "EA"
};
Task<OperationalRelationshipPresentation> LoadRelationship(LineKey key, CancellationToken _) => Task.FromResult(
    key.Line switch
    {
        "002" => Presentation(key, null, "NO_WORK_ORDER_REQUIRED", "NO_WORK_ORDER_REQUIRED", "DIRECT_FULFILLMENT", true, true, null),
        "003" => Presentation(key, null, "NONE", "CANDIDATE_REVIEW_REQUIRED", "NORMAL_PRODUCTION_REVIEW", true, true, null),
        "004" => Presentation(key, null, "NONE", "RMA_DECISION_PENDING", "RMA_REWORK", true, false, new OperationalRmaControl(Guid.NewGuid(), 1, "RMA-T")),
        "005" => Presentation(key, "115611", "RMA_DECISION", "RMA_WORK_ORDER_ASSIGNED", "RMA_REWORK", true, true, new OperationalRmaControl(Guid.NewGuid(), 1, "RMA-T")),
        _ => Presentation(key, "115611", "APPROVED", "WORK_ORDER_APPROVED", "NORMAL_PRODUCTION", true, true, null)
    });
OperationalRelationshipPresentation Presentation(LineKey key, string? workOrder, string source, string status,
    string route, bool fulfillment, bool shipping, OperationalRmaControl? rma) => new(
        key.Customer, key.SalesOrder, key.Line, 10, JsonDocument.Parse("{}").RootElement.Clone(),
        workOrder, source, [], status, route, "DECIDED", "Qualification", rma, null, null,
        fulfillment, shipping, route == "NORMAL_PRODUCTION");

void Check(bool condition, string name) { if (!condition) throw new Exception("FAILED: " + name); checks.Add(name); }
void Equal<T>(T expected, T actual, string name) { Check(EqualityComparer<T>.Default.Equals(expected, actual), $"{name} ({actual})"); }
JsonDocument Json(object value) => JsonDocument.Parse(JsonSerializer.Serialize(value));

async Task ExpectProblem(Func<Task<object>> action, string name)
{
    try { await action(); throw new Exception("FAILED: " + name); }
    catch (ShipmentStagingProblem) { checks.Add(name); }
}
async Task Execute(string cs, string sql) { await using var c=new SqlConnection(cs); await c.OpenAsync(); await using var cmd=new SqlCommand(sql,c); await cmd.ExecuteNonQueryAsync(); }
async Task<int> Scalar(string cs, string sql) { await using var c=new SqlConnection(cs); await c.OpenAsync(); await using var cmd=new SqlCommand(sql,c); return Convert.ToInt32(await cmd.ExecuteScalarAsync()); }
async Task<string> TextScalar(string cs, string sql) { await using var c=new SqlConnection(cs); await c.OpenAsync(); await using var cmd=new SqlCommand(sql,c); return Convert.ToString(await cmd.ExecuteScalarAsync()) ?? ""; }
async Task ApplyMigration(string cs)
{
    var script=await File.ReadAllTextAsync(Path.Combine(Directory.GetCurrentDirectory(),"Tools","ShipmentStaging","Database","001_AddOperationalShipmentStaging.sql"));
    await using var c=new SqlConnection(cs); await c.OpenAsync();
    foreach(var batch in System.Text.RegularExpressions.Regex.Split(script,@"(?im)^\s*GO\s*$"))
    { if(string.IsNullOrWhiteSpace(batch))continue; await using var cmd=new SqlCommand(batch,c); await cmd.ExecuteNonQueryAsync(); }
}
async Task<(Guid Id,Guid? ProposalId)> ReadRecord(string cs,string request)
{
    await using var c=new SqlConnection(cs); await c.OpenAsync(); await using var cmd=new SqlCommand("SELECT ShipmentStagingId,ProposedMatchId FROM operational.vw_CurrentShipmentStaging WHERE RequestId=@Request",c); cmd.Parameters.AddWithValue("@Request",request);
    await using var reader=await cmd.ExecuteReaderAsync(); await reader.ReadAsync(); return(reader.GetGuid(0),reader.IsDBNull(1)?null:reader.GetGuid(1));
}
async Task ExpectSql(string cs,string sql,int number,string name)
{
    try { await Execute(cs,sql); throw new Exception("FAILED: "+name); }
    catch(SqlException error) when(error.Number==number) { checks.Add(name); }
}

sealed class InvoiceHandler : HttpMessageHandler
{
    public int NonGetRequests { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
    {
        if(request.Method!=HttpMethod.Get) NonGetRequests++;
        var query=Uri.UnescapeDataString(request.RequestUri?.Query ?? "");
        var item=query.Split('&').FirstOrDefault(part=>part.StartsWith("itemNumber=",StringComparison.OrdinalIgnoreCase))?.Split('=',2).Last() ?? "";
        object[] rows=item switch
        {
            "ITEM-EXACT" => [Evidence("INV-EXACT","001",5)],
            "ITEM-MULTI" => [Evidence("INV-M1","006",3),Evidence("INV-M2","006",2)],
            "ITEM-PARTIAL" => [Evidence("INV-PART","007",2)],
            "ITEM-OVER" => [Evidence("INV-OVER","008",8)],
            _ => []
        };
        var json=JsonSerializer.Serialize(new{items=rows,totalItems=rows.Length,page=1,pageSize=200});
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(json,Encoding.UTF8,"application/json")});
    }
    static object Evidence(string invoice,string line,decimal quantity)=>new{invoiceHistoryLineId="LINE-"+invoice,customerNumber="001238",invoiceNumber=invoice,invoiceLineNumber="001",invoiceDate=DateTime.UtcNow.ToString("yyyy-MM-dd"),salesOrderNumber="0012087",salesOrderLineNumber=line,itemNumber=line switch{"001"=>"ITEM-EXACT","006"=>"ITEM-MULTI","007"=>"ITEM-PARTIAL",_=>"ITEM-OVER"},quantityShipped=quantity,workOrderNumber="0115611"};
}
