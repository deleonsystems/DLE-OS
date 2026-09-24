using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);
var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","purchasing","qualification-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
var checks=0;
void Check(bool value,string message){if(!value)throw new Exception(message);checks++;Console.WriteLine("PASS "+message);}
string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
var sourceHashes=new[]{"data/dle-os-sim.db","data/rfq-intakes.json","state/metadata.json"}.ToDictionary(x=>x,x=>Hash(Path.Combine(source,x)));
foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories))
{
    if(file.EndsWith("dle-os-sim.db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
}
await using(var from=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(source,"data/dle-os-sim.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString()))
await using(var to=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"data/dle-os-sim.db"),Pooling=false}.ToString()))
{
    await from.OpenAsync();await to.OpenAsync();from.BackupDatabase(to);
    // Reset only this feature's tables in the disposable copy, so qualification is repeatable
    // after the authorized live purchase. Never reset the supplied source checkpoint.
    await using var reset=to.CreateCommand();
    reset.CommandText="DROP TABLE IF EXISTS SimPurchasingDemand; DROP TABLE IF EXISTS SimBuyingPlan; DROP TABLE IF EXISTS SimPurchaseLine; DROP TABLE IF EXISTS SimPurchasingCommand; DROP TABLE IF EXISTS SimPurchasingEvent;";
    await reset.ExecuteNonQueryAsync();
}
var state=new SimStateStore(root);await state.InitializeAsync();
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
var service=new SimPurchasingService(state,ops);
var actor=SimPersonaCatalog.Default;
JsonElement E(object value)=>JsonSerializer.SerializeToElement(value,json);
string S(JsonElement e,string key)=>e.GetProperty(key).GetString()!;
long V(JsonElement e)=>e.GetProperty("version").GetInt64();
async Task Reject(Func<Task> action,string message){try{await action();}catch(Exception e) when(e is SimPurchasingProblem or SimOrderEntryPermissionException){Check(true,message+" ["+e.GetType().Name+"]");return;}throw new Exception(message);}
async Task<string> TableHash(string table)
{
    await using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=ops.DatabasePath,Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString());await c.OpenAsync();
    await using var cmd=c.CreateCommand();cmd.CommandText="SELECT * FROM \""+table+"\" ORDER BY 1;";
    await using var reader=await cmd.ExecuteReaderAsync();var rows=new List<string>();
    while(await reader.ReadAsync()){var values=new object[reader.FieldCount];reader.GetValues(values);rows.Add(JsonSerializer.Serialize(values,json));}
    return Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n",rows))));
}
var protectedTables=new[]{"SimKittingCase","SimKittingCaseEvent","SimKittingSubmission","KittingReadState","SalesOrderLine","WorkOrder"};
var before=new Dictionary<string,string>();foreach(var t in protectedTables)before[t]=await TableHash(t);
var intakesHash=Hash(Path.Combine(root,"data/rfq-intakes.json"));
var incoming=E(await service.Read(actor));
var demand=incoming.GetProperty("demands").EnumerateArray().Single(d=>S(d,"workOrderNumber")=="0999999");
var demandId=S(demand,"demandId");
Check(S(demand,"partNumber")=="SIM-OPTO-4"&&demand.GetProperty("shortQuantity").GetDecimal()==8,"submitted shortage projects one SIM-OPTO-4 demand for 8");
Check(demand.GetProperty("requiredQuantity").GetDecimal()==20&&demand.GetProperty("kittedQuantity").GetDecimal()==12,"released requirement and submitted count remain distinct");
Check(!demand.GetProperty("qualityRequirements").GetProperty("poTraceabilityRequired").GetBoolean()&&demand.GetProperty("qualityRequirements").GetProperty("originalPoTraceabilityRequired").GetBoolean(),"reviewed Not Required policy retains original Required history");
Check(S(demand,"customerDueDate")=="2026-10-14"&&S(demand,"salesOrderNumber")=="0099999"&&S(demand,"salesOrderLineNumber")=="010","authoritative customer due date and SO lineage");
Check(E(await service.Read(actor)).GetProperty("demands").GetArrayLength()==incoming.GetProperty("demands").GetArrayLength(),"GET reload creates no duplicate demand");
var accept=new SimPurchasingVersionRequest(V(demand),Guid.NewGuid());
await Reject(async()=>{await service.Accept(demandId,accept,SimPersonaCatalog.Get("read-only-viewer")!);},"readonly actor cannot accept");
var accepted=E(await service.Accept(demandId,accept,actor));
Check(V(accepted)>V(demand),"accept advances demand version");
Check(E(await service.Accept(demandId,accept,actor)).GetRawText()==accepted.GetRawText(),"same accept retry is idempotent");
await Reject(async()=>{await service.Accept(demandId,new(V(demand),Guid.NewGuid()),actor);},"second acceptance with stale version is rejected");

