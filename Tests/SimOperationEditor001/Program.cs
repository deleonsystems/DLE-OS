using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var output=Path.Combine(repo,"tmp","operation-editor");
var root=Path.Combine(output,"tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state","intake-documents"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
    if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
}
var db=Path.Combine(root,"data/dle-os-sim.db");
await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
await using(var b=new SqliteConnection($"Data Source={db};Pooling=False")){await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
// Qualify the complete v1 -> v2 lifecycle even if Miguel already opened a live
// draft. Reset only the additive revision layer in this disposable copied DB.
await using(var fixture=new SqliteConnection($"Data Source={db};Pooling=False")){
    await fixture.OpenAsync();await using var reset=fixture.CreateCommand();
    reset.CommandText="DROP TABLE IF EXISTS SimProductionTeamInput; DROP TABLE IF EXISTS SimWoTravelerRevisionEvent; DROP TABLE IF EXISTS SimWoTravelerRevision; DROP TABLE IF EXISTS SimWoTravelerDraft; DROP TABLE IF EXISTS SimWoTravelerRevisionHead;";
    await reset.ExecuteNonQueryAsync();
}
var checks=0;var json=SimProductionService.Json;var actor=SimPersonaCatalog.Default;var reader=SimPersonaCatalog.Get("read-only-viewer")!;var manager=SimPersonaCatalog.Get("operations-manager")!;
void Check(bool pass,string name){if(!pass)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
async Task Reject(Func<Task> action,string code){try{await action();}catch(KittingCaseProblem e){Check(e.Code==code,code+" (actual "+e.Code+")");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Expected "+code);}
async Task Sql(string sql){await using var c=new SqliteConnection($"Data Source={db};Pooling=False");await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();}
async Task<Dictionary<string,string>> Tables(){
    await using var c=new SqliteConnection($"Data Source={db};Mode=ReadOnly;Pooling=False");await c.OpenAsync();var tables=new List<string>();
    await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));}
    var hashes=new Dictionary<string,string>();foreach(var table in tables){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{table}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(JsonSerializer.Serialize(values,json));}hashes[table]=SimProductionService.Hash(rows);}return hashes;
}
var before=await Tables();var files=Directory.EnumerateFiles(root,"*",SearchOption.AllDirectories).Where(p=>!p.EndsWith(".db")&&!p.EndsWith("-wal")&&!p.EndsWith("-shm")).ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
var state=new SimStateStore(root);await state.InitializeAsync();var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,operations);
var service=new SimProductionService(state,operations,intakes,provider,new(root));const string wo="0999999";
var view=await service.Read(wo,actor);var original=view.Clone();
long Working()=>view.GetProperty("woRevisionWorkingVersion").GetInt64();
Guid Effective()=>view.GetProperty("effectiveRevision").GetProperty("id").GetGuid();
SimWoTravelerRevision Draft()=>view.GetProperty("woRevisionDraft").Deserialize<SimWoTravelerRevision>(json)!;
string[] Order()=>Draft().Operations.Where(o=>o.Enabled&&o.Classification=="PRODUCTION").OrderBy(o=>o.Sequence).Select(o=>o.Id).ToArray();
SimWoRevisionSaveRequest Save(string[] ids,string reason="Isolated pre-start shop-flow review")=>new(Working(),Draft().Id,Draft().Lease!.Id,reason,ids);
SimWoRevisionApproveRequest Approve(bool warnings=true)=>new(Working(),Draft().Id,Draft().Lease!.Id,warnings);
void Preserved(JsonElement current){foreach(var key in new[]{"source","sourceToken","bom","kitting","boundTraveler","definition","customerRequirements","materialStatus","productionStatus"})Check(current.GetProperty(key).GetRawText()==original.GetProperty(key).GetRawText(),"unchanged "+key);Check(!current.GetProperty("executionStarted").GetBoolean()&&!current.GetProperty("firstOperation").GetProperty("startAvailable").GetBoolean(),"execution not started / Start unavailable");}
var quoted=original.GetProperty("effectiveRevision").GetProperty("operations").EnumerateArray().First(o=>o.GetProperty("enabled").GetBoolean()&&o.GetProperty("classification").GetString()=="PRODUCTION");
var op=quoted.GetProperty("id").GetString()!;var sourceText=quoted.GetProperty("sourceInstruction").GetString()!;
Check(quoted.GetProperty("travelerInstructions").GetString()==sourceText,"source inherited without writing an override");
Check((await Tables()).Count==before.Count,"source default projection does not migrate storage");
view=await service.BeginWoRevision(wo,new(Working(),Effective()),actor);
var originalDraft=Draft();var input=new SimWoOperationContentInput(op,"Verify board revision, inspect finish and holes, then clean as needed. EDITOR_SENTINEL","Prep","Production");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{OperationContent=[input]},reader),"permission");
foreach(var bad in new[]{input with{OperationId="foreign"},input with{Instructions=new string('x',8001)},input with{WorkCenter="invalid\ncenter"},input with{Department=new string('x',121)}})
    await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{OperationContent=[bad]},actor),"wo_operation_content_invalid");
