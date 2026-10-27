using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;

var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
if(args.Length==2&&args[0]=="--inspect-format"){
    // Explicit read-only diagnostic: actual bytes remain in memory, no store writes or identity reconciliation.
    var diagnosticBytes=await File.ReadAllBytesAsync(args[1]);var hash=SHA256.HashData(diagnosticBytes);var identity=SimVproParser.Describe(diagnosticBytes);
    var split=identity.Drawing.LastIndexOf(" REV ",StringComparison.Ordinal);
    if(split<0)throw new Exception("Literal source identity has no REV separator.");
    var parsed=SimVproParser.Parse(diagnosticBytes,"format-diagnostic",identity.Drawing[..split],identity.Drawing[(split+5)..],"Read-only format diagnostic");
    Check(parsed.VproImport!.RawRows.Length>0&&parsed.VproImport.SourceNotes!.Length>0,"actual saved format parsed in memory under its own literal identity (not mapped to any job)");
    Console.WriteLine($"Rows={parsed.Rows.Length}; notes={parsed.VproImport.SourceNotes!.Length}; decimalFinds={parsed.Rows.Count(r=>r.Values["lineNumber"].Contains('.'))}; NOB={parsed.Rows.Count(r=>r.Values["lineNumber"]=="NOB")}");
    Check(hash.SequenceEqual(SHA256.HashData(await File.ReadAllBytesAsync(args[1]))),"actual source bytes unchanged; no record or candidate persisted");return;
}
var fixture=Path.GetFullPath(args.Single());if(!Directory.Exists(fixture)||Directory.EnumerateFileSystemEntries(fixture).Any())throw new Exception("Supply a new empty synthetic fixture directory.");
string Row(params string[] fields)=>string.Join('\t',fields);
var text=string.Join('\n',new[]{Row([..SimVproParser.Headers," / DRAW#=TEST-A REV A* / SYN="]),
    Row("001","","*** DRAWING: TEST-A REV A-ECR123 ***","","1","0","  ","0","0","0","0","",""),
    Row("002","","","","1","0","  ","0","0","0","0","",""),
    Row("003","ITEM-1","Fixture component","ALIAS","1","2","EA","1","0","0","0","",""),
    Row("004","ALT-1","Fixture alternate","ALTALIAS","10",".0001","EA","1","0","0","0","",""),
    Row("005","","(18.1)J2","","1","0","  ","0","0","0","0","",""),
    Row("006","SPACER","Fixture spacer","","1","10","EA","1","0","0","0","",""),
    Row("007","","(NOB)FOR J2 (x2/EA) FOR PROPER HEIGHT INSTALL","","1","0","  ","0","0","0","0","","")});
