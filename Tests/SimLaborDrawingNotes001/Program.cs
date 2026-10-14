using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
if(args.Contains("--exclusions")){await ExclusionTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--bom")){await BomSlideTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--organizer")){await OrganizerTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--slides")){await SlideTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--pages")){await PageTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--roles")){await RoleTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--shapes")){await ShapeTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--text-transforms")){await TextTransformTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--layers")){await SharedLayerTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Contains("--revision-fixture")){await LaborRevisionTests.Run(Path.GetFullPath(args[0]),true);return;}
if(args.Contains("--revisions")){await LaborRevisionTests.Run(Path.GetFullPath(args[0]));return;}
if(args.Length>1&&args[1]=="--bridge"){
 var opt=new JsonSerializerOptions(JsonSerializerDefaults.Web);var input=JsonNode.Parse(Console.In.ReadToEnd())!;var api=new SimRfqIntakeStore(args[0]);var persona=new SimPersona("bridge","bridge","Isolated Browser Author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
 try{object output=(string?)input["action"] switch{
 "visual"=>await api.StageLaborVisual((string)input["id"]!,input["request"]!["metadata"]!.Deserialize<SimLaborVisualUpload>(opt)!,"browser-fixture.png",new MemoryStream(Convert.FromBase64String((string)input["request"]!["bytes"]!)),persona),
 "labor"=>await api.ReadLabor((string)input["id"]!),
 "revise"=>await api.ReviseLabor((string)input["id"]!,input["request"]!.Deserialize<SimLaborReviseRequest>(opt)!,persona),
 "labor-save"=>await api.SaveLabor((string)input["id"]!,input["request"]!.Deserialize<SimLaborRequest>(opt)!,persona),
 "save"=>await api.SaveDrawingNotes((string)input["id"]!,(string)input["step"]!,input["request"]!.Deserialize<SimDrawingNotesRequest>(opt)!,persona),
 "page"=>new {image=Convert.ToBase64String(await api.DrawingNotesPage((string)input["id"]!,(string)input["documentId"]!,(string)input["sha256"]!,(int)input["page"]!,persona))},
 _=>await api.ReadDrawingNotes((string)input["id"]!,persona,(int?)input["version"])};Console.WriteLine(JsonSerializer.Serialize(output,opt));}
 catch(SimRfqIntakeProblem e){Console.WriteLine(JsonSerializer.Serialize(new{error=true,message=e.Message,code=e.Code},opt));}
 return;
}
var repo=Path.GetFullPath(args[0]);var root=Path.Combine(repo,"tmp/labor-drawing-notes/test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem p){Check(p.Code==code,code);}}
var dataset=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-intakes.json")))!;
var fixtureRecord=dataset["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]=="RFQI-SIM-0036")!.DeepClone();
var id=(string)fixtureRecord["intakeId"]!;var correlation=(string)fixtureRecord["requestCorrelationId"]!;
var lane=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-lanes.json")))![id]!.DeepClone();lane["labor"]!["status"]="IN_PROGRESS";
var docid=(string)fixtureRecord["technicalReview"]!["workflow"]!["outputs"]!["manufacturing"]!["governingDocumentId"]!;
var folder=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(folder);
foreach(var ext in new[]{".json",".bin"})File.Copy(Path.Combine(repo,".sim-state/intake-documents",correlation,docid+ext),Path.Combine(folder,docid+ext));
var original=SHA256.HashData(File.ReadAllBytes(Path.Combine(folder,docid+".bin")));
var dataPath=Path.Combine(root,"data/rfq-intakes.json");var lanePath=Path.Combine(root,"data/rfq-lanes.json");
async Task Write(){await File.WriteAllTextAsync(dataPath,new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new JsonArray(fixtureRecord.DeepClone())}.ToJsonString());await File.WriteAllTextAsync(lanePath,new JsonObject{[id]=lane.DeepClone()}.ToJsonString());}
await Write();var sourceBefore=File.ReadAllBytes(dataPath);var laborBefore=File.ReadAllBytes(lanePath);
var author=new SimPersona("test","test","Isolated Author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");var viewer=author with{Permissions=["technical_review.view"]};
var store=new SimRfqIntakeStore(root);var view=await store.ReadDrawingNotes(id,author);
var ops=lane["laborQuote"]!["operations"]!.AsArray();var step=(string)ops[0]!["id"]!;var child=(string)ops.First(n=>n!["parentId"] is not null)!["id"]!;
var mark=new SimDrawingMark(Guid.NewGuid().ToString(),1,"arrow",[new(.2,.3),new(.4,.5)]);
var req=new SimDrawingNotesRequest(0,view.LaborRevision,view.Source,[mark],null,"marks","Author step note");
await Reject(()=>store.SaveDrawingNotes(id,step,req,viewer),"DRAWING_DENIED");
await Reject(()=>store.ReadDrawingNotes(id,viewer with{Permissions=[]}),"DRAWING_DENIED");
var first=await store.SaveDrawingNotes(id,step,req,author);Check(first.Revision==1&&first.SavedView.Width==1,"marks persisted with default opening view");
var camera=new SimDrawingCamera(2,.3,.4,.25,.4,90);
var second=await store.SaveDrawingNotes(id,step,req with{ExpectedRevision=1,Action="view",Marks=null,SavedView=camera},author);Check(second.Marks.Length==1&&second.SavedView==camera&&second.Note=="Author step note","explicit Save view preserves marks");
var third=await store.SaveDrawingNotes(id,step,req with{ExpectedRevision=2,SavedView=new(1,.8,.8,.1,.1)},author);Check(third.SavedView==camera,"Save notes ignores casual camera");
await store.SaveDrawingNotes(id,child,req,author);
var reopened=await new SimRfqIntakeStore(root).ReadDrawingNotes(id,author);Check(reopened.Layers.Length==2&&reopened.Layers.Single(x=>x.Layer.StepId==step).Layer.SavedView==camera,"disk reopen preserves operation and child layers");
await Reject(()=>store.SaveDrawingNotes(id,step,req,author),"DRAWING_STALE");await Reject(()=>store.SaveDrawingNotes(id,"new-step",req,author),"DRAWING_STEP");
await Reject(()=>store.SaveDrawingNotes(id,step,req with{ExpectedLaborRevision=-1},author),"DRAWING_SOURCE_CHANGED");
await Reject(()=>store.SaveDrawingNotes(id,step,req with{ExpectedRevision=3,Marks=[mark with{Points=[new(double.NaN,0),new(.3,.4)]}]},author),"DRAWING_VALUES");
await Reject(()=>store.DrawingNotesPage(id,docid,"wrong",1,viewer),"DRAWING_SOURCE_CHANGED");
Check(File.ReadAllBytes(dataPath).SequenceEqual(sourceBefore)&&File.ReadAllBytes(lanePath).SequenceEqual(laborBefore),"annotation writes leave Labor and intake byte-identical");
var moved=ops[0]!.DeepClone();ops.RemoveAt(0);ops.Add(moved);await Write();Check((await store.ReadDrawingNotes(id,viewer)).Layers.Single(x=>x.Layer.StepId==step).Layer.SavedView==camera,"stable association after reorder");
lane["labor"]!["status"]="COMPLETE";await Write();Check(!(await store.ReadDrawingNotes(id,author)).CanEdit,"completed plan read-only");await Reject(()=>store.SaveDrawingNotes(id,step,req with{ExpectedRevision=3},author),"DRAWING_COMPLETE");
fixtureRecord["assemblies"]![0]!["revision"]="TEST-NEW";await Write();Check((await store.ReadDrawingNotes(id,viewer)).Layers.All(x=>x.ReviewRequired),"revision change flags review");
fixtureRecord["assemblies"]![0]!["revision"]=view.Source.Revision;fixtureRecord["technicalReview"]!["workflow"]!["outputs"]!["manufacturing"]!["id"]="TEST-NEW-DEFINITION";await Write();Check((await store.ReadDrawingNotes(id,viewer)).Layers.All(x=>x.ReviewRequired),"definition change retains historical layers");
Check(SHA256.HashData(File.ReadAllBytes(Path.Combine(folder,docid+".bin"))).SequenceEqual(original),"source drawing unchanged");

lane["labor"]!["status"]="IN_PROGRESS";fixtureRecord["technicalReview"]!["workflow"]!["outputs"]!["manufacturing"]!["id"]=view.Source.DefinitionId;await Write();
await File.WriteAllTextAsync(Path.Combine(repo,"tmp/labor-drawing-notes/bridge-fixture.json"),JsonSerializer.Serialize(new{root,id,step,child}));
