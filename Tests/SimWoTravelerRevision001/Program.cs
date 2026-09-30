using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var output=Path.Combine(repo,"tmp","wo-traveler-revisions");
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
    reset.CommandText="DROP TABLE IF EXISTS SimWoTravelerRevisionEvent; DROP TABLE IF EXISTS SimWoTravelerRevision; DROP TABLE IF EXISTS SimWoTravelerDraft; DROP TABLE IF EXISTS SimWoTravelerRevisionHead;";
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
Check(Effective()==original.GetProperty("boundTraveler").GetProperty("id").GetGuid()&&Working()==0,"v1 projected from original binding without migration");
Check(view.GetProperty("woRevisionDraft").ValueKind==JsonValueKind.Null&&view.GetProperty("canEditTraveler").GetBoolean(),"no draft; Edit available");
Check((await Tables()).Count==before.Count,"GET creates no schema or records");
await File.WriteAllTextAsync(Path.Combine(output,"baseline.json"),view.GetRawText());
await Reject(()=>service.BeginWoRevision(wo,new(0,Effective()),reader),"permission");
await Reject(()=>service.BeginWoRevision(wo,new(0,Guid.NewGuid()),actor),"wo_revision_effective_changed");
var v1=Effective();view=await service.BeginWoRevision(wo,new(0,v1),actor);var draft=Draft();
Check(draft.Version==2&&draft.PreviousRevisionId==v1&&draft.ChangeBasis=="WO_SPECIFIC"&&draft.Status=="DRAFT","v2 WO-specific complete draft based on v1");
Check(draft.Operations.Length==13&&draft.DefinitionId==original.GetProperty("boundTraveler").GetProperty("definitionId").GetGuid()&&draft.FrozenPackage.GetProperty("source").GetProperty("laborVersion").GetInt32()==2,"complete snapshot / original definition and Labor lineage");
Preserved(view);
await File.WriteAllTextAsync(Path.Combine(output,"draft-created.json"),view.GetRawText());
await Reject(()=>service.BeginWoRevision(wo,new(Working(),v1),manager),"wo_revision_in_use");
Check(!(await service.Read(wo,reader)).GetProperty("canEditTraveler").GetBoolean(),"read-only viewer while edit leased");
await Reject(()=>service.SaveWoRevision(wo,Save(Order(),""),actor),"wo_revision_reason_required");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{LeaseId=Guid.NewGuid()},actor),"wo_revision_lease_required");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{ExpectedWorkingVersion=0},actor),"wo_revision_version_changed");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"wo_revision_save_required");
foreach(var invalid in new[]{Order()[..^1],Order().Select((id,i)=>i==1?Order()[0]:id).ToArray(),Order().Select((id,i)=>i==1?"foreign":id).ToArray(),Order().Append(draft.Operations.Single(o=>!o.Enabled).Id).ToArray()})
    await Reject(()=>service.SaveWoRevision(wo,Save(invalid),actor),"wo_revision_operation_identity");
var ordered=Order();(ordered[0],ordered[1])=(ordered[1],ordered[0]);var stale=Save(ordered);view=await service.SaveWoRevision(wo,stale,actor);
Check(Effective()==v1&&view.GetProperty("firstOperation").GetProperty("name").GetString()=="PCB Preparation","saved draft does not float effective route or readiness");
draft=Draft();foreach(var op in draft.Operations){var old=original.GetProperty("boundTraveler").GetProperty("operations").Deserialize<SimTravelerOperation[]>(json)!.Single(x=>x.Id==op.Id);
    Check(SimProductionService.Hash(op with{Sequence=old.Sequence})==SimProductionService.Hash(old),"whole operation data retained "+op.SourceOperationId);}
