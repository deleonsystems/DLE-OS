using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
try{
var repo=Path.GetFullPath(args[0]);var backup=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root))throw new Exception("Fresh fixture required");
foreach(var folder in new[]{"data","state","intake-documents","documents"})foreach(var f in Directory.EnumerateFiles(Path.Combine(backup,folder),"*",SearchOption.AllDirectories)){
 var to=Path.Combine(root,Path.GetRelativePath(backup,f));Directory.CreateDirectory(Path.GetDirectoryName(to)!);File.Copy(f,to);
}
var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,ops);var prod=new SimProductionService(state,ops,intakes,provider,new(root));
var actor=new SimPersona("administrator","administrator","SIM Administrator","ACTIVE",[],[],true,"fixture");var json=SimProductionService.Json;var wo="0999997";int checks=0;
void Check(bool b,string label){if(!b)throw new Exception(label);checks++;Console.WriteLine("PASS "+label);}
async Task Reject(Func<Task> call,string code){try{await call();}catch(KittingCaseProblem e){Check(e.Code==code,code+" remains blocked");return;}catch(SimRfqIntakeProblem e){Check(e.Code==code,code+" remains blocked");return;}throw new Exception("Expected "+code);}
async Task Sql(string sql,params(string,object)[] parameters){using var c=new SqliteConnection($"Data Source={ops.DatabasePath};Pooling=False");await c.OpenAsync();using var q=c.CreateCommand();q.CommandText=sql;foreach(var(k,v)in parameters)q.Parameters.AddWithValue(k,v);await q.ExecuteNonQueryAsync();}
async Task<string> Payload(string table,string key,string value){using var c=new SqliteConnection($"Data Source={ops.DatabasePath};Mode=ReadOnly;Pooling=False");await c.OpenAsync();using var q=c.CreateCommand();q.CommandText=$"SELECT PayloadJson FROM {table} WHERE {key}=@v";q.Parameters.AddWithValue("@v",value);return (string)(await q.ExecuteScalarAsync())!;}
var rawWo=await Payload("WorkOrder","WorkOrderNumber",wo);var provenance=JsonNode.Parse(rawWo)!["importProvenance"]!;
var receipt=(await ops.FindReceiptAsync(provenance["packetId"]!.ToString()))!;var lineId=receipt.SalesOrderLineId;
var rawLine=await Payload("SalesOrderLine","SalesOrderLineId",lineId);var quality=await Payload("SimQualityRelease","WorkOrderNumber",wo);
var beforeKit=await Payload("SimKittingCase","WorkOrderNumber",wo);
var beforeReceiving=JsonSerializer.Serialize(await new SimReceivingService(state,ops,new(root)).History(actor),json);
var readback=await ops.ReadPacketRecognitionAsync(receipt,runtime);
Check(readback.Verified,"valid Quality-released import passes recognition");
Check(JsonNode.Parse(rawLine)!["releaseState"]!.ToString()=="AWAITING_RELEASE","immutable import remains Awaiting Release");
var projected=JsonSerializer.SerializeToNode((await ops.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,StringValues>{{"salesOrderNumber","0099997"}}),runtime.Generation)).Items.Single(),json)!;
Check(projected["releaseState"]!.ToString()=="RELEASED","operational projection remains Released");
var view=await prod.Read(wo,actor);Check(view.GetProperty("materialStatus").GetString()=="KIT_SHORT"&&view.GetProperty("productionStatus").GetString()=="AWAITING_PARTS"&&!view.GetProperty("ready").GetBoolean(),"Kit Short returns readable Awaiting Parts without 409");
Check(!view.GetProperty("executionStarted").GetBoolean(),"valid release does not start production");
File.WriteAllText(Path.Combine(root,"kit-short.json"),view.GetRawText());
foreach(var (field,value) in new[]{("releaseState","RELEASED"),("itemNumber","TAMPERED")}){
 var changed=JsonNode.Parse(rawLine)!;changed[field]=value;await Sql("UPDATE SalesOrderLine SET PayloadJson=@p WHERE SalesOrderLineId=@id",("@p",changed.ToJsonString()),("@id",lineId));
 var invalid=await ops.ReadPacketRecognitionAsync(receipt,runtime);Check(!invalid.Verified&&invalid.Errors.Any(e=>e.Contains(field)),"genuine stored "+field+" mismatch detected");
 await Reject(()=>prod.Read(wo,actor),"SIM_KITTING_REQUIREMENTS_READBACK");
 await Sql("UPDATE SalesOrderLine SET PayloadJson=@p WHERE SalesOrderLineId=@id",("@p",rawLine),("@id",lineId));
}
// Alter only disposable fixture release rows to qualify existing generation guards.
await Sql("DROP TRIGGER IF EXISTS SimQualityReleaseNoUpdate;DROP TRIGGER IF EXISTS SimQualityReleaseNoDelete;UPDATE SimQualityRelease SET Generation=Generation-1 WHERE WorkOrderNumber=@wo",("@wo",wo));
await Reject(()=>prod.Read(wo,actor),"SIM_KITTING_REQUIREMENTS_AWAITING_RELEASE");
await Sql("UPDATE SimQualityRelease SET Generation=@g WHERE WorkOrderNumber=@wo",("@g",runtime.Generation),("@wo",wo));
var wrong=JsonNode.Parse(quality)!;wrong["generation"]=runtime.Generation-1;await Sql("UPDATE SimQualityRelease SET PayloadJson=@p WHERE WorkOrderNumber=@wo",("@p",wrong.ToJsonString()),("@wo",wo));
await Reject(()=>prod.Read(wo,actor),"SIM_KITTING_REQUIREMENTS_QUALITY_RELEASE_CHANGED");
await Sql("UPDATE SimQualityRelease SET PayloadJson=@p WHERE WorkOrderNumber=@wo",("@p",quality),("@wo",wo));
Check((await prod.Read(wo,actor)).GetProperty("productionStatus").GetString()=="AWAITING_PARTS","valid release restored in fixture");
Check(await Payload("SimKittingCase","WorkOrderNumber",wo)==beforeKit&&JsonSerializer.Serialize(await new SimReceivingService(state,ops,new(root)).History(actor),json)==beforeReceiving,"all read-only checks preserve kit and all staged receipts");
// Qualify real allocation/submission only in this disposable copy, never active SIM.
var kit=new SimKittingCases(state,ops,provider);var c=(await ops.ReadSimKittingCase(wo,runtime))!;await kit.Resume(wo,new(c.WorkingVersion),actor);
var context=JsonSerializer.SerializeToElement(await kit.MaterialContext(wo,actor),json);
foreach(var requirement in context.GetProperty("requirements").EnumerateArray()){
 var material=requirement.GetProperty("materials").EnumerateArray().Single();c=(await ops.ReadSimKittingCase(wo,runtime))!;
 await kit.ApplyMaterial(wo,new(c.WorkingVersion,c.EditingSessionId,Guid.NewGuid(),c.CaseId,requirement.GetProperty("submissionId").GetGuid(),requirement.GetProperty("sourceRowId").GetString()!,requirement.GetProperty("requirementId").GetString()!,requirement.GetProperty("demandId").GetString()!,material.GetProperty("receiptLineId").GetString()!,material.GetProperty("version").GetInt64(),requirement.GetProperty("remainingShort").GetDecimal(),requirement.GetProperty("uom").GetString()!),actor);
}
c=(await ops.ReadSimKittingCase(wo,runtime))!;await kit.Submit(wo,new(c.WorkingVersion,c.EditingSessionId,c.Draft),actor);
view=await prod.Read(wo,actor);Check(view.GetProperty("materialStatus").GetString()=="KIT_COMPLETE"&&view.GetProperty("productionStatus").GetString()=="TRAVELER_REVIEW_REQUIRED"&&!view.GetProperty("ready").GetBoolean(),"Kit Complete still requires approved bound Traveler");
Check(!view.GetProperty("executionStarted").GetBoolean(),"Kit Complete never auto-starts production");
File.WriteAllText(Path.Combine(root,"kit-complete.json"),view.GetRawText());
view=await prod.Seed(wo,new(view.GetProperty("sourceToken").GetString()!,["op-1"]),actor);
view=await prod.Lease(wo,new(view.GetProperty("definition").GetProperty("workingVersion").GetInt64()),actor);
view=await prod.Approve(wo,new(view.GetProperty("definition").GetProperty("workingVersion").GetInt64(),view.GetProperty("definition").GetProperty("lease").GetProperty("id").GetGuid()),actor);
Check(!view.GetProperty("ready").GetBoolean(),"Traveler approval alone does not enable readiness");
view=await prod.Bind(wo,new(view.GetProperty("definition").GetProperty("workingVersion").GetInt64(),view.GetProperty("definition").GetProperty("version").GetInt32()),actor);
Check(view.GetProperty("ready").GetBoolean()&&view.GetProperty("productionStatus").GetString()=="READY_TO_START_PRODUCTION","Kit Complete plus approved bound Traveler permits readiness");
Check(!view.GetProperty("executionStarted").GetBoolean()&&view.GetProperty("currentOperations").GetArrayLength()==0,"ready-to-start never creates execution");
File.WriteAllText(Path.Combine(root,"ready-not-started.json"),view.GetRawText());
Check(await Payload("SalesOrderLine","SalesOrderLineId",lineId)==rawLine&&await Payload("WorkOrder","WorkOrderNumber",wo)==rawWo,"immutable imported source remains exact after full fixture workflow");
Console.WriteLine("PASS "+checks+" checks; fixture "+root);
}catch(Exception e){Console.Error.WriteLine(e);Environment.Exit(1);}