var bytes=Encoding.ASCII.GetBytes(text);var correlation=Guid.NewGuid().ToString("D");var storeRoot=Path.Combine(fixture,"state");Directory.CreateDirectory(Path.Combine(storeRoot,"data"));
var documents=new SimIntakeDocuments(storeRoot);var actor=new SimPersona("fixture","fixture","Fixture Reviewer","ACTIVE",[],["technical_review.disposition"],false,"test");
var pdf=await documents.Stage(correlation,"fixture.pdf",0,new MemoryStream(Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF")),actor.DisplayName);
var txt=await documents.Stage(correlation,"fixture.txt",0,new MemoryStream(bytes),actor.DisplayName);
var r=JsonSerializer.Deserialize<SimRfqIntakeRecord>("""
{"intakeId":"RFQI-SIM-9001","requestCorrelationId":"","schema":"DLE_RFQ_INTAKE_V1","handoffTarget":"Technical Review","status":"ON_HOLD","intakeType":"NEW_QUOTE_REQUEST","customer":{"customerId":"fixture","customerNumber":"990999","customerName":"Synthetic","resolutionSource":"fixture"},"assemblyCount":1,"assemblies":[{"lineNumber":1,"assemblyNumber":"TEST-A","revision":"A (ECR123)","quantity":29}],"deLeonScope":"MATERIAL_AND_LABOR","technicalFilesProvided":true,"technicalFiles":[],"documentPreservationState":"PRESERVED","customerRequirements":[],"createdBy":"Fixture Reviewer","createdAtUtc":"2026-01-01T00:00:00Z","scenarioId":"fixture","generation":1,"environment":"SIM","technicalReview":{"reviewType":"RFQ_REVIEW","assemblyType":"","assemblyDrawingFile":"","bomFile":"","gerbersRequired":false,"gerberFiles":[],"subAssemblyDocuments":[],"materialResponsibility":"","customerSuppliedItems":[],"technicalPackageSufficient":false,"disposition":"ON_HOLD","reviewStatus":"ON_HOLD","reviewedBy":"","reviewedAtUtc":"2026-01-01T00:00:00Z","reviewerNotes":"preserve","workflow":{"holdReason":"identity unresolved"}}}
""",json)!;
r=r with{RequestCorrelationId=correlation,TechnicalFiles=[pdf,txt]};r=r with{TechnicalReview=r.TechnicalReview! with{TechnicalPackage=SimTechnicalPackageProvider.Inventory(r)}};
var unrelated=r with{IntakeId="RFQI-SIM-9002",TechnicalFiles=[]};var dataPath=Path.Combine(storeRoot,"data","rfq-intakes.json");
async Task Write(SimRfqIntakeRecord record)=>await File.WriteAllTextAsync(dataPath,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",version=1,lastIntakeSequence=9002,updatedAtUtc=DateTimeOffset.UtcNow,records=new[]{record,unrelated},analysisJobs=Array.Empty<DleAnalysisJob>()},json));
await Write(r);var store=new SimRfqIntakeStore(storeRoot);
async Task<SimRfqIntakeRecord> Read()=>JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
async Task<JsonElement> View(string? drawing=null,string? bom=null)=>JsonSerializer.SerializeToElement(await store.ReadReviewSources(r.IntakeId,drawing??pdf.DocumentId,bom??txt.DocumentId),json);
SimReviewSourceRequest Request(JsonElement v,string action,bool confirm=false,string? reason=null)=>new(v.GetProperty("token").GetString()!,pdf.DocumentId,txt.DocumentId,action,v.GetProperty("sourceToken").GetString(),confirm,reason);
async Task Reject(Func<Task> operation,string label){var before=await File.ReadAllBytesAsync(dataPath);try{await operation();throw new Exception(label+" allowed");}catch(SimRfqIntakeProblem){Check(before.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),label+"; data unchanged");}}
var view=await View();Check(!view.GetProperty("sourceMatches").GetBoolean(),"literal identity mismatch exposed");
await store.SaveReviewSources(r.IntakeId,new(view.GetProperty("token").GetString()!,pdf.DocumentId,null,"SAVE_DRAFT"),actor);
var draft=await Read();Check(draft.Status=="ON_HOLD"&&draft.TechnicalReview!.Workflow!.HoldReason=="identity unresolved"&&draft.TechnicalReview.CandidateBom is null,"partial draft save preserves hold and creates no candidate");
Check(JsonSerializer.Serialize(draft with{ReviewSourceSetup=null},json)==JsonSerializer.Serialize(r,json),"draft only changes source-setup metadata; all decisions/classifications retained");
store=new SimRfqIntakeStore(storeRoot);Check((await Read()).ReviewSourceSetup!.Current.DrawingDocumentId==pdf.DocumentId,"draft survives reopen");
await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(view,"SAVE_DRAFT"),actor),"stale draft rejected");
view=await View();await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(view,"BUILD"),actor),"mismatch without explicit confirmation rejected");
await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(view,"BUILD",true,""),actor),"empty identity reason rejected");
await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(view,"BUILD",true,"fixture confirmation") with{ExpectedSourceToken="stale"},actor),"stale exact source token rejected");
await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(view,"SAVE_DRAFT"),actor with{Permissions=[]}),"disposition permission enforced");
await store.SaveReviewSources(r.IntakeId,Request(view,"BUILD",true,"Fixture-only explicit applicability reconciliation"),actor);
var built=await Read();var bom=built.TechnicalReview!.CandidateBom!;
Check(built.Status=="TECHNICAL_REVIEW_IN_PROGRESS"&&bom.Rows.Length==2,"explicit build resumes held review and creates candidate");
Check(bom.Rows[0].Values["lineNumber"]=="18.1"&&bom.Rows[1].Values["lineNumber"]=="NOB"&&bom.Rows[1].Values["quantity"]=="10","decimal Finds and NOB component quantity preserved without job multiplication");
Check(bom.VproImport!.SourceNotes!.Any(n=>n.Kind=="DRAWING_NOTE")&&bom.VproImport.SourceNotes!.Any(n=>n.Kind=="SEPARATOR")&&bom.VproImport.SourceNotes!.Any(n=>n.Kind=="NOB_INSTALLATION"&&n.ComponentSequence=="006"),"notes and separators retained separately with component evidence");
Check(bom.VproImport.IdentityConfirmation?.Sha256==DleAnalysisContract.Hash(bytes)&&bom.VproImport.BaselineDecision is null&&built.TechnicalReview.BomAcceptances is null,"identity confirmation bound to hash; no baseline/BOM acceptance");
Check(bom.Rows.All(x=>!x.ReviewState.Reviewed)&&bom.Rows[0].Alternates![0].ReviewStatus=="PROPOSED","rows and alternates remain unreviewed");
Check(JsonSerializer.Serialize(built.TechnicalReview.TechnicalPackage,json)==JsonSerializer.Serialize(r.TechnicalReview!.TechnicalPackage,json),"PDF PN classification not required or changed for TXT draft");
await Reject(async()=>{await store.CompleteBomReview(r.IntakeId,new(bom),actor);},"final acceptance remains blocked until human reviews");
var snapshot=await File.ReadAllBytesAsync(dataPath);await store.SaveReviewSources(r.IntakeId,Request(await View(),"BUILD",true,"Fixture retry"),actor);Check(snapshot.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),"retry same built sources reuses candidate without duplicate writes");
var newTxt=await documents.Stage(correlation,"replacement.txt",0,new MemoryStream(bytes),actor.DisplayName);await Write(built with{TechnicalFiles=built.TechnicalFiles.Append(newTxt).ToArray()});
var replacement=await View(pdf.DocumentId,newTxt.DocumentId);await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(replacement,"BUILD",true,"Fixture replacement") with{BomDocumentId=newTxt.DocumentId},actor),"replacement requires deliberate confirmation");
await store.SaveReviewSources(r.IntakeId,Request(replacement,"BUILD",true,"Fixture replacement") with{BomDocumentId=newTxt.DocumentId,ReplaceCandidate=true},actor);
var replaced=await Read();Check(replaced.TechnicalReview!.CandidateBomVersions!.Any(v=>v.Id==bom.Id)&&replaced.TechnicalFiles.Any(f=>f.DocumentId==txt.DocumentId),"replacement retains old candidate and original saved copy");
var data=JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;Check(data["records"]![1]!.ToJsonString()==JsonSerializer.SerializeToNode(unrelated,json)!.ToJsonString(),"unrelated record preserved");
Check((await documents.Bytes(correlation,txt.DocumentId!)).SequenceEqual(bytes),"source snapshot bytes retained");
void RejectParse(string input, string label,SimVproIdentityConfirmation? identity=null){try{SimVproParser.Parse(Encoding.ASCII.GetBytes(input),"format","TEST-A","A*","Fixture",identity);throw new Exception(label+" allowed");}catch(SimRfqIntakeProblem){Check(true,label);}}
var varied=text.Replace(Row("005","","(18.1)J2"),Row("0041","ALT-2","Second fixture alternate","","10",".0001","  ",".0001","0","0","0","","")+"\n"+Row("005","","(18.1)J2"))+"\n"+Row("008","DO NOT POPULATE","PLACE HOLDER FOR DNP PARTS","DO NOT POPULATE","10",".0001","EA","1","0","0","0","","")+"\n"+Row("009","","(20) EMPTY","","1","0","  ","0","0","0","0","","");
var variedBom=SimVproParser.Parse(Encoding.ASCII.GetBytes(varied),"format","TEST-A","A*","Fixture");
Check(variedBom.Rows[0].Alternates!.Length==2&&variedBom.Rows[0].Alternates![1].SourceContext!.Contains("unit literal [  ]")&&variedBom.Rows[0].Alternates!.All(a=>a.ReviewStatus=="PROPOSED"),"two suppressed alternates retain blank unit/factor literally; no approval");
Check(variedBom.Rows[2].ComponentType=="DNP"&&!variedBom.Rows[2].ReviewState.Reviewed&&variedBom.VproImport!.SourceNotes!.Any(n=>n.Kind=="DNP_PLACEHOLDER"),"exact DNP placeholder remains visible, unreviewed, and documented");
RejectParse(text.Replace("(18.1)J2","Unexplained continuation"),"ambiguous component grouping rejected");
RejectParse(text.Replace("ALTALIAS\t10\t.0001","ALTALIAS\t10\t1"),"unsuppressed extra component not inferred as alternate");
RejectParse(text.Replace("\t(18.1)J2\t\t1\t0","\t(18.1)J2\t\t1\t2"),"nonzero note quantity rejected");
var forged=new SimVproIdentityConfirmation("format","wrong-hash","TEST-A REV B","TEST-A","A*","Fixture","Fixture",DateTimeOffset.UtcNow);
RejectParse(text.Replace("TEST-A REV A*","TEST-A REV B"),"forged identity hash rejected",forged);
await Write(replaced with{TechnicalReview=replaced.TechnicalReview! with{BomAcceptances=[new(1,replaced.TechnicalReview!.CandidateBom!,replaced.TechnicalReview.TechnicalPackage!,"Fixture",DateTimeOffset.UtcNow)]}});
var acceptedView=await View();await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(acceptedView,"BUILD",true,"Fixture") with{ReplaceCandidate=true},actor),"accepted BOM cannot be replaced");
await Write(replaced with{TechnicalReview=replaced.TechnicalReview! with{PresentationDraft=replaced.TechnicalReview!.PresentationDraft! with{ProductionAcceptances=[new("accepted",1,"fixture","Fixture",DateTimeOffset.UtcNow)]}}});
var slidesView=await View();await Reject(()=>store.SaveReviewSources(r.IntakeId,Request(slidesView,"BUILD",true,"Fixture") with{ReplaceCandidate=true},actor),"accepted production slides cannot be replaced");
await Write(replaced);var concurrentView=await View();async Task<bool> ConcurrentSave(){try{await store.SaveReviewSources(r.IntakeId,Request(concurrentView,"SAVE_DRAFT"),actor);return true;}catch(SimRfqIntakeProblem){return false;}}
var results=await Task.WhenAll(ConcurrentSave(),ConcurrentSave());Check(results.Count(x=>x)==1,"concurrent saves serialize and reject stale overwrite");
Console.WriteLine("PASS synthetic source setup end-to-end; no active business state used");
