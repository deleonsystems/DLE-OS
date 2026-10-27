using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;

if (args.Length == 2 && args[0] == "--reparse")
{
    var roots = new SimDrawingFolders(JsonSerializer.Serialize(new[]{new SimDrawingRoot("drawings","Synthetic",args[1])}));
    if (roots.Browse("drawings","").Entries.Any(e=>e.Name=="linked")) throw new Exception("Junction exposed in listing");
    try { roots.Browse("drawings","linked"); throw new Exception("Junction traversal allowed"); }
    catch(SimRfqIntakeProblem p) when(p.Code=="SIM_DRAWING_FOLDER_LINK") {}
    var linkedRoot = new SimDrawingFolders(JsonSerializer.Serialize(new[]{new SimDrawingRoot("drawings","Synthetic",Path.Combine(args[1],"linked"))}));
    try { linkedRoot.Browse("drawings",""); throw new Exception("Junction root allowed"); }
    catch(SimRfqIntakeProblem p) when(p.Code=="SIM_DRAWING_FOLDER_LINK") {}
    Console.WriteLine("PASS junction omitted, direct junction traversal rejected, junction configured root rejected"); return;
}
var fixture = Path.GetFullPath(args.Single());
if (!Directory.Exists(fixture) || Directory.EnumerateFileSystemEntries(fixture).Any()) throw new Exception("Supply a new, empty synthetic fixture directory.");
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
void Check(bool value, string label) { if (!value) throw new Exception(label); Console.WriteLine("PASS " + label); }
async Task Reject(Func<Task> operation, string label) { try { await operation(); } catch(SimRfqIntakeProblem) { Console.WriteLine("PASS "+label); return; } throw new Exception(label); }
var root = Path.Combine(fixture,"source"); var job = Path.Combine(root,"Customer","Assembly","Rev A");
Directory.CreateDirectory(job); File.WriteAllText(Path.Combine(job,"drawing.txt"),"synthetic drawing bytes");
var before = SHA256.HashData(File.ReadAllBytes(Path.Combine(job,"drawing.txt")));
string Configuration(string path) => JsonSerializer.Serialize(new[]{new SimDrawingRoot("drawings","Company drawings",path)},options);
var sources = new SimDrawingFolders(Configuration(root));
Check(new SimDrawingFolders(null).Choices().Length == 0,"unconfigured roots default empty");
foreach(var p in new[]{"../escape","/absolute","C:/escape","a\\b","a//b","a/../b","a:stream","a.","a ","CON","a/COM1.txt","a\0b"})
    await Reject(()=>{sources.Browse("drawings",p);return Task.CompletedTask;},"reject path "+p.Replace('\0','?'));
