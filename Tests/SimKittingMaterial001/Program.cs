using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","governed-rekit","tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)) {
    if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var destination=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination);
}
await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
await using(var b=new SqliteConnection($"Data Source={Path.Combine(root,"data/dle-os-sim.db")};Pooling=False")) {await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
var json=SimPurchasingService.Json;var actor=SimPersonaCatalog.Default;var checks=0;
void Check(bool pass,string text){if(!pass)throw new Exception(text);checks++;Console.WriteLine("PASS "+text);}
async Task Reject(Func<Task> action,string code) {try{await action();}catch(KittingCaseProblem e){Check(e.Code==code,code);return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Expected "+code);}
var state=new SimStateStore(root);await state.InitializeAsync();var store=new SimOperationsDataStore(repo,root);await store.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,store);
var kitting=new SimKittingCases(state,store,provider){UtcNow=()=>new(2026,9,26,12,0,0,TimeSpan.Zero)};
var receiving=new SimReceivingService(state,store,new(root));var purchasing=new SimPurchasingService(state,store);
var planning=new SimMaterialPlanning(state,store,intakes,provider);
const string wo="0999999",materialId="SIM-AM-0000001";
async Task<SimKittingCaseRecord> Current()=> (await store.ReadSimKittingCase(wo,state.Current.Metadata!))!;
async Task<JsonElement> Context()=>JsonSerializer.SerializeToElement(await kitting.MaterialContext(wo,actor),json).GetProperty("requirements")[0];
var initial=await Current();var original=(await store.ReadSimKittingSubmissions(wo,state.Current.Metadata!)).Single();
var frozen=initial.FrozenDraft.GetRawText();var submittedHash=SimPurchasingService.Hash(original);
var materialBefore=await receiving.Material(materialId,actor);
Check(initial.State=="KIT_SHORT"&&initial.WorkingVersion==54,"fixture captures existing manual A2 and immutable shortage");
await kitting.Resume(wo,new(initial.WorkingVersion),actor);var c=await Current();
Check((await purchasing.Read(actor)).Demands.Single(d=>d.WorkOrderNumber==wo).SourceCurrent,"original purchasing source stays current during editing");
var ctx=await Context();var correctionInfo=ctx.GetProperty("corrections")[0];
var correction=new SimKittingCorrectionRequest(c.WorkingVersion,c.EditingSessionId,Guid.NewGuid(),c.CaseId,original.SubmissionId,
    ctx.GetProperty("sourceRowId").GetString()!,"G005","A2",correctionInfo.GetProperty("allocationHash").GetString()!,"Reviewed manual test A2 was not receipt application; restore original count evidence.");
var apply=new SimKittingMaterialRequest(c.WorkingVersion,c.EditingSessionId,Guid.NewGuid(),c.CaseId,original.SubmissionId,
    correction.SourceRowId,"G005",ctx.GetProperty("demandId").GetString()!,materialId,2,8,"EA");
await Reject(()=>kitting.ApplyMaterial(wo,apply,actor),"manual_rekit_correction_required");
await Reject(()=>kitting.CorrectAllocation(wo,correction with{ExpectedAllocationHash="wrong"},actor),"allocation_correction_invalid");
await Reject(()=>kitting.CorrectAllocation(wo,correction with{Reason=""},actor),"review_reason_required");
await kitting.CorrectAllocation(wo,correction,actor);c=await Current();
JsonElement Row(SimKittingCaseRecord value)=>value.Draft.GetProperty("groups").EnumerateArray().Single(g=>g.GetProperty("groupId").GetString()=="G005");
Check(Row(c).GetProperty("entry").GetProperty("pickedQuantity").GetDecimal()==12&&c.TotalShortage==8,"reviewed correction restores12 short8");
Check((await kitting.CorrectAllocation(wo,correction,actor)) is not null&&(await Current()).WorkingVersion==c.WorkingVersion,"correction replay is idempotent");
var history=await store.ReadSimKittingEvents(wo,state.Current.Metadata!);
Check(history.Any(e=>e.Detail.TryGetProperty("action",out var a)&&a.GetString()=="MANUAL_ALLOCATION_CORRECTED"),"case audit links reviewed correction");
apply=apply with{ExpectedWorkingVersion=c.WorkingVersion,EditingSessionId=c.EditingSessionId};
await Reject(()=>kitting.ApplyMaterial(wo,apply,SimPersonaCatalog.Get("read-only-viewer")!),"permission");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{ExpectedWorkingVersion=1},actor),"kitting_case_version_changed");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{EditingSessionId=Guid.NewGuid()},actor),"editing_lease_required");
await Reject(()=>kitting.ApplyMaterial(wo,apply,SimPersonaCatalog.Get("kitting-operator")!),"editing_lease_required");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{ExpectedMaterialVersion=1},actor),"material_version_changed");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{ReceiptLineId="wrong"},actor),"accepted_material_required");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{CaseId=Guid.NewGuid()},actor),"assigned_demand_required");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{RequirementId="G006"},actor),"shortage_origin_invalid");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{Uom="M"},actor),"uom_mismatch");
foreach(var qty in new[]{0m,-1m,9m})await Reject(()=>kitting.ApplyMaterial(wo,apply with{Quantity=qty},actor),"application_quantity_invalid");
Check((await Current()).WorkingVersion==c.WorkingVersion&&(await receiving.Material(materialId,actor)).AvailableQuantity==8,"failed commands have no partial case or balance writes");
var response=JsonSerializer.SerializeToElement(await kitting.ApplyMaterial(wo,apply,actor),json);
var appId=response.GetProperty("applicationEvent").GetProperty("eventId").GetGuid();c=await Current();
Check(c.State=="KIT_SHORT"&&c.CompletedCount==12&&c.TotalShortage==0&&Row(c).GetProperty("entry").GetProperty("pickedQuantity").GetDecimal()==20,"apply yields20/20 while governingKIT_SHORT persists");
var m=await receiving.Material(materialId,actor);Check(m.AcceptedQuantity==8&&m.ReceivedQuantity==8&&m.AppliedQuantity==8&&m.AvailableQuantity==0&&m.Version==3,"accepted8 applied8 available0 materialversion3");
await kitting.ApplyMaterial(wo,apply,actor);Check((await Current()).WorkingVersion==c.WorkingVersion&&(await receiving.Material(materialId,actor)).AppliedQuantity==8,"retry never consumes twice");
await Reject(()=>kitting.ApplyMaterial(wo,apply with{Quantity=1},actor),"request_reused");
var plan=(await planning.Read(actor)).WorkOrders.Single(w=>w.WorkOrderNumber==wo);
Check(plan.CompactText=="Re-Kit Applied · Submission Required"&&plan.Demands.Single().AcceptedMaterials!.Length==0,"queue removes consumed receipt and retains submission-required WO context");
Check(plan.Demands.Single().Schedule!.MaterialNeedBy=="2026-10-09","need-by preserved");
Check((await store.ReadSimKittingSubmissions(wo,state.Current.Metadata!)).Length==1,"apply creates no successor");
var tamper=JsonNode.Parse(c.Draft.GetRawText())!;var target=tamper["groups"]!.AsArray().Single(g=>g!["groupId"]!.ToString()=="G005")!;
target["entry"]!["allocations"]!.AsArray().RemoveAt(1);
await Reject(()=>kitting.Save(wo,new(c.WorkingVersion,c.EditingSessionId,JsonSerializer.SerializeToElement(tamper,json)),actor),"governed_application_required");
await kitting.Save(wo,new(c.WorkingVersion,c.EditingSessionId,c.Draft),actor,true);c=await Current();
Check(c.EditingSessionId is null&&c.State=="KIT_SHORT"&&(await receiving.Material(materialId,actor)).AvailableQuantity==0,"SaveExit retains application and governing status");
await kitting.Resume(wo,new(c.WorkingVersion),actor);c=await Current();
await kitting.Abandon(wo,new(c.WorkingVersion,c.EditingSessionId),actor);c=await Current();
Check((await receiving.Material(materialId,actor)).AvailableQuantity==0,"abandon releases lease without refunding physically applied material");
await kitting.Resume(wo,new(c.WorkingVersion),actor);c=await Current();
var reverse=new SimKittingReversalRequest(c.WorkingVersion,c.EditingSessionId,Guid.NewGuid(),c.CaseId,appId,3,"Isolated physical return correction",true);
await Reject(()=>kitting.ReverseMaterial(wo,reverse with{MaterialReturnedToStaging=false},actor),"physical_return_required");
await kitting.ReverseMaterial(wo,reverse,actor);c=await Current();
Check(c.TotalShortage==8&&(await receiving.Material(materialId,actor)).AvailableQuantity==8,"audited reversal restores balance only after physical return attestation");
await kitting.ReverseMaterial(wo,reverse,actor);Check((await receiving.Material(materialId,actor)).AvailableQuantity==8,"reversal replay does not double refund");
var partial=apply with{RequestId=Guid.NewGuid(),ExpectedWorkingVersion=c.WorkingVersion,EditingSessionId=c.EditingSessionId,ExpectedMaterialVersion=4,Quantity=3};
await kitting.ApplyMaterial(wo,partial,actor);c=await Current();
Check(c.TotalShortage==5&&(await receiving.Material(materialId,actor)).AvailableQuantity==5,"partial3 keeps separate application and short5");
var last=partial with{RequestId=Guid.NewGuid(),ExpectedWorkingVersion=c.WorkingVersion,ExpectedMaterialVersion=5,Quantity=5};
var concurrent=await Task.WhenAll(new[]{last,last with{RequestId=Guid.NewGuid()}}.Select(async r=> {try{await kitting.ApplyMaterial(wo,r,actor);return true;}catch(KittingCaseProblem){return false;}}));
Check(concurrent.Count(v=>v)==1&&(await receiving.Material(materialId,actor)).AvailableQuantity==0,"concurrent commands cannot double spend case or receipt");
c=await Current();Check(Row(c).GetProperty("entry").GetProperty("allocations").GetArrayLength()==3,"partial applications retain distinct identities");
Check(SimPurchasingService.Hash((await store.ReadSimKittingSubmissions(wo,state.Current.Metadata!)).Single())==submittedHash&&c.FrozenDraft.GetRawText()==frozen,"original snapshot PDF hash and frozen release remain byte-identical");
var demandBefore=(await purchasing.Read(actor)).Demands.Single(d=>d.WorkOrderNumber==wo);
await kitting.Submit(wo,new(c.WorkingVersion,c.EditingSessionId,c.Draft),actor);c=await Current();
var successor=(await store.ReadSimKittingSubmissions(wo,state.Current.Metadata!)).Single(s=>s.SubmissionId!=original.SubmissionId);
var snap=JsonDocument.Parse(successor.SnapshotJson).RootElement;
Check(c.State=="KIT_COMPLETE"&&snap.GetProperty("predecessorSubmissionId").GetGuid()==original.SubmissionId&&snap.GetProperty("applicationIds").GetArrayLength()==2,"isolated-only explicit successor Submit carries predecessor and application lineage");
var demandAfter=(await purchasing.Read(actor)).Demands.Where(d=>d.WorkOrderNumber==wo).ToArray();
Check(demandAfter.Length==1&&demandAfter[0].DemandId==demandBefore.DemandId&&demandAfter[0].RemainingShortQuantity==0&&demandAfter[0].State=="RESOLVED","successor reconciles original demand with no new buying authority");
var completedSupply=(await planning.Read(actor)).WorkOrders.Single(w=>w.WorkOrderNumber==wo);
var completedDemand=completedSupply.Demands.Single();
Check(completedSupply.MaterialStatus=="KIT_COMPLETE"&&completedSupply.CompactText=="Kit Complete"&&completedSupply.ShortageCount==0&&
    completedSupply.LastPartDue is null&&!completedSupply.LastPartDueEstablished&&completedSupply.ProductionAtRisk==false,
    "successor completion removes current LPD blocker using Kitting authority");
