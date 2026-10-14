using System.Text.Json;
using System.Text.Json.Nodes;
internal static class SlideTests
{
 internal static async Task Run(string repo){
  await LaborRevisionTests.Run(repo,true);
  var fixture=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json")))!;
  var root=(string)fixture["root"]!;var id=(string)fixture["id"]!;var store=new SimRfqIntakeStore(root);
  var author=new SimPersona("slides","slides","Slide fixture author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  void Check(bool value,string label){if(!value)throw new Exception(label);Console.WriteLine("PASS: "+label);}
  async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code+" (received "+e.Code+")");}}
  var before=await store.ReadLabor(id);var history=JsonSerializer.Serialize(before.Plan.Versions);
  var labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),before.Plan.Revision,before.Plan.Versions[^1].Version,"Isolated slide fixture"),author);
  var drawing=await store.ReadDrawingNotes(id,author);
  string Id()=>Guid.NewGuid().ToString();
  SimLaborSlideStage Stage(string name,int page=1)=>new(Id(),name,[],new(page,.5,.5,1,1));
  var mark=new SimDrawingMark(Id(),1,"arrow",[new(.2,.2),new(.5,.5)],Color:"#c72116",Thickness:.002);
  var card=new SimLaborSlide(Id(),"DRAWING","Fixture drawing","Operator-facing fixture guidance",1,[Stage("First") with{Marks=[mark],SavedView=new(1,.4,.4,.5,.5)},Stage("Replacement")],drawing.Source);
  using var imageStream=File.OpenRead(Path.Combine(repo,"tmp/labor-drawing-notes/synthetic.png"));
  var image=await store.StageLaborVisual(id,new(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Operations[2].Id,"30",labor.Plan.Operations[2].Name),"slide-fixture.png",imageStream,author);
  var photo=new SimLaborSlidePhoto(Id(),image.DocumentId,image.Sha256,"Fixture photo",.2,.2,.4,.3,25);
  card=card with{Stages=[card.Stages[0] with{Photos=[photo]},card.Stages[1]]};
  var imageCard=new SimLaborSlide(Id(),"IMAGE","Fixture image","",1,[Stage("Image base")],ImageDocumentId:image.DocumentId,ImageSha256:image.Sha256);
  var ops=labor.Plan.Operations.Select((o,i)=>o with{Slides=i==0?[card,new(Id(),"BLANK","Intentional blank","",1,[Stage("Base")])]:i==2?[imageCard]:null}).ToArray();
  SimLaborRequest Request(SimLaborView v, bool complete=false)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,v.Plan.Rate,v.Plan.Markup,complete,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1,3);
  await Reject(()=>store.SaveLabor(id,Request(labor) with{SlideContractVersion=0},author),"LABOR_SLIDE_CONTRACT");
  await Reject(()=>store.SaveLabor(id,Request(labor),author with{Permissions=["technical_review.view"]}),"LABOR_DENIED");
  var bad=card with{Stages=[card.Stages[0] with{SavedView=new(2,.5,.5,1,1)}]};
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=[ops[0] with{Slides=[bad]}]},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=[ops[0] with{Slides=[card,card]}]},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=[ops[0] with{Slides=[card with{Source=card.Source! with{Sha256=new string('0',64)}}]}]},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=ops.Select((o,i)=>i==2?o with{Slides=[imageCard with{ImageSha256=new string('0',64)}]}:o).ToArray()},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{SlideContractVersion=1},author),"LABOR_SLIDE_CONTRACT");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=ops.Select((o,i)=>i==0?o with{Slides=[card with{Stages=[card.Stages[0] with{Photos=[photo with{Width=2}]}]}]}:o).ToArray()},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=ops.Select((o,i)=>i==0?o with{Slides=[card with{Stages=[card.Stages[0] with{Photos=[photo with{Sha256=new string('0',64)}]}]}]}:o).ToArray()},author),"LABOR_SLIDE_VALUES");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{SlideContractVersion=2},author),"LABOR_SLIDE_CONTRACT");
  await Reject(()=>store.SaveLabor(id,Request(labor) with{Operations=ops.Select((o,i)=>i==0?o with{Slides=[card with{Stages=[card.Stages[0] with{Photos=[photo with{Rotation=181}]}]}]}:o).ToArray()},author),"LABOR_SLIDE_VALUES");
  var saved=await store.SaveLabor(id,Request(labor),author);var reopened=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(reopened.SlideContractVersion==8&&JsonSerializer.Serialize(reopened.Plan.Operations)==JsonSerializer.Serialize(ops),"durable cards, stage order, marks, exact page and saved views reopen");
  Check(reopened.Plan.Operations[0].Slides![0].Stages[0].Photos![0]==photo,"photo reference and geometry reopen without modifying drawing or ink");
  await Reject(()=>store.SaveLabor(id,Request(saved) with{SlideContractVersion=1,Operations=ops.Select(o=>o with{Slides=o.Slides?.Select(c=>c with{Stages=c.Stages.Select(t=>t with{Photos=null}).ToArray()}).ToArray()}).ToArray()},author),"LABOR_SLIDE_CONTRACT");
  await Reject(()=>store.SaveLabor(id,Request(saved) with{SlideContractVersion=2,Operations=ops.Select(o=>o with{Slides=o.Slides?.Select(c=>c with{Stages=c.Stages.Select(t=>t with{Photos=t.Photos?.Select(p=>p with{Rotation=0}).ToArray()}).ToArray()}).ToArray()}).ToArray()},author),"LABOR_SLIDE_CONTRACT");
  Check(reopened.Totals==before.Totals&&reopened.Plan.Rate==before.Plan.Rate&&JsonSerializer.Serialize(reopened.Plan.Versions)==history,"pricing, roles and prior completed history preserved");
  await Reject(()=>store.SaveLabor(id,Request(labor),author),"LABOR_STALE");
  await Reject(()=>store.SaveLabor(id,Request(saved) with{SlideContractVersion=0,Operations=ops.Select(o=>o with{Slides=null}).ToArray()},author),"LABOR_SLIDE_CONTRACT");
  await Reject(()=>store.SaveLabor(id,Request(saved) with{Operations=[ops[0] with{Slides=[card with{Page=2,Stages=[Stage("Page 2",2)]}]}]},author),"LABOR_SLIDE_VALUES");
  var copy=card with{Id=Id(),Stages=card.Stages.Select(s=>s with{Id=Id(),Marks=s.Marks.Select(m=>m with{Id=Id()}).ToArray(),Photos=s.Photos?.Select(p=>p with{Id=Id()}).ToArray()}).ToArray()};
  ops=ops.Select((o,i)=>i==1?o with{Slides=[copy with{Body="Independent copy"}]}:o).ToArray();
  saved=await store.SaveLabor(id,Request(saved),author);
  Check(saved.Plan.Operations[0].Slides![0].Body==card.Body&&saved.Plan.Operations[1].Slides![0].Source==card.Source,"copy retains immutable reference and independent editable content");
  var complete=await store.SaveLabor(id,Request(saved,true),author);var frozen=JsonSerializer.Serialize(complete.Plan.Versions[^1]);
  var revised=await store.ReviseLabor(id,new(Id(),complete.Plan.Revision,complete.Plan.Versions[^1].Version,"Modify slide draft"),author);
  ops=ops.Select((o,i)=>i==0?o with{Slides=[o.Slides![1],card with{Body="Later edit",Stages=card.Stages.Reverse().ToArray()}]}:o).ToArray();
  saved=await store.SaveLabor(id,Request(revised),author);
  Check(JsonSerializer.Serialize(saved.Plan.Versions[^1])==frozen,"completion freezes stage views/content/order; later revision never rewrites history");
  var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);var target=Path.Combine(repo,"tmp/slides");Directory.CreateDirectory(target);
  await File.WriteAllTextAsync(Path.Combine(target,"fixture.json"),JsonSerializer.Serialize(new{root,id,labor=saved,drawing},options));
 }
}
