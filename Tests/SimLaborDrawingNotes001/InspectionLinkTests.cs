using System.Text.Json;
internal static class InspectionLinkTests
{
 internal static async Task Run(SimRfqIntakeStore store,string root,string id,SimPersona actor)
 {
  var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);var labor=await store.ReadLabor(id);
  string U()=>Guid.NewGuid().ToString();
  var camera=new SimDrawingCamera(1,.5,.5,1,1);
  SimLaborSlide Card()=>new(U(),"BLANK","Symbol fixture","",1,[new(U(),"Stage",[],camera)]);
  var cards=new[]{Card(),Card(),Card()};var op=labor.Plan.Operations[0];
  SimInspectionAnchor Anchor(int n)=>new(labor.Plan.DefinitionId,op.Id,cards[n].Id,cards[n].Stages[0].Id,"BLANK",1);
  var parent=new SimDrawingMark(U(),1,"inspection-square-filled-parent",[new(.2,.2),new(.3,.3)],Color:"#1255cc",Thickness:.003);
  parent=parent with{Inspection=new(parent.Id,"parent",Anchor(0),2)};
  var children=Enumerable.Range(1,2).Select(n=>new SimDrawingMark(U(),1,"inspection-square-filled-child",[new(.4,.4),new(.5,.5)],Color:"#1255cc",Thickness:.003,Inspection:new(parent.Id,"child",Anchor(n)))).ToArray();
  cards=cards.Select((c,i)=>c with{Stages=[c.Stages[0] with{Marks=[i==0?parent:children[i-1]]}]}).ToArray();
  var ops=labor.Plan.Operations.Select((o,i)=>i==0?o with{Slides=cards}:o).ToArray();
  void Validate(SimLaborOperation[] value){foreach(var o in value)foreach(var c in o.Slides??[])foreach(var s in c.Stages)SimRfqIntakeStore.ValidateDrawingNotes(s.Marks,s.SavedView);SimRfqIntakeStore.ValidateInspectionLinks(value,labor.Plan.DefinitionId);}
  void Reject(SimLaborOperation[] value){try{Validate(value);throw new Exception("Invalid links accepted");}catch(SimRfqIntakeProblem){}}
  SimLaborOperation[] Alter(int index,Func<SimLaborSlide,SimLaborSlide> fn)=>ops.Select((o,i)=>i==0?o with{Slides=cards.Select((c,n)=>n==index?fn(c):c).ToArray()}:o).ToArray();
  Validate(ops);
  Reject(Alter(0,c=>c with{Stages=[c.Stages[0] with{Marks=[]}]}));
  Reject(Alter(0,c=>c with{Stages=[c.Stages[0] with{Marks=[parent with{Inspection=parent.Inspection! with{Expected=1}}]}]}));
  Reject(Alter(1,c=>c with{Id=U()}));Reject(Alter(1,c=>c with{Page=2}));
  Reject(Alter(1,c=>c with{Stages=[c.Stages[0] with{Marks=[children[0] with{Inspection=children[0].Inspection! with{GroupId=U()}}]}]}));
  Reject(ops.Select((o,i)=>i==0?o with{ExcludedSlideIds=[cards[1].Id]}:o).ToArray());
  Reject(Alter(1,c=>c with{Stages=[c.Stages[0] with{Marks=[children[0] with{Inspection=null}]}]}));
  Reject(Alter(1,c=>c with{Stages=[c.Stages[0] with{Marks=[children[0] with{Kind="inspection-circle"}]}]}));
  var path=Path.Combine(root,"links-roundtrip.json");File.WriteAllText(path,JsonSerializer.Serialize(ops,json));var reopened=JsonSerializer.Deserialize<SimLaborOperation[]>(File.ReadAllText(path),json)!;Validate(reopened);
  if(JsonSerializer.Serialize(ops,json)!=JsonSerializer.Serialize(reopened,json))throw new Exception("Link JSON changed");
  SimLaborRequest Request(SimLaborView v,SimLaborOperation[] value)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,value,v.Plan.Rate,v.Plan.Markup,false,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1,8);
  var saved=await store.SaveLabor(id,Request(labor,ops),actor);var again=await new SimRfqIntakeStore(root).ReadLabor(id);
  if(JsonSerializer.Serialize(again.Plan.Operations,json)!=JsonSerializer.Serialize(ops,json))throw new Exception("Store changed links");
  try{await store.SaveLabor(id,Request(labor,ops),actor);throw new Exception("Stale accepted");}catch(SimRfqIntakeProblem e)when(e.Code=="LABOR_STALE"){}
  try{await store.SaveLabor(id,Request(saved,Alter(0,c=>c with{Stages=[c.Stages[0] with{Marks=[]}]})),actor);throw new Exception("Orphan persisted");}catch(SimRfqIntakeProblem e)when(e.Code=="INSPECTION_LINK_VALUES"){}
  Console.WriteLine("PASS: links actual isolated SaveLabor/reopen, JSON identity, stale-save rejection, parent deletion/count/source/slide/exclusion/metadata guards.");
 }
}
