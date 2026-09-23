using System.Text.Json;
using System.Text.Json.Nodes;
if(args[0]=="identifiers"){await IdentifierChecks.Run(args[1],args[2]);return;}
if(args[0]=="handoff"){await HandoffChecks.Run(args[1],args[2],args[3]);return;}
var source=Path.GetFullPath(args[0]);var root=Path.GetFullPath(args[1]);Directory.CreateDirectory(Path.Combine(root,"data"));
foreach(var f in new[]{"rfq-intakes.json","rfq-lanes.json"})File.Copy(Path.Combine(source,"data",f),Path.Combine(root,"data",f),true);
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true};var store=new SimRfqIntakeStore(root);
var r=(SimRfqIntakeRecord)(await store.ReadAsync("RFQI-SIM-0043"))!;var p=r.OrderIntake!;
var folder=Path.Combine("intake-documents",r.RequestCorrelationId);Directory.CreateDirectory(Path.Combine(root,folder));foreach(var e in p.PoEvidence)foreach(var ext in new[]{".bin",".json"})File.Copy(Path.Combine(source,folder,e.Document.DocumentId+ext),Path.Combine(root,folder,e.Document.DocumentId+ext),true);
var actor=new SimPersona("test-reviewer","test-reviewer","Isolated SIM Reviewer","ACTIVE",[],[],true,"isolated test");
var viewer=new SimPersona("viewer","viewer","Viewer","ACTIVE",[],["order_entry.view"],false,"test");
int count=0;void Check(bool b,string m){if(!b)throw new Exception(m);Console.WriteLine("PASS "+m);count++;}
async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,"reject "+code);}}
string HashState()=>File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json"));
var original=JsonNode.Parse(HashState())!;var sourceQuote=original["records"]!.AsArray().Single(x=>x!["intakeId"]!.ToString()=="RFQI-SIM-0042")!.ToJsonString();var lanes=File.ReadAllText(Path.Combine(root,"data","rfq-lanes.json"));
Check(!JsonSerializer.Serialize(await store.ListOrderEntry(),json).Contains(r.IntakeId),"draft absent from bridge and acceptance queues");
await Reject(()=>store.ReadOrderEntry(r.IntakeId),"ORDER_ENTRY_DRAFT");
try{await store.AcceptNewOrder(r.IntakeId,new(Guid.NewGuid().ToString(),p.Revision,"",true,null),viewer);throw new Exception("permission bypass");}catch(SimOrderEntryPermissionException){Check(true,"viewer cannot accept");}
var request=new SimOrderSaveRequest(Guid.NewGuid().ToString(),r.RequestCorrelationId,r.IntakeId,p.Revision,r.Customer,p.PoNumber,p.Facts,p.PreviouslyQuoted,p.Quote?.Reference,
 p.Questionnaire! with{RequirementsIdentifiedOnAttachedDocument=true},p.PoEvidence.Select(e=>e.Document).ToArray(),24,true,p.TechnicalSource!.Choice,[],"review",true,3,true,new("ACCEPT",p.ContractDates!.DueDateReview!.Note));