SimBuyingPlanRequest Plan(decimal buy=8,decimal coverage=8,string? excess=null,long version=0)=>new(version,Guid.NewGuid(),"DLE-SIM-SUPPLIER","SIM-OPTO-4",buy,"EA",1.25m,"USD","2026-10-05","2026-10-07",null,"Isolated purchasing qualification",excess,[new(demandId,coverage,V(accepted))]);
await Reject(async()=>{await service.SavePlan(null,Plan(25),actor);},"excess buying requires an explicit purpose");
await Reject(async()=>{await service.SavePlan(null,Plan(9,9),actor);},"coverage cannot exceed source shortage");
var create=Plan();
var plan=E(await service.SavePlan(null,create,actor));var planId=plan.GetProperty("planId").GetGuid();
Check(E(await service.SavePlan(null,create,actor)).GetProperty("planId").GetGuid()==planId,"create-plan retry is idempotent");
await Reject(async()=>{await service.SavePlan(null,create with{BuyQuantity=9,ExcessPurpose="Changed retry payload"},actor);},"same request ID with different intent is rejected");
await Reject(async()=>{await service.SavePlan(null,Plan(),actor);},"second buying plan cannot reserve already-covered demand");
var independent=E(await service.SavePlan(planId,Plan(25,8,"Future synthetic stock",V(plan)),actor));
Check(independent.GetProperty("buyQuantity").GetDecimal()==25&&E(await service.Read(actor)).GetProperty("demands").EnumerateArray().Single(d=>S(d,"demandId")==demandId).GetProperty("shortQuantity").GetDecimal()==8,"buy quantity changes independently of immutable source shortage");
plan=E(await service.SavePlan(planId,Plan(version:V(independent)),actor));
var ready=E(await service.Ready(planId,new(V(plan),Guid.NewGuid()),actor));
Check(S(ready,"state")=="READY_FOR_PO","Shop List readiness persists on same plan");
var edited=E(await service.SavePlan(planId,Plan(version:V(ready)),actor));
Check(S(edited,"state")=="DRAFT","editing ready plan requires readiness review again");
await Reject(async()=>{await service.Purchase(planId,new(V(edited),Guid.NewGuid(),"SIM-PO-0001","010","2026-09-23",null,null),actor);},"draft plan cannot record purchase");
ready=E(await service.Ready(planId,new(V(edited),Guid.NewGuid()),actor));
var purchaseRequest=new SimPurchaseRequest(V(ready),Guid.NewGuid(),"SIM-PO-0001","010","2026-09-23","SIM-ACK-0001","Isolated developmental evidence; no supplier obligation");
var purchase=E(await service.Purchase(planId,purchaseRequest,actor));
Check(purchase.GetProperty("orderedQuantity").GetDecimal()==8&&purchase.GetProperty("extendedCost").GetDecimal()==10m,"purchase quantities and decimal cost math");
Check(E(await service.Purchase(planId,purchaseRequest,actor)).GetRawText()==purchase.GetRawText(),"record-purchase retry returns same line");
await Reject(async()=>{await service.Purchase(planId,purchaseRequest with{RequestId=Guid.NewGuid()},actor);},"repeat click with distinct request cannot duplicate purchase");
await Reject(async()=>{await service.SavePlan(planId,Plan(version:V(ready)+1),actor);},"ordered plan cannot be edited");
var expected=E(await service.Expected(actor));
var receipt=expected.GetProperty("items").EnumerateArray().Single();
Check(!expected.GetProperty("canReceive").GetBoolean()&&receipt.GetProperty("orderedQuantity").GetDecimal()==8&&receipt.GetProperty("receivedQuantity").GetDecimal()==0&&receipt.GetProperty("openQuantity").GetDecimal()==8,"one expected PO line with ordered8 received0 open8 and no receiving capability");
Check(S(receipt,"provenance")=="SIMULATED_DEVELOPMENTAL"&&S(receipt,"status")=="EXPECTED"&&S(receipt,"receiptState")=="AWAITING_RECEIPT","explicit developmental and awaiting-receipt truth");
Check(receipt.GetProperty("coverage")[0].GetProperty("quantity").GetDecimal()==8&&S(receipt.GetProperty("coverage")[0],"workOrderNumber")=="0999999","expected receipt retains per-demand coverage");
Check(S(receipt,"expectedDate")=="2026-10-07"&&S(receipt,"requestedDate")=="2026-10-05"&&S(receipt,"materialNeedBy")==""&&S(receipt.GetProperty("coverage")[0],"customerDueDate")=="2026-10-14","supplier dates, absent need-by and customer due remain separate date-only facts");
var events=await service.History(actor);
foreach(var kind in new[]{"SHORTAGE_ACCEPTED","BUYING_PLAN_CREATED","BUYING_PLAN_UPDATED","READY_FOR_PO","PURCHASE_RECORDED"})Check(events.Any(e=>e.EventType==kind&&e.ActorId==actor.Id&&e.ResultingVersion>e.ExpectedVersion),"audited versioned transition "+kind);
Check(events.Count(e=>e.EventType=="SHORTAGE_ACCEPTED")==1&&events.Count(e=>e.EventType=="PURCHASE_RECORDED")==1,"retries append no duplicate transition events");
service=new SimPurchasingService(state,ops);
Check(E(await service.Expected(actor)).GetRawText()==expected.GetRawText(),"expected line survives service reload");
foreach(var p in before)Check(await TableHash(p.Key)==p.Value,"unchanged protected table "+p.Key);
Check(Hash(Path.Combine(root,"data/rfq-intakes.json"))==intakesHash,"accepted order and RFQ Material Costing unchanged");
foreach(var p in sourceHashes)Check(Hash(Path.Combine(source,p.Key))==p.Value,"live checkpoint untouched "+p.Key);
checks+=await AdditionalChecks.Run(repo,source);
Console.WriteLine($"PASS {checks} checks; isolated state: {root}");
