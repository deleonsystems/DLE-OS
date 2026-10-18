using System.Text.Json;
// Run only against a disposable fixture root, never the live .sim-state directory.
internal static class CommissionTests
{
 internal static async Task Run(string root,string id){
  if(Path.GetFullPath(root).Split(Path.DirectorySeparatorChar).Contains(".sim-state",StringComparer.OrdinalIgnoreCase))throw new Exception("Disposable fixture required");
  void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
  var store=new SimRfqIntakeStore(root);var actor=new SimPersona("commission-test","commission-test","Fixture","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  var v=await store.ReadLabor(id);var originalMaterial=JsonSerializer.Serialize(v.Rfq.Lanes.MaterialsQuote);var source=File.ReadAllBytes(Path.Combine(root,"data","rfq-intakes.json"));
  Check(v.Plan.CommissionPercent==0,"legacy missing commission defaults to zero");
  Check(!JsonSerializer.Serialize(v.Plan).Contains("CommissionPercent"),"zero commission omitted from legacy serialization");
  SimLaborOperation[] ops=[new("test-work","Synthetic work",OperationQuantity:1,RunSeconds:1055)];
  SimLaborCharge[] charges=[new(Guid.NewGuid().ToString(),"RECURRING","Supplies",2),new(Guid.NewGuid().ToString(),"NRE","Fixture tooling",100)];
  var zero=SimRfqIntakeStore.CalculateLabor(ops,25,85,25,charges);var c=SimRfqIntakeStore.CalculateLabor(ops,25,85,25,charges,9);
  Check(zero.UnitSalePrice==33.64m&&zero==SimRfqIntakeStore.CalculateLabor(ops,25,85,25,charges,0),"zero commission leaves prior price unchanged");
  Check(c.UnitSalePrice==36.66m&&c.NreTotal==100&&c.TotalSeconds==1055&&c.Cost==26.91m,"9 percent then 25 percent gives 36.66; NRE/time/base cost unchanged");
  SimLaborRequest Req(decimal? commission,bool complete=false)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,85,25,complete,"LABOR_BATCH_ALLOCATION_V6",1,1,charges,1,null,1,v.DrawingContentToken,1,8,commission);
  foreach(var invalid in new[]{-1m,10001m,0.0000001m}){try{await store.SaveLabor(id,Req(invalid),actor);throw new Exception("Accepted invalid commission");}catch(SimRfqIntakeProblem ex){Check(ex.Code=="LABOR_COMMISSION","reject invalid commission "+invalid);}}
  v=await store.SaveLabor(id,Req(null),actor);Check(v.Plan.CommissionPercent==0,"legacy client can save zero commission plan");
  v=await store.SaveLabor(id,Req(9),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.Plan.CommissionPercent==9&&v.Plan.Markup==25&&v.Totals.UnitSalePrice==36.66m,"save and fresh store reopen persist commission and markup");
  var bytes=File.ReadAllBytes(Path.Combine(root,"data","rfq-lanes.json"));try{await store.SaveLabor(id,Req(null),actor);throw new Exception("Old client erased commission");}catch(SimRfqIntakeProblem ex){Check(ex.Code=="LABOR_COMMISSION_CLIENT","old client blocked on nonzero commission");}
  Check(bytes.SequenceEqual(File.ReadAllBytes(Path.Combine(root,"data","rfq-lanes.json"))),"rejected stale client leaves saved state unchanged");
  v=await store.SaveLabor(id,Req(9,true),actor);var snap=v.Plan.Versions.Last();
  Check(snap.CommissionPercent==9&&snap.Totals.UnitSalePrice==36.66m,"completed snapshot retains commission and sale price");
  var final=await store.ReadFinalReview(id);Check(final.Summary.LaborUnitSale==36.66m&&final.Summary.NreTotal==100,"final review uses commissioned labor and separate NRE");
  Check(JsonSerializer.Serialize(v.Rfq.Lanes.MaterialsQuote)==originalMaterial&&source.SequenceEqual(File.ReadAllBytes(Path.Combine(root,"data","rfq-intakes.json"))),"materials and intake source unchanged");
 }
}
