using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;

var repo = Path.GetFullPath(args[0]);
if(args.Length>1&&args[1]=="commercial-context"){await CommercialContextChecks.Run(repo,args[2]);return;}
var root = Path.Combine(repo, "tmp", "operations-packet-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var now = DateTimeOffset.UtcNow;
var runtime = new SimStateMetadata("SIM", "baseline", 5, 9999, 1, now, now, 1, now, 1, 0, 1);
var store = new SimOperationsDataStore(repo, root);
await store.InitializeAsync(runtime);
int checks = 0;
void Check(bool success, string label) { if (!success) throw new Exception(label); checks++; Console.WriteLine("PASS " + label); }
Check(store.IsHealthy, "isolated baseline initializes");
string Hash() => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(store.DatabasePath)));
var p = new SimOperationsPacket(Guid.NewGuid().ToString(), 1, "", "test-reviewer", now,
    "SIM", "SIM-VPRO5", "SIMULATED_DEVELOPMENTAL", "E2E-SIM-001", "baseline", 5, 9999,
    new("RFQI-SIM-0043", Guid.NewGuid().ToString(), 7, "accepted-content-token", Guid.NewGuid().ToString(), 11,
        "RFQI-SIM-0042", "SIM-Q-0042-R01", "accepted-bom-id/version1", "manufacturing-definition-id"),
    new("990901", "DLE-SIM-CUSTOMER", "SIM-E2E-001-PO", "0099999", "010", "SIM-ASSY-001", "A",
        "E2E synthetic assembly", 10, 10, 0, "USD", 70.64m, 706.40m, "2026-10-14", null, null,
        ["Opening ERP open=10/shipped=0; simulated", "WO STANDARD/OPEN, opened date is simulated preparation date"]),
    new("0999999", "990901", "0099999", "010", "SIM-ASSY-001", "A", 10, "STANDARD", "OPEN", "2026-09-23", "EA"),
    [new("WOE-01-1", "synthetic WOE-01 explicit SO-line anchor", "990901", "0099999", "010", "0999999", "SIM-ASSY-001", "A", 10)]);
SimOperationsPacket Seal(SimOperationsPacket value) => value with { ContentHash = SimOperationsDataStore.PacketHash(value) };
p = Seal(p);
var wireRoundtrip = p with
{
    PreparedAt = p.PreparedAt.ToOffset(TimeSpan.FromHours(-7)),
    OrderLine = p.OrderLine with { QuantityOrdered = 10.00m, ErpQuantityOpen = 10.000m, OpeningShippedQuantity = 0.00m,
        UnitPrice = 70.6400m, ExtendedPrice = 706.4m },
    WorkOrder = p.WorkOrder with { ScheduledQuantity = 10.0000m },
    RelationshipEvidence = [p.RelationshipEvidence[0] with { ScheduledQuantity = 10.00m }]
};
Check(SimOperationsDataStore.PacketHash(wireRoundtrip) == p.ContentHash, "canonical hash preserves equivalent timezone offsets and decimal scales");
Check(SimOperationsDataStore.PacketHash(p with { PreparedAt = p.PreparedAt.AddMinutes(1) }) != p.ContentHash,
    "canonical timestamp hash still rejects different instants");