Check(completedDemand.Resolved&&completedDemand.Short==8&&completedDemand.RemainingShortQuantity==0&&completedDemand.Progress=="Kit Complete"&&
    completedDemand.Schedule?.MaterialNeedBy=="2026-10-09"&&completedDemand.UnavailableReason is null,
    "resolved historical shortage retains planning provenance without false source-change warning");
Check(completedDemand.AppliedQuantity==8&&completedDemand.Orders.Single().AppliedQuantity==8&&completedDemand.AcceptedMaterials!.Length==0&&
    completedDemand.ReturnOrigin is null,"completed supply retains application history and exposes no actionable re-kit context");
Check((await receiving.Material(materialId,actor)).AcceptedQuantity==materialBefore.AcceptedQuantity,"receiving historical acceptance never rewritten");
await using(var auditConnection=new SqliteConnection($"Data Source={store.DatabasePath};Pooling=False")) {
    await auditConnection.OpenAsync();
    await using(var auditRead=auditConnection.CreateCommand()) {
        auditRead.CommandText="SELECT PayloadJson FROM SimKittingMaterialEvent";
        await using var reader=await auditRead.ExecuteReaderAsync();var events=new List<SimKittingMaterialEvent>();
        while(await reader.ReadAsync())events.Add(JsonSerializer.Deserialize<SimKittingMaterialEvent>(reader.GetString(0),json)!);
        var corrected=events.Single(e=>e.Kind=="MANUAL_ALLOCATION_CORRECTED");
        Check(corrected.BeforeRequirement.GetProperty("entry").GetProperty("allocations")[1].GetProperty("quantity").GetDecimal()==8&&
            corrected.AfterRequirement.GetProperty("entry").GetProperty("allocations").GetArrayLength()==1&&corrected.Reason==correction.Reason&&corrected.ActorId==actor.Id,
            "append-only correction retains A2 quantity evidence reviewer reason and before/after requirement");
    }
    foreach(var table in new[]{"SimKittingMaterialEvent","SimKittingMaterialCommand","SimKittingDemandReconciliation"}) {
        foreach(var verb in new[]{"UPDATE","DELETE"}) {
            await using var command=auditConnection.CreateCommand();command.CommandText=verb=="UPDATE"?$"UPDATE {table} SET {(table.EndsWith("Command")?"ResponseJson=ResponseJson":"PayloadJson=PayloadJson")}":$"DELETE FROM {table}";
            try{await command.ExecuteNonQueryAsync();throw new Exception("Audit mutation allowed");}catch(SqliteException e){Check(e.SqliteErrorCode==19,table+" blocks "+verb);}
        }
    }
}
await MaterialScenarios.Run(repo,source,Check);
Console.WriteLine($"PASS {checks} checks; isolated fixture {root}");


