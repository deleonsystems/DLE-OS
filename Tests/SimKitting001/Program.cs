using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);
var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","kitting","qualification-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
var checks=0;
void Check(bool value,string message){if(!value)throw new Exception(message);checks++;Console.WriteLine("PASS "+message);}
string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
var sourceHashes=new[]{"data/dle-os-sim.db","data/rfq-intakes.json","state/metadata.json"}.ToDictionary(x=>x,x=>Hash(Path.Combine(source,x)));
foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories))
{
    if(file.EndsWith("dle-os-sim.db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
}
await using(var from=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(source,"data/dle-os-sim.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString()))
await using(var to=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"data/dle-os-sim.db"),Pooling=false}.ToString()))
{
    await from.OpenAsync();await to.OpenAsync();from.BackupDatabase(to);
    // Start/lease scenarios need a fresh case. Reset only the three new Kitting
    // tables in this disposable copy, so the suite also works after live Start.
    await using var reset=to.CreateCommand();
    reset.CommandText="DROP TABLE IF EXISTS SimKittingSubmission; DROP TABLE IF EXISTS SimKittingCaseEvent; DROP TABLE IF EXISTS SimKittingCase;";
    await reset.ExecuteNonQueryAsync();
}
var state=new SimStateStore(root);await state.InitializeAsync();
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);
var provider=new SimKittingRequirementsProvider(intakes,ops);
var service=new SimKittingCases(state,ops,provider);
var actor=SimPersonaCatalog.Get("kitting-operator")!;
var other=SimPersonaCatalog.Default;
const string wo="0999999";
JsonElement E(object value)=>JsonSerializer.SerializeToElement(value,json);
T Request<T>(object value)=>JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value,json),json)!;
async Task Reject(Func<Task> action,string message){try{await action();}catch(Exception e) when(e is KittingCaseProblem or SimRfqIntakeProblem or SimOrderEntryPermissionException){Check(true,message+" ["+e.GetType().Name+"]");return;}throw new Exception(message);}
async Task<JsonElement> Read()=>E(await service.Read(wo,actor)).GetProperty("kittingCase");
SimKittingSaveRequest SaveRequest(JsonElement current,JsonElement draft)=>Request<SimKittingSaveRequest>(new{expectedWorkingVersion=current.GetProperty("workingVersion").GetInt64(),editingSessionId=current.GetProperty("editingSessionId"),draft});
SimKittingVersionRequest Version(JsonElement current)=>Request<SimKittingVersionRequest>(new{expectedWorkingVersion=current.GetProperty("workingVersion").GetInt64()});
SimKittingEditableRequest Editable(JsonElement current)=>Request<SimKittingEditableRequest>(new{expectedWorkingVersion=current.GetProperty("workingVersion").GetInt64(),editingSessionId=current.GetProperty("editingSessionId")});

