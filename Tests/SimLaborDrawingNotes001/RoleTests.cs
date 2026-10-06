using System.Text.Json;
using System.Text.Json.Nodes;
internal static class RoleTests {
 internal static async Task Run(string repo){
  await LaborRevisionTests.Run(repo,true);var fixture=JsonNode.Parse(File.ReadAllText(Path.Combine(repo,"tmp/labor-revise/browser-fixture.json")))!;var root=(string)fixture["root"]!;var id=(string)fixture["id"]!;var store=new SimRfqIntakeStore(root);
  var author=new SimPersona("role-test","role-test","Fixture author","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");
  var before=await store.ReadLabor(id);var history=JsonSerializer.Serialize(before.Plan.Versions);var labor=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),before.Plan.Revision,4,"Role fixture"),author);
  var ops=labor.Plan.Operations.Select((o,i)=>o with{ResponsibleRole=i==0?"Kitting operator":i==1?"":null}).ToArray();
  SimLaborRequest Request(SimLaborView v,bool complete=false)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,v.Plan.Rate,v.Plan.Markup,complete,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1);
  void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS: "+message);}
  async Task Reject(SimLaborRequest r,string code){try{await store.SaveLabor(id,r,author);throw new Exception("Expected rejection");}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
  await Reject(Request(labor) with{RoleContractVersion=0},"LABOR_ROLE_CONTRACT");
  await Reject(Request(labor) with{Operations=[ops[0] with{ResponsibleRole=new string('x',81)}]},"LABOR_ROLE_VALUES");
  var saved=await store.SaveLabor(id,Request(labor),author);var reopened=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(reopened.RoleContractVersion==1&&JsonSerializer.Serialize(reopened.Plan.Operations)==JsonSerializer.Serialize(ops),"role labels, explicit unassigned and inherited null persist");
  Check(reopened.Plan.Rate==before.Plan.Rate&&reopened.Plan.Markup==before.Plan.Markup&&reopened.Totals==before.Totals,"rates and totals unchanged");
  Check(JsonSerializer.Serialize(reopened.Plan.Versions)==history,"old completed versions unchanged");
  await Reject(Request(saved) with{RoleContractVersion=0,Operations=ops.Select(o=>o with{ResponsibleRole=null}).ToArray()},"LABOR_ROLE_CONTRACT");
  var completed=await store.SaveLabor(id,Request(reopened,true),author);Check(JsonSerializer.Serialize(completed.Plan.Versions[^1].Operations)==JsonSerializer.Serialize(ops),"completed snapshot freezes assignments");
  var revised=await store.ReviseLabor(id,new(Guid.NewGuid().ToString(),completed.Plan.Revision,5,"Second fixture revision"),author);Check(JsonSerializer.Serialize(revised.Plan.Operations)==JsonSerializer.Serialize(ops),"revision retains assignments");
 }
}
