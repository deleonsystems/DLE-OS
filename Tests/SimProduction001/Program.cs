using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","production-foundation","tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state","intake-documents"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
    if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var destination=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination);
}
var db=Path.Combine(root,"data/dle-os-sim.db");
await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
await using(var b=new SqliteConnection($"Data Source={db};Pooling=False")){await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
// The live reference may already have an approved Traveler. Reset only the new,
// disposable copy's Traveler tables so this harness can qualify initial creation again.
await using(var fixture=new SqliteConnection($"Data Source={db};Pooling=False")){
    await fixture.OpenAsync();await using var reset=fixture.CreateCommand();
    reset.CommandText="DROP TABLE IF EXISTS SimWoTravelerRevisionEvent; DROP TABLE IF EXISTS SimWoTravelerRevision; DROP TABLE IF EXISTS SimWoTravelerDraft; DROP TABLE IF EXISTS SimWoTravelerRevisionHead; DROP TABLE IF EXISTS SimTravelerEvent; DROP TABLE IF EXISTS SimWoTraveler; DROP TABLE IF EXISTS SimTravelerApprovedVersion; DROP TABLE IF EXISTS SimTravelerDefinition;";
    await reset.ExecuteNonQueryAsync();
}
var json=SimProductionService.Json;var actor=SimPersonaCatalog.Default;var checks=0;
void Check(bool pass,string text){if(!pass)throw new Exception(text);checks++;Console.WriteLine("PASS "+text);}
async Task Reject(Func<Task> action,string code){try{await action();}catch(KittingCaseProblem e){Check(e.Code==code,code);return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Expected "+code);}
async Task<Dictionary<string,string>> Existing(){
    await using var c=new SqliteConnection($"Data Source={db};Mode=ReadOnly;Pooling=False");await c.OpenAsync();var tables=new List<string>();
    await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'SimTraveler%' AND name<>'SimWoTraveler' ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));}
    var hashes=new Dictionary<string,string>();foreach(var table in tables){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{table}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(JsonSerializer.Serialize(values,json));}hashes[table]=SimProductionService.Hash(rows);}return hashes;
}
var before=await Existing();var filesBefore=Directory.EnumerateFiles(Path.Combine(root,"data"),"*.json").ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
var state=new SimStateStore(root);await state.InitializeAsync();var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,operations);
var service=new SimProductionService(state,operations,intakes,provider,new(root));const string wo="0999999";
var view=await service.Read(wo,actor);var sourceToken=view.GetProperty("sourceToken").GetString()!;
await File.WriteAllTextAsync(Path.Combine(root,"unseeded.json"),view.GetRawText());
Check(view.GetProperty("definition").ValueKind==JsonValueKind.Null&&view.GetProperty("boundTraveler").ValueKind==JsonValueKind.Null,"GET does not seed a Traveler");
Check(view.GetProperty("source").GetProperty("laborVersion").GetInt32()==2,"frozen Labor version2 source");
Check(view.GetProperty("source").GetProperty("manufacturingDefinitionId").GetString()=="c545f92b-d0ac-40f6-b072-ff1ce68a1f6b","frozen manufacturing identity retained");
Check(view.GetProperty("operations").GetArrayLength()==13,"all13source operations previewed");
Check(!view.GetProperty("ready").GetBoolean()&&view.GetProperty("productionStatus").GetString()=="TRAVELER_REVIEW_REQUIRED","KitComplete without approvedboundTraveler is notready");
foreach(var status in new[]{"NEEDS_KITTING","KITTING_IN_PROGRESS"})Check(SimProductionService.Status(status,true)=="AWAITING_KITTING",status+" awaitsKitting");
Check(SimProductionService.Status("KIT_SHORT",true)=="AWAITING_PARTS","KitShort awaitsParts");
Check(SimProductionService.Status("KIT_COMPLETE",true)=="READY_TO_START_PRODUCTION","KitComplete validTraveler ready");
Check(SimProductionService.Status("UNKNOWN",true)=="SOURCE_REVIEW_REQUIRED","unknownMaterials failclosed");
Check(view.GetProperty("bom").GetArrayLength()==12,"12frozen releasedrequirements");
var opto=view.GetProperty("bom").EnumerateArray().Single(b=>b.GetProperty("partNumber").GetString()=="SIM-OPTO-4");
Check(opto.GetProperty("recordedKittedQuantity").GetDecimal()==20&&opto.GetProperty("originalKittedQuantity").GetDecimal()==12&&opto.GetProperty("acceptedMaterialApplied").GetDecimal()==8,"SIM-OPTO4 original12 accepted8 final20");
Check(opto.GetProperty("acceptedMaterials")[0].GetProperty("materialId").GetString()=="SIM-AM-0000001","acceptedmaterial identity preserved");
Check(opto.GetProperty("acceptedMaterials")[0].GetProperty("purchaseOrderNumber").GetString()=="SIM-PO-0001"&&opto.GetProperty("acceptedMaterials")[0].GetProperty("purchaseOrderLine").GetString()=="010","frozen acceptedmaterial retains supplierPOandline");
Check(view.GetProperty("bom").EnumerateArray().Any(b=>b.GetProperty("recordedKittedQuantity").ValueKind==JsonValueKind.Null),"completion dispositions do not inventnumericcounts");
await Reject(()=>service.Read(wo,SimPersonaCatalog.Get("no-access")!),"permission");
await Reject(()=>service.Seed(wo,new(sourceToken,["op-1"]),SimPersonaCatalog.Get("read-only-viewer")!),"permission");
await Reject(()=>service.Seed(wo,new("stale",["op-1"]),actor),"traveler_source_changed");
await Reject(()=>service.Seed(wo,new(sourceToken,["missing"]),actor),"traveler_prerequisite_identity");
await Reject(()=>service.Seed(wo,new(sourceToken,["op-1","op-1"]),actor),"traveler_prerequisite_identity");
await Reject(()=>service.Seed(wo,new(sourceToken,Enumerable.Range(1,13).Select(n=>"op-"+n).ToArray()),actor),"traveler_validation");
view=await service.Seed(wo,new(sourceToken,["op-1"]),actor);
long Version()=>view.GetProperty("definition").GetProperty("workingVersion").GetInt64();
Guid Lease()=>view.GetProperty("definition").GetProperty("lease").GetProperty("id").GetGuid();
SimTravelerEditOperation[] Edits()=>view.GetProperty("definition").GetProperty("operations").Deserialize<SimTravelerOperation[]>(json)!.Select(o=>new SimTravelerEditOperation(o.Id,o.Sequence,o.Department,o.WorkCenter,o.ShopInstructions,o.ManagementNotes,o.InspectionRequirements,o.Enabled,o.ExclusionReason)).ToArray();
Check(view.GetProperty("definition").GetProperty("status").GetString()=="DRAFT","explicit seedcreatesDraft");
var sourceOps=view.GetProperty("operations").Deserialize<SimTravelerOperation[]>(json)!;
Check(sourceOps.Single(o=>o.SourceOperationId=="op-1") is{Classification:"MATERIALS_PREREQUISITE",Enabled:false},"KittingexplicitlyretainedasMaterialsprerequisite");
Check(sourceOps.Count(o=>o.Enabled&&o.Classification=="PRODUCTION")==12,"12activeProductionoperations");
Check(sourceOps.Where(o=>o.Enabled).Select(o=>o.Sequence).SequenceEqual(Enumerable.Range(2,12).Select(n=>n*10m)),"active sequences20through130");
Check(sourceOps.Select(o=>o.Id).Distinct().Count()==13&&sourceOps.All(o=>o.Id!=o.SourceOperationId),"stableTravelerIDsseparatefromsourceIDs");
foreach(var op in sourceOps)Check(op.ProductionNotes.All(n=>n.Purpose=="PRODUCTION"&&!n.Removed),"onlyproductionnotes "+op.SourceOperationId);
Check(sourceOps.All(o=>!string.IsNullOrWhiteSpace(o.Instructions)&&o.ProductionNotes.Length>0),"frozeninstructions andproductionnotes retainedonall13");
Check(sourceOps.Where(o=>o.Visuals.Length>0).Select(o=>o.SourceOperationId).SequenceEqual(new[]{"op-5","op-7","op-8","op-11"}),"four frozenvisuals retained exactsteps");
Check(sourceOps.Single(o=>o.SourceOperationId=="op-9").Visuals.Length==0,"HandSolder stays textonly");
await Reject(()=>service.Seed(wo,new(sourceToken,["op-1"]),actor),"traveler_already_exists");
await Reject(()=>service.Approve(wo,new(Version(),Guid.NewGuid()),actor),"traveler_lease_required");
await Reject(()=>service.Bind(wo,new(Version(),1),actor),"traveler_approval_required");
view=await service.Lease(wo,new(Version()),actor);
await Reject(()=>service.Lease(wo,new(1),actor),"traveler_version_changed");
await Reject(()=>service.Lease(wo,new(Version()),SimPersonaCatalog.Get("operations-manager")!),"traveler_in_use");
await Reject(()=>service.Draft(wo,new(Version(),Guid.NewGuid(),"review",Edits()),actor),"traveler_lease_required");
await Reject(()=>service.Draft(wo,new(Version(),Lease(),"",Edits()),actor),"traveler_reason_required");
var edits=Edits();edits[1]=edits[1] with{Sequence=edits[2].Sequence};
await Reject(()=>service.Draft(wo,new(Version(),Lease(),"review",edits),actor),"traveler_validation");
edits=Edits();edits[0]=edits[0] with{Enabled=true};await Reject(()=>service.Draft(wo,new(Version(),Lease(),"review",edits),actor),"traveler_validation");
await Reject(()=>service.Draft(wo,new(Version(),Lease(),"review",Edits()[..12]),actor),"traveler_operation_identity");
view=await service.Approve(wo,new(Version(),Lease()),actor);
Check(view.GetProperty("definition").GetProperty("status").GetString()=="APPROVED"&&!view.GetProperty("ready").GetBoolean(),"approvedalone stillrequiresbinding");
view=await service.Bind(wo,new(Version(),1),actor);var bound=view.GetProperty("boundTraveler").GetRawText();
Check(view.GetProperty("ready").GetBoolean()&&view.GetProperty("productionStatus").GetString()=="READY_TO_START_PRODUCTION","approved frozenWOTraveler enablesderivedreadiness");
Check(view.GetProperty("firstOperation").GetProperty("sequence").GetDecimal()==20&&view.GetProperty("firstOperation").GetProperty("name").GetString()=="PCB Preparation"&&view.GetProperty("firstOperation").GetProperty("state").GetString()=="READY","firstoperation20PCBPreparation ready");
Check(!view.GetProperty("executionStarted").GetBoolean()&&view.GetProperty("currentOperations").GetArrayLength()==0&&sourceOps.All(o=>o.ExecutionState=="NOT_STARTED"),"noexecutioneventsoractiveoperations");
await File.WriteAllTextAsync(Path.Combine(root,"bound.json"),view.GetRawText());Console.WriteLine("PROJECTION "+Path.Combine(root,"bound.json"));
await File.WriteAllTextAsync(Path.Combine(repo,"tmp","production-foundation","isolated-bound.json"),view.GetRawText());
await Reject(()=>service.Bind(wo,new(Version(),1),actor),"traveler_already_bound");
foreach(var doc in view.GetProperty("technicalDocuments").EnumerateArray()){
    var file=await service.Document(wo,doc.GetProperty("documentId").GetString()!,false,actor);
    Check(Convert.ToHexString(SHA256.HashData(file.Bytes))==doc.GetProperty("sha256").GetString(),"verifiedtechnicalreference "+file.Name);
}
foreach(var visual in sourceOps.SelectMany(o=>o.Visuals)){
    var file=await service.Document(wo,visual.DocumentId,true,actor);Check(Convert.ToHexString(SHA256.HashData(file.Bytes))==visual.Sha256,"verifiedvisual "+visual.Name);
}
await Reject(()=>service.Document(wo,"bbf3bdc0-797a-47dc-84df-d2d71106f3a6",false,actor),"production_document_scope");
var kit=await service.KittingPdf(wo,actor);Check(kit.Bytes.AsSpan().StartsWith("%PDF"u8),"finalgovernedKittingPDFopens");
foreach(var kind in new[]{"traveler","bom"}){var pdf=await SimProductionPrint.Create(view,kind,actor,new(2026,9,25,18,0,0,TimeSpan.Zero));Check(pdf.AsSpan().StartsWith("%PDF"u8),kind+"PDF generated from frozenprojection");await File.WriteAllBytesAsync(Path.Combine(root,kind+".pdf"),pdf);}
view=await service.Lease(wo,new(Version()),actor);edits=Edits();edits[1]=edits[1] with{ShopInstructions="Reviewed shop instruction for next definition version."};
view=await service.Draft(wo,new(Version(),Lease(),"Isolated next-version review",edits),actor);
Check(view.GetProperty("definition").GetProperty("version").GetInt32()==2&&view.GetProperty("definition").GetProperty("status").GetString()=="DRAFT","approveddefinitionrevisioncreatesnextDraftversion");
Check(view.GetProperty("boundTraveler").GetRawText()==bound&&view.GetProperty("operations")[1].GetProperty("shopInstructions").GetString()=="","laterdefinitioneditdoesnotfloatfrozenWOTraveler");
var reloaded=new SimProductionService(state,operations,intakes,provider,new(root));var resumed=await reloaded.Read(wo,actor);
Check(resumed.GetProperty("boundTraveler").GetRawText()==bound&&resumed.GetProperty("ready").GetBoolean(),"reloadretainsfrozenbinding andreadiness");
service.UtcNow=()=>DateTimeOffset.UtcNow.AddHours(1);
await Reject(()=>service.Approve(wo,new(Version(),Lease()),actor),"traveler_lease_required");service.UtcNow=()=>DateTimeOffset.UtcNow;
var racingVersion=Version();
async Task<bool> Race(){try{await service.Lease(wo,new(racingVersion),actor);return true;}catch(KittingCaseProblem e)when(e.Code=="traveler_version_changed"){return false;}}
var races=await Task.WhenAll(Race(),Race());Check(races.Count(x=>x)==1,"concurrent sameversion commands allowexactlyonewriter");
var lanesPath=Path.Combine(root,"data","rfq-lanes.json");var lanesOriginal=await File.ReadAllTextAsync(lanesPath);
var lanes=JsonNode.Parse(lanesOriginal)!;
// Mutate only an isolated mutable worksheet value; accepted package remains the sole authority.
void AlterMutable(JsonNode? n){if(n is JsonObject obj){if(obj.ContainsKey("instructions")&&obj.ContainsKey("name"))obj["instructions"]="ISOLATED MUTABLE WORKSHEET EDIT";foreach(var child in obj.ToArray())AlterMutable(child.Value);}else if(n is JsonArray array)foreach(var child in array)AlterMutable(child);}
AlterMutable(lanes);await File.WriteAllTextAsync(lanesPath,lanes.ToJsonString());
Check((await service.Read(wo,actor)).GetProperty("boundTraveler").GetRawText()==bound,"mutableLaborworksheetdoesnotalterfrozenTraveler");await File.WriteAllTextAsync(lanesPath,lanesOriginal);
var visualId=sourceOps.SelectMany(o=>o.Visuals).First().DocumentId;var visualFile=Directory.EnumerateFiles(Path.Combine(root,"intake-documents"),visualId+".bin",SearchOption.AllDirectories).Single();
var visualBytes=await File.ReadAllBytesAsync(visualFile);await File.WriteAllBytesAsync(visualFile,[1,2,3]);
try{await service.Read(wo,actor);throw new Exception("Expected corrupt reference failure");}catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_DOCUMENT_VERIFICATION_FAILED","corrupt frozenvisual failsclosed");}finally{await File.WriteAllBytesAsync(visualFile,visualBytes);}
await using(var c=new SqliteConnection($"Data Source={db};Pooling=False")){await c.OpenAsync();foreach(var table in new[]{"SimTravelerApprovedVersion","SimWoTraveler","SimTravelerEvent"})foreach(var verb in new[]{"UPDATE","DELETE"}){
    try{await using var q=c.CreateCommand();q.CommandText=verb=="UPDATE"?$"UPDATE {table} SET PayloadJson='{{}}'":$"DELETE FROM {table}";await q.ExecuteNonQueryAsync();throw new Exception("Immutable table accepted mutation");}catch(SqliteException){Check(true,table+" rejects"+verb);}
}}
Check((await Existing()).All(p=>before.TryGetValue(p.Key,out var hash)&&hash==p.Value),"all30existingbusiness tables preserved");
Check(filesBefore.All(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"acceptedorder andfrozenlabor JSON preserved");
Check(resumed.GetProperty("history").EnumerateArray().All(e=>!e.GetProperty("action").GetString()!.Contains("START")),"history containsnoexecutionstart");
Console.WriteLine($"PASS {checks} checks; isolated fixture {root}");