Check(draft.SourceSequences[ordered[0]]==30&&draft.Operations.Single(o=>o.Id==ordered[0]).Sequence==20,"source sequence 30 retained while WO sequence becomes20");
Check(draft.Differences.Length==2&&draft.Differences.All(d=>d.Operations.Count(o=>o.Changed)==2)&&draft.Differences.All(d=>d.Operations.Count(o=>!o.Changed)==10),"dual stable-ID diff includes two moves and ten unchanged");
Check(draft.Warnings.Length>0&&draft.Warnings.Any(w=>w.Evidence.Contains("first",StringComparison.OrdinalIgnoreCase)),"sequence-sensitive warnings retain source evidence");
await File.WriteAllTextAsync(Path.Combine(output,"draft-saved.json"),view.GetRawText());
await Reject(()=>service.SaveWoRevision(wo,stale,actor),"wo_revision_version_changed");
await Reject(()=>service.ApproveWoRevision(wo,Approve(false),actor),"wo_revision_warnings_required");
await Reject(()=>service.ApproveWoRevision(wo,Approve() with{ExpectedWorkingVersion=1},actor),"wo_revision_version_changed");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),reader),"permission");
// The persisted guard applies at edit, save and approval, including completed/voided evidence.
await Sql("CREATE TABLE SimProductionExecutionRecord(WorkOrderNumber TEXT,PayloadJson TEXT); INSERT INTO SimProductionExecutionRecord VALUES('0999999','{\"state\":\"VOIDED\"}');");
var guarded=await Tables();
await Reject(()=>service.BeginWoRevision(wo,new(Working(),v1),actor),"traveler_execution_exists");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()),actor),"traveler_execution_exists");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"traveler_execution_exists");
Check((await Tables()).All(p=>guarded.GetValueOrDefault(p.Key)==p.Value),"execution rejection leaves all tables unchanged");
Check((await service.Read(wo,actor)).GetProperty("executionStarted").GetBoolean()&&!(await service.Read(wo,actor)).GetProperty("canEditTraveler").GetBoolean(),"persisted execution is projected and disables edit");
await Sql("DELETE FROM SimProductionExecutionRecord; INSERT INTO SimProductionExecutionRecord VALUES('ANOTHER-WO','{}');");
Check((await service.Read(wo,actor)).GetProperty("canEditTraveler").GetBoolean(),"other WO execution does not block this WO");await Sql("DROP TABLE SimProductionExecutionRecord;");
var savedApproval=Approve();service.UtcNow=()=>DateTimeOffset.UtcNow.AddHours(1);
await Reject(()=>service.ApproveWoRevision(wo,savedApproval,actor),"wo_revision_lease_required");
view=await service.BeginWoRevision(wo,new(Working(),v1),manager);Check(Draft().Lease!.ActorId==manager.Id,"expired lease recovered by another trained user");
await Reject(()=>service.ApproveWoRevision(wo,savedApproval,actor),"wo_revision_version_changed");
view=await service.ApproveWoRevision(wo,Approve(),manager);var v2=Effective();
Check(v2!=v1&&view.GetProperty("effectiveRevision").GetProperty("version").GetInt32()==2&&view.GetProperty("woRevisionDraft").ValueKind==JsonValueKind.Null,"v2 frozen / effective pointer advanced / draft retired atomically");
Check(view.GetProperty("firstOperation").GetProperty("name").GetString()=="SMT Setup","first ready operation follows effective reorder");Preserved(view);
var v1Read=await service.ReadRevision(wo,v1,reader);Check(v1Read.GetProperty("operations")[1].GetProperty("name").GetString()=="PCB Preparation","immutable v1 available read-only");
await Reject(()=>service.ReadRevision(wo,Guid.NewGuid(),reader),"wo_revision_missing");
await File.WriteAllTextAsync(Path.Combine(output,"approved-v2.json"),view.GetRawText());
var pdf=await SimProductionPrint.Create(view,"traveler",actor,new(2026,9,27,18,0,0,TimeSpan.Zero));Check(pdf.AsSpan().StartsWith("%PDF"u8),"effective v2 print generated");await File.WriteAllBytesAsync(Path.Combine(output,"approved-v2.pdf"),pdf);
foreach(var table in new[]{"SimWoTravelerRevision","SimWoTravelerRevisionEvent"})foreach(var verb in new[]{"UPDATE","DELETE"}){
    try{await Sql(verb=="UPDATE"?$"UPDATE {table} SET PayloadJson='{{}}'":$"DELETE FROM {table}");throw new Exception("Expected immutable protection");}catch(SqliteException){Check(true,table+" rejects "+verb);}}