await Reject(()=>{sources.Browse("unknown","");return Task.CompletedTask;},"unknown root rejected");
await Reject(()=>{new SimDrawingFolders("[{\"id\":\"bad id\",\"label\":\"x\",\"path\":\"relative\"}]");return Task.CompletedTask;},"invalid configuration rejected");
var listing=sources.Browse("drawings","Customer/Assembly/Rev A");
Check(listing.Entries.Single().Name=="drawing.txt"&&!listing.Entries[0].IsDirectory,"selected directory contents listed without file reads");
Check(!JsonSerializer.Serialize(listing,options).Contains(root,StringComparison.OrdinalIgnoreCase),"physical root absent from browser contract");
var many=Path.Combine(root,"many");Directory.CreateDirectory(many);for(var i=0;i<205;i++)File.WriteAllText(Path.Combine(many,$"{i:D3}.txt"),"");
var bounded=sources.Browse("drawings","many");Check(bounded.Truncated&&bounded.Entries.Length==200,"bounded 200-entry listing");
// Junction test is performed by the runner after this fixture phase via --reparse.
var state=Path.Combine(fixture,"state");Directory.CreateDirectory(Path.Combine(state,"data"));
var dataPath=Path.Combine(state,"data","rfq-intakes.json");
var record=JsonSerializer.Deserialize<SimRfqIntakeRecord>("""
{"intakeId":"RFQI-SIM-9001","requestCorrelationId":"synthetic-only","schema":"DLE_RFQ_INTAKE_V1","handoffTarget":"Technical Review","status":"READY_FOR_RFQ_QUALIFICATION","intakeType":"NEW_QUOTE_REQUEST","customer":{"customerId":"fixture","customerNumber":"990999","customerName":"Synthetic Customer","resolutionSource":"fixture"},"assemblyCount":2,"assemblies":[{"lineNumber":1,"assemblyNumber":"TEST-A","revision":"A","quantity":2},{"lineNumber":2,"assemblyNumber":"TEST-B","revision":"B","quantity":3}],"deLeonScope":"MATERIAL_AND_LABOR","technicalFilesProvided":false,"technicalFiles":[],"documentPreservationState":"NOT_PROVIDED","customerRequirements":["PRICE"],"createdBy":"Fixture","createdAtUtc":"2026-01-01T00:00:00Z","scenarioId":"fixture","generation":1,"environment":"SIM","technicalReview":{"reviewType":"RFQ_REVIEW","assemblyType":"","assemblyDrawingFile":"","bomFile":"","gerbersRequired":false,"gerberFiles":[],"subAssemblyDocuments":[],"materialResponsibility":"","customerSuppliedItems":[],"technicalPackageSufficient":false,"disposition":"READY_FOR_RFQ_QUALIFICATION","reviewStatus":"READY_FOR_RFQ_QUALIFICATION","reviewedBy":"","reviewedAtUtc":"2026-01-01T00:00:00Z","reviewerNotes":"preserve this"}}
""",options)!;
var unrelated=record with { IntakeId="RFQI-SIM-9002" };
async Task WriteRecords(params SimRfqIntakeRecord[] records) => await File.WriteAllTextAsync(dataPath,JsonSerializer.Serialize(new {schema="DLE_RFQ_INTAKE_DATASET_V1",version=1,lastIntakeSequence=9002,updatedAtUtc=DateTimeOffset.UtcNow,records},options));
await WriteRecords(record,unrelated);
var store=new SimRfqIntakeStore(state);
var actor=new SimPersona("fixture","fixture","Fixture Reviewer","ACTIVE",[],["technical_review.disposition"],false,"test");
async Task<string> Token(int line) => JsonSerializer.SerializeToElement(await store.ReadDrawingFolder(record.IntakeId,line),options).GetProperty("token").GetString()!;
var token=await Token(1);
var request=new SimDrawingFolderRequest(1,token,"drawings","Customer/Assembly/Rev A");
var association=await store.SaveDrawingFolder(record.IntakeId,request,actor,sources);
Check(association.CustomerId=="fixture"&&association.AssemblyNumber=="TEST-A"&&association.Revision=="A"&&association.LinkedBy=="Fixture Reviewer","saved reviewer and assembly context");
await Reject(async()=>{await store.SaveDrawingFolder(record.IntakeId,request,actor,sources);},"stale save rejected");
var reloaded=new SimRfqIntakeStore(state);
Check(JsonSerializer.SerializeToElement(await reloaded.ReadDrawingFolder(record.IntakeId,1),options).GetProperty("association").GetProperty("id").GetString()==association.Id,"association survives store reload");
var dataset=JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;
var saved=dataset["records"]![0]!.Deserialize<SimRfqIntakeRecord>(options)!;
Check(JsonSerializer.Serialize(saved with {DrawingFolders=null},options)==JsonSerializer.Serialize(record,options),"all existing target-record fields preserved");
Check(dataset["records"]![1]!.ToJsonString()==JsonSerializer.SerializeToNode(unrelated,options)!.ToJsonString(),"unrelated record preserved");
await store.SaveDrawingFolder(record.IntakeId,new(2,await Token(2),"drawings","Customer"),actor,sources);
Check(JsonSerializer.SerializeToElement(await store.ReadDrawingFolder(record.IntakeId,1),options).GetProperty("association").GetProperty("id").GetString()==association.Id,"second assembly link does not change first");
var changed=await store.SaveDrawingFolder(record.IntakeId,new(1,await Token(1),"drawings","Customer/Assembly"),actor,sources);
Check(changed.RelativePath=="Customer/Assembly","explicit change folder saves");
var moved=Path.Combine(fixture,"nas");Directory.Move(root,moved);
Check(new SimDrawingFolders(Configuration(moved)).Browse(changed.RootId,changed.RelativePath).Entries.Any(e=>e.Name=="Rev A"),"same association resolves after configured root migration");
Check(before.SequenceEqual(SHA256.HashData(File.ReadAllBytes(Path.Combine(moved,"Customer","Assembly","Rev A","drawing.txt")))),"source file bytes unchanged");
await WriteRecords(record with {Status="READY_FOR_RFQ_WORKING_QUEUE"},unrelated);
await Reject(async()=>{await store.SaveDrawingFolder(record.IntakeId,new(1,await Token(1),"drawings",""),actor,new SimDrawingFolders(Configuration(moved)));},"completed review cannot change association");
await WriteRecords(record with {Environment="DEV"},unrelated);
await Reject(async()=>{await store.SaveDrawingFolder(record.IntakeId,new(1,await Token(1),"drawings",""),actor,new SimDrawingFolders(Configuration(moved)));},"non-SIM record cannot change association");
Console.WriteLine("PASS synthetic persistence and security checks; no active SIM state used");
await LinkedFileChecks.Run(fixture,dataPath,saved,actor,new SimDrawingFolders(Configuration(moved)));
await RemovalChecks.Run(fixture,dataPath,actor);
