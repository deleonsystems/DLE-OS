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
var actor=new SimPersona("packet-test","test","Packet Test Author","ACTIVE",[],[],true,"isolated");
var store=new SimProductionStore(ops.DatabasePath);var json=SimProductionService.Json;var wo="0999997";int count=0;
JsonElement E(object v)=>JsonSerializer.SerializeToElement(v,json);
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+(++count)+" "+label);}
async Task Block(Func<Task> fn,string code){try{await fn();}catch(KittingCaseProblem e){Check(e.Code==code,code+" (got "+e.Code+")");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Not blocked: "+code);}
async Task Sql(string sql){await using var c=store.Open(true);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();}
async Task<int> Save(SimLaborOperation[] operations){var d=E(await service.ReadPacketDraft(wo,actor));var saved=E(await service.SavePacketDraft(wo,new(d.GetProperty("draftVersion").GetInt32(),d.GetProperty("parentJobId").GetString()!,d.GetProperty("parentMainId").ValueKind==JsonValueKind.String?d.GetProperty("parentMainId").GetString():null,operations),actor));return saved.GetProperty("draftVersion").GetInt32();}
async Task<SimInstructionPacket> Release(int version,string scope)=> (SimInstructionPacket)await service.ReleasePacket(wo,new(version,Guid.NewGuid().ToString(),scope,"Isolated fixture improvement"),actor);
var initial=E(await service.ReadJobInstructions(wo,actor,true));var original=initial.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;
var approval=SimProductionService.Hash((await store.ReadQualityRelease(wo,runtime.Generation))!);
var kit=SimProductionService.Hash((await new SimKittingCases(state,ops,provider).Read(wo,actor))!);
Check(initial.GetProperty("travelerRevision").GetInt32()==1,"original released packet displays Rev 1 without rewriting approval");
await File.WriteAllTextAsync(Path.Combine(root,"initial.json"),initial.GetRawText()); await File.WriteAllTextAsync(Path.Combine(root,"sources.json"),E(await service.ReadInstructionSources(wo,actor,true)).GetRawText()); await File.WriteAllTextAsync(Path.Combine(root,"order.json"),E(await intakes.ReadOrderEntry("RFQI-SIM-0046")).GetRawText()); await File.WriteAllTextAsync(Path.Combine(root,"production.json"),(await service.Read(wo,actor)).GetRawText());
var d0=E(await service.ReadPacketDraft(wo,actor));Check(d0.GetProperty("draftVersion").GetInt32()==0&&!d0.GetProperty("hasSavedDraft").GetBoolean(),"opening editor creates no saved draft");
var reader=actor with{IsSuperAdmin=false,Permissions=["production.view","order_entry.view"]};
Check(!E(await service.ReadPacketDraft(wo,reader)).GetProperty("canEdit").GetBoolean(),"reader cannot edit");
await Block(async()=>{await service.SavePacketDraft(wo,new(0,d0.GetProperty("parentJobId").GetString()!,null,original),reader);},"permission");
var changed=original.ToArray();var index=Array.FindIndex(changed,o=>o.ParentId is null&&o.Name!="Kitting");changed[index]=changed[index] with{Instructions="Fixture draft one"};
// Optional marker opacity: mixed generations share a packet without rewriting old marks.
Check(initial.GetProperty("markerOpacitySupported").GetBoolean()&&d0.GetProperty("markerOpacitySupported").GetBoolean(),"instruction and draft views advertise opacity persistence");
var opacityCard=changed[index].Slides![0];var opacityStage=opacityCard.Stages[0];
SimDrawingMark Marker(double? alpha,double y)=>new(Guid.NewGuid().ToString(),opacityCard.Page,"marker",[new(.15,y),new(.65,y)],Color:"#eaff00",Thickness:.018,Opacity:alpha);
var legacyMark=Marker(null,.2);var newMark=Marker(.5,.35);var explicitMark=Marker(.65,.5);
var legacyJson=JsonSerializer.Serialize(legacyMark,json);
Check(!legacyJson.Contains("opacity")&&JsonSerializer.Serialize(JsonSerializer.Deserialize<SimDrawingMark>(legacyJson,json),json)==legacyJson,"legacy mark serialization remains byte-identical and omits opacity");
foreach(var alpha in new double?[]{null,0,.28,.5,.65,1})SimRfqIntakeStore.ValidateDrawingNotes([Marker(alpha,.2)],opacityStage.SavedView);
Check(true,"optional opacity and finite boundary values accepted");
foreach(var alpha in new[]{-.01,1.01,double.NaN,double.PositiveInfinity,double.NegativeInfinity}){
 bool rejected=false;try{SimRfqIntakeStore.ValidateDrawingNotes([Marker(alpha,.2)],opacityStage.SavedView);}catch(SimRfqIntakeProblem){rejected=true;}Check(rejected,"malformed opacity rejected: "+alpha);
}
bool badKind=false;try{SimRfqIntakeStore.ValidateDrawingNotes([newMark with{Kind="freehand"}],opacityStage.SavedView);}catch(SimRfqIntakeProblem){badKind=true;}Check(badKind,"opacity rejected for non-marker tools");
foreach(var raw in new[]{"\"0.5\"","true","{}","\"NaN\""}){
 bool rejected=false;try{JsonSerializer.Deserialize<SimDrawingMark>(legacyJson[..^1]+",\"opacity\":"+raw+"}",json);}catch(JsonException){rejected=true;}Check(rejected,"invalid JSON opacity type rejected: "+raw);
}
var mixedMarks=new[]{legacyMark,newMark,explicitMark};
opacityStage=opacityStage with{Marks=mixedMarks};
opacityCard=opacityCard with{Stages=opacityCard.Stages.Select((x,i)=>i==0?opacityStage:x).ToArray()};
changed[index]=changed[index] with{Slides=changed[index].Slides!.Select((x,i)=>i==0?opacityCard:x).ToArray()};
var v=await Save(changed);Check(v==1,"first save creates draft v1");

changed[index]=changed[index] with{Instructions="Fixture draft two"};v=await Save(changed);Check(v==2,"repeated save advances only draft counter");
service=new SimProductionService(state,ops,intakes,provider,docs);
Check(E(await service.ReadPacketDraft(wo,actor)).GetProperty("operations")[index].GetProperty("instructions").GetString()=="Fixture draft two","draft survives service reopen");
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,actor)).GetProperty("operations"))==SimProductionService.Hash(initial.GetProperty("operations")),"Production sees original packet while draft saved");
var opacityReopened=E(await service.ReadPacketDraft(wo,actor)).GetProperty("operations")[index].GetProperty("slides")[0].GetProperty("stages")[0].GetProperty("marks").Deserialize<SimDrawingMark[]>(json)!;
Check(JsonSerializer.Serialize(opacityReopened,json)==JsonSerializer.Serialize(mixedMarks,json),"mixed legacy/new/explicit opacity survives durable draft and service reopen");
await File.WriteAllTextAsync(Path.Combine(root,"opacity-draft.json"),JsonSerializer.Serialize(opacityReopened,json));

