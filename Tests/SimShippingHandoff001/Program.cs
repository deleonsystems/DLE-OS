using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","shipping-handoff","tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state","intake-documents"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
    if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var destination=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination);
}
var db=Path.Combine(root,"data/dle-os-sim.db");
await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
await using(var b=new SqliteConnection($"Data Source={db};Pooling=False")){await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
await DepartureTests.Run(repo,root);
// Only the disposable copy is reset, allowing reruns after the authorized live milestone.
async Task Sql(string sql){await using var c=new SqliteConnection($"Data Source={db};Pooling=False");await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();}
await Sql("DROP TABLE IF EXISTS SimShippingHandoffEvent;");
var actor=SimPersonaCatalog.Default;var checks=0;const string wo="0999999";
void Check(bool pass,string text){if(!pass)throw new Exception(text);checks++;Console.WriteLine("PASS "+text);}
async Task Reject(Func<Task> action,string code){try{await action();}catch(KittingCaseProblem e){Check(e.Code==code,code+" actual="+e.Code);return;}catch(SimRfqIntakeProblem e){Check(code=="source_readback"&&e.Message.Contains("Canonical imported order facts"),"stale ERP remaining rejected by verified source guard");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Expected "+code);}
async Task<Dictionary<string,string>> Existing(){
    await using var c=new SqliteConnection($"Data Source={db};Mode=ReadOnly;Pooling=False");await c.OpenAsync();var tables=new List<string>();
    await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name<>'SimShippingHandoffEvent' ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));}
    var hashes=new Dictionary<string,string>();foreach(var table in tables){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{table}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(JsonSerializer.Serialize(values));}hashes[table]=SimProductionService.Hash(rows);}return hashes;
}
var before=await Existing();var filesBefore=Directory.EnumerateFiles(Path.Combine(root,"data"),"*.json").ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
var state=new SimStateStore(root);await state.InitializeAsync();var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,operations);
SimProductionService Service()=>new(state,operations,intakes,provider,new(root));var service=Service();
var v=await service.ReadShipping(wo,actor);var initial=v;
Check(v.Clearances.Length==0&&v.Authorizations.Length==0&&v.History.Length==0,"read does not seed handoff");
Check(v.MaterialStatus=="KIT_COMPLETE"&&v.ProductionExecution=="NOT_STARTED"&&v.ProductionStatus=="READY_TO_START_PRODUCTION","separate material/production states");
var route=v.Traveler.Operations.Where(x=>x.Enabled&&x.Classification=="PRODUCTION").OrderBy(x=>x.Sequence).ToArray();
Check(route[^2].Sequence==120&&route[^1].Sequence==130,"reviewed gate 120 precedes Packaging 130");
SimClearanceCreate Create(string token,decimal qty=10)=>new(Guid.NewGuid(),token,qty,"SIMULATED_DEVELOPMENTAL",route[^2].Id,route[^1].Id,"Isolated developmental test; no execution");
SimAuthorizationCreate Release(string token,Guid id,decimal qty)=>new(Guid.NewGuid(),token,id,qty,"Not set — dispatch planning pending","Isolated release test");
await Reject(()=>service.CreateClearance(wo,Create(v.Token),SimPersonaCatalog.Get("shipping-operator")!),"permission");
await Reject(()=>service.CreateClearance(wo,Create(v.Token) with{SourceMode="REAL_EXECUTION"},actor),"shipping_execution_unavailable");
await Reject(()=>service.CreateClearance(wo,Create(v.Token,11),actor),"shipping_quantity");
await Reject(()=>service.CreateClearance(wo,Create(v.Token,0),actor),"shipping_quantity");
await Reject(()=>service.CreateClearance(wo,Create(v.Token) with{GateOperationId=route[0].Id},actor),"shipping_gate");
await Reject(()=>service.CreateClearance(wo,Create(v.Token) with{Reason=""},actor),"shipping_reason");
await Reject(()=>service.AuthorizeShipment(wo,Release(v.Token,Guid.NewGuid(),10),actor),"shipping_clearance_required");
await Reject(()=>service.CreateClearance(wo,Create("stale"),actor),"shipping_stale");
var create=Create(v.Token);v=await service.CreateClearance(wo,create,actor);var clearance=v.Clearances.Single();
Check(clearance.Quantity==10&&clearance.SourceMode=="SIMULATED_DEVELOPMENTAL"&&clearance.State=="CLEARED_FOR_PACKAGING","exact developmental clearance quantity and mode");
Check(clearance.TravelerId==v.Traveler.TravelerId&&clearance.RevisionId==v.Traveler.Id&&clearance.TravelerVersion==1,"effective approved Traveler identity retained");
Check(clearance.Gate.Id==route[^2].Id&&clearance.Packaging.Id==route[^1].Id,"gate and Packaging stable identities retained");
Check(clearance.Serials.Length==0&&v.ProductionExecution=="NOT_STARTED","no serial allocation or execution evidence");
Check((await service.CreateClearance(wo,create,actor)).History.Length==1,"duplicate clearance request idempotent");
await Reject(()=>service.CreateClearance(wo,create with{Quantity=9},actor),"shipping_idempotency_conflict");
await Reject(()=>service.CreateClearance(wo,Create(v.Token),actor),"shipping_sim_scope");
await Reject(()=>service.AuthorizeShipment(wo,Release(v.Token,clearance.Id,11),actor),"shipping_quantity");
await Reject(()=>service.AuthorizeShipment(wo,Release(v.Token,clearance.Id,1),SimPersonaCatalog.Get("shipping-operator")!),"permission");
Check(SimPersonaCatalog.Get("operations-manager")!.Can("shipments.release"),"Operations owns authorization permission");
var stale=v.Token;
await Sql("UPDATE SalesOrderLine SET PayloadJson=json_set(PayloadJson,'$.erpQuantityOpen',9) WHERE SalesOrderNumber='0099999';");
await Reject(()=>service.AuthorizeShipment(wo,Release(stale,clearance.Id,10),actor),"source_readback");
await Sql("UPDATE SalesOrderLine SET PayloadJson=json_set(PayloadJson,'$.erpQuantityOpen',10) WHERE SalesOrderNumber='0099999';");
v=await service.ReadShipping(wo,actor);var partial=Release(v.Token,clearance.Id,4);v=await service.AuthorizeShipment(wo,partial,actor);
Check(v.Authorizations.Single().Quantity==4&&v.AvailableToRelease==6,"partial authorization reserves four and leaves six");
await Reject(()=>service.ConfirmSimDeparture(wo,v.Authorizations[0].Id,new(Guid.NewGuid(),v.Token,1),SimPersonaCatalog.Get("shipping-operator")!),"shipping_departure_unavailable");
Check((await service.AuthorizeShipment(wo,partial,actor)).Authorizations.Length==1,"duplicate release click idempotent");
await Reject(()=>service.AuthorizeShipment(wo,partial with{Quantity=5},actor),"shipping_idempotency_conflict");
await Reject(()=>service.AuthorizeShipment(wo,Release(stale,clearance.Id,6),actor),"shipping_stale");
var raceToken=v.Token;
async Task<bool> Race(){try{await Service().AuthorizeShipment(wo,Release(raceToken,clearance.Id,6),actor);return true;}catch(KittingCaseProblem e)when(e.Code=="shipping_stale"){return false;}}
var race=await Task.WhenAll(Race(),Race());Check(race.Count(x=>x)==1,"two concurrent services cannot double-release remaining quantity");
v=await service.ReadShipping(wo,actor);Check(v.Authorizations.Sum(x=>x.Quantity)==10&&v.AvailableToRelease==0,"full release within cleared and ERP quantity");
Check(v.Authorizations.All(x=>x.State=="RELEASED"&&x.Version==1),"release states versioned");
var context=v.Authorizations[0].Context;
Check(context.GetProperty("customerPo").GetString()=="SIM-E2E-001-PO"&&context.GetProperty("salesOrderNumber").GetString()=="0099999"&&context.GetProperty("lineNumber").GetString()=="010","PO/SO/customer lineage");
Check(context.GetProperty("customerDueDate").GetString()=="2026-10-14","accepted date-only due date");
var docs=context.GetProperty("requiredDocuments");Check(docs.GetProperty("customerCoC").GetString()=="REQUIRED"&&docs.GetProperty("serialList").GetString()!.StartsWith("REQUIRED")&&docs.GetProperty("testResults").GetString()!.StartsWith("REQUIRED"),"retained required CoC serial list test results");
Check(docs.GetProperty("fai").GetString()=="NOT_ESTABLISHED","FAI not invented");
Check(context.GetProperty("shippingMethod").GetProperty("status").GetString()=="REVIEW_REQUIRED"&&context.GetProperty("shippingMethod").GetProperty("questionnaire").GetString()=="WILL_CALL","shipping conflict remains explicit");
Check(context.GetProperty("shippingMethod").GetProperty("poEvidence")[0].GetProperty("value").GetString()!.Contains("ground",StringComparison.OrdinalIgnoreCase),"original ground transport evidence retained");
Check(v.History.All(x=>x.ActorId==actor.Id&&x.AtUtc!=default&&x.RequestId!=Guid.Empty&&x.ExpectedToken.Length==64),"actor/time/idempotency/expected-token audit");
var fresh=Service();Check(SimProductionService.Hash(await fresh.ReadShipping(wo,actor))==SimProductionService.Hash(v),"fresh service reload sees durable authorization");
await File.WriteAllTextAsync(Path.Combine(repo,"tmp/shipping-handoff/released-fixture.json"),JsonSerializer.Serialize(v,SimProductionService.Json));
Check(JsonSerializer.Serialize(await fresh.ShippingQueue(SimPersonaCatalog.Get("shipping-operator")!)).Contains("RELEASED"),"Shipping reader discovers released work directly");
var authorization=v.Authorizations[0];
await Reject(()=>service.DispositionShipping(wo,authorization.Id,false,new(Guid.NewGuid(),v.Token,99,"HELD","Test"),actor),"shipping_version");
v=await service.DispositionShipping(wo,authorization.Id,false,new(Guid.NewGuid(),v.Token,1,"HELD","Review required"),actor);
Check(v.Authorizations.Single(x=>x.Id==authorization.Id).State=="HELD"&&v.AvailableToRelease==0,"held authorization retains reservation");
v=await service.DispositionShipping(wo,authorization.Id,false,new(Guid.NewGuid(),v.Token,2,"REVOKED","Withdraw unshipped authorization"),actor);
Check(v.AvailableToRelease==4&&v.History.Any(x=>x.Authorization?.Id==authorization.Id&&x.Authorization.State=="RELEASED"),"revocation frees unshipped quantity without erasing history");
var beforeClearanceHold=v.Token;
v=await service.DispositionShipping(wo,clearance.Id,true,new(Guid.NewGuid(),v.Token,1,"HELD","Quality review"),actor);
Check(v.Clearances.Single().State=="HELD"&&v.AvailableToRelease==0,"clearance hold blocks further release");
await Reject(()=>service.AuthorizeShipment(wo,Release(beforeClearanceHold,clearance.Id,1),actor),"shipping_stale");
await Reject(()=>service.AuthorizeShipment(wo,Release(v.Token,clearance.Id,1),actor),"shipping_clearance_required");
v=await service.DispositionShipping(wo,clearance.Id,true,new(Guid.NewGuid(),v.Token,2,"REVOKED","Withdraw developmental clearance"),actor);
Check(v.Clearances.Single().State=="REVOKED"&&v.History[0].Clearance!.State=="CLEARED_FOR_PACKAGING","clearance revocation preserves initial evidence");
try{await Sql("UPDATE SimShippingHandoffEvent SET Sequence=500;");throw new Exception("Expected immutable history");}catch(SqliteException){Check(true,"append-only journal rejects UPDATE");}
try{await Sql("DELETE FROM SimShippingHandoffEvent;");throw new Exception("Expected immutable history");}catch(SqliteException){Check(true,"append-only journal rejects DELETE");}
// Restore fixture SQL text exactly before whole-table preservation comparison.
await using(var original=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False")){
    await original.OpenAsync();await using var q=original.CreateCommand();q.CommandText="SELECT PayloadJson FROM SalesOrderLine WHERE SalesOrderNumber='0099999'";var payload=(string)(await q.ExecuteScalarAsync())!;
    await using var c=new SqliteConnection($"Data Source={db};Pooling=False");await c.OpenAsync();await using var update=c.CreateCommand();update.CommandText="UPDATE SalesOrderLine SET PayloadJson=@p WHERE SalesOrderNumber='0099999'";update.Parameters.AddWithValue("@p",payload);await update.ExecuteNonQueryAsync();
}
var after=await Existing();foreach(var x in before)Check(after[x.Key]==x.Value,"unchanged table "+x.Key);
foreach(var x in filesBefore)Check(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(x.Key)))==x.Value,"unchanged file "+Path.GetFileName(x.Key));
// Adversarial fixture only, after preservation checks: a later approved effective Traveler
// invalidates the earlier clearance rather than silently reusing its gate.
var beforeTravelerChange=v.Token;
var revised=initial.Traveler with{Id=Guid.NewGuid(),Version=2,PreviousRevisionId=initial.Traveler.Id,ChangeBasis="WO_SPECIFIC",Reason="Isolated source revision test"};
var fixtureStore=new SimProductionStore(db);
await fixtureStore.ShippingTransaction(true,async(c,t)=>{
    await SimProductionStore.FreezeRevision(c,t,revised);
    await SimProductionStore.SaveHead(c,t,new(wo,revised.Generation,revised.TravelerId,100,revised.Id,2));return true;
});
await Reject(()=>service.AuthorizeShipment(wo,Release(beforeTravelerChange,clearance.Id,1),actor),"shipping_stale");
Check((await service.ReadShipping(wo,actor)).Traveler.Id==revised.Id,"handoff resolves effective approved revision, never mutable draft");
Console.WriteLine($"PASS {checks} checks; isolated fixture {root}");
