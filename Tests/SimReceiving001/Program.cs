using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","receiving","qualification-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
var json=SimPurchasingService.Json;var checks=0;
void Check(bool ok,string message){if(!ok)throw new Exception(message);checks++;Console.WriteLine("PASS "+message);}
void RejectJson<T>(string body,string message){try{JsonSerializer.Deserialize<T>(body,json);}catch(JsonException){Check(true,message);return;}throw new Exception(message);}
RejectJson<SimReceivingRequirementLine>("{\"purchaseId\":\"11111111-1111-1111-1111-111111111111\"}","omitted requirement decisions cannot silently become Not Required");
foreach(var property in new[]{"cocRequired","materialCertRequired","poTraceabilityRequired","inspectionRequired"}) {
    var values=new Dictionary<string,object>{{"purchaseId",Guid.NewGuid()},{"cocRequired",false},{"materialCertRequired",false},{"poTraceabilityRequired",false},{"inspectionRequired",false}};
    values.Remove(property);RejectJson<SimReceivingRequirementLine>(JsonSerializer.Serialize(values,json),"explicit requirement decision required: "+property);
}
RejectJson<SimReceivingRequirementsRequest>("{}","requirements command requires explicit expected version");
RejectJson<SimReceiveRequest>("{}","receive command requires explicit expected version");
RejectJson<SimStageMaterialRequest>("{}","staging command requires explicit expected version");
string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
var liveHashes=new[]{"data/dle-os-sim.db","data/rfq-intakes.json","state/metadata.json"}.ToDictionary(x=>x,x=>Hash(Path.Combine(source,x)));
foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)) {
    if(file.EndsWith("dle-os-sim.db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var destination=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination);
}
await using(var original=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(source,"data/dle-os-sim.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString()))
await using(var copy=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"data/dle-os-sim.db"),Pooling=false}.ToString())) {
    await original.OpenAsync();await copy.OpenAsync();original.BackupDatabase(copy);
    await using var reset=copy.CreateCommand();reset.CommandText=string.Join("",new[]{"SimReceivingDelivery","SimAcceptedMaterial","SimReceivingRequirementReview","SimReceivingStage","SimReceivingDocument","SimReceivingEvent","SimReceivingCommand"}.Select(t=>$"DROP TABLE IF EXISTS {t};"));await reset.ExecuteNonQueryAsync();
}
var state=new SimStateStore(root);await state.InitializeAsync();var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
var service=new SimReceivingService(state,operations,new(root)){UtcNow=()=>new(2026,9,24,20,0,0,TimeSpan.Zero)};
var purchasing=new SimPurchasingService(state,operations);var actor=SimPersonaCatalog.Default;
var intakes=new SimRfqIntakeStore(root);
var planning=new SimMaterialPlanning(state,operations,intakes,new SimKittingRequirementsProvider(intakes,operations)){UtcNow=()=>new(2026,9,24,20,0,0,TimeSpan.Zero)};
var purchase=(await purchasing.Read(actor)).Purchases.Single(p=>p.PoNumber=="SIM-PO-0001");var id=purchase.PurchaseId;
async Task<string> TableHash(string table) {
    await using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=operations.DatabasePath,Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString());await c.OpenAsync();await using var cmd=c.CreateCommand();
    cmd.CommandText=$"SELECT * FROM {table} ORDER BY 1";await using var reader=await cmd.ExecuteReaderAsync();var rows=new List<string>();while(await reader.ReadAsync()){var values=new object[reader.FieldCount];reader.GetValues(values);rows.Add(JsonSerializer.Serialize(values,json));}
    return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n",rows))));
}
var protectedTables=new[]{"SimKittingCase","SimKittingCaseEvent","SimKittingSubmission","KittingReadState","SalesOrderLine","WorkOrder","SimPurchaseLine","SimPurchasingEvent","SimBuyingPlan"};
var protectedHashes=new Dictionary<string,string>();foreach(var t in protectedTables)protectedHashes[t]=await TableHash(t);
var originalIntakes=Hash(Path.Combine(root,"data/rfq-intakes.json"));
async Task Reject(Func<Task> action,string code,string description) {
    try{await action();}catch(SimPurchasingProblem e){Check(e.Code==code,description+" ["+e.Code+"]");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",description);return;}throw new Exception("Expected rejection: "+description);
}
Dictionary<string,string> Pass()=>new(){["packingSlip"]="PASS",["partIdentity"]="PASS",["uom"]="PASS",["physicalCount"]="PASS",["condition"]="PASS",["damage"]="PASS",["inspection"]="PASS",["coc"]="NOT_APPLICABLE",["materialCert"]="NOT_APPLICABLE",["traceability"]="NOT_APPLICABLE"};
SimReceiveLineRequest Line(decimal count=8,decimal accept=8,decimal hold=0,decimal reject=0)=>new(id,count,count,accept,hold,reject,purchase.VendorPartNumber,hold+reject>0?"Synthetic discrepancy":null,Pass());
SimReceiveRequest Receive(long version=1,string slip="SIM-PS-0001",params SimReceiveLineRequest[] lines)=>new(version,Guid.NewGuid(),slip,"2026-09-24",null,null,"Isolated test",null,lines.Length==0?[Line()]:lines);
SimReceivingRequirementsRequest Review(long version=0,bool coc=false)=>new(version,Guid.NewGuid(),"Explicit synthetic policy: supplier CoC, material certificates and material traceability not required; Traveler unchanged.",[new(id,coc,false,false,false)]);
var initial=await service.ReadPo(id,actor);
Check(initial.Version==0&&initial.Lines.Single().OpenQuantity==8&&initial.Lines.Single().ReceivedQuantity==0,"existing immutable PO opens with deliberate zero physical receipts");
Check(initial.Lines.Single().Requirements.CocRequired is null&&initial.Lines.Single().Requirements.ReviewId is null,"unknown supplier CoC remains unresolved on GET");
await Reject(async()=>{await service.Receive(id,Receive(0),SimPersonaCatalog.Get("receiving-viewer")!);},"permission","read-only receiving viewer cannot receive");
await Reject(async()=>{await service.Receive(id,Receive(0),actor);},"requirements_unreviewed","unknown requirement blocks accepted material");
var review=Review();var reviewed=await service.Review(id,review,actor);
Check(reviewed.Version==1&&reviewed.Lines.Single().Requirements.CocRequired==false&&reviewed.Lines.Single().Requirements.MaterialCertRequired==false&&!reviewed.Lines.Single().Requirements.PoTraceabilityRequired,"explicit reviewed Not Required policy");
Check((await service.Review(id,review,actor)).Version==1,"review retry is idempotent");
await Reject(async()=>{await service.Review(id,review with{Reason="changed"},actor);},"request_reused","request ID cannot be reused with different review intent");
Check((await service.History(actor)).Reviews.Single().Reason.Contains("Traveler")&&purchase.QualityRequirements.CocRequired is null,"review records reason and leaves original purchase quality immutable");
await Reject(async()=>{await service.Receive(id,Receive(0),actor);},"receiving_version_changed","stale PO version cannot receive");
await Reject(async()=>{await service.Receive(id,Receive(slip:""),actor);},"required","packing-slip identity required");
await Reject(async()=>{await service.Receive(id,Receive() with{PackingSlipDate="09/24/2026"},actor);},"date_only","date-only storage format enforced");
await Reject(async()=>{await service.Receive(id,Receive(lines:[Line(9,9)]),actor);},"over_receipt","physical overreceipt blocked");
await Reject(async()=>{await service.Receive(id,Receive(lines:[Line(8,7)]),actor);},"quantity_reconciliation","received does not silently equal accepted");
await Reject(async()=>{await service.Receive(id,Receive(lines:[Line() with{PackingSlipQuantity=7}]),actor);},"discrepancy_reason","packing-slip mismatch requires explanation");
var failed=Pass();failed["inspection"]="FAIL";
await Reject(async()=>{await service.Receive(id,Receive(lines:[Line() with{Checks=failed}]),actor);},"inspection_failed","failed basic inspection blocks acceptance");
var unattached=Receive() with{DocumentId=Guid.NewGuid().ToString()};
await Reject(async()=>{await service.Receive(id,unattached,actor);},"receiving_document","unverified attachment reference rejected");
var bytes=Encoding.UTF8.GetBytes("SIM packing slip evidence");
var doc=await service.Upload(id,"PACKING_SLIP","SIM-PS-0001.txt",new MemoryStream(bytes),actor);
var duplicate=await service.Upload(id,"PACKING_SLIP","another-name.txt",new MemoryStream(bytes),actor);
Check(doc.Document.BinaryStatus=="VERIFIED"&&doc.Sha256==Convert.ToHexString(SHA256.HashData(bytes)),"existing binary infrastructure preserves verified document hash");
Check(duplicate.DocumentId==doc.DocumentId&&(await service.History(actor)).Documents.Length==1,"duplicate binary upload reuses evidence reference");
Check((await service.OpenDocument(id,doc.DocumentId,actor)).Bytes.SequenceEqual(bytes),"document retrieval returns exact verified evidence");
var partial=Receive(lines:[Line(3,3)]) with{DocumentId=doc.DocumentId};
var partialResult=await service.Receive(id,partial,actor);var first=partialResult.AcceptedMaterials.Single();
Check(first.ReceivedQuantity==3&&first.AcceptedQuantity==3&&first.AvailableQuantity==0&&first.HoldQuantity==0&&first.RejectedQuantity==0,"partial accepted material remains unavailable before staging");
Check(partialResult.Lines.Single().ReceivedQuantity==3&&partialResult.Lines.Single().OpenQuantity==5,"partial receive response updates physical/open quantities immediately");
Check(first.ReceiptLineId=="SIM-AM-0000001"&&first.VproReceiptId is null&&first.PurchaseId==id&&first.ExpectedReceiptId==purchase.ExpectedReceiptId,"stable SIM identity retains parents and no VPRO accounting receipt");
Check(first.Coverage.Single().Quantity==3&&first.Coverage.Single().ReceivedQuantity==3&&first.Coverage.Single().WorkOrderNumber=="0999999","unambiguous coverage retains exact physical/accepted demand lineage");
Check(partialResult.Deliveries.Single().PackingSlipDocument?.DocumentId==doc.DocumentId,"delivery binds verified packing-slip reference");
Check((await service.Receive(id,partial,actor)).AcceptedMaterials.Single().ReceiptLineId==first.ReceiptLineId,"duplicate-click idempotency returns same operational receipt");
await Reject(async()=>{await service.Receive(id,partial with{RequestId=Guid.NewGuid()},actor);},"receiving_version_changed","new request with stale version cannot double accept");
await Reject(async()=>{await service.Receive(id,Receive(2,lines:[Line(1,1)]),actor);},"packing_slip_already_received","same packing slip cannot create second delivery by distinct request");
await Reject(async()=>{await service.Review(id,Review(2),actor);},"requirements_frozen","started line requirements do not overwrite accepted evidence");
var stageRequest=new SimStageMaterialRequest(1,Guid.NewGuid(),"SIM / KITTING STAGING");
var staged=await service.Stage(first.ReceiptLineId,stageRequest,actor);
Check(staged.AvailableQuantity==3&&staged.Version==2&&staged.StagingLocation=="SIM / KITTING STAGING","staging releases exact accepted availability");
var partialSupply=(await planning.Read(actor)).WorkOrders.Single(w=>w.WorkOrderNumber=="0999999");
Check(partialSupply.LastPartDue=="2026-10-07"&&partialSupply.Demands.Single().Short==8&&partialSupply.Demands.Single().Orders.Single().Open==5&&partialSupply.Demands.Single().AcceptedMaterials!.Sum(m=>m.AvailableQuantity)==3&&partialSupply.CompactText.Contains("Partially Available"),"joined supply keeps LPD with partial accepted3 open5 and shortage8");
Check((await service.Stage(first.ReceiptLineId,stageRequest,actor)).Version==2,"staging retry is idempotent");
await Reject(async()=>{await service.Stage(first.ReceiptLineId,new(1,Guid.NewGuid(),"other"),actor);},"receiving_version_changed","stale material version cannot restage");
await Reject(async()=>{await service.Stage(first.ReceiptLineId,new(2,Guid.NewGuid(),"other"),actor);},"already_staged","duplicate staging cannot recreate availability");
var assigned = staged.Coverage.Single();
var shared = staged with { AcceptedQuantity = 8, AvailableQuantity = 8,
    Coverage = [assigned with { DemandId = "A", Quantity = 3 }, assigned with { DemandId = "B", Quantity = 5 }] };
var sharedOrders = partialSupply.Demands.Single().Orders;
Check(SimMaterialPlanning.AcceptedForDemand("A", [shared], sharedOrders).Sum(m => m.AvailableQuantity) == 3 &&
    SimMaterialPlanning.AcceptedForDemand("B", [shared], sharedOrders).Sum(m => m.AvailableQuantity) == 5,
    "shared receipt exposes assigned 3 and 5 balances, never the entire 8 to each destination");
Check(SimMaterialPlanning.AcceptedForDemand("unassigned", [shared], sharedOrders).Length == 0 &&
    SimMaterialPlanning.AcceptedForDemand("A", [shared with { StagedAtUtc = null }], sharedOrders).Length == 0,
    "same part with no governed assignment or no staging is not actionable");
var repeat=await service.Receive(id,Receive(2,"SIM-PS-0002",Line(5,5)),actor);var second=repeat.AcceptedMaterials.Single(m=>m.ReceiptLineId!=first.ReceiptLineId);
await service.Stage(second.ReceiptLineId,new(1,Guid.NewGuid(),"SIM / KITTING STAGING"),actor);
var final=await service.ReadPo(id,actor);var finalLine=final.Lines.Single();
Check(finalLine.ReceivedQuantity==8&&finalLine.AcceptedQuantity==8&&finalLine.AvailableQuantity==8&&finalLine.OpenQuantity==0,"repeat delivery reconciles received8 accepted8 available8 open0");
Check(final.Deliveries.Length==2&&final.AcceptedMaterials.Select(m=>m.ReceiptLineId).Distinct().Count()==2,"partial/repeat deliveries retain distinct stable material identities");
var fullSupply=(await planning.Read(actor)).WorkOrders.Single(w=>w.WorkOrderNumber=="0999999");
Check(fullSupply.CompactText=="Accepted Material · Awaiting Kitting"&&fullSupply.Demands.Single().Short==8&&fullSupply.Demands.Single().Orders.Single().Received==8&&fullSupply.Demands.Single().Orders.Single().Open==0,"joined supply full accepted8 awaits Kitting while shortage remains8");
var demand = (await purchasing.Read(actor)).Demands.Single(d => d.WorkOrderNumber == "0999999");
var origin = fullSupply.Demands.Single().ReturnOrigin;
Check(origin is not null && origin.CaseId == demand.CaseId && origin.SubmissionId == demand.SubmissionId &&
    origin.SourceRowId == demand.SourceRowId && origin.FindNumber == "5" && origin.ReleasedSequence == "5" &&
    origin.RequirementId == "G005" && origin.PreviouslyKitted == 12 && origin.RequiredQuantity == 20,
    "return-to-origin binds exact case immutable submission released row requirement Find and sequence");
Check(fullSupply.Demands.Single().AcceptedMaterials!.Length == 2 &&
    fullSupply.Demands.Single().AcceptedMaterials!.Sum(m => m.AvailableQuantity) == 8,
    "read-only return projection preserves separate receipt identities and assigned quantities");
Check((await purchasing.Expected(actor)).Items.Single(p=>p.PurchaseId==id).OpenQuantity==0&&(await purchasing.Read(actor)).Purchases.Single(p=>p.PurchaseId==id).ReceivedQuantity==8,"Purchasing/expected views derive received8 open0 without rewriting purchase");
var reloadedOperations=new SimOperationsDataStore(repo,root);await reloadedOperations.InitializeAsync(state.Current.Metadata!);
var reloaded=new SimReceivingService(state,reloadedOperations,new(root));
Check((await reloaded.Material(first.ReceiptLineId,actor)).AvailableQuantity==3,"availability survives service reload");
var auditBefore=JsonSerializer.Serialize(await service.History(actor),json);
await service.Material(first.ReceiptLineId,actor);await service.ReadPo(id,actor);await service.Material(first.ReceiptLineId,actor);
Check(JsonSerializer.Serialize(await service.History(actor),json)==auditBefore,"read-only label/PO data fetches do not create receipt or change status");
var history=await service.History(actor);
Check(history.Events.Count(e=>e.EventType=="DELIVERY_DISPOSITIONED")==2&&history.Events.Count(e=>e.EventType=="MATERIAL_STAGED")==2,"audit has one event per real disposition/stage");
Check(history.Events.All(e=>e.ActorId==actor.Id&&e.AtUtc!=default),"audit records authenticated actor and timestamp");
foreach(var pair in protectedHashes)Check(await TableHash(pair.Key)==pair.Value,"unchanged protected table "+pair.Key);
Check(Hash(Path.Combine(root,"data/rfq-intakes.json"))==originalIntakes,"accepted order quote and RFQ Material Costing preserved");

// Additional records are test fixtures inserted ONLY in this disposable database.
async Task<SimPurchaseLine> Fixture(string po,string line="010",decimal qty=8,SimPurchasingQuality? quality=null,SimDemandCoverage[]? coverage=null,decimal excess=0) {
    var p=purchase with{PurchaseId=Guid.NewGuid(),ExpectedReceiptId=Guid.NewGuid(),PlanId=Guid.NewGuid(),PoNumber=po,PoLine=line,OrderedQuantity=qty,ReceivedQuantity=0,OpenQuantity=qty,
        QualityRequirements=quality??purchase.QualityRequirements,Coverage=coverage??purchase.Coverage,ExcessQuantity=excess};
    await using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=operations.DatabasePath,Pooling=false}.ToString());await c.OpenAsync();await using var cmd=c.CreateCommand();
    cmd.CommandText="INSERT INTO SimPurchaseLine VALUES(@id,@expected,@supplier,@po,@line,@json)";
    cmd.Parameters.AddWithValue("@id",p.PurchaseId.ToString());cmd.Parameters.AddWithValue("@expected",p.ExpectedReceiptId.ToString());cmd.Parameters.AddWithValue("@supplier",p.Supplier);cmd.Parameters.AddWithValue("@po",po);cmd.Parameters.AddWithValue("@line",line);cmd.Parameters.AddWithValue("@json",JsonSerializer.Serialize(p,json));await cmd.ExecuteNonQueryAsync();return p;
}
var q=purchase.QualityRequirements with{CocRequired=false,MaterialCertRequired=false,InspectionRequired=false};
var multi1=await Fixture("SIM-PO-9001",quality:q);var multi2=await Fixture("SIM-PO-9001","020",quality:q);
Check((await service.ReadPo(multi1.PurchaseId,actor)).Lines.Length==2,"PO-centric workspace loads all lines");
var multiRequest=Receive(0,"SIM-MULTI",Line(2,2) with{PurchaseId=multi1.PurchaseId},Line(1,0,1) with{PurchaseId=multi2.PurchaseId,Checks=failed});
var multi=await service.Receive(multi1.PurchaseId,multiRequest,actor);
Check(multi.AcceptedMaterials.Length==2&&multi.Lines.Single(l=>l.Purchase.PurchaseId==multi2.PurchaseId).HoldQuantity==1,"one delivery supports multiple lines and independent Hold disposition");
var held=multi.AcceptedMaterials.Single(m=>m.PurchaseId==multi2.PurchaseId);
await Reject(async()=>{await service.Stage(held.ReceiptLineId,new(1,Guid.NewGuid(),"SIM"),actor);},"no_accepted_material","held material cannot be staged as accepted");
var rejectedPurchase=await Fixture("SIM-PO-9002",quality:q);
var rejected=await service.Receive(rejectedPurchase.PurchaseId,Receive(0,"SIM-REJECT",Line(8,0,0,8) with{PurchaseId=rejectedPurchase.PurchaseId,Checks=failed}),actor);
Check(rejected.Lines.Single().ReceivedQuantity==8&&rejected.Lines.Single().RejectedQuantity==8&&rejected.Lines.Single().AvailableQuantity==0&&rejected.Lines.Single().OpenQuantity==0,"received/rejected closes arrival obligation without usable availability");
var requiredPurchase=await Fixture("SIM-PO-9003",quality:q with{CocRequired=true});
await Reject(async()=>{await service.Receive(requiredPurchase.PurchaseId,Receive(0,"SIM-COC",Line() with{PurchaseId=requiredPurchase.PurchaseId}),actor);},"required_evidence","future required CoC blocks acceptance without evidence and checked PASS");
var coc=await service.Upload(requiredPurchase.PurchaseId,"COC","SIM-COC.txt",new MemoryStream(Encoding.UTF8.GetBytes("SIM supplier CoC")),actor);
var cocChecks=Pass();cocChecks["coc"]="PASS";
var withCoc=await service.Receive(requiredPurchase.PurchaseId,Receive(0,"SIM-COC",Line() with{PurchaseId=requiredPurchase.PurchaseId,Checks=cocChecks,EvidenceDocumentIds=[coc.DocumentId]}),actor);
Check(withCoc.AcceptedMaterials.Single().AcceptedQuantity==8&&withCoc.AcceptedMaterials.Single().EvidenceDocuments.Single().Sha256==coc.Sha256,"required verified CoC with explicit check permits acceptance");
var excessPurchase=await Fixture("SIM-PO-9004",qty:10,quality:q,excess:2);
await Reject(async()=>{await service.Receive(excessPurchase.PurchaseId,Receive(0,"SIM-EXCESS",Line(10,10) with{PurchaseId=excessPurchase.PurchaseId}),actor);},"coverage_allocation","excess purchase cannot auto-spread receipt to shortage");
var allocation=new SimReceivingCoverageRequest(purchase.Coverage.Single().DemandId,8,8,0,0);
var explicitExcess=await service.Receive(excessPurchase.PurchaseId,Receive(0,"SIM-EXCESS",Line(10,10) with{PurchaseId=excessPurchase.PurchaseId,Coverage=[allocation]}),actor);
Check(explicitExcess.AcceptedMaterials.Single().AcceptedQuantity==10&&explicitExcess.AcceptedMaterials.Single().Coverage.Sum(c=>c.Quantity)==8,"explicit coverage leaves surplus separate from demand availability");
var concurrency=await Fixture("SIM-PO-9005",quality:q);
var requests=new[]{Receive(0,"SIM-RACE-A",Line() with{PurchaseId=concurrency.PurchaseId}),Receive(0,"SIM-RACE-B",Line() with{PurchaseId=concurrency.PurchaseId})};
var results=await Task.WhenAll(requests.Select(async r=>{try{await service.Receive(concurrency.PurchaseId,r,actor);return "received";}catch(SimPurchasingProblem e){return e.Code;}}));
Check(results.Count(r=>r=="received")==1&&results.Count(r=>r=="receiving_version_changed")==1,"concurrent receivers cannot accept same open quantity twice");
foreach(var table in new[]{"SimAcceptedMaterial","SimReceivingDelivery","SimReceivingEvent","SimReceivingRequirementReview","SimReceivingStage"}) {
    await using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=operations.DatabasePath,Pooling=false}.ToString());await c.OpenAsync();await using var cmd=c.CreateCommand();cmd.CommandText=$"DELETE FROM {table}";
    try{await cmd.ExecuteNonQueryAsync();throw new Exception("Append-only guard absent");}catch(SqliteException){Check(true,"append-only SQL guard "+table);}
}
foreach(var pair in liveHashes)Check(Hash(Path.Combine(source,pair.Key))==pair.Value,"live checkpoint untouched "+pair.Key);
Console.WriteLine($"PASS {checks} checks; isolated state: {root}");
