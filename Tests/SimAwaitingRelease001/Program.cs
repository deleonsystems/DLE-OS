using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state"})foreach(var path in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
 var dest=Path.Combine(root,Path.GetRelativePath(source,path));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(path,dest);
}
var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);var intakes=new SimRfqIntakeStore(root);
var service=new SimOperationsHandoffService(state,intakes,ops,true);var json=SimOperationsDataStore.PacketJson;
var actor=new SimPersona("sim-entry-test","test","SIM VPRO Entry Test","ACTIVE",[],[],true,"isolated");
int count=0;void Check(bool ok,string label){if(!ok)throw new Exception(label);count++;Console.WriteLine("PASS "+label);}
JsonElement E(object? v)=>JsonSerializer.SerializeToElement(v,json);
T R<T>(object v)=>JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v,json),json)!;
var before=await File.ReadAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"));
var original=(SimRfqIntakeRecord)(await intakes.ReadAsync("RFQI-SIM-0046"))!;
Check(SimOperationsHandoffService.TrialScope(original)=="ABBOTT-0046-AWAITING-RELEASE","exact accepted 0046 eligible only as held trial");
Check(SimOperationsHandoffService.TrialScope(original with{OrderEntry=original.OrderEntry! with{Acceptance=original.OrderEntry!.Acceptance with{PackageRevision=3}}}) is null,"different accepted revision excluded");
Check(SimOperationsHandoffService.TrialScope(original with{OrderEntry=original.OrderEntry! with{Acceptance=original.OrderEntry!.Acceptance with{SourceToken="changed"}}}) is null,"different source token excluded");
foreach(var id in new[]{"RFQI-SIM-0043","RFQI-SIM-0044"})Check(SimOperationsHandoffService.TrialScope((SimRfqIntakeRecord)(await intakes.ReadAsync(id))!) is not null,id+" remains eligible");
var revision=original.OrderEntry!.Bridge.Revision;
foreach(var item in SimRfqIntakeStore.BridgeChecklist){var b=await intakes.UpdateOrderBridge(original.IntakeId,R<SimBridgeRequest>(new{requestId=Guid.NewGuid().ToString(),expectedRevision=revision,action="CHECK",item,complete=true,reason="Explicitly simulated VPRO entry in isolated test; no real ERP or Quality review."}),actor);revision=b.Revision;}
var ids=await intakes.UpdateOrderBridge(original.IntakeId,R<SimBridgeRequest>(new{requestId=Guid.NewGuid().ToString(),expectedRevision=revision,action="IDENTIFIERS",identifiers=new{salesOrder="0099997",salesOrderLine="010",workOrder="0999997",orderLineKey="RFQI-SIM-0046:1",@namespace="SIM-VPRO5"},reason="SIM only"}),actor);revision=ids.Revision;
var ready=await intakes.UpdateOrderBridge(original.IntakeId,R<SimBridgeRequest>(new{requestId=Guid.NewGuid().ToString(),expectedRevision=revision,action="READY",reason="Simulated VPRO entry only; awaiting Quality release"}),actor);
var prep=E(await service.Prepare(original.IntakeId,ready.Revision,actor));
Check(prep.GetProperty("validation").GetProperty("status").GetString()=="PASS","collision-checked held packet passes dry run");
var packet=prep.GetProperty("packet").Deserialize<SimOperationsPacket>(json)!;
Check(packet.WorkOrder.WorkOrderStatus=="AWAITING_RELEASE","simulated WO explicitly Awaiting Release");
var altered=packet with{WorkOrder=packet.WorkOrder with{WorkOrderStatus="OPEN"}};altered=altered with{ContentHash=SimOperationsDataStore.PacketHash(altered)};
Check((await ops.ValidatePacketAsync(altered,runtime)).Status=="BLOCKED","cannot import 0046 as open actionable job");
var import=E(await service.Import(original.IntakeId,new(packet,prep.GetProperty("validationToken").GetString()!),actor));
Check(import.GetProperty("recognition").GetString()=="Recognized in SIM Operations","held packet imports with verified canonical readback");
var row=E(await ops.ReadRecordAsync("SalesOrderLine","SalesOrderLineId",SimOperationsDataStore.PacketSalesOrderLineId(packet))!);
Check(row.GetProperty("releaseState").GetString()=="AWAITING_RELEASE","canonical Operations line retains explicit release state");
var page=await ops.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,StringValues>{{"salesOrderNumber","0099997"}}),runtime.Generation);
Check(page.Items.Length==1&&E(page.Items[0]).GetProperty("materialStatus").GetProperty("machineValue").GetString()=="AWAITING_RELEASE","visible in Operations with material release hold");
Check(await ops.ReadKittingCaseAsync("0999997",runtime.Generation) is null,"held WO has no default Needs Kitting case");
var provider=new SimKittingRequirementsProvider(intakes,ops);var kitting=new SimKittingCases(state,ops,provider);var production=new SimProductionService(state,ops,intakes,provider,new SimIntakeDocuments(root));
async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem e){Check(e.Message.Contains("Awaiting Release"),label);return;}throw new Exception(label);}
await Block(async()=>{await provider.ResolveAsync("0999997",runtime);},"released requirements denied while held");
await Block(async()=>{await kitting.Start("0999997",new(),actor);},"direct Kitting Start denied server-side");
await Block(async()=>{await production.Read("0999997",actor);},"production packet unavailable while held");
var after=(SimRfqIntakeRecord)(await intakes.ReadAsync(original.IntakeId))!;
Check(JsonSerializer.Serialize(original.OrderEntry.Acceptance,json)==JsonSerializer.Serialize(after.OrderEntry!.Acceptance,json),"entire frozen package, documents, C/S and acceptance unchanged");
Check(JsonSerializer.Serialize(original.OrderIntake,json)==JsonSerializer.Serialize(after.OrderIntake,json),"original order inputs unchanged");
var beforeRecords=JsonDocument.Parse(before).RootElement.GetProperty("records");var afterRecords=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"))).RootElement.GetProperty("records");
Check(beforeRecords.EnumerateArray().Where(r=>r.GetProperty("intakeId").GetString()!=original.IntakeId).Select(r=>r.GetRawText()).SequenceEqual(afterRecords.EnumerateArray().Where(r=>r.GetProperty("intakeId").GetString()!=original.IntakeId).Select(r=>r.GetRawText())),"every unrelated intake unchanged");
var receipt=(await ops.GetBridgeReceiptAsync(after.OrderEntry.Bridge.Id))!;
Check((await ops.ReadPacketRecognitionAsync(receipt,runtime)).Verified,"held receipt remains verifiable");
var duplicate=E(await service.Import(original.IntakeId,new(packet,prep.GetProperty("validationToken").GetString()!),actor));Check(duplicate.GetProperty("receipt").GetProperty("receiptId").GetString()==receipt.ReceiptId,"retry reuses receipt");
await File.WriteAllTextAsync(Path.Combine(root,"held-row.json"),JsonSerializer.Serialize(page.Items[0],json));
Console.WriteLine($"PASS {count} checks; isolated state {root}");
