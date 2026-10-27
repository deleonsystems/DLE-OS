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
// Seed isolated published cards so full editing/removal targets existing released content.
var releasedCard=new SimLaborSlide(Guid.NewGuid().ToString(),"NOTE","Existing released card","Original released body",1,[new(Guid.NewGuid().ToString(),"Stage 1",[],new(1,.5,.5,1,1))]);
var releasedRemove=releasedCard with{Id=Guid.NewGuid().ToString(),Title="Existing released card to remove",Stages=[new(Guid.NewGuid().ToString(),"Stage 1",[],new(1,.5,.5,1,1))]};
original[index]=original[index] with{Slides=[releasedCard,releasedRemove,..original[index].Slides??[]],SlidesOrganized=false};
await Release(await Save(original),"WO_ONLY");initial=E(await service.ReadJobInstructions(wo,team));original=initial.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;parent=initial.GetProperty("instructionPacketId").GetString()!;op=original[index];
var before=SimProductionService.Hash(initial.GetProperty("operations"));var initialDraft=E(await service.ReadPacketDraft(wo,quality));var draftBefore=SimProductionService.Hash(initialDraft);
Check(initial.GetProperty("productionAdditionsVersion").GetInt32()==2,"backend capability advertises additions");
Check(manager.Can("production.manage")&&!SimProductionService.CanReviewQuality(manager),"Operations Manager retains management but has no Quality authority");
Check(SimProductionService.CanReviewQuality(quality)&&SimProductionService.CanReviewQuality(actor)&&!quality.Can("production.manage"),"Quality/Admin review authority is separate");
Check(initial.GetProperty("productionProposalsVersion").GetInt32()==1&&initial.GetProperty("productionCanPropose").GetBoolean(),"full proposal editor advertised to Production");
var seed=E(await service.ReadProductionProposal(wo,null,team));var id=seed.GetProperty("proposalId").GetString()!;
Check(seed.GetProperty("canEdit").GetBoolean()&&seed.GetProperty("draftVersion").GetInt32()==0,"opening fresh full editor is editable and creates no saved proposal");
var stranger=team with{Id="other-operator",DisplayName="Other Operator"};
SimLaborOperation[] Clone(SimLaborOperation[] values)=>E(values).Deserialize<SimLaborOperation[]>(json)!;
SimLaborSlide Card(string title)=>new(Guid.NewGuid().ToString(),"NOTE",title,"",1,[new(Guid.NewGuid().ToString(),"Stage 1",[],new(1,.5,.5,1,1))]);
var proposed=Clone(original);var oldSlides=proposed[index].Slides??[];oldSlides[0]=oldSlides[0] with{Title="Production edits released card",Body="Proposed changed body"};var card1=Card("Proposed A");var card2=Card("Proposed B");
proposed[index]=proposed[index] with{Instructions="Production proposed instructions",Slides=[card2,card1,..oldSlides],SlidesOrganized=false};
var request=new SimProposalSave(Guid.NewGuid().ToString(),0,parent,proposed);
foreach(var denied in new[]{quality,manager,SimPersonaCatalog.Get("read-only-viewer")!}){
 await Block(async()=>{await service.SaveProductionProposal(wo,id,request,denied);},"permission");
 await Block(async()=>{await service.UploadProposalAsset(wo,parent,"x",[1],denied);},"permission");
}
foreach(var denied in new[]{team,manager}){
 await Block(async()=>{await service.ListProductionProposals(wo,denied);},"permission");
 await Block(async()=>{await service.ReviewProductionProposal(wo,id,new(Guid.NewGuid().ToString(),1,0,"ACCEPT",""),denied);},"permission");
 await Block(async()=>{await service.ReleasePacket(wo,new(0,Guid.NewGuid().ToString(),"WO_ONLY","denied"),denied);},"permission");
 await Block(async()=>{await service.SavePacketDraft(wo,new(0,parent,null,proposed),denied);},"permission");
}
var saved=E(await service.SaveProductionProposal(wo,id,request,team));Check(saved.GetProperty("version").GetInt32()==1,"full proposal saves independently");
Check(E(await service.SaveProductionProposal(wo,id,request,team)).GetProperty("version").GetInt32()==1,"save retries are idempotent");
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,team)).GetProperty("operations"))==before,"full pending edits do not change published instructions");
Check(SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)))==draftBefore,"full pending edits do not change Quality draft");
await Block(async()=>{await service.SaveProductionProposal(wo,id,request with{RequestId=Guid.NewGuid().ToString()},team);},"proposal_changed");
await Block(async()=>{await service.SaveProductionProposal(wo,id,request with{ExpectedVersion=1,RequestId=Guid.NewGuid().ToString()},stranger);},"permission");
await Block(async()=>{await service.ReadProductionProposal(wo,id,stranger);},"permission");
await Block(async()=>{await service.SaveProductionProposal(wo,Guid.NewGuid().ToString(),request with{RequestId=Guid.NewGuid().ToString()},team);},"proposal_changed");
var edited=Clone(proposed);edited[index]=edited[index] with{Slides=[card1 with{Title="Edited existing proposal slide",Body="Changed body"},..oldSlides.Where(c=>c.Id!=releasedRemove.Id)]};
var v2=new SimProposalSave(Guid.NewGuid().ToString(),1,parent,edited);await service.SaveProductionProposal(wo,id,v2,team);
service=new SimProductionService(state,ops,intakes,provider,docs);
var reopened=E(await service.ReadProductionProposal(wo,null,team));Check(SimProductionService.Hash(reopened.GetProperty("operations"))==SimProductionService.Hash(edited),"edit, reorder and removal persist through service reopen");
Check((await store.ReadPackets(wo,runtime.Generation)).Any(p=>p.Operations[index].Slides!.Any(c=>c.Id==releasedRemove.Id)),"removed published content retained in released history");
var history=await store.ReadProposals(wo,runtime.Generation);Check(history.Length==2&&history[0].Operations[index].Slides!.Any(c=>c.Id==card2.Id),"removed slide retained in immutable proposal history");
var asset=await service.UploadProposalAsset(wo,parent,"proposal.png",Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII="),team);
edited[index].Slides![0].Stages[0]=edited[index].Slides![0].Stages[0] with{Photos=[new(Guid.NewGuid().ToString(),asset.DocumentId,asset.Sha256,asset.Name,.2,.2,.3,.3)],Marks=[new(Guid.NewGuid().ToString(),1,"text",[new(.1,.1)],"Native annotation")]};
await service.SaveProductionProposal(wo,id,new(Guid.NewGuid().ToString(),2,parent,edited),team);
Check(Convert.ToHexString(SHA256.HashData((await service.OpenInstructionAsset(wo,asset.DocumentId,team)).Bytes))==asset.Sha256,"proposal photo uses durable existing asset reader");
await Block(async()=>{await service.SaveProductionProposal(wo,id,new(Guid.NewGuid().ToString(),3,"stale",edited),team);},"proposal_source_changed");
await Block(async()=>{await service.SaveProductionProposal(wo,id,new(Guid.NewGuid().ToString(),3,parent,edited.Reverse().ToArray()),team);},"packet_operation_scope");
// Quality changed a different field/operation after Production began. Merge must preserve it.
var qc=Clone(original);var other=Array.FindIndex(qc,o=>o.Id!=op.Id&&o.Name!="Kitting");qc[other]=qc[other] with{Instructions="Concurrent Quality change"};
var qv=await Save(qc);
await Block(async()=>{await service.ReviewProductionProposal(wo,id,new(Guid.NewGuid().ToString(),3,qv-1,"ACCEPT",""),quality);},"packet_draft_changed");
var ret=new SimProposalReview(Guid.NewGuid().ToString(),3,qv,"RETURN","Please revise this packet");var returned=(SimProductionProposal)await service.ReviewProductionProposal(wo,id,ret,quality);
Check(returned.Status=="RETURNED"&&returned.Version==4,"Quality returns a full proposal with note");
Check(((SimProductionProposal)await service.ReviewProductionProposal(wo,id,ret,quality)).Version==4,"review retry idempotence");
Check(E(await service.ReadProductionProposal(wo,null,team)).GetProperty("note").GetString()==ret.Note,"return note survives author reopen");
await service.SaveProductionProposal(wo,id,new(Guid.NewGuid().ToString(),4,parent,edited),team);
var accept=new SimProposalReview(Guid.NewGuid().ToString(),5,qv,"ACCEPT","");var accepted=(SimProductionProposal)await service.ReviewProductionProposal(wo,id,accept,quality);
Check(accepted.Status=="ACCEPTED"&&accepted.AcceptedDraftVersion==qv+1,"Quality accepts into a separate draft version");
var merged=E(await service.ReadPacketDraft(wo,quality)).GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;
Check(merged[other].Instructions=="Concurrent Quality change"&&merged[index].Instructions==edited[index].Instructions,"independent concurrent Quality work preserved");
Check(SimProductionService.Hash(merged[index].Slides!)==SimProductionService.Hash(edited[index].Slides!),"full edited slide set accepted including removals and annotations");
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,team)).GetProperty("operations"))==before,"acceptance alone does not publish full edits");
await Block(async()=>{await service.SaveProductionProposal(wo,id,new(Guid.NewGuid().ToString(),6,parent,edited),team);},"proposal_changed");
// New proposal collides with existing Quality changes to the same text. No overwrite.
var seed2=E(await service.ReadProductionProposal(wo,null,team));var id2=seed2.GetProperty("proposalId").GetString()!;
var collision=Clone(original);collision[index]=collision[index] with{Instructions="Different proposed text"};
await service.SaveProductionProposal(wo,id2,new(Guid.NewGuid().ToString(),0,parent,collision),team);
var qualityHash=SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)));
await Block(async()=>{await service.ReviewProductionProposal(wo,id2,new(Guid.NewGuid().ToString(),1,qv+1,"ACCEPT",""),quality);},"proposal_conflict");
Check(SimProductionService.Hash(E(await service.ReadPacketDraft(wo,quality)))==qualityHash,"conflict leaves concurrent Quality draft untouched");
var published=await Release(qv+1,"WO_ONLY");Check(published.JobRevision==initial.GetProperty("travelerRevision").GetInt32()+1,"only explicit Quality/Admin release publishes full edits");
Check(published.Assets.Any(a=>a.DocumentId==asset.DocumentId),"released proposal image preserved in immutable packet");
Check(E(await service.ReadProductionProposal(wo,null,team)).GetProperty("stale").GetBoolean(),"new publication marks pending old-source proposal stale");
await Block(async()=>{await service.ReviewProductionProposal(wo,id2,new(Guid.NewGuid().ToString(),1,qv+1,"ACCEPT",""),quality);},"proposal_source_changed");
await service.ReviewProductionProposal(wo,id2,new(Guid.NewGuid().ToString(),1,qv+1,"RETURN","Source changed; reconcile"),quality);
Check((await store.ReadProposals(wo,runtime.Generation)).Any(p=>p.Status=="RETURNED"&&p.Note=="Source changed; reconcile"),"stale proposal remains recoverable and returnable");
try{await Sql("DELETE FROM SimProductionProposal");throw new Exception("history deletion succeeded");}catch(SqliteException){Check(true,"proposal history rejects deletion");}
Check(protectedFiles.All(kv=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(kv.Key)))==kv.Value),"all source files unchanged within isolated fixture");
File.WriteAllText(Path.Combine(root,"initial.json"),initial.GetRawText());File.WriteAllText(Path.Combine(root,"sources.json"),E(await service.ReadInstructionSources(wo,actor,true)).GetRawText());
File.WriteAllText(Path.Combine(root,"order.json"),E(await intakes.ReadOrderEntry("RFQI-SIM-0046")).GetRawText());
File.WriteAllText(Path.Combine(root,"production.json"),E(await service.Read(wo,actor)).GetRawText());
Console.WriteLine("PASS "+count+" isolated full proposal checks");