var fresh=new SimProductionService(state,operations,intakes,provider,new(root));view=await fresh.Read(wo,actor);Check(Effective()==v2,"new service reload retains effective revision");
view=await service.BeginWoRevision(wo,new(Working(),v2),actor);ordered=Order();(ordered[2],ordered[3])=(ordered[3],ordered[2]);view=await service.SaveWoRevision(wo,Save(ordered),actor);
Check(Draft().Version==3&&Draft().Differences[0].BaselineRevisionId==v2&&Draft().Differences[1].BaselineRevisionId==v1,"v3 compares against previous effective AND as-quoted");
Check(Draft().Differences[0].Operations.Count(o=>o.Changed)==2&&Draft().Differences[1].Operations.Count(o=>o.Changed)==4,"v3 diffs correctly diverge by baseline");
await File.WriteAllTextAsync(Path.Combine(output,"draft-v3.json"),view.GetRawText());
var version=Working();async Task<bool> Race(){try{await fresh.BeginWoRevision(wo,new(version,v2),actor);return true;}catch(KittingCaseProblem e)when(e.Code=="wo_revision_version_changed"){return false;}}
Check((await Task.WhenAll(Race(),Race())).Count(x=>x)==1,"exactly one concurrent same-version writer wins");
// Synthetic child fixture is pure data only; the live route has no active child operations.
draft=Draft();var parents=draft.Operations.Where(o=>o.Enabled).OrderBy(o=>o.Sequence).ToArray();var child=parents[0] with{Id="child-stable",SourceOperationId="child-source",Sequence=parents[0].Sequence+.01m};
var grouped=draft with{Operations=draft.Operations.Append(child).ToArray(),SourceParents=new(draft.SourceParents){[child.SourceOperationId]=parents[0].SourceOperationId},SourceSequences=new(draft.SourceSequences){[child.Id]=child.Sequence}};
var groupIds=new[]{parents[1].Id,parents[0].Id,child.Id}.Concat(parents.Skip(2).Select(o=>o.Id)).ToArray();var moved=SimProductionService.Reorder(grouped,groupIds);
Check(moved.Single(o=>o.Id==child.Id).Sequence==moved.Single(o=>o.Id==parents[0].Id).Sequence+.01m,"child group moves intact with parent");
await Reject(()=>Task.FromResult(SimProductionService.Reorder(grouped,groupIds.Where(id=>id!=child.Id).Append(child.Id).ToArray())),"wo_revision_group_order");
// Content authoring is exercised only in this disposable copied database.
service.UtcNow=()=>DateTimeOffset.UtcNow;
view=await service.Read(wo,actor);
var noteId=Guid.NewGuid();var operationId=Order()[0];
SimWoClarificationInput Note(string text)=>new(noteId,operationId,text);
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note(" ")]},actor),"wo_clarification_invalid");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note("a"),Note("b")]},actor),"wo_clarification_invalid");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[new(Guid.NewGuid(),"foreign","text")]},actor),"wo_clarification_invalid");
var priorFrozen=await service.ReadRevision(wo,v2,actor);
view=await service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note("Verify polarity before releasing the first board.")]},actor);
var added=Draft().Clarifications!.Single();
Check(added.Id==noteId&&added.RevisionId==Draft().Id&&added.SourceOperationId==Draft().Operations.Single(o=>o.Id==operationId).SourceOperationId&&added.CreatedBy==actor.DisplayName,"clarification stable identity, operation/source linkage and server provenance");
Check(Draft().Differences.All(d=>d.Clarifications!.Single().Action=="ADDED"),"added clarification in both comparisons");
Check(view.GetProperty("operations").EnumerateArray().All(o=>o.GetProperty("clarifications").GetArrayLength()==0),"draft clarification absent from effective route");
var snapshot=Draft().Id;
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[new(noteId,Order()[1],"move")]},actor),"wo_clarification_invalid");
view=await service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note("Confirm D1 and D2 polarity before releasing the first board.")]},actor);
Check(Draft().Clarifications!.Single().Id==noteId&&Draft().Clarifications!.Single().CreatedAt==added.CreatedAt,"draft edit retains identity and creation provenance");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"wo_clarification_review_required");
await File.WriteAllTextAsync(Path.Combine(output,"clarification-draft.json"),view.GetRawText());
await File.WriteAllBytesAsync(Path.Combine(output,"clarification-draft.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow,true));
view=await service.ApproveWoRevision(wo,Approve() with{TechnicalConsistencyReviewed=true},actor);var v3=Effective();
Check(view.GetProperty("operations").EnumerateArray().Single(o=>o.GetProperty("id").GetString()==operationId).GetProperty("clarifications")[0].GetProperty("id").GetGuid()==noteId,"effective read-only operation projects approved clarification");
Check((await service.ReadRevision(wo,v2,actor)).GetRawText()==priorFrozen.GetRawText(),"prior approved revision remains immutable after content approval");
await File.WriteAllTextAsync(Path.Combine(output,"clarification-approved.json"),view.GetRawText());
await File.WriteAllBytesAsync(Path.Combine(output,"clarification-approved.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow));
view=await service.BeginWoRevision(wo,new(Working(),v3),actor);
Check(Draft().Clarifications!.Single().RevisionId==Draft().Id&&Draft().Clarifications!.Single().Id==noteId,"new draft rebinds snapshot linkage while retaining clarification identity");
view=await service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note("Updated WO clarification.")]},actor);
Check(Draft().Differences[0].Clarifications!.Single().Action=="CHANGED"&&!Draft().Differences[0].Operations.Any(o=>o.Changed),"clarification-only change reports CHANGED without false reorder");
view=await service.SaveWoRevision(wo,Save(Order()),actor);
Check(Draft().Clarifications!.Single().Text=="Updated WO clarification.","older reorder client omitting content preserves existing clarification");
view=await service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[]},actor);
Check(Draft().Clarifications!.Single().Removed&&Draft().Differences[0].Clarifications!.Single().Action=="REMOVED","remove retains tombstone and reports removal against previous effective");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[Note("resurrect")]},actor),"wo_clarification_invalid");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"wo_clarification_review_required");
await Sql("CREATE TABLE SimProductionExecutionRecord(WorkOrderNumber TEXT,PayloadJson TEXT); INSERT INTO SimProductionExecutionRecord VALUES('0999999','{}');");
await Reject(()=>service.SaveWoRevision(wo,Save(Order()) with{Clarifications=[new(Guid.NewGuid(),operationId,"blocked")]},actor),"traveler_execution_exists");
await Sql("DROP TABLE SimProductionExecutionRecord;");
Check((await service.ReadRevision(wo,v3,actor)).GetProperty("clarifications")[0].GetProperty("text").GetString()=="Confirm D1 and D2 polarity before releasing the first board.","later edits/removal do not mutate approved clarification");
var history=(await service.Read(wo,actor)).GetProperty("woRevisionHistory").EnumerateArray().Select(e=>e.GetProperty("action").GetString()).ToArray();
Check(new[]{"WO_CLARIFICATION_ADDED","WO_CLARIFICATION_CHANGED","WO_CLARIFICATION_REMOVED"}.All(history.Contains),"append-only typed content events retained");
Check((await Tables()).Where(p=>before.ContainsKey(p.Key)).All(p=>before[p.Key]==p.Value),"all 34 original business/Traveler tables unchanged");
Check(files.All(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"all original source, quote, accepted-order and document files unchanged");
Console.WriteLine($"PASS {checks} checks; isolated fixture {root}");
