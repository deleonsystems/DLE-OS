using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var backup=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root)||root.StartsWith(repo,StringComparison.OrdinalIgnoreCase))throw new Exception("Use a new isolated fixture directory outside the repository.");
foreach(var folder in new[]{"data","state","intake-documents","documents"})foreach(var p in Directory.EnumerateFiles(Path.Combine(backup,folder),"*",SearchOption.AllDirectories)){
 var target=Path.Combine(root,Path.GetRelativePath(backup,p));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(p,target);
}
var protectedFiles=Directory.GetFiles(root,"*",SearchOption.AllDirectories).Where(p=>!p.EndsWith(".db")).ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);var intakes=new SimRfqIntakeStore(root);
var provider=new SimKittingRequirementsProvider(intakes,ops);var docs=new SimIntakeDocuments(root);var service=new SimProductionService(state,ops,intakes,provider,docs);
var actor=SimPersonaCatalog.Default;
var store=new SimProductionStore(ops.DatabasePath);var json=SimProductionService.Json;var wo="0999997";int count=0;
JsonElement E(object v)=>JsonSerializer.SerializeToElement(v,json);
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+(++count)+" "+label);}
async Task Block(Func<Task> fn,string code){try{await fn();}catch(KittingCaseProblem e){Check(e.Code==code,code+" (got "+e.Code+")");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Not blocked: "+code);}
async Task Sql(string sql){await using var c=store.Open(true);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();}
async Task<int> Save(SimLaborOperation[] operations){var d=E(await service.ReadPacketDraft(wo,actor));var saved=E(await service.SavePacketDraft(wo,new(d.GetProperty("draftVersion").GetInt32(),d.GetProperty("parentJobId").GetString()!,d.GetProperty("parentMainId").ValueKind==JsonValueKind.String?d.GetProperty("parentMainId").GetString():null,operations),actor));return saved.GetProperty("draftVersion").GetInt32();}
async Task<SimInstructionPacket> Release(int version,string scope)=> (SimInstructionPacket)await service.ReleasePacket(wo,new(version,Guid.NewGuid().ToString(),scope,"Isolated fixture improvement"),actor);
var team=SimPersonaCatalog.Get("production-team")!;var quality=SimPersonaCatalog.Get("quality-reviewer")!;var manager=SimPersonaCatalog.Get("operations-manager")!;
var initial=E(await service.ReadJobInstructions(wo,team));var original=initial.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;
var parent=initial.GetProperty("instructionPacketId").GetString()!;var index=Array.FindIndex(original,o=>o.ParentId is null&&o.Name.StartsWith("SMT"));var op=original[index];
var before=SimProductionService.Hash(initial.GetProperty("operations"));var initialDraft=E(await service.ReadPacketDraft(wo,quality));var draftBefore=SimProductionService.Hash(initialDraft);
Check(initial.GetProperty("productionAdditionsVersion").GetInt32()==2,"backend capability advertises additions");
Check(manager.Can("production.manage")&&!SimProductionService.CanReviewQuality(manager),"Operations Manager retains management but has no Quality authority");
Check(SimProductionService.CanReviewQuality(quality)&&SimProductionService.CanReviewQuality(actor)&&!quality.Can("production.manage"),"Quality/Admin review authority is separate");
var create=new SimAdditionCreate(Guid.NewGuid().ToString(),parent,op.Id,"New setup image","Check this proposed addition.");
foreach(var denied in new[]{team,manager,SimPersonaCatalog.Get("read-only-viewer")!}){
 await Block(async()=>{await service.SavePacketDraft(wo,new(0,parent,null,original),denied);},"permission");
 await Block(async()=>{await service.ReleasePacket(wo,new(0,Guid.NewGuid().ToString(),"WO_ONLY","denied"),denied);},"permission");
 await Block(async()=>{await service.ApproveQualityRelease(wo,new("denied"),denied);},"permission");
 await Block(async()=>{await service.ReviewAddition(wo,create.RequestId,new(Guid.NewGuid().ToString(),1,0,"ACCEPT",""),denied);},"permission");
}
await Block(async()=>{await service.CreateAddition(wo,create,manager);},"permission");
foreach(var extra in new[]{"operations","slides","delete","order","authorId","status"}){
 bool denied=false;try{JsonSerializer.Deserialize<SimAdditionCreate>(JsonSerializer.Serialize(create,json)[..^1]+",\""+extra+"\":[]}",json);}catch(JsonException){denied=true;}Check(denied,"operator cannot supply "+extra);
}
await Block(async()=>{await service.CreateAddition(wo,create with{ParentJobId="stale"},team);},"addition_source_changed");
await Block(async()=>{await service.CreateAddition(wo,create with{OperationId="unknown"},team);},"addition_operation");
await Block(async()=>{await service.CreateAddition(wo,create with{OperationId=original.First(o=>o.Name=="Kitting").Id},team);},"addition_materials");
var png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=";
create=create with{FileName="fixture.png",ImageBase64=png};
var added=(SimProductionAddition)await service.CreateAddition(wo,create,team);
Check(added.Status=="PENDING"&&added.AuthorId==team.Id&&added.At!=default&&added.ParentJobId==parent&&added.SourceRevision==initial.GetProperty("travelerRevision").GetInt32(),"submission records immutable author/time/source revision");
Check(((SimProductionAddition)await service.CreateAddition(wo,create,team)).Slide.Id==added.Slide.Id,"duplicate submission reuses one addition/image");
await Block(async()=>{await service.CreateAddition(wo,create with{Body="different"},team);},"addition_request_reused");
Check(SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)))==draftBefore,"submission does not touch QC draft");
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,team)).GetProperty("operations"))==before,"pending image is not released");
Check((await service.OpenInstructionAsset(wo,added.Slide.ImageDocumentId!,team)).Bytes.SequenceEqual(Convert.FromBase64String(png)),"pending image retained through existing asset reader");
Check(E(await service.ReadAdditions(wo,team)).GetProperty("entries").GetArrayLength()==1&&E(await service.ReadAdditions(wo,quality)).GetProperty("entries").GetArrayLength()==1,"author and Quality can read pending additions");
Check(E(await service.ReadAdditions(wo,manager)).GetProperty("entries").GetArrayLength()==0,"other nonreviewer cannot read author's pending list");
service=new SimProductionService(state,ops,intakes,provider,docs);
Check(E(await service.ReadAdditions(wo,team)).GetProperty("entries")[0].GetProperty("addition").GetProperty("id").GetString()==added.Id,"addition survives service reopen");
// Make a legitimate independent QC edit; acceptance must preserve it, not restore the operator's copy.
var draftOps=initialDraft.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;draftOps[index]=draftOps[index] with{Instructions="Independent Quality draft text"};
var version=await Save(draftOps);var accept=new SimAdditionReview(Guid.NewGuid().ToString(),1,version-1,"ACCEPT","Reviewed image");
await Block(async()=>{await service.ReviewAddition(wo,added.Id,accept,quality);},"packet_draft_changed");
accept=accept with{ExpectedDraftVersion=version};var accepted=(SimProductionAddition)await service.ReviewAddition(wo,added.Id,accept,quality);
Check(accepted.Status=="ACCEPTED"&&accepted.ReviewerId==quality.Id&&accepted.AcceptedDraftVersion==version+1,"Quality accepts into new saved draft version");
Check(((SimProductionAddition)await service.ReviewAddition(wo,added.Id,accept,quality)).Version==2,"review duplicate click is idempotent");
var merged=E(await service.ReadPacketDraft(wo,quality)).GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;
Check(merged[index].Instructions=="Independent Quality draft text","acceptance preserves independent QC edits");
Check(SimProductionService.Hash(merged[index] with{Slides=merged[index].Slides!.Where(c=>c.Id!=added.Slide.Id).ToArray()})==SimProductionService.Hash(draftOps[index]),"only new slide appended; existing content/order unchanged");
Check(merged.Where((o,i)=>i!=index).Select(SimProductionService.Hash).SequenceEqual(draftOps.Where((o,i)=>i!=index).Select(SimProductionService.Hash)),"all other operations unchanged");
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,team)).GetProperty("operations"))==before,"accepted is still not released");
await Block(async()=>{await service.ReviewAddition(wo,added.Id,accept with{RequestId=Guid.NewGuid().ToString()},quality);},"addition_review_changed");
var returned=(SimProductionAddition)await service.CreateAddition(wo,create with{RequestId=Guid.NewGuid().ToString(),ImageBase64=null,Body="Proposed text"},team);
var ret=new SimAdditionReview(Guid.NewGuid().ToString(),1,0,"RETURN","");
await Block(async()=>{await service.ReviewAddition(wo,returned.Id,ret,quality);},"addition_return_note");
ret=ret with{Note="Please show the connector more clearly."};var back=(SimProductionAddition)await service.ReviewAddition(wo,returned.Id,ret,actor);
Check(back.Status=="RETURNED"&&back.Note==ret.Note&&back.ReviewerId==actor.Id,"Administrator can return with retained note");
var stale=(SimProductionAddition)await service.CreateAddition(wo,create with{RequestId=Guid.NewGuid().ToString(),ImageBase64=null,Body="Wait for review"},team);
var publication=(SimInstructionPacket)await service.ReleasePacket(wo,new(version+1,Guid.NewGuid().ToString(),"WO_ONLY","Explicit Quality release in fixture"),quality);
Check(publication.JobRevision==added.SourceRevision+1&&publication.MainRevision is null,"Quality explicitly releases W/O only");
Check(publication.Operations[index].Slides!.Any(c=>c.Id==added.Slide.Id)&&publication.Assets.Any(a=>a.DocumentId==added.Slide.ImageDocumentId),"release includes accepted slide and immutable image");
var published=E(await service.ReadAdditions(wo,team)).GetProperty("entries").EnumerateArray().Single(e=>e.GetProperty("addition").GetProperty("id").GetString()==added.Id);
Check(published.GetProperty("publications").GetArrayLength()==1,"reviewed vs released status derived from actual publication");
await Block(async()=>{await service.ReviewAddition(wo,stale.Id,new(Guid.NewGuid().ToString(),1,version+1,"ACCEPT",""),quality);},"addition_source_changed");
await service.ReviewAddition(wo,stale.Id,new(Guid.NewGuid().ToString(),1,0,"RETURN","Please resubmit against current instructions."),quality);
Check(true,"stale addition can be returned without bypassing source check");
var after=publication.Operations.ToArray();after[index]=after[index] with{Instructions="Next change"};var nextVersion=await Save(after);
await Sql("CREATE TABLE SimAdditionTestProductionExecution(WorkOrderNumber TEXT, Evidence TEXT); INSERT INTO SimAdditionTestProductionExecution VALUES('0999997','fixture')");
await Block(async()=>{await Release(nextVersion,"WO_ONLY");},"packet_execution_exists");
await Sql("DROP TABLE SimAdditionTestProductionExecution");
await using(var c=store.Open(true)){await c.OpenAsync();await using var t=c.BeginTransaction();await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="CREATE TABLE IF NOT EXISTS SimWoTravelerRevisionHead(WorkOrderNumber TEXT,Generation INTEGER,PayloadJson TEXT); INSERT INTO SimWoTravelerRevisionHead VALUES('0999997',"+runtime.Generation+",'{}')";await q.ExecuteNonQueryAsync();await Block(()=>SimProductionStore.RequirePacketUnbound(c,t,wo,runtime.Generation),"packet_traveler_exists");await t.RollbackAsync();}
// Same-editor v2: owned pending slide saves use the existing annotation/photo contract.
var v2parent=E(await service.ReadJobInstructions(wo,team)).GetProperty("instructionPacketId").GetString()!;
var v2asset=await service.UploadAdditionAsset(wo,v2parent,op.Id,"new-editor.png",Convert.FromBase64String(png),team);
var v2card=new SimLaborSlide(Guid.NewGuid().ToString(),"BLANK","Production addition","",1,
 [new(Guid.NewGuid().ToString(),"Stage 1",[new(Guid.NewGuid().ToString(),1,"freehand",[new(.1,.1),new(.4,.4)],Color:"#FF0000",Thickness:.01)],new(1,.5,.5,1,1),
 [new(Guid.NewGuid().ToString(),v2asset.DocumentId,v2asset.Sha256,"new-editor.png",.2,.2,.4,.3)])]);