async Task Block(SimOperationsPacket value, string text)
{
    var before = Hash(); var result = await store.ValidatePacketAsync(Seal(value), runtime);
    Check(result.Status == "BLOCKED" && result.Errors.Any(x => x.Contains(text, StringComparison.OrdinalIgnoreCase)), "blocks " + text);
    Check(Hash() == before, "blocked dry run is byte-preserving: " + text);
}
var baseline = Hash();
var dry = await store.ValidatePacketAsync(p, runtime);
Check(dry.Status == "PASS" && dry.Relationship == "EXACT_LINE_UNIQUE", "exact unique relationship is derived from evidence");
Check(dry.SalesOrderLineId == "9909010099999010", "canonical line key matches production concatenated contract");
Check(Hash() == baseline && await store.FindReceiptAsync(p.PacketId) is null, "passing dry run creates no canonical rows or receipt schema");
Check(dry.Warnings.Any(x => x.StartsWith("Estimated")) && dry.Warnings.Any(x => x.StartsWith("ERP order")), "unknown ERP dates remain explicit warnings");
await Block(p with { Environment = "PRODUCTION" }, "Only SIM");
await Block(p with { Generation = 1 }, "stale");
await Block(p with { OrderLine = p.OrderLine with { SalesOrderNumber = "SIM-SO-0043" } }, "identifiers");
await Block(p with { OrderLine = p.OrderLine with { ExtendedPrice = 999 } }, "reconciled");
await Block(p with { OrderLine = p.OrderLine with { OpeningShippedQuantity = 1 } }, "unshipped");
await Block(p with { OrderLine = p.OrderLine with { CustomerDueDate = "10/14/2026" } }, "date-only");
await Block(p with { RelationshipEvidence = [] }, "No source relationship");
await Block(p with { RelationshipEvidence = [p.RelationshipEvidence[0] with { SalesOrderLineNumber = "020" }] }, "anchors");
await Block(p with { RelationshipEvidence = [p.RelationshipEvidence[0] with { ScheduledQuantity = 9 }] }, "reconcile");
await Block(p with { RelationshipEvidence = [p.RelationshipEvidence[0], p.RelationshipEvidence[0] with { EvidenceId = "other", WorkOrderNumber = "0999998" }] }, "more than one");
var tampered = await store.ValidatePacketAsync(p with { ContentHash = "FAKE" }, runtime);
Check(tampered.Status == "BLOCKED", "changed packet hash rejected");
async Task Sql(string sql)
{
    await using var con = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = store.DatabasePath, Pooling = false }.ToString());
    await con.OpenAsync(); await using var cmd = con.CreateCommand(); cmd.CommandText = sql; await cmd.ExecuteNonQueryAsync();
}
async Task<long> Count(string sql)
{
    await using var con = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = store.DatabasePath, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
    await con.OpenAsync(); await using var cmd = con.CreateCommand(); cmd.CommandText = sql; return Convert.ToInt64(await cmd.ExecuteScalarAsync());
}
await Sql("INSERT INTO WorkOrder VALUES('999999','TEST-ALIAS','OPEN','{}');");
await Block(p, "Work Order identity");
await Sql("DELETE FROM WorkOrder WHERE WorkOrderNumber='999999';");
await Sql("INSERT INTO SalesOrderLine VALUES('ALIAS-TEST','990999','Isolated Alias','TEST','99999','010','TEST','',1,'{}');");
await Block(p, "Sales Order identity");
await Sql("DELETE FROM SalesOrderLine WHERE SalesOrderLineId='ALIAS-TEST';");
await Sql("CREATE TRIGGER test_abort_wo BEFORE INSERT ON WorkOrder WHEN NEW.WorkOrderNumber='0999999' BEGIN SELECT RAISE(ABORT,'test transaction rollback'); END;");
try { await store.ImportPacketAsync(p, runtime, "test", "Test Reviewer"); throw new Exception("expected abort"); }
catch (SqliteException) { Check(true, "injected middle-of-transaction failure surfaced"); }
Check(await Count("SELECT COUNT(*) FROM SalesOrderLine WHERE SalesOrderNumber='0099999';") == 0 &&
    await Count("SELECT COUNT(*) FROM sqlite_master WHERE name='SimOperationsImportReceipt';") == 0,
    "failed import rolls back canonical row and new receipt schema together");
await Sql("DROP TRIGGER test_abort_wo;");
var baselineLines = await Count("SELECT COUNT(*) FROM SalesOrderLine;");
var baselineWorks = await Count("SELECT COUNT(*) FROM WorkOrder;");
var baselineKitting = await Count("SELECT COUNT(*) FROM KittingReadState;");
var result = await store.ImportPacketAsync(p, runtime, "test", "Test Reviewer");
if (!result.Readback.Verified) Console.WriteLine(JsonSerializer.Serialize(result.Readback.Errors));
Check(!result.Duplicate && result.Readback.Verified, "transaction imports and normal canonical services verify every payload field");
Check(result.Receipt.Packet == p && result.Receipt.ActorId == "test", "receipt retains immutable packet, validation and actor");
Check(await Count("SELECT COUNT(*) FROM SalesOrderLine;") == baselineLines + 1 && await Count("SELECT COUNT(*) FROM WorkOrder;") == baselineWorks + 1,
    "exactly one canonical SO line and one WO added");
Check(await Count("SELECT COUNT(*) FROM KittingReadState;") == baselineKitting, "no material status or Kitting case fabricated");
var noCase = await store.ReadKittingCaseAsync(p.WorkOrder.WorkOrderNumber, runtime.Generation);
Check(noCase is not null && JsonSerializer.SerializeToElement(noCase).GetProperty("kittingCase").ValueKind == JsonValueKind.Null,
    "exact open imported WO returns normal no-case response for forced Kitting refresh");
Check(await store.ReadKittingCaseAsync("0888888", runtime.Generation) is null, "unknown WO has no no-case fallback");
async Task<string?> MaterialKey()
{
    var page=await store.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,Microsoft.Extensions.Primitives.StringValues>{{"salesOrderNumber",p.OrderLine.SalesOrderNumber}}),runtime.Generation);
    return JsonSerializer.SerializeToElement(page.Items[0],SimOperationsDataStore.PacketJson).GetProperty("materialStatusWorkOrderNumber").GetString();
}
Check(await MaterialKey()==p.WorkOrder.WorkOrderNumber,"open exact canonical WO exposed for shared no-case material projection");
await Sql("UPDATE SalesOrderWorkOrderRelationship SET ResolutionStatus='CANDIDATE_UNIQUE' WHERE SalesOrderNumber='0099999';");
Check(await store.ReadKittingCaseAsync(p.WorkOrder.WorkOrderNumber, runtime.Generation) is null, "candidate-only WO has no actionable no-case fallback");
Check(await MaterialKey()=="","candidate relationship does not expose no-case material projection");
await Sql("UPDATE SalesOrderWorkOrderRelationship SET ResolutionStatus='EXACT_LINE_UNIQUE' WHERE SalesOrderNumber='0099999'; UPDATE SalesOrderLine SET PayloadJson=json_set(PayloadJson,'$.erpQuantityOpen',0) WHERE SalesOrderNumber='0099999';");
Check(await store.ReadKittingCaseAsync(p.WorkOrder.WorkOrderNumber, runtime.Generation) is null, "closed quantity has no actionable no-case fallback");
Check(await MaterialKey()=="","closed quantity does not expose no-case material projection");
await Sql("UPDATE SalesOrderLine SET PayloadJson=json_set(PayloadJson,'$.erpQuantityOpen',10) WHERE SalesOrderNumber='0099999';");
var line = JsonSerializer.SerializeToElement(result.Readback.SalesOrderLine, SimOperationsDataStore.PacketJson);
Check(line.GetProperty("customerDueDate").GetString() == "2026-10-14" && line.GetProperty("estimatedShipDate").GetString() == "" &&
    line.GetProperty("orderDate").GetString() == "", "reviewed due date never fills ERP ship/order date");
