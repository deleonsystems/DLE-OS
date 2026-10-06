using System.Text.Json;
using System.Text.Json.Nodes;
internal static class ShapeTests
{
 internal static async Task Run(string repo) {
  await LaborRevisionTests.Run(repo,true);
  var fixture=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json")))!;
  var root=(string)fixture["root"]!;var id=(string)fixture["id"]!;var store=new SimRfqIntakeStore(root);
  var author=new SimPersona("shape-test","shape-test","Fixture Author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  var before=await store.ReadLabor(id);var history=JsonSerializer.Serialize(before.Plan.Versions);
  var labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),before.Plan.Revision,4,"Isolated shapes trial"),author);
  var manifest=await store.ReadDrawingNotes(id,author);var step=labor.Plan.Operations[0].Id;
  void Check(bool value,string message){if(!value)throw new Exception(message);Console.WriteLine("PASS: "+message);}
  var marks=new[]{"line","arrow","box","circle","callout","polygon","cloud","polyline"}.Select(kind=>new SimDrawingMark(Guid.NewGuid().ToString(),1,kind,kind is "polygon" or "polyline"?[new(.2,.2),new(.5,.3),new(.4,.6)]:[new(.3,.3),new(.6,.6)],kind=="callout"?"Synthetic callout":"",Thickness:.00005,FontSize:kind=="callout"?.0005:null,TextRotation:kind=="callout"?25:null,CompactCallout:kind=="callout"?true:null)).ToArray();
  var legacy=new SimDrawingMark(Guid.NewGuid().ToString(),1,"text",[new(.1,.1)],"Legacy");
  var request=new SimDrawingNotesRequest(0,labor.Plan.Revision,manifest.Source,[..marks,legacy],null,"marks","Preserved note",Guid.NewGuid().ToString(),"Shape fixture",[step]);
  var saved=await store.SaveDrawingNotes(id,step,request,author);
  var reopened=await new SimRfqIntakeStore(root).ReadDrawingNotes(id,author);
  Check(reopened.ZoomSizedShapes&&reopened.BasicShapes&&JsonSerializer.Serialize(reopened.Layers.Single().Layer.Marks)==JsonSerializer.Serialize(request.Marks),"eight shapes, callout transforms and legacy text round-trip unchanged");
  var invalid=new[]{marks[0] with{Points=[new(.1,.1)]},marks[3] with{Points=[new(.1,.1),new(.3,.3),new(.5,.5)]},marks[4] with{Text=""},marks[5] with{Points=[new(.1,.1),new(.2,.2)]},marks[6] with{Points=[new(-.1,.2),new(.5,.5)]},marks[0] with{FontSize=.03}};
  foreach(var mark in invalid){try{await store.SaveDrawingNotes(id,step,request with{ExpectedRevision=saved.Revision,Marks=[mark]},author);throw new Exception("Expected rejection");}catch(SimRfqIntakeProblem e){Check(e.Code=="DRAWING_VALUES","invalid shape rejected");}}
  var token=reopened.DrawingContentToken;
  await store.SaveDrawingNotes(id,step,request with{ExpectedRevision=saved.Revision,Action="view",Marks=null,SavedView=new(1,.4,.4,.6,.6,90)},author);
  Check((await store.ReadDrawingNotes(id,author)).DrawingContentToken==token,"Save View preserves shape content token");
  Check(JsonSerializer.Serialize((await store.ReadLabor(id)).Plan.Versions)==history,"existing completed versions unchanged");
  labor=await store.ReadLabor(id);var completed=await store.SaveLabor(id,new(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Quantity,labor.Plan.Operations,labor.Plan.Rate,labor.Plan.Markup,true,"LABOR_BATCH_ALLOCATION_V6",1,1,labor.Plan.Charges,1,labor.Plan.ManufacturingLead,1,labor.DrawingContentToken),author);
  Check(JsonSerializer.Serialize(completed.Plan.Versions[^1].DrawingNotes!.Single().Marks)==JsonSerializer.Serialize(request.Marks),"completion freezes shape geometry");
  Check((await store.ReadDrawingNotes(id,author,5)).Layers.Single().Layer.Marks.Length==9,"historical viewer receives shapes");
 }
}