var v2id=Guid.NewGuid().ToString();var v2req=new SimAdditionSlideSave(Guid.NewGuid().ToString(),0,v2parent,op.Id,v2card);
var v2draftBefore=SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)));
var v2=(SimProductionAddition)await service.SaveAdditionSlide(wo,v2id,v2req,team);
Check(v2.Status=="PENDING"&&v2.Version==1&&v2.Slide.Stages[0].Photos!.Length==1&&v2.Slide.Stages[0].Marks.Length==1,"same editor persists photo/annotation on owned pending slide");
Check(((SimProductionAddition)await service.SaveAdditionSlide(wo,v2id,v2req,team)).Version==1,"same-editor repeated save request is idempotent");
Check(SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)))==v2draftBefore,"same-editor save never modifies QC draft");
var stranger=team with{Id="other-operator",DisplayName="Other Operator"};
await Block(async()=>{await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString(),ExpectedVersion=1},stranger);},"permission");
await Block(async()=>{await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString()},team);},"addition_edit_changed");
await Block(async()=>{await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString(),ExpectedVersion=1,Slide=v2card with{Id=Guid.NewGuid().ToString()}},team);},"addition_identity");
await Block(async()=>{await service.SaveAdditionSlide(wo,Guid.NewGuid().ToString(),v2req with{RequestId=Guid.NewGuid().ToString(),Slide=v2card with{Id=publication.Operations[index].Slides![0].Id}},team);},"addition_identity");
await Block(async()=>{await service.SaveAdditionSlide(wo,Guid.NewGuid().ToString(),v2req with{RequestId=Guid.NewGuid().ToString(),Slide=v2card with{Kind="START"}},team);},"addition_slide");
var v2change=v2card with{Body="Second save retained",Stages=[v2card.Stages[0] with{Marks=[..v2card.Stages[0].Marks,new(Guid.NewGuid().ToString(),1,"text",[new(.2,.2)],"Pending text",FontSize:.03)]}]};
var v2second=(SimProductionAddition)await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString(),ExpectedVersion=1,Slide=v2change},team);
Check(v2second.Version==2&&v2second.AuthorId==team.Id&&v2second.At==v2.At&&v2second.EditedAt is not null,"second save preserves original author/time and records edit time");
service=new SimProductionService(state,ops,intakes,provider,docs);
var reopened=(await store.ReadAdditions(wo,runtime.Generation)).Where(a=>a.Id==v2id).MaxBy(a=>a.Version)!;
Check(SimProductionService.Hash(reopened.Slide)==SimProductionService.Hash(v2change),"same-editor content survives reopen without loss");
var v2return=(SimProductionAddition)await service.ReviewAddition(wo,v2id,new(Guid.NewGuid().ToString(),2,0,"RETURN","Please clarify the label"),quality);
var v2third=(SimProductionAddition)await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString(),ExpectedVersion=3,Slide=v2change with{Body="Clarified"}},team);
Check(v2third.Status=="PENDING"&&v2third.Version==4&&(await store.ReadAdditions(wo,runtime.Generation)).Any(a=>a.Id==v2id&&a.Note=="Please clarify the label"),"returned slide can be revised; review history retained");
var v2draft=E(await service.ReadPacketDraft(wo,quality));
await Block(async()=>{await service.ReviewAddition(wo,v2id,new(Guid.NewGuid().ToString(),2,v2draft.GetProperty("draftVersion").GetInt32(),"ACCEPT",""),quality);},"addition_review_changed");
await service.ReviewAddition(wo,v2id,new(Guid.NewGuid().ToString(),4,v2draft.GetProperty("draftVersion").GetInt32(),"ACCEPT",""),quality);
await Block(async()=>{await service.SaveAdditionSlide(wo,v2id,v2req with{RequestId=Guid.NewGuid().ToString(),ExpectedVersion=5,Slide=v2change},team);},"addition_edit_changed");
Check(!E(await service.ReadJobInstructions(wo,team)).GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!.Any(o=>(o.Slides??[]).Any(c=>c.Id==v2card.Id)),"accepted edited addition still absent from released instructions");
foreach(var forbidden in new[]{team,manager})await Block(async()=>{await service.ReviewAddition(wo,v2id,new(Guid.NewGuid().ToString(),4,0,"ACCEPT",""),forbidden);},"permission");
Check(protectedFiles.All(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"source files unchanged within fixture");
await File.WriteAllTextAsync(Path.Combine(root,"initial.json"),initial.GetRawText());
await File.WriteAllTextAsync(Path.Combine(root,"sources.json"),E(await service.ReadInstructionSources(wo,actor,true)).GetRawText());
await File.WriteAllTextAsync(Path.Combine(root,"order.json"),E(await intakes.ReadOrderEntry("RFQI-SIM-0046")).GetRawText());
await File.WriteAllTextAsync(Path.Combine(root,"production.json"),(await service.Read(wo,actor)).GetRawText());
Console.WriteLine("PASS "+count+" isolated addition checks");