var submitted=await store.SaveOrder(request,actor,JsonSerializer.Deserialize<SimStateMetadata>(File.ReadAllText(Path.Combine(source,"state","metadata.json")),json)!);
Check(submitted.Record.OrderIntake!.ReviewStatus=="READY_FOR_CONTRACT_REVIEW","normal submission is pending acceptance, not accepted");
Check(submitted.Record.OrderIntake.ContractDates!.DueDateReview==p.ContractDates.DueDateReview,"original due-date event preserved exactly");
Check(submitted.Record.OrderIntake.Facts==p.Facts || JsonSerializer.Serialize(submitted.Record.OrderIntake.Facts,json)==JsonSerializer.Serialize(p.Facts,json),"PO wording and date facts unchanged");
Check(submitted.Record.OrderEntry is null,"submission does not queue bridge");
var view=JsonSerializer.SerializeToNode(await store.ReadOrderEntry(r.IntakeId),json)!;var token=view["sourceToken"]!.ToString();var revision=(int)view["packageRevision"]!;
Check(view["blockers"]!.AsArray().Count==0,"review guards pass after explicit verification and acknowledgment");
var accept=new SimOrderAcceptRequest(Guid.NewGuid().ToString(),revision,token,true,"Reviewed fixed date 10/14/2026 governs; original relative PO instruction retained.");
await Reject(()=>store.AcceptNewOrder(r.IntakeId,accept with{SourceToken="stale"},actor),"ORDER_ACCEPT_STALE");
await Reject(()=>store.AcceptNewOrder(r.IntakeId,accept with{Confirm=false},actor),"ORDER_ACCEPT_REQUEST");
var accepted=await store.AcceptNewOrder(r.IntakeId,accept,actor);var afterAcceptance=HashState();
Check(accepted.Acceptance.PackageRevision==revision&&accepted.Acceptance.SourceToken==token,"exact submitted package revision and token frozen");
Check(accepted.Acceptance.Package.Revision==revision&&accepted.Bridge.State.Status=="READY_FOR_VPRO","acceptance atomically creates bridge");
var retry=await store.AcceptNewOrder(r.IntakeId,accept,actor);Check(retry.Bridge.Id==accepted.Bridge.Id&&HashState()==afterAcceptance,"acceptance retry is idempotent and byte-preserving");
await Reject(()=>store.AcceptNewOrder(r.IntakeId,accept with{RequestId=Guid.NewGuid().ToString()},actor),"ORDER_ALREADY_ACCEPTED");
await Reject(()=>store.AcceptNewOrder(r.IntakeId,accept with{Note="changed"},actor),"ORDER_REQUEST_REUSED");
var bom=SimRfqIntakeStore.OrderEntryBom(accepted.Acceptance.Package);Check(bom.Length==12&&bom.All(x=>x.TotalRequirement==x.QuantityPerAssembly*10),"exact 12 approved rows and order-quantity multiplication");
Check(bom[0].ApprovedPartNumber=="SIM-PCB-001 REV A"&&bom[1].ApprovedPartNumber=="SIM-R-1K","approved identities used, including preserved PCB revision");
var report=await store.ReadOrderEntryReport(r.IntakeId);Check(report.Title=="NEW ORDER ACCEPTED FOR ORDER ENTRY"&&!report.Title.Contains("DRAFT"),"accepted report truthful, separate Operations boundary");
Check(report.PoDocuments.Length==1&&report.TechnicalDocuments.Length==2,"PO and both technical links retained");
var bridge=accepted.Bridge;
async Task<SimOrderBridge> Cmd(string action,string? item=null,bool complete=true,SimBridgeIdentifiers? ids=null,string? reason=null){bridge=await store.UpdateOrderBridge(r.IntakeId,new(Guid.NewGuid().ToString(),bridge.Revision,action,item,complete,ids,reason),actor);return bridge;}
await Reject(()=>Cmd("READY"),"BRIDGE_INCOMPLETE");
try{await store.UpdateOrderBridge(r.IntakeId,new(Guid.NewGuid().ToString(),bridge.Revision,"START"),viewer);throw new Exception("write bypass");}catch(SimOrderEntryPermissionException){Check(true,"viewer cannot edit bridge");}
await Cmd("START");Check(bridge.State.Status=="IN_PROGRESS","start enters In Progress");
var first=new SimBridgeRequest(Guid.NewGuid().ToString(),bridge.Revision,"CHECK","ASSEMBLY_ITEM");bridge=await store.UpdateOrderBridge(r.IntakeId,first,actor);var once=HashState();await store.UpdateOrderBridge(r.IntakeId,first,actor);Check(HashState()==once,"checklist retry writes exactly once");
await Reject(()=>store.UpdateOrderBridge(r.IntakeId,first with{RequestId=Guid.NewGuid().ToString()},actor),"BRIDGE_STALE");
foreach(var key in SimRfqIntakeStore.BridgeChecklist.Skip(1))await Cmd("CHECK",key);
await Reject(()=>Cmd("READY"),"BRIDGE_INCOMPLETE");
var ids=new SimBridgeIdentifiers("SIM-VPRO5","0099999","001","0999999",r.IntakeId+":1");
await Reject(()=>Cmd("IDENTIFIERS",ids:ids with{WorkOrder="UNKNOWN"}),"BRIDGE_SYNTHETIC_IDS");
await Cmd("IDENTIFIERS",ids:ids);Check(bridge.State.Identifiers!.SalesOrderLine=="001","SO-line leading zeros retained as string");
await Cmd("READY");Check(bridge.State.Status=="READY_FOR_OPERATIONS_SYNC","five attestations and identifiers reach Ready for Operations Sync");
await Reject(()=>Cmd("CHECK","BOM",false),"BRIDGE_READY");
await Reject(()=>Cmd("IDENTIFIERS",ids:ids with{WorkOrder="0999998"}),"BRIDGE_REASON");
await Cmd("IDENTIFIERS",ids:ids with{WorkOrder="0999998"},reason:"Corrected synthetic WO transcription");Check(bridge.State.Status=="IN_PROGRESS"&&bridge.History.Last().Before!.Identifiers!.WorkOrder=="0999999","identifier correction preserves before/after and invalidates readiness");
await Cmd("READY");await Cmd("REOPEN",reason:"Recheck BOM");await Cmd("CHECK","BOM",false,reason:"BOM entry needs correction");await Reject(()=>Cmd("READY"),"BRIDGE_INCOMPLETE");await Cmd("CHECK","BOM");await Cmd("HOLD",reason:"Waiting for entry check");await Reject(()=>Cmd("READY"),"BRIDGE_INCOMPLETE");await Cmd("CLEAR_HOLD",reason:"Entry check complete");await Cmd("READY");
await Reject(()=>Cmd("RELEASED_TO_OPERATIONS"),"BRIDGE_READY");
Check(bridge.History.All(h=>h.ActorId==actor.Id&&h.At!=default)&&bridge.History.Length==bridge.Revision,"append-only actor/time and sequential bridge audit");
var fresh=(SimRfqIntakeRecord)(await new SimRfqIntakeStore(root).ReadAsync(r.IntakeId))!;
Check(fresh.OrderEntry!.Acceptance==accepted.Acceptance || JsonSerializer.Serialize(fresh.OrderEntry.Acceptance,json)==JsonSerializer.Serialize(accepted.Acceptance,json),"accepted package remains immutable through bridge changes");
var final=JsonNode.Parse(HashState())!;Check(final["records"]!.AsArray().Single(x=>x!["intakeId"]!.ToString()=="RFQI-SIM-0042")!.ToJsonString()==sourceQuote&&File.ReadAllText(Path.Combine(root,"data","rfq-lanes.json"))==lanes,"source RFQ quote BOM Materials Labor and commercial lifecycle unchanged");
// Isolated fixture for cross-order identifier collision and legitimate same-SO/different-line validation.
var clone=fresh with{IntakeId="RFQI-SIM-TEST-OTHER",OrderEntry=fresh.OrderEntry with{Bridge=fresh.OrderEntry.Bridge with{Id=Guid.NewGuid().ToString(),State=new("IN_PROGRESS",[],null,null),History=[],Revision=0}}};
final["records"]!.AsArray().Add(JsonSerializer.SerializeToNode(clone,json));File.WriteAllText(Path.Combine(root,"data","rfq-intakes.json"),final.ToJsonString(json));
var otherIds=bridge.State.Identifiers! with{OrderLineKey=clone.IntakeId+":1"};
await Reject(()=>store.UpdateOrderBridge(clone.IntakeId,new(Guid.NewGuid().ToString(),0,"IDENTIFIERS",Identifiers:otherIds),actor),"BRIDGE_ID_CONFLICT");
await Reject(()=>store.UpdateOrderBridge(clone.IntakeId,new(Guid.NewGuid().ToString(),0,"IDENTIFIERS",Identifiers:otherIds with{SalesOrderLine="002"}),actor),"BRIDGE_ID_CONFLICT");
var other=await store.UpdateOrderBridge(clone.IntakeId,new(Guid.NewGuid().ToString(),0,"IDENTIFIERS",Identifiers:otherIds with{SalesOrderLine="002",WorkOrder="0999997"}),actor);Check(other.State.Identifiers!.SalesOrder==ids.SalesOrder,"one SO may have distinct lines with distinct WOs");
Directory.CreateDirectory("tmp/order-entry");File.WriteAllText("tmp/order-entry/isolated-verification.json",JsonSerializer.Serialize(new{acceptance=accepted.Acceptance.Id,bridge=bridge.Id,bridge.State,bom},json));
Console.WriteLine($"PASS {count} checks; writes isolated to {root}");
