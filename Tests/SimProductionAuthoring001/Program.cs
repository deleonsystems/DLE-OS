using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var output=Path.Combine(repo,"tmp","production-team");
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
var team=SimPersonaCatalog.Get("production-team")!;
var bound=original.GetProperty("boundTraveler").GetProperty("id").GetGuid();var op=original.GetProperty("effectiveRevision").GetProperty("operations").EnumerateArray().First(o=>o.GetProperty("enabled").GetBoolean()&&o.GetProperty("classification").GetString()=="PRODUCTION").GetProperty("id").GetString()!;
var note=new SimProductionTeamSave(Guid.NewGuid(),0,bound,op,"UNPROMOTED NOTE sentinel");
await Reject(()=>service.SaveTeamInput(wo,note,reader),"permission");
await Reject(()=>service.SaveTeamInput(wo,note with{OperationId="foreign"},team),"team_operation_scope");
await Reject(()=>service.SaveTeamInput(wo,note with{Audience="MANAGEMENT_ONLY"},team),"permission");
view=await service.SaveTeamInput(wo,note,team);Preserved(view);Check(Working()==0&&Effective()==bound,"Team Note does not create a revision or advance working version");
await Reject(()=>service.SaveTeamInput(wo,note,team),"team_version_changed");
await Reject(()=>service.SaveTeamInput(wo,note with{ExpectedVersion=1,Text="corrected"},team),"team_correction_reason");
var corrected=note with{ExpectedVersion=1,Text="PROMOTED NOTE sentinel",Reason="Reviewed wording"};view=await service.SaveTeamInput(wo,corrected,team);
Check(view.GetProperty("teamInputs")[0].GetProperty("history").GetArrayLength()==2,"note correction appends original and corrected versions");
var privateNote=note with{Id=Guid.NewGuid(),Text="PRIVATE NOTE sentinel",Audience="MANAGEMENT_ONLY"};await service.SaveTeamInput(wo,privateNote,actor);
Check(!(await service.Read(wo,team)).GetRawText().Contains("PRIVATE NOTE sentinel"),"management-only input hidden from team projection");
await service.SaveTeamInput(wo,note with{Id=Guid.NewGuid(),Text="UNPROMOTED NOTE sentinel"},team);
var png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=");
var image=await service.UploadProductionVisual(wo,new(bound,op,"TEAM VISUAL caption"),"team.png",new MemoryStream(png),team);
Check((await service.OpenProductionVisual(wo,image.Id,reader)).Bytes.SequenceEqual(png),"verified Team Visual retrievable unchanged");
var privateImage=await service.UploadProductionVisual(wo,new(bound,op,"private",Audience:"MANAGEMENT_ONLY"),"private.png",new MemoryStream(png),actor);
await Reject(()=>service.OpenProductionVisual(wo,privateImage.Id,team),"permission");
await Reject(()=>service.UploadProductionVisual(wo,new(bound,op,"bad"),"bad.png",new MemoryStream("bad"u8.ToArray()),team),"team_visual_type");
await Reject(()=>service.UploadProductionVisual(wo,new(bound,op,"bad",Scope:"DRAFT_VISUAL"),"x.png",new MemoryStream(png),team),"permission");
await Reject(()=>service.BeginWoRevision(wo,new(0,bound),team),"permission");
view=await service.BeginWoRevision(wo,new(0,bound),actor);
var direct=await service.UploadProductionVisual(wo,new(bound,op,"DIRECT CONTROLLED caption",Scope:"DRAFT_VISUAL",ExpectedWorkingVersion:Working(),RevisionId:Draft().Id,LeaseId:Draft().Lease!.Id),"direct.png",new MemoryStream(png),actor);
await Reject(()=>service.OpenProductionVisual(wo,direct.Id,team),"permission");
var steps=new[]{new SimWoSubstepInput(Guid.NewGuid(),op,1,"FIRST SUBSTEP sentinel"),new SimWoSubstepInput(Guid.NewGuid(),op,2,"SECOND SUBSTEP sentinel")};
var notes=new[]{new SimWoClarificationInput(Guid.NewGuid(),op,corrected.Text,new(note.Id,2))};
var visuals=new[]{new SimWoVisualInput(Guid.NewGuid(),op,image.Id,"TEAM VISUAL caption",new(image.Id,1)),new SimWoVisualInput(Guid.NewGuid(),op,direct.Id,"DIRECT CONTROLLED caption")};
SimWoRevisionSaveRequest Authored()=>Save(Order()) with{Substeps=steps,Clarifications=notes,Visuals=visuals};
await Reject(()=>service.SaveWoRevision(wo,Authored() with{Clarifications=[notes[0] with{TeamSource=new(note.Id,1)}]},actor),"team_promotion_changed");
await Reject(()=>service.SaveWoRevision(wo,Authored() with{Substeps=[steps[0],steps[1] with{Order=1}]},actor),"wo_substep_order");
var stale=Authored();view=await service.SaveWoRevision(wo,stale,actor);
Check(Effective()==bound&&Draft().Substeps!.Length==2&&Draft().Visuals!.Length==2,"authored content saved in draft only");Preserved(view);
Check(Draft().Clarifications![0].TeamSource==new SimTeamSource(note.Id,2)&&Draft().Visuals![0].TeamSource==new SimTeamSource(image.Id,1),"promotion retains exact input identity/version provenance");
Check(Draft().Differences.All(d=>d.Content!.Any(c=>c.Kind=="SUBSTEP")&&d.Content!.Any(c=>c.Action=="PROMOTED")),"dual diffs show substeps and promoted visual");
await Reject(()=>service.SaveWoRevision(wo,stale,actor),"wo_revision_version_changed");
await Reject(()=>service.SaveWoRevision(wo,Authored() with{Substeps=[steps[0] with{OperationId=Order()[1]},steps[1]]},actor),"wo_substep_invalid");
await Reject(()=>service.ApproveWoRevision(wo,Approve(),actor),"wo_clarification_review_required");
await File.WriteAllTextAsync(Path.Combine(output,"authored-draft.json"),view.GetRawText());
await File.WriteAllBytesAsync(Path.Combine(output,"authored-draft.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow,true));
view=await service.ApproveWoRevision(wo,Approve() with{TechnicalConsistencyReviewed=true},actor);
Check(view.GetProperty("effectiveRevision").GetProperty("substeps").GetArrayLength()==2,"approved snapshot retains typed substeps");
Check((await service.OpenProductionVisual(wo,direct.Id,reader)).Bytes.SequenceEqual(png),"approved WO visual is now viewable by Production readers");
Check((await service.ReadRevision(wo,bound,reader)).GetProperty("operations")[1].GetProperty("name").GetString()=="PCB Preparation","v1 remains original source route");
await File.WriteAllTextAsync(Path.Combine(output,"authored-approved.json"),view.GetRawText());
await File.WriteAllBytesAsync(Path.Combine(output,"authored-approved.pdf"),await SimProductionPrint.Create(view,"traveler",actor,DateTimeOffset.UtcNow));
var v2=Effective();view=await service.BeginWoRevision(wo,new(Working(),v2),actor);
steps=[steps[0] with{Order=2,Text="FIRST SUBSTEP corrected"},steps[1] with{Order=1}];
view=await service.SaveWoRevision(wo,Authored(),actor);Check(Draft().Differences[0].Content!.Count(c=>c.Action=="REORDERED")==2,"substeps reorder only within parent with diff");
var replacement=await service.UploadProductionVisual(wo,new(bound,op,"replacement",Scope:"DRAFT_VISUAL",ExpectedWorkingVersion:Working(),RevisionId:Draft().Id,LeaseId:Draft().Lease!.Id),"replacement.png",new MemoryStream(png),actor);
var oldVisual=visuals[1];visuals=[visuals[0],new(Guid.NewGuid(),op,replacement.Id,"replacement",SupersedesId:oldVisual.Id)];steps=[steps[0]];
view=await service.SaveWoRevision(wo,Authored(),actor);
Check(Draft().Substeps!.Any(s=>s.Removed)&&Draft().Visuals!.Any(v=>v.Removed&&v.Id==oldVisual.Id),"removal and supersession retain tombstones");
Check(Draft().Differences[0].Content!.Any(c=>c.Action=="SUPERSEDED"),"supersession is explicit in diff");
await Sql("CREATE TABLE SimProductionExecutionRecord(WorkOrderNumber TEXT,PayloadJson TEXT); INSERT INTO SimProductionExecutionRecord VALUES('0999999','{}');");
view=await service.SaveTeamInput(wo,corrected with{ExpectedVersion=2,Text="After-start correction",Reason="Evidence correction after start"},team);
Check(view.GetProperty("teamInputs").EnumerateArray().First(n=>n.GetProperty("id").GetGuid()==note.Id).GetProperty("version").GetInt32()==3,"Team correction remains append-only after execution");
await Reject(()=>service.SaveWoRevision(wo,Authored(),actor),"traveler_execution_exists");
await Reject(()=>service.ApproveWoRevision(wo,Approve() with{TechnicalConsistencyReviewed=true},actor),"traveler_execution_exists");
await Reject(()=>service.UploadProductionVisual(wo,new(bound,op,"blocked",Scope:"DRAFT_VISUAL",ExpectedWorkingVersion:Working(),RevisionId:Draft().Id,LeaseId:Draft().Lease!.Id),"blocked.png",new MemoryStream(png),actor),"traveler_execution_exists");
await Sql("DROP TABLE SimProductionExecutionRecord;");
foreach(var verb in new[]{"UPDATE","DELETE"}){try{await Sql(verb=="UPDATE"?"UPDATE SimProductionTeamInput SET Version=999":"DELETE FROM SimProductionTeamInput");throw new Exception("Expected append-only trigger");}catch(SqliteException){Check(true,"Team history rejects "+verb);}}
var reload=new SimProductionService(state,operations,intakes,provider,new(root));
var reloaded=await reload.Read(wo,team);Check(reloaded.GetProperty("teamInputs").EnumerateArray().Any(n=>n.GetProperty("id").GetGuid()==note.Id&&n.GetProperty("version").GetInt32()==3),"Team evidence and correction history survive service reload");
Check(Draft().Differences[0].Content!.Any(c=>c.Action=="REMOVED"),"removed substep appears in revision diff");
var events=(await service.Read(wo,actor)).GetRawText();Check(events.Contains("TEAM_NOTE_PROMOTED")&&events.Contains("TEAM_VISUAL_PROMOTED"),"append-only history records both promotion types");
Check((await service.ReadRevision(wo,v2,reader)).GetRawText().Contains("DIRECT CONTROLLED caption"),"prior approved visual remains in immutable revision after supersession");
await Reject(()=>service.UploadProductionVisual(wo,new(bound,op,"oversized"),"large.png",new MemoryStream(new byte[8*1024*1024+1]),team),"team_visual_size");
var binary=Directory.EnumerateFiles(Path.Combine(root,"intake-documents"),image.DocumentId+".bin",SearchOption.AllDirectories).Single();
var savedBytes=await File.ReadAllBytesAsync(binary);await File.WriteAllBytesAsync(binary,"corrupt"u8.ToArray());
try{await service.OpenProductionVisual(wo,image.Id,reader);throw new Exception("Expected binary verification rejection");}catch(KittingCaseProblem){Check(true,"tampered Team Visual fails verified retrieval");}catch(SimRfqIntakeProblem){Check(true,"tampered Team Visual fails verified retrieval");}
await File.WriteAllBytesAsync(binary,savedBytes);
var after=await Tables();foreach(var entry in before)Check(after[entry.Key]==entry.Value,"original table unchanged "+entry.Key);
Check(files.All(p=>File.Exists(p.Key)&&Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"all original evidence and business files unchanged");
Console.WriteLine($"PASS {checks} Production authoring checks; isolated root {root}");
