using System.Text.Json;
using System.Text.Json.Nodes;
using System.Reflection;
var repo=Path.GetFullPath(args[0]);var sourceRoot=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root))throw new Exception("Use a new disposable test directory; existing paths are refused.");
foreach(var file in Directory.GetFiles(sourceRoot,"*",SearchOption.AllDirectories)){var to=Path.Combine(root,Path.GetRelativePath(sourceRoot,file));Directory.CreateDirectory(Path.GetDirectoryName(to)!);File.Copy(file,to);}

var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);int count=0;
void Check(bool b,string m){if(!b)throw new Exception(m);count++;Console.WriteLine("PASS "+m);}
async Task Reject(Func<Task> f,string code){try{await f();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
var state=new SimStateStore(root);await state.InitializeAsync();var store=new SimRfqIntakeStore(root);var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
var service=new SimOperationsHandoffService(state,store,ops,true);var admin=SimPersonaCatalog.Default;var viewer=SimPersonaCatalog.Get("order-entry-operator")!;const string id="RFQI-SIM-0044";
var r=(SimRfqIntakeRecord)(await store.ReadAsync(id))!;var p=r.OrderIntake!;var row=p.TechnicalSource!.Baseline!.Definition.Materials.Candidate.Rows[0];var alt=row.Alternates![0];var source=JsonSerializer.Serialize(r,json);
Check(SimApprovedPartIdentities.Resolve(row).SequenceEqual(new[]{"N4-554 REV -"}),"legacy reviewed identity retained exactly");
Check(SimApprovedPartIdentities.Resolve(row with{Alternates=[alt with{RemovedAtUtc=DateTimeOffset.UtcNow}]}).Length==0,"removed identity rejected");
Check(SimApprovedPartIdentities.Resolve(row with{Alternates=[alt with{ReviewStatus="NEEDS_REVIEW"}]}).Length==0,"unconfirmed identity rejected");
Check(SimApprovedPartIdentities.Resolve(row with{Alternates=[alt with{History=[]}]}).Length==0,"missing review evidence rejected");
Check(SimApprovedPartIdentities.Resolve(row with{AssemblyIdentity=new("CURRENT", "Reviewer",DateTimeOffset.UtcNow)}).SequenceEqual(new[]{"CURRENT"}),"current assembly identity takes precedence");
Check(SimApprovedPartIdentities.Resolve(row with{ComponentType="DNP"}).Length==0,"DNP remains non-actionable");
var view=JsonSerializer.SerializeToNode(await store.ReadOrderEntry(id),json)!;Check(view["blockers"]!.AsArray().Count==0,"0044 acceptance guards now pass");
var accept=new SimOrderAcceptRequest(Guid.NewGuid().ToString(),4,view["sourceToken"]!.ToString(),true,"Isolated test only");
try{await store.AcceptNewOrder(id,accept,viewer);throw new Exception("Permission bypass");}catch(SimOrderEntryPermissionException){Check(true,"operator cannot accept");}
await Reject(()=>store.AcceptNewOrder(id,accept with{ExpectedRevision=3},admin),"ORDER_ACCEPT_STALE");await Reject(()=>store.AcceptNewOrder(id,accept with{Confirm=false},admin),"ORDER_ACCEPT_REQUEST");
var entry=await store.AcceptNewOrder(id,accept,admin);var accepted=(SimRfqIntakeRecord)(await store.ReadAsync(id))!;
Check(JsonSerializer.Serialize(entry.Acceptance.Package,json)==JsonSerializer.Serialize(p,json),"acceptance freezes unchanged reviewed package");
Check(SimOperationsHandoffService.TrialScope(accepted)=="ABBOTT-0044-SIM-TRIAL","exact Abbott scope admitted");
Check(SimOperationsHandoffService.TrialScope(accepted with{IntakeId="RFQI-SIM-OTHER"}) is null,"other intake rejected");
Check(SimOperationsHandoffService.TrialScope(accepted with{OrderEntry=entry with{Acceptance=entry.Acceptance with{PackageRevision=5}}}) is null,"later revision rejected");
Check(SimOperationsHandoffService.TrialScope(accepted with{OrderEntry=entry with{Acceptance=entry.Acceptance with{SourceToken="changed"}}}) is null,"changed package token rejected");
var old=(SimRfqIntakeRecord)(await store.ReadAsync("RFQI-SIM-0043"))!;Check(SimOperationsHandoffService.TrialScope(old)=="E2E-SIM-001","0043 compatibility preserved");
var b=entry.Bridge;
await Reject(()=>service.Prepare(id,b.Revision,admin),"SIM_IMPORT_BRIDGE");
foreach(var item in SimRfqIntakeStore.BridgeChecklist)b=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),b.Revision,"CHECK",item,Reason:"Isolated simulated setup"),admin);
b=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),b.Revision,"IDENTIFIERS",Identifiers:new("SIM-VPRO5","0099998","010","0999998",id+":1"),Reason:"Isolated simulation"),admin);
b=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),b.Revision,"READY"),admin);
await Reject(()=>new SimOperationsHandoffService(state,store,ops,false).Prepare(id,b.Revision,admin),"SIM_IMPORT_DISABLED");
var dry=JsonSerializer.SerializeToNode(await service.Prepare(id,b.Revision,admin),json)!;Check(dry["validation"]!["status"]!.ToString()=="PASS","Abbott packet validates");
var packet=dry["packet"]!.Deserialize<SimOperationsPacket>(json)!;var token=dry["validationToken"]!.ToString();
Check(packet.OrderLine.CustomerNumber=="990100"&&packet.OrderLine.QuantityOrdered==25&&packet.OrderLine.ItemNumber=="B11283-17"&&packet.OrderLine.Revision=="B","exact Abbott order facts");
Check(packet.OrderLine.ExtendedPrice==36346.25m&&packet.DevelopmentScenario=="ABBOTT-0044-SIM-TRIAL","line value and honest trial provenance");
await Reject(()=>service.Import(id,new(packet,"bad"),admin),"SIM_IMPORT_VALIDATION");
await Reject(()=>service.Import(id,new(packet with{ContentHash="bad"},token),admin),"SIM_IMPORT_HASH");
var expiredGrant=new SimOperationsValidationGrant(packet.PacketId,packet.ContentHash,admin.Id,id,packet.Source.AcceptedRevision,packet.Source.BridgeRevision,packet.Generation,DateTimeOffset.UtcNow.AddMinutes(-1));
var expired=(string)typeof(SimOperationsHandoffService).GetMethod("Sign",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(service,[expiredGrant])!;
await Reject(()=>service.Import(id,new(packet,expired),admin),"SIM_IMPORT_VALIDATION");
var colliding=packet with{PacketId=Guid.NewGuid().ToString(),OrderLine=packet.OrderLine with{SalesOrderNumber="0099999"},WorkOrder=packet.WorkOrder with{WorkOrderNumber="0999999"}};
colliding=colliding with{ContentHash=SimOperationsDataStore.PacketHash(colliding)};Check((await ops.ValidatePacketAsync(colliding,state.Current.Metadata!)).Status=="BLOCKED","colliding canonical identifiers rejected");
var result=JsonSerializer.SerializeToNode(await service.Import(id,new(packet,token),admin),json)!;Check(result["recognition"]!.ToString()=="Recognized in SIM Operations","import recognized");
var retry=JsonSerializer.SerializeToNode(await service.Import(id,new(packet,token),admin),json)!;Check(retry["receipt"]!["receiptId"]!.ToString()==result["receipt"]!["receiptId"]!.ToString(),"same-packet retry no duplicate");
var req=await new SimKittingRequirementsProvider(store,ops).ResolveAsync("0999998",state.Current.Metadata!);var groups=req.Draft.GetProperty("groups");
Check(groups.GetArrayLength()==55,"55 frozen Kitting requirements");
Check(req.BuildQuantity==25&&req.AssemblyItemNumber=="B11283-17"&&req.Revision=="B"&&req.PoTraceabilityRequired,"Kitting anchors and traceability retained");
Check(groups[0].GetProperty("partNumber").GetString()=="N4-554 REV -"&&groups[0].GetProperty("requiredQuantity").GetDecimal()==25,"Kitting line1 exact identity and demand");
Check(await ops.ReadSimKittingCase("0999998",state.Current.Metadata!) is null,"Kitting not started");
Check(JsonSerializer.Serialize((SimRfqIntakeRecord)(await store.ReadAsync("RFQI-SIM-0043"))!,json)==JsonSerializer.Serialize(old,json),"0043 unchanged");
Console.WriteLine($"PASS {count} Abbott trial checks");