Check(line.GetProperty("erpQuantityOpen").GetDecimal() == 10 && line.GetProperty("importProvenance").GetProperty("simulated").GetBoolean(),
    "open quantity and synthetic provenance visible on normal canonical row");
var after = Hash();
var retry = await store.ImportPacketAsync(p, runtime, "test", "Test Reviewer");
Check(retry.Duplicate && retry.Receipt.ReceiptId == result.Receipt.ReceiptId && Hash() == after, "same packet retry returns durable receipt without writes");
var roundtripRetry = await store.ImportPacketAsync(wireRoundtrip, runtime, "test", "Test Reviewer");
Check(roundtripRetry.Duplicate && roundtripRetry.Readback.Verified && roundtripRetry.Receipt.ReceiptId == result.Receipt.ReceiptId && Hash() == after,
    "equivalent wire-roundtrip retry recovers same receipt without writes");
var restarted = new SimOperationsDataStore(repo, root); await restarted.InitializeAsync(runtime);
Check(restarted.IsHealthy && (await restarted.GetBridgeReceiptAsync(p.Source.BridgeId))!.ReceiptId == result.Receipt.ReceiptId, "restart retains additive schema and receipt recovery");
Check((await restarted.ReadPacketRecognitionAsync(result.Receipt, runtime)).Verified, "recognition reverified after restart");
var futureStore=new SimOperationsDataStore(repo,Path.Combine(root,"schema2"));await futureStore.InitializeAsync(runtime);
var future=Seal(p with{SchemaVersion=2,OrderLine=p.OrderLine with{CustomerPoDate="2026-09-22",OrderDate="2026-09-23"}});
Check((await futureStore.ValidatePacketAsync(future,runtime)).Status=="PASS","future schema2 packet accepts separate customer PO Date");
var missingPo=Seal(future with{OrderLine=future.OrderLine with{CustomerPoDate=null}});
Check((await futureStore.ValidatePacketAsync(missingPo,runtime)).Status=="BLOCKED","schema2 requires its explicit Customer PO Date");
var legacyWithDate=Seal(future with{SchemaVersion=1});
Check((await futureStore.ValidatePacketAsync(legacyWithDate,runtime)).Status=="BLOCKED","schema1 cannot silently add a new PO Date field");
var futureImport=await futureStore.ImportPacketAsync(future,runtime,"test","Test Reviewer");
var futureRow=JsonSerializer.SerializeToElement(futureImport.Readback.SalesOrderLine,SimOperationsDataStore.PacketJson);
Check(futureImport.Readback.Verified&&futureRow.GetProperty("customerPoDate").GetString()=="2026-09-22"&&futureRow.GetProperty("orderDate").GetString()=="2026-09-23"&&
    futureRow.GetProperty("customerDueDate").GetString()=="2026-10-14"&&futureRow.GetProperty("estimatedShipDate").GetString()=="","schema2 canonical import preserves four separate date facts");
await Block(p with { OrderLine = p.OrderLine with { Description = "changed" } }, "different content");
var other = Seal(p with { PacketId = Guid.NewGuid().ToString(), Source = p.Source with { BridgeId = Guid.NewGuid().ToString(), AcceptanceId = Guid.NewGuid().ToString() } });
await Block(other, "Sales Order identity");
await Block(other with { Source = p.Source }, "already has");
await Sql("UPDATE WorkOrder SET PayloadJson=json_set(PayloadJson,'$.schProdQuantity',9) WHERE WorkOrderNumber='0999999';");
var badRead = await store.ReadPacketRecognitionAsync(result.Receipt, runtime);
Check(!badRead.Verified && badRead.Errors.Any(x => x.Contains("schProdQuantity")), "recognition fails on canonical fact drift");
await Sql("UPDATE SimDatabaseMetadata SET StateGeneration=1;");
try { await store.ValidatePacketAsync(p, runtime); throw new Exception("expected database identity block"); }
catch (SimOperationsPacketProblem ex) { Check(ex.Code == "SIM_DATABASE_IDENTITY", "database generation independently rechecked"); }
Console.WriteLine($"{checks} packet-store checks passed. Isolated state: {root}");