var steps=new[]{new SimWoSubstepInput(Guid.NewGuid(),op,1,"Check board revision"),new SimWoSubstepInput(Guid.NewGuid(),op,2,"Inspect finish")};
var request=Save(Order()) with{OperationContent=[input],Substeps=steps};view=await service.SaveWoRevision(wo,request,actor);
Check(Draft().OperationContent!.Single().Instructions==input.Instructions,"draft retains WO instruction");
Check(Draft().Operations.Single(o=>o.Id==op).Instructions==originalDraft.Operations.Single(o=>o.Id==op).Instructions,"frozen operation instruction remains unchanged");
Check(view.GetProperty("effectiveRevision").GetProperty("operations").EnumerateArray().Single(o=>o.GetProperty("id").GetString()==op).GetProperty("travelerInstructions").GetString()==sourceText,"draft instruction does not become effective");
Check(Draft().Differences.All(d=>d.Content!.Any(c=>c.Kind=="TRAVELER_INSTRUCTION"&&c.Action=="CHANGED")&&d.Content!.Any(c=>c.Kind=="WORK_CENTER"&&c.After=="Prep / Production")),"both comparisons include instruction and work center before/after");
Preserved(view);await Reject(()=>service.SaveWoRevision(wo,request,actor),"wo_revision_version_changed");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"wo_clarification_review_required");
await File.WriteAllTextAsync(Path.Combine(output,"editor-draft.json"),view.GetRawText());
await File.WriteAllBytesAsync(Path.Combine(output,"editor-draft.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow,true));
var contentId=Draft().OperationContent![0].Id;var originalCreatedAt=Draft().OperationContent![0].CreatedAt;
view=await service.ApproveWoRevision(wo,Approve() with{TechnicalConsistencyReviewed=true},actor);var v2=Effective();
var effectiveOp=view.GetProperty("effectiveRevision").GetProperty("operations").EnumerateArray().Single(o=>o.GetProperty("id").GetString()==op);
Check(effectiveOp.GetProperty("travelerInstructions").GetString()==input.Instructions&&effectiveOp.GetProperty("travelerWorkCenter").GetString()=="Prep","approved projection uses WO instruction and assignment");
Check(effectiveOp.GetProperty("sourceInstruction").GetString()==sourceText&&effectiveOp.GetProperty("instructionModified").GetBoolean(),"original source remains separately readable with modification indicator");
await File.WriteAllTextAsync(Path.Combine(output,"editor-approved.json"),view.GetRawText());await File.WriteAllBytesAsync(Path.Combine(output,"editor-approved.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow));
view=await service.BeginWoRevision(wo,new(Working(),Effective()),actor);
Check(Draft().OperationContent![0].Id==contentId&&Draft().OperationContent![0].RevisionId==Draft().Id&&Draft().OperationContent![0].CreatedAt==originalCreatedAt,"next revision retains identity and creation provenance, updates revision linkage");
var order=Order();(order[0],order[1])=(order[1],order[0]);view=await service.SaveWoRevision(wo,Save(order),actor);
Check(Draft().Substeps!.Select(n=>n.Id).SequenceEqual(steps.Select(n=>n.Id))&&Draft().Substeps!.All(n=>n.OperationId==op),"parent reorder and older client preserve substep identities and linkage");
Check(Draft().OperationContent!.Single().Instructions==input.Instructions,"older client omitting overrides preserves WO content");
view=await service.SaveWoRevision(wo,Save(Order()) with{OperationContent=[input with{Instructions="",WorkCenter="",Department=""}]},actor);
Check(Draft().Differences[0].Content!.Any(c=>c.Kind=="TRAVELER_INSTRUCTION"&&c.Action=="REMOVED"),"explicit blank instruction is a reviewed removal");
view=await service.SaveWoRevision(wo,Save(Order()) with{OperationContent=[input with{Instructions=sourceText,WorkCenter="",Department=""}]},actor);
Check(Draft().Differences[1].Content!.All(c=>c.Kind!="TRAVELER_INSTRUCTION"&&c.Kind!="WORK_CENTER"),"restoring source values removes false source diff");
Check((await service.ReadRevision(wo,v2,reader)).GetRawText().Contains("EDITOR_SENTINEL"),"approved v2 snapshot remains immutable after later draft changes");
await Sql("CREATE TABLE SimProductionExecutionRecord(WorkOrderNumber TEXT,PayloadJson TEXT); INSERT INTO SimProductionExecutionRecord VALUES('0999999','{}');");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{OperationContent=[input]},actor),"traveler_execution_exists");
await Reject(()=>service.ApproveWoRevision(wo,Approve() with{TechnicalConsistencyReviewed=true},actor),"traveler_execution_exists");await Sql("DROP TABLE SimProductionExecutionRecord;");
Check((await service.Read(wo,actor)).GetRawText().Contains("WO_TRAVELER_INSTRUCTION_CHANGED")&&(await service.Read(wo,actor)).GetRawText().Contains("WO_WORK_CENTER_CHANGED"),"typed instruction and work-center history events");
var after=await Tables();foreach(var pair in before)Check(after[pair.Key]==pair.Value,"original table unchanged "+pair.Key);
Check(files.All(p=>File.Exists(p.Key)&&Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"original business and source documents unchanged");
Console.WriteLine($"PASS {checks} operation-editor checks; isolated root {root}");