await Block(async()=>{await service.SavePacketDraft(wo,new(0,d0.GetProperty("parentJobId").GetString()!,null,changed),actor);},"packet_draft_changed");
var invalid=changed.ToArray();invalid[index]=invalid[index] with{Name="Changed route"};await Block(async()=>{await Save(invalid);},"packet_operation_scope");
await Block(async()=>{await service.ReleasePacket(wo,new(v,Guid.NewGuid().ToString(),"WO_ONLY",""),actor);},"packet_release_details");
var request=new SimPacketPublish(v,Guid.NewGuid().ToString(),"WO_ONLY","Fixture job release");
var released=(SimInstructionPacket)await service.ReleasePacket(wo,request,actor);
Check(released.JobRevision==2&&released.MainRevision is null,"job-only release advances to Rev 2");
var releasedMarks=released.Operations[index].Slides![0].Stages[0].Marks;
Check(JsonSerializer.Serialize(releasedMarks,json)==JsonSerializer.Serialize(mixedMarks,json),"fixture release preserves mixed opacity exactly");
var releasedRead=E(await service.ReadJobInstructions(wo,actor)).GetProperty("operations")[index].GetProperty("slides")[0].GetProperty("stages")[0].GetProperty("marks").Deserialize<SimDrawingMark[]>(json)!;
Check(JsonSerializer.Serialize(releasedRead,json)==JsonSerializer.Serialize(mixedMarks,json),"released viewer payload keeps legacy null, new .50 and explicit .65");
await File.WriteAllTextAsync(Path.Combine(root,"opacity-released.json"),JsonSerializer.Serialize(releasedRead,json));