Check(state.Current.IsHealthy&&ops.IsHealthy,"isolated accepted checkpoint loads");
checks+=PdfQuantityChecks.Run();
var release=await provider.ResolveAsync(wo,state.Current.Metadata!);
var releaseAgain=await provider.ResolveAsync(wo,state.Current.Metadata!);
Check(release.ReleasedBomIdentity==releaseAgain.ReleasedBomIdentity,"release identity deterministic across reads");
var intakePath=Path.Combine(root,"data/rfq-intakes.json");
var originalIntakes=await File.ReadAllTextAsync(intakePath);
var changedMutable=JsonNode.Parse(originalIntakes)!;
var mutableSource=changedMutable["records"]!.AsArray().Single(x=>x!["intakeId"]!.ToString()=="RFQI-SIM-0042")!;
mutableSource["technicalReview"]!["candidateBom"]!["rows"]![0]!["values"]!["quantity"]="999";
await File.WriteAllTextAsync(intakePath,changedMutable.ToJsonString());
Check((await provider.ResolveAsync(wo,state.Current.Metadata!)).ReleasedBomIdentity==release.ReleasedBomIdentity,"mutable Technical Review changes cannot alter accepted release");
await File.WriteAllTextAsync(intakePath,originalIntakes);
var alteredAcceptance=JsonNode.Parse(originalIntakes)!;
var acceptedNode=alteredAcceptance["records"]!.AsArray().Single(x=>x!["intakeId"]!.ToString()=="RFQI-SIM-0043")!;
acceptedNode["orderEntry"]!["acceptance"]!["package"]!["technicalSource"]!["baseline"]!["definition"]!["materials"]!["candidate"]!["rows"]![0]!["values"]!["quantity"]="999";
await File.WriteAllTextAsync(intakePath,alteredAcceptance.ToJsonString());
await Reject(async()=>{await provider.ResolveAsync(wo,state.Current.Metadata!);},"changed accepted snapshot fails its acceptance token");
await File.WriteAllTextAsync(intakePath,originalIntakes);
var acceptedRecord=(SimRfqIntakeRecord)(await intakes.ReadAsync("RFQI-SIM-0043"))!;
checks+=SimKittingRequirementChecks.Run(acceptedRecord.OrderEntry!.Acceptance.Package.TechnicalSource!.Baseline!.Definition.Materials.Candidate.Rows[1]);
var held=JsonNode.Parse(originalIntakes)!;
held["records"]!.AsArray().Single(x=>x!["intakeId"]!.ToString()=="RFQI-SIM-0043")!["orderEntry"]!["bridge"]!["state"]!["holdReason"]="Isolated hold guard test";
await File.WriteAllTextAsync(intakePath,held.ToJsonString());
await Reject(async()=>{await provider.ResolveAsync(wo,state.Current.Metadata!);},"held bridge cannot release requirements");
await File.WriteAllTextAsync(intakePath,originalIntakes);
var groups=release.Draft.GetProperty("groups").EnumerateArray().ToArray();
var parts=new[]{"SIM-PCB-001 REV A","SIM-R-1K","SIM-R-10K","SIM-C-100N","SIM-OPTO-4","SIM-J-4","SIM-LED-G","SIM-D-REV","SIM-TP","SIM-HW-M3","SIM-LABEL","SIM-BAG"};
var per=new[]{1m,2m,2m,2m,2m,2m,2m,2m,4m,4m,1m,1m};
Check(groups.Length==12,"12 released requirement groups");
for(var i=0;i<12;i++)Check(groups[i].GetProperty("partNumber").GetString()==parts[i]&&groups[i].GetProperty("requiredEach").GetDecimal()==per[i]&&groups[i].GetProperty("requiredQuantity").GetDecimal()==per[i]*10&&groups[i].GetProperty("actionable").GetBoolean()&&groups[i].GetProperty("references").GetArrayLength()>0&&groups[i].GetProperty("eligibleParts").GetArrayLength()==1&&groups[i].GetProperty("entry").ValueKind==JsonValueKind.Null,"accepted identity, quantities, references, empty execution: "+parts[i]);
await Reject(async()=>{await provider.ResolveAsync("0888888",state.Current.Metadata!);},"unknown WO rejected");
await Reject(async()=>{await service.Read("0888888",actor);},"missing WO keeps missing-case API behavior");
await Reject(async()=>{await provider.ResolveAsync(wo,state.Current.Metadata! with{Generation=state.Current.Metadata!.Generation+1});},"stale runtime generation rejected");
var start=Request<SimKittingStartRequest>(new{customerNumber="990901",originSalesOrderNumber="0099999",originSalesOrderLineNumber="010",assemblyItemNumber="SIM-ASSY-001",revision="A",releasedBomIdentity=release.ReleasedBomIdentity,draft=release.Draft});
await Reject(async()=>{await service.Start(wo,start,SimPersonaCatalog.Get("read-only-viewer")!);},"read-only actor cannot start");
var concurrentStart=await SimKittingConcurrencyChecks.Start(service,intakes,wo,start,actor,intakePath);
checks+=concurrentStart.Checks;
var current=E(concurrentStart.Case);
var id=current.GetProperty("caseId").GetString();
Check(current.GetProperty("actionableCount").GetInt32()==12&&current.GetProperty("completedCount").GetInt32()==0&&current.GetProperty("shortRequirementCount").GetInt32()==0,"start has 12 actionable / zero completed / zero shortages");
Check(current.GetProperty("poTraceabilityRequired").GetBoolean()&&current.GetProperty("state").GetString()=="KITTING_IN_PROGRESS","start is in progress with required PO traceability");
try{Check(E(await service.Start(wo,start,other)).GetProperty("caseId").GetString()==id,"duplicate Start returns existing case");}catch(KittingCaseProblem){Check(true,"duplicate Start rejected safely");}
Check((await Read()).GetProperty("caseId").GetString()==id,"one case identity retained after duplicate attempt");
await Reject(async()=>{await service.Resume(wo,Version(current),other);},"active lease excludes other actor");
await Reject(async()=>{await service.Save(wo,SaveRequest(current,current.GetProperty("draft")),other);},"lease owner required for save");
var original=current.Clone();
current=E(await service.Save(wo,SaveRequest(current,current.GetProperty("draft")),actor));
Check(current.GetProperty("workingVersion").GetInt64()>original.GetProperty("workingVersion").GetInt64(),"save advances working version");
await Reject(async()=>{await service.Save(wo,SaveRequest(original,original.GetProperty("draft")),actor);},"stale save rejected");
await Reject(async()=>{await service.Traceability(wo,Request<SimKittingTraceabilityRequest>(new{expectedWorkingVersion=current.GetProperty("workingVersion").GetInt64(),editingSessionId=current.GetProperty("editingSessionId"),poTraceabilityRequired=false}),actor);},"accepted contractual traceability cannot be disabled");
foreach(var field in new[]{"partNumber","requiredQuantity","requiredEach","references","eligibleParts","actionable"})
{
    var mutated=JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
    var row=mutated["groups"]![0]!;
    row[field]=field switch{"references" or "eligibleParts"=>new JsonArray("UNAPPROVED"),"actionable"=>JsonValue.Create(false),"requiredQuantity" or "requiredEach"=>JsonValue.Create(999),_=>JsonValue.Create("UNAPPROVED")};
    await Reject(async()=>{await service.Save(wo,SaveRequest(current,E(mutated)),actor);},"frozen requirement field rejected: "+field);
}
current=E(await service.Save(wo,SaveRequest(current,current.GetProperty("draft")),actor,true));
Check(current.GetProperty("editingSessionId").ValueKind==JsonValueKind.Null,"Save and Exit releases lease");
service=new SimKittingCases(state,ops,provider);
var reloaded=await Read();
Check(reloaded.GetProperty("caseId").GetString()==id&&reloaded.GetProperty("releasedBomIdentity").GetString()==release.ReleasedBomIdentity&&reloaded.GetProperty("draft").GetProperty("groups").GetArrayLength()==12,"service reload retains case, frozen release and requirements");
current=E(await service.Resume(wo,Version(reloaded),actor));
Check(current.GetProperty("editingSessionId").ValueKind==JsonValueKind.String,"Resume reacquires lease on same case");

