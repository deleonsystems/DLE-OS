using System.Text.Json;
using System.Text.Json.Nodes;

internal static class LaborRevisionTests
{
 internal static async Task Run(string repo,bool fixtureOnly=false){
  var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);var root=Path.Combine(repo,"tmp/labor-revise/fixture-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
  var data=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-intakes.json")))!;
  var record=data["records"]!.AsArray().Single(x=>(string?)x!["intakeId"]=="RFQI-SIM-0036")!.DeepClone();
  var id=(string)record["intakeId"]!;var lane=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,".sim-state/data/rfq-lanes.json")))![id]!.DeepClone();
  lane["labor"]!["status"]="COMPLETE";lane["laborQuote"]!["revision"]=7;lane["laborQuote"]!.AsObject().Remove("revisionHistory");
  var originalLane=lane.DeepClone();var path=Path.Combine(root,"data/rfq-lanes.json");var dataPath=Path.Combine(root,"data/rfq-intakes.json");
  async Task Write(JsonNode? extra=null){var rows=new JsonArray(record.DeepClone());if(extra is not null)rows.Add(extra.DeepClone());await File.WriteAllTextAsync(dataPath,new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=rows}.ToJsonString());await File.WriteAllTextAsync(path,new JsonObject{[id]=lane.DeepClone()}.ToJsonString());}
  var correlation=(string)record["requestCorrelationId"]!;var doc=(string)record["technicalReview"]!["workflow"]!["outputs"]!["manufacturing"]!["governingDocumentId"]!;
  Directory.CreateDirectory(Path.Combine(root,"intake-documents",correlation));foreach(var ext in new[]{".json",".bin"})File.Copy(Path.Combine(repo,".sim-state/intake-documents",correlation,doc+ext),Path.Combine(root,"intake-documents",correlation,doc+ext));await Write();
  if(fixtureOnly){await File.WriteAllTextAsync(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json"),JsonSerializer.Serialize(new{root,id}));return;}
  void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: "+label);}
  async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
  var actor=new SimPersona("author","author","Revision Tester","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");var store=new SimRfqIntakeStore(root);var before=await store.ReadLabor(id);
  SimLaborRequest Save(SimLaborView v,bool complete=false)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,v.Plan.Operations,v.Plan.Rate,v.Plan.Markup,complete,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken);
  var request=new SimLaborReviseRequest(Guid.NewGuid().ToString(),before.Plan.Revision,4,"Review drawing instructions with Miguel");
  Check(before.CanRevise&&before.Plan.Revision==7,"completed v4 exposes guarded revision capability");
  await Reject(()=>store.SaveLabor(id,Save(before),actor),"LABOR_COMPLETE");
  await Reject(()=>store.StageLaborVisual(id,new(before.Plan.Revision,before.Plan.DefinitionId,before.Plan.Operations[0].Id,"10","Kitting"),"test.png",new MemoryStream(),actor),"LABOR_COMPLETE");
  await Reject(()=>store.ReviseLabor(id,request,actor with{Permissions=["technical_review.view"]}),"LABOR_REVISE_DENIED");
  await Reject(()=>store.ReviseLabor(id,request with{Reason=" "},actor),"LABOR_REVISE_REASON");
  lane["commercial"]=new JsonObject{["status"]="SUBMITTED",["revision"]=1};await Write();await Reject(()=>store.ReviseLabor(id,request,actor),"LABOR_COMMITTED");
  lane=originalLane.DeepClone();var downstream=record.DeepClone();downstream["intakeId"]="ISOLATED-ORDER";downstream["orderIntake"]=new JsonObject{["quote"]=new JsonObject{["reference"]=new JsonObject{["intakeId"]=id}}};await Write(downstream);await Reject(()=>store.ReviseLabor(id,request,actor),"LABOR_COMMITTED");await Write();
  var winner=store.ReviseLabor(id,request,actor);var rival=Reject(()=>store.ReviseLabor(id,request with{RequestId=Guid.NewGuid().ToString()},actor),"LABOR_STALE");var revised=await winner;await rival;Check(revised.Plan.Revision==8&&revised.Rfq.Lanes.Labor.Status=="IN_PROGRESS"&&revised.Plan.RevisionHistory!.Single().BaseVersion==4,"audited revision 8 starts from v4");
  Check(JsonSerializer.Serialize(revised.Plan.Versions)==JsonSerializer.Serialize(before.Plan.Versions)&&JsonSerializer.Serialize(revised.Plan.Operations)==JsonSerializer.Serialize(before.Plan.Operations),"baseline history and every step identity retained");
  var duplicate=await store.ReviseLabor(id,request,actor);Check(duplicate.Plan.Revision==8&&duplicate.Plan.RevisionHistory!.Length==1,"retry is idempotent");
  await Reject(()=>store.ReviseLabor(id,request with{RequestId=Guid.NewGuid().ToString()},actor),"LABOR_STALE");
  await Reject(()=>store.ReviseLabor(id,request with{Reason="different"},actor),"LABOR_REVISE_REQUEST");
  var review=await store.ReadFinalReview(id);Check(!review.ApprovalCurrent&&review.Blockers.Any(x=>x.Contains("Complete Labor")),"reopened Labor blocks approval readiness");
  var notes=await store.ReadDrawingNotes(id,actor);var step=revised.Plan.Operations[0].Id;
  var mark=new SimDrawingMark(Guid.NewGuid().ToString(),1,"arrow",[new(.2,.3),new(.4,.5)]);
  var layer=await store.SaveDrawingNotes(id,step,new(0,8,notes.Source,[mark],null,"marks","Inspect real drawing orientation"),actor);
  await Reject(()=>store.SaveLabor(id,Save(revised,true),actor),"LABOR_DRAWING_STALE");
  revised=await store.ReadLabor(id);var completed=await store.SaveLabor(id,Save(revised,true),actor);
  Check(completed.Plan.Versions.Length==5&&completed.Plan.Versions[^1].DrawingNotes!.Single().Note=="Inspect real drawing orientation","completion v5 freezes annotation content");
  Check(completed.Plan.Versions.Take(4).Select(v=>JsonSerializer.Serialize(v)).SequenceEqual(before.Plan.Versions.Select(v=>JsonSerializer.Serialize(v))),"v1-v4 untouched after v5 completion");
  Check((await store.ReadDrawingNotes(id,actor,4)).Layers.Length==0,"legacy v4 never imports mutable overlays");
  var frozen=JsonSerializer.Serialize((await store.ReadDrawingNotes(id,actor,5)).Layers.Select(x=>new{x.Layer.Marks,x.Layer.Note}));
  var oldApproval=before.Rfq.Lanes.FinalReviews![0];var final=await store.ReadFinalReview(id);var approved=await store.ApproveFinalReview(id,new(final.SourceToken,final.Approvals.Length,oldApproval.Answers),actor);Check(approved.ApprovalCurrent&&approved.Approvals.Length==2,"v5 requires and receives isolated fresh approval");
  await store.SaveDrawingNotes(id,step,new(layer.Revision,completed.Plan.Revision,notes.Source,null,new(1,.3,.4,.5,.5,90),"view"),actor);
  Check((await store.ReadFinalReview(id)).ApprovalCurrent,"saved-view-only change leaves approval current");
  await Reject(()=>store.SaveDrawingNotes(id,step,new(layer.Revision,completed.Plan.Revision,notes.Source,[],null,"marks"),actor),"DRAWING_COMPLETE");
  var next=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),completed.Plan.Revision,5,"Next content review"),actor);var current=await store.ReadDrawingNotes(id,actor);
  await store.SaveDrawingNotes(id,step,new(current.Layers.Single().Layer.Revision,next.Plan.Revision,current.Source,[mark],null,"marks","Updated draft instruction"),actor);
  Check(JsonSerializer.Serialize((await store.ReadDrawingNotes(id,actor,5)).Layers.Select(x=>new{x.Layer.Marks,x.Layer.Note}))==frozen,"later draft edits cannot change completed v5 history");
  var after=JsonNode.Parse(File.ReadAllText(path))![id]!;Check(JsonNode.DeepEquals(after["materialsQuote"],originalLane["materialsQuote"])&&JsonNode.DeepEquals(after["materials"],originalLane["materials"]),"Materials and pricing storage untouched");
  Check((await store.ReadLabor(id)).Plan.Rate==before.Plan.Rate&&(await store.ReadLabor(id)).Plan.Markup==before.Plan.Markup,"Labor cost inputs retained");
  record["assemblies"]![0]!["revision"]="STALE-TEST";await File.WriteAllTextAsync(dataPath,new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new JsonArray(record.DeepClone())}.ToJsonString());
  var stale=await store.ReadLabor(id);await Reject(()=>store.SaveLabor(id,Save(stale,true),actor),"LABOR_DRAWING_SOURCE");
  Console.WriteLine("Revision fixture: "+root);
 }
}