Check(released.ActorId==actor.Id&&released.At!=default&&released.Reason==request.Reason,"actual actor/time/reason recorded");
Check(((SimInstructionPacket)await service.ReleasePacket(wo,request,actor)).Id==released.Id,"release retry idempotent");
await Block(async()=>{await service.ReleasePacket(wo,request with{Reason="different"},actor);},"packet_request_reused");
Check((await store.ReadMainPacket(released.Identity.Key)) is null,"job-only leaves main packet absent");
Check(E(await service.ReadJobInstructions(wo,actor)).GetProperty("travelerRevision").GetInt32()==2,"Production reads newly released Rev 2");
Check((await service.Read(wo,actor)).GetProperty("source").GetProperty("instructionPacket").GetProperty("id").GetString()==released.Id,"production source pins exact packet ID");
Check(SimProductionService.Hash((await store.ReadQualityRelease(wo,runtime.Generation))!)==approval,"original Quality approval preserved");
Check(SimProductionService.Hash((await new SimKittingCases(state,ops,provider).Read(wo,actor))!)==kit,"completed kitting and evidence unchanged");
var png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=");
var asset=await service.UploadPacketAsset(wo,d0.GetProperty("baselineToken").GetString()!,"fixture.png",png,actor);
var card=changed.SelectMany(o=>o.Slides??[]).First();var image=card with{Id=Guid.NewGuid().ToString(),Kind="IMAGE",Title="Fixture image",Body="",Page=1,Source=null,ImageDocumentId=asset.DocumentId,ImageSha256=asset.Sha256,Stages=[card.Stages[0] with{Id=Guid.NewGuid().ToString(),Marks=[],SavedView=new(1,.5,.5,1,1,0),Photos=[]}]};
changed[index]=changed[index] with{Slides=(changed[index].Slides??[]).Append(image).ToArray()};
// Preserve any existing organized End boundary.
if(changed[index].SlidesOrganized==true){var list=changed[index].Slides!.Where(c=>c.Id!=image.Id).ToList();list.Insert(list.Count-1,image);changed[index]=changed[index] with{Slides=list.ToArray()};}
v=await Save(changed);var main=await Release(v,"MAIN_ONLY");
Check(main.MainRevision==1&&main.JobRevision is null,"main-only has its own Rev 1 identity");
Check(E(await service.ReadJobInstructions(wo,actor)).GetProperty("travelerRevision").GetInt32()==2,"main-only leaves this W/O unchanged");
Check(main.Assets.Single(a=>a.DocumentId==asset.DocumentId).Bytes.SequenceEqual(png),"published main packet retains its instruction image bytes");
Check(((SimInstructionPacket)await service.ReadMainAssemblyPacket(wo,actor)).Id==main.Id,"matching main packet retrievable");
Check((await store.ReadPacketHead("W:"+runtime.Generation+":0999998")) is null,"other W/O head untouched");
changed[index]=changed[index] with{Instructions="Fixture both"};v=await Save(changed);
// Simulate another publisher advancing only the main head between save and release.
var rival=main with{Id=Guid.NewGuid().ToString(),WorkOrderNumber="0999998",RequestId=Guid.NewGuid().ToString(),DraftVersion=1,MainRevision=2};
await store.PacketTransaction(async(c,t)=>{await SimProductionStore.InsertPacket(c,t,rival);await SimProductionStore.SetPacketHead(c,t,main.Identity.Key,rival.Id);return true;});
await Block(async()=>{await Release(v,"BOTH");},"packet_main_changed");
Check((await store.ReadPacketHead("W:"+runtime.Generation+":"+wo))!.Id==released.Id,"failed Both cannot partially publish job head");
await store.PacketTransaction(async(c,t)=>{await SimProductionStore.SetPacketHead(c,t,main.Identity.Key,main.Id);return true;});
var both=await Release(v,"BOTH");Check(both.JobRevision==3&&both.MainRevision==2,"Both advances independent histories");
Check((await store.ReadMainPacket(main.Identity.Key))!.Id==both.Id&&(await store.ReadPacketHead("W:"+runtime.Generation+":"+wo))!.Id==both.Id,"Both heads share atomic publication identity");
var material=Array.FindIndex(changed,o=>o.Name=="Kitting");Check(material>=0,"fixture contains Materials");changed[material]=changed[material] with{Instructions="Fixture changed materials"};v=await Save(changed);
await Block(async()=>{await Release(v,"WO_ONLY");},"packet_materials_used");changed[material]=original[material];v=await Save(changed);
changed[index]=changed[index] with{Instructions="Execution guard test"};v=await Save(changed);
await Sql("CREATE TABLE SimPacketTestProductionExecution(WorkOrderNumber TEXT, Evidence TEXT); INSERT INTO SimPacketTestProductionExecution VALUES('0999997','retained execution evidence')");
await Block(async()=>{await Release(v,"WO_ONLY");},"packet_execution_exists");
var safeMain=await Release(v,"MAIN_ONLY");Check(safeMain.MainRevision==3,"main-only remains available without changing executed job");
Check((await store.ReadPacketHead("W:"+runtime.Generation+":"+wo))!.Id==both.Id,"execution evidence does not cause job replacement");
await Sql("DROP TABLE SimPacketTestProductionExecution");
Check((await store.ReadPackets(wo,runtime.Generation)).Any(p=>p.Id==released.Id&&p.Operations[index].Instructions=="Fixture draft two"),"old released content remains retained");
Check(protectedFiles.All(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"all quote/source files unchanged");
// Fresh-job lifecycle fixture: retain the simulated main library but remove this
// cloned job's release/case/head only. Never runs against the live data location.
await Sql("DROP TRIGGER IF EXISTS SimQualityReleaseNoDelete; DELETE FROM SimQualityRelease WHERE WorkOrderNumber='0999997'; DROP TRIGGER IF EXISTS SimKittingEventNoDelete; DROP TRIGGER IF EXISTS SimKittingSubmissionNoDelete; DELETE FROM SimKittingCaseEvent WHERE CaseId IN (SELECT CaseId FROM SimKittingCase WHERE WorkOrderNumber='0999997'); DELETE FROM SimKittingSubmission WHERE CaseId IN (SELECT CaseId FROM SimKittingCase WHERE WorkOrderNumber='0999997'); DELETE FROM SimKittingCase WHERE WorkOrderNumber='0999997'; DELETE FROM SimInstructionPacketHead WHERE PacketKey='W:"+runtime.Generation+":0999997'");
service=new SimProductionService(state,ops,intakes,provider,docs);
var fresh=E(await service.ReadJobInstructions(wo,actor,true));
Check(fresh.GetProperty("mainPacketId").GetString()==safeMain.Id&&fresh.GetProperty("operations")[index].GetProperty("instructions").GetString()=="Execution guard test","fresh unreleased packet consumes compatible main content");
var review=E(await service.ReadQualityReview(wo,actor));await service.ApproveQualityRelease(wo,new(review.GetProperty("reviewToken").GetString()!),actor);
Check((await store.ReadQualityRelease(wo,runtime.Generation))!.MainPacketId==safeMain.Id,"initial approval pins exact selected main version");
Check((await service.OpenInstructionAsset(wo,asset.DocumentId,actor,true)).Bytes.SequenceEqual(png),"pinned main image readable through job route");
// A later main publication cannot change an already approved job.
var pinned=SimProductionService.Hash(E(await service.ReadJobInstructions(wo,actor,true)).GetProperty("operations"));
var later=safeMain with{Id=Guid.NewGuid().ToString(),WorkOrderNumber="0999998",DraftVersion=2,RequestId=Guid.NewGuid().ToString(),MainRevision=4,Operations=original};
await store.PacketTransaction(async(c,t)=>{await SimProductionStore.InsertPacket(c,t,later);await SimProductionStore.SetPacketHead(c,t,later.Identity.Key,later.Id);return true;});
Check(SimProductionService.Hash(E(await service.ReadJobInstructions(wo,actor,true)).GetProperty("operations"))==pinned,"later main publication cannot alter approved job content");
Check((await store.ReadQualityRelease(wo,runtime.Generation))!.MainPacketId==safeMain.Id,"approved job retains original main packet ID");
var incompatible=later with{Id=Guid.NewGuid().ToString(),DraftVersion=3,RequestId=Guid.NewGuid().ToString(),Identity=later.Identity with{Compatibility="different-source"}};
await store.PacketTransaction(async(c,t)=>{await SimProductionStore.InsertPacket(c,t,incompatible);await SimProductionStore.SetPacketHead(c,t,later.Identity.Key,incompatible.Id);return true;});
await Block(async()=>{await service.ReadMainAssemblyPacket(wo,actor);},"packet_main_incompatible");
Check(!E(await service.ReadPacketDraft(wo,actor)).GetProperty("mainPacket").GetProperty("compatible").GetBoolean(),"incompatible main is flagged in editor");
await using(var c=store.Open(true)){await c.OpenAsync();await using var t=c.BeginTransaction();
 await using var command=c.CreateCommand();command.Transaction=t;command.CommandText="CREATE TABLE IF NOT EXISTS SimWoTravelerRevisionHead(WorkOrderNumber TEXT,Generation INTEGER,PayloadJson TEXT); INSERT INTO SimWoTravelerRevisionHead VALUES('0999997',"+runtime.Generation+",'{}')";await command.ExecuteNonQueryAsync();
 await Block(()=>SimProductionStore.RequirePacketUnbound(c,t,wo,runtime.Generation),"packet_traveler_exists");await t.RollbackAsync();}
Console.WriteLine("PASS "+count+" isolated packet checks; no live state touched");
