using System.Text.Json;
internal static class InspectionSymbolTests
{
 internal static async Task Run(string repo)
 {

var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);
var camera=new SimDrawingCamera(1,.5,.5,1,1);
var legacy=new SimDrawingMark(Guid.NewGuid().ToString(),1,"circle",[new(.1,.1),new(.2,.2)]);
var before=JsonSerializer.Serialize(legacy,options);
var marks=new[]{"circle","triangle","square","diamond"}.SelectMany(s=>new[]{"inspection-"+s,"inspection-"+s+"-filled"}).Select(k=>new SimDrawingMark(Guid.NewGuid().ToString(),1,k,[new(.2,.2),new(.3,.35)],Color:"#1255cc",Thickness:.002)).Append(legacy).ToArray();
SimRfqIntakeStore.ValidateDrawingNotes(marks,camera);
var json=JsonSerializer.Serialize(marks,options);var file=Path.Combine(Path.GetTempPath(),"inspection-symbols-"+Guid.NewGuid().ToString("N")+".json");File.WriteAllText(file,json);
var reopened=JsonSerializer.Deserialize<SimDrawingMark[]>(File.ReadAllText(file),options)!;
if(JsonSerializer.Serialize(reopened,options)!=json||JsonSerializer.Serialize(reopened.Last(),options)!=before)throw new Exception("Roundtrip changed marks");
foreach(var invalid in new[]{marks[0] with{Kind="inspection-star"},marks[0] with{Points=[new(.2,.2)]},marks[0] with{Points=[new(.2,.2),new(.3,.3),new(.4,.4)]},marks[0] with{Points=[new(double.NaN,.2),new(.3,.3)]},marks[0] with{Color="red"},marks[0] with{Opacity=.5}}){try{SimRfqIntakeStore.ValidateDrawingNotes([invalid],camera);throw new Exception("Invalid symbol accepted");}catch(SimRfqIntakeProblem ex)when(ex.Code=="DRAWING_VALUES") {}}
Console.WriteLine("PASS: eight symbol kinds and legacy mark validate and file/JSON roundtrip; invalid kinds, geometry, colors and opacity rejected.");
// This fixture uses a private copy; no server, live annotation, or ERP is contacted.
{
 repo=Path.GetFullPath(repo);var root=Path.Combine(Path.GetTempPath(),"fixture-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
 var records=System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-intakes.json")))!;
 var record=records["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]=="RFQI-SIM-0036")!.DeepClone();
 var lane=System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-lanes.json")))!["RFQI-SIM-0036"]!.DeepClone();
 lane["labor"]!["status"]="IN_PROGRESS";lane["commercial"]=null;
 var correlation=(string)record["requestCorrelationId"]!;var document=(string)record["technicalReview"]!["workflow"]!["outputs"]!["manufacturing"]!["governingDocumentId"]!;
 var folder=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(folder);
 foreach(var ext in new[]{".json",".bin"})File.Copy(Path.Combine(repo,".sim-state/intake-documents",correlation,document+ext),Path.Combine(folder,document+ext));
 File.WriteAllText(Path.Combine(root,"data/rfq-intakes.json"),new System.Text.Json.Nodes.JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new System.Text.Json.Nodes.JsonArray(record)}.ToJsonString());
 File.WriteAllText(Path.Combine(root,"data/rfq-lanes.json"),new System.Text.Json.Nodes.JsonObject{["RFQI-SIM-0036"]=lane}.ToJsonString());
 var store=new SimRfqIntakeStore(root);var actor=new SimPersona("fixture","fixture","Isolated symbol fixture","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
 var context=await store.ReadDrawingNotes("RFQI-SIM-0036",actor);var step=context.Targets![0].Id;
 var request=new SimDrawingNotesRequest(0,context.LaborRevision,context.Source,marks,null,"marks","",Guid.NewGuid().ToString(),"Inspection symbols",[step],1);
 var saved=await store.SaveDrawingNotes("RFQI-SIM-0036",step,request,actor);
 var again=await new SimRfqIntakeStore(root).ReadDrawingNotes("RFQI-SIM-0036",actor);
 if(!again.InspectionSymbolsSupported||JsonSerializer.Serialize(again.Layers.Single().Layer.Marks,options)!=json)throw new Exception("Store reopen changed symbol styles");
 try{await store.SaveDrawingNotes("RFQI-SIM-0036",step,request,actor);throw new Exception("Stale save accepted");}catch(SimRfqIntakeProblem e)when(e.Code=="DRAWING_STALE"){}
 await store.SaveDrawingNotes("RFQI-SIM-0036",step,request with{ExpectedRevision=saved.Revision,Action="view",Marks=null,SavedView=new(1,.4,.4,.5,.5,90)},actor);
 var after=await new SimRfqIntakeStore(root).ReadDrawingNotes("RFQI-SIM-0036",actor);if(JsonSerializer.Serialize(after.Layers.Single().Layer.Marks,options)!=json)throw new Exception("View save changed symbols");
 await InspectionLinkTests.Run(store,root,"RFQI-SIM-0036",actor);
 Console.WriteLine("PASS: actual store save/reopen preserves all eight symbols and legacy mark; stale write rejected; saved camera preserves marks. Isolated fixture only.");
}


 }
}