// Execution examples below are confined to this disposable copy, never the live SIM.
var edited=JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
var opto=edited["groups"]![4]!;
opto["rowState"]="SUBMITTED";opto["revisionNumber"]=1;
opto["entry"]=JsonSerializer.SerializeToNode(new{method="COUNT",selectedPartNumber=(string?)null,purchaseOrder="",allocations=new[]{new{allocationId="A1",partNumber="SIM-OPTO-4",quantity=12m,purchaseOrder=""}},pickedQuantity=12m,shortageQuantity=8m,extraQuantity=0m,result="COUNTED_SHORT"},json);
await Reject(async()=>{await service.Save(wo,SaveRequest(current,E(edited)),actor);},"positive allocation requires PO evidence");
opto["entry"]!["allocations"]![0]!["purchaseOrder"]="ISOLATED-TEST-PO";
current=E(await service.Save(wo,SaveRequest(current,E(edited)),actor));
Check(current.GetProperty("completedCount").GetInt32()==1&&current.GetProperty("shortRequirementCount").GetInt32()==1&&current.GetProperty("totalShortage").GetDecimal()==8&&current.GetProperty("state").GetString()=="KITTING_IN_PROGRESS","isolated saved row retains 20 required, 12 counted, 8 short without final disposition");
service=new SimKittingCases(state,ops,provider);
Check((await Read()).GetProperty("draft").GetProperty("groups")[4].GetProperty("entry").GetProperty("pickedQuantity").GetDecimal()==12,"row evidence survives service reload");
var spoof=JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
spoof["groups"]![4]!["lastSubmittedBy"]="FORGED REVIEWER";spoof["groups"]![4]!["revisionNumber"]=999;
spoof["groups"]![4]!["entry"]!["evidenceOperator"]="FORGED REVIEWER";
current=E(await service.Save(wo,SaveRequest(current,E(spoof)),actor));
Check(current.GetProperty("draft").GetProperty("groups")[4].GetProperty("lastSubmittedBy").GetString()==actor.DisplayName&&current.GetProperty("draft").GetProperty("groups")[4].GetProperty("revisionNumber").GetInt32()!=999,"caller cannot forge row audit identity or revision");
var wrongTotals=JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
wrongTotals["groups"]![4]!["entry"]!["pickedQuantity"]=999;wrongTotals["groups"]![4]!["entry"]!["extraQuantity"]=999;wrongTotals["groups"]![4]!["entry"]!["shortageQuantity"]=0;
await Reject(async()=>{await service.Save(wo,SaveRequest(current,E(wrongTotals)),actor);},"incorrect claimed shortage rejected by shared rules");
wrongTotals["groups"]![4]!["entry"]!["shortageQuantity"]=8;
current=E(await service.Save(wo,SaveRequest(current,E(wrongTotals)),actor));
var canonicalCount=current.GetProperty("draft").GetProperty("groups")[4].GetProperty("entry");
Check(canonicalCount.GetProperty("pickedQuantity").GetDecimal()==12&&canonicalCount.GetProperty("shortageQuantity").GetDecimal()==8&&canonicalCount.GetProperty("extraQuantity").GetDecimal()==0,"server derives displayed count/short/extra from allocations");
await Reject(async()=>{await service.Submit(wo,SaveRequest(current,current.GetProperty("draft")),actor);},"incomplete case cannot submit");
service.UtcNow=()=>DateTimeOffset.UtcNow.AddMinutes(16);
await Reject(async()=>{await service.Save(wo,SaveRequest(current,current.GetProperty("draft")),actor);},"expired lease rejects saves");
current=E(await service.Resume(wo,Version(current),other));
Check(current.GetProperty("editingSessionId").ValueKind==JsonValueKind.String,"expired lease can be recovered");
current=E(await service.Abandon(wo,Editable(current),other));
Check(current.GetProperty("editingSessionId").ValueKind==JsonValueKind.Null,"Abandon releases lease and records compatible event");
var history=E(await service.History(wo,other));
Check(history.GetRawText().Contains("EDITING_ABANDONED")&&history.GetRawText().Contains("STALE_LEASE_RECOVERED")&&history.GetRawText().Contains("STARTED"),"append-only history retains start, stale recovery and abandonment");
Check(history.GetProperty("events").EnumerateArray().Count(e=>e.GetProperty("eventType").GetString()=="STARTED")==1,"duplicate Start appended no duplicate STARTED event");
current=E(await service.Resume(wo,Version(current),other));
var complete=JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
foreach(var node in complete["groups"]!.AsArray())
{
    node!["rowState"]="SUBMITTED";
    node["entry"]=JsonSerializer.SerializeToNode(new{method="COMPLETE",selectedPartNumber=node["partNumber"]!.ToString(),purchaseOrder="ISOLATED-TEST-PO",allocations=Array.Empty<object>(),pickedQuantity=(decimal?)null,shortageQuantity=0m,extraQuantity=(decimal?)null,result="COMPLETE"},json);
}
current=E(await service.Submit(wo,SaveRequest(current,E(complete)),other));
Check(current.GetProperty("state").GetString()=="KIT_COMPLETE"&&current.GetProperty("completedCount").GetInt32()==12&&current.GetProperty("editingSessionId").ValueKind==JsonValueKind.Null,"isolated future submission uses existing completion rules and releases lease");
var submissions=E(await service.Submissions(wo,other)).GetProperty("submissions");
Check(submissions.GetArrayLength()==1,"isolated submission creates one immutable report");
var submissionId=submissions[0].GetProperty("submissionId").GetGuid();
var pdf=await service.Pdf(wo,submissionId,other);
Check(System.Text.Encoding.ASCII.GetString(pdf.Bytes,0,5)=="%PDF-"&&Convert.ToHexString(SHA256.HashData(pdf.Bytes))==submissions[0].GetProperty("pdfSha256").GetString(),"isolated submitted PDF retrieves with matching integrity hash");
var fractionalReport=JsonNode.Parse(submissions[0].GetProperty("snapshotJson").GetString()!)!;
fractionalReport["draft"]!["groups"]![0]!["requiredQuantity"]=0.00001m;
Check(System.Text.Encoding.ASCII.GetString(KittingCasePdfWriter.Create(fractionalReport.ToJsonString())).Contains("0.00001"),"future PDF preserves meaningful quantities below 0.0001");
await Reject(async()=>{await service.Resume(wo,Version(current),other);},"completed case is read-only");
await using(var con=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=ops.DatabasePath,Pooling=false}.ToString()))
{
    await con.OpenAsync();
    foreach(var table in new[]{"SimKittingCaseEvent","SimKittingSubmission"})
    {
        await using var cmd=con.CreateCommand();cmd.CommandText=$"DELETE FROM {table};";
        try{await cmd.ExecuteNonQueryAsync();throw new Exception("Immutable evidence deletion unexpectedly allowed");}
        catch(SqliteException){Check(true,"database enforces immutable "+table);}
    }
}
checks+=await SimKittingTraceabilityAmendmentChecks.Run(repo,source);
foreach(var pair in sourceHashes)Check(Hash(Path.Combine(source,pair.Key))==pair.Value,"source checkpoint unchanged: "+pair.Key);
Console.WriteLine($"PASS {checks} checks; isolated state: {root}");
