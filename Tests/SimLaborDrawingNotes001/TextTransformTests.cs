using System.Text.Json;
using System.Text.Json.Nodes;
internal static class TextTransformTests
{
 internal static async Task Run(string repo) {
  await LaborRevisionTests.Run(repo,true);
  var fixture=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json")))!;
  var root=(string)fixture["root"]!;var id=(string)fixture["id"]!;var store=new SimRfqIntakeStore(root);
  var author=new SimPersona("text-test","text-test","Fixture Author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  var before=await store.ReadLabor(id);var history=JsonSerializer.Serialize(before.Plan.Versions);
  var labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),before.Plan.Revision,4,"Isolated text gesture trial"),author);
  var manifest=await store.ReadDrawingNotes(id,author);var step=labor.Plan.Operations[0].Id;
  void Check(bool value,string message){if(!value)throw new Exception(message);Console.WriteLine("PASS: "+message);}
  var legacy=new SimDrawingMark(Guid.NewGuid().ToString(),1,"text",[new(.4,.4)],"Legacy text");
  Check(!JsonSerializer.Serialize(legacy).Contains("FontSize")&&!JsonSerializer.Serialize(legacy).Contains("TextRotation"),"legacy serialization has no new null fields");
  var mark=legacy with{FontSize=.052,TextRotation=-37};var req=new SimDrawingNotesRequest(0,labor.Plan.Revision,manifest.Source,[mark],null,"marks","",Guid.NewGuid().ToString(),"Text trial",[step]);
  var saved=await store.SaveDrawingNotes(id,step,req,author);
  var reopened=await new SimRfqIntakeStore(root).ReadDrawingNotes(id,author);
  Check(reopened.TextTransforms&&JsonSerializer.Serialize(reopened.Layers.Single().Layer.Marks.Single())==JsonSerializer.Serialize(mark),"text size/rotation/coordinates persist through store reopen");
  foreach(var invalid in new[]{mark with{FontSize=.3},mark with{FontSize=.000001},mark with{TextRotation=181},mark with{TextRotation=double.NaN},mark with{Kind="marker",Points=[new(.2,.2),new(.3,.3)]}}){try{await store.SaveDrawingNotes(id,step,req with{ExpectedRevision=saved.Revision,Marks=[invalid]},author);throw new Exception("Expected validation failure");}catch(SimRfqIntakeProblem e){Check(e.Code=="DRAWING_VALUES","invalid text transform rejected");}}
  var token=reopened.DrawingContentToken;
  await store.SaveDrawingNotes(id,step,req with{ExpectedRevision=saved.Revision,Action="view",Marks=null,SavedView=new(1,.3,.4,.5,.5,90)},author);
  Check((await store.ReadDrawingNotes(id,author)).DrawingContentToken==token,"Save View does not change text content token");
  Check(JsonSerializer.Serialize((await store.ReadLabor(id)).Plan.Versions)==history,"completed historical versions remain unchanged");
  labor=await store.ReadLabor(id);var completed=await store.SaveLabor(id,new(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Quantity,labor.Plan.Operations,labor.Plan.Rate,labor.Plan.Markup,true,"LABOR_BATCH_ALLOCATION_V6",1,1,labor.Plan.Charges,1,labor.Plan.ManufacturingLead,1,labor.DrawingContentToken),author);
  var frozen=completed.Plan.Versions[^1].DrawingNotes!.Single().Marks.Single();Check(frozen.FontSize==.052&&frozen.TextRotation==-37,"completion freezes text transforms");
  Check((await store.ReadDrawingNotes(id,author,5)).Layers.Single().Layer.Marks.Single().TextRotation==-37,"historical viewer receives frozen text rotation");
 }
}
