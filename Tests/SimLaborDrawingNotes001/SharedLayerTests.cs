using System.Text.Json;
using System.Text.Json.Nodes;

internal static class SharedLayerTests
{
 internal static async Task Run(string repo) {
  await LaborRevisionTests.Run(repo,true);
  var fixture=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json")))!;
  var root=(string)fixture["root"]!;var id=(string)fixture["id"]!;
  var store=new SimRfqIntakeStore(root);var author=new SimPersona("layer-test","layer-test","Layer Tester","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  var before=await store.ReadLabor(id);var historical=JsonSerializer.Serialize(before.Plan.Versions);
  var labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),before.Plan.Revision,4,"Isolated shared-layer trial"),author);
  var manifest=await store.ReadDrawingNotes(id,author);var source=manifest.Source;
  var a=labor.Plan.Operations[0].Id;var b=labor.Plan.Operations.First(o=>o.ParentId is not null).Id;
  void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
  async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
  SimDrawingMark Mark(string kind="marker")=>new(Guid.NewGuid().ToString(),1,kind,[new(.2,.3),new(.4,.5),new(.45,.3)],"","#00aa88",.018);
  var layerId=Guid.NewGuid().ToString();var req=new SimDrawingNotesRequest(0,labor.Plan.Revision,source,[Mark()],null,"marks","Check the cathode stripe",layerId,"D2 orientation",[a,b]);
  var shared=await store.SaveDrawingNotes(id,a,req,author);
  Check(shared.LayerId==layerId&&shared.ContentRevision==1&&shared.StepIds!.Length==2,"named shared layer has stable identity and content version");
  await Reject(()=>store.SaveDrawingNotes(id,a,req with {LayerId=Guid.NewGuid().ToString(),StepIds=["unknown"]},author),"DRAWING_LAYER");
  await Reject(()=>store.SaveDrawingNotes(id,a,req with {LayerId=Guid.NewGuid().ToString(),Name=" "},author),"DRAWING_LAYER");
  await Reject(()=>store.SaveDrawingNotes(id,a,req with {LayerId=Guid.NewGuid().ToString(),Marks=[Mark() with {Color="url(bad)"}]},author),"DRAWING_VALUES");
  var privateLayer=await store.SaveDrawingNotes(id,b,req with {LayerId=Guid.NewGuid().ToString(),Name="Quality checks",StepIds=[b]},author);
  var reopened=await new SimRfqIntakeStore(root).ReadDrawingNotes(id,author);
  Check(reopened.Layers.Count(x=>SimRfqIntakeStore.DrawingSteps(x.Layer).Contains(a))==1&&reopened.Layers.Count(x=>SimRfqIntakeStore.DrawingSteps(x.Layer).Contains(b))==2,"shared guidance accompanies separate private layer on sub-operation");
  var updated=await store.SaveDrawingNotes(id,b,req with {ExpectedRevision=1,Note="Shared correction from Quality"},author);
  Check((await new SimRfqIntakeStore(root).ReadDrawingNotes(id,author)).Layers.Single(x=>x.Layer.LayerId==layerId).Layer.Note==updated.Note,"save from second step propagates after disk reopen");
  await Reject(()=>store.SaveDrawingNotes(id,a,req with {ExpectedRevision=1},author),"DRAWING_STALE");
  var token=(await store.ReadLabor(id)).DrawingContentToken;
  var camera=new SimDrawingCamera(2,.35,.45,.3,.4,270);
  updated=await store.SaveDrawingNotes(id,a,req with {ExpectedRevision=updated.Revision,Action="view",SavedView=camera,Name="IGNORED",StepIds=[a]},author);
  Check(updated.SavedView==camera&&updated.Name=="D2 orientation"&&updated.StepIds!.Length==2&&updated.ContentRevision==2,"saved author view cannot change instructional membership or version");
  Check((await store.ReadLabor(id)).DrawingContentToken==token,"presentation preserves approval content token");
  updated=await store.SaveDrawingNotes(id,a,req with {ExpectedRevision=updated.Revision,StepIds=[a],Note=updated.Note},author);
  Check((await store.ReadLabor(id)).DrawingContentToken!=token,"membership removal changes approval content");
  await Reject(()=>store.SaveDrawingNotes(id,b,req with {ExpectedRevision=updated.Revision},author),"DRAWING_MEMBERSHIP");
  updated=await store.SaveDrawingNotes(id,a,req with {ExpectedRevision=updated.Revision,Note=updated.Note},author);
  labor=await store.ReadLabor(id);
  SimLaborRequest Complete(SimLaborView v)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,v.Plan.Operations,v.Plan.Rate,v.Plan.Markup,true,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken);
  var completed=await store.SaveLabor(id,Complete(labor),author);
  var frozen=JsonSerializer.Serialize(completed.Plan.Versions[^1].DrawingNotes);
  Check(completed.Plan.Versions[^1].DrawingNotes!.Single(x=>x.LayerId==layerId).StepIds!.Length==2,"completion freezes shared membership and content version once");
  Check(JsonSerializer.Serialize(completed.Plan.Versions.Take(4))==historical,"v1-v4 remain byte-equivalent in serialized model");
  var final=await store.ReadFinalReview(id);var approved=await store.ApproveFinalReview(id,new(final.SourceToken,final.Approvals.Length,before.Rfq.Lanes.FinalReviews![0].Answers),author);
  updated=await store.SaveDrawingNotes(id,a,req with {ExpectedRevision=updated.Revision,ExpectedLaborRevision=completed.Plan.Revision,Action="view",SavedView=camera with {Rotation=90}},author);
  Check((await store.ReadFinalReview(id)).ApprovalCurrent,"completed shared layer view leaves approval current");
  await Reject(()=>store.SaveDrawingNotes(id,a,req with {ExpectedRevision=updated.Revision,ExpectedLaborRevision=completed.Plan.Revision,StepIds=[a]},author),"DRAWING_COMPLETE");
  labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),completed.Plan.Revision,5,"Isolated next shared draft"),author);
  updated=await store.SaveDrawingNotes(id,b,req with {ExpectedRevision=updated.Revision,ExpectedLaborRevision=labor.Plan.Revision,Note="Next draft",Marks=[Mark("freehand")]},author);
  Check(JsonSerializer.Serialize((await store.ReadLabor(id)).Plan.Versions[^1].DrawingNotes)==frozen,"later shared edits cannot change completed snapshot");
  Check((await store.ReadDrawingNotes(id,author,5)).Layers.Single(x=>x.Layer.LayerId==layerId).Layer.Note!="Next draft","historical viewer uses frozen shared guidance");
  Check((await store.ReadDrawingNotes(id,author,4)).Layers.Length==0,"legacy snapshots never acquire current layers");
  labor=await store.ReadLabor(id);completed=await store.SaveLabor(id,Complete(labor),author);
  Check(completed.Plan.Versions[^1].DrawingNotes!.Single(x=>x.LayerId==layerId).Note=="Next draft"&&JsonSerializer.Serialize(completed.Plan.Versions[^2].DrawingNotes)==frozen,"new completion freezes new shared version; old version remains immutable");
  Console.WriteLine("Shared-layer fixture: "+root);
 }
}
