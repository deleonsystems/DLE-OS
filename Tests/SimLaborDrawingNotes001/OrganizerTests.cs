using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
internal static class OrganizerTests
{
 internal static async Task Run(string repo){
  var root=Path.Combine(repo,"tmp/organizer-store-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
  var source=Path.Combine(repo,".sim-state");foreach(var f in Directory.GetFiles(source,"*",SearchOption.AllDirectories)){var t=Path.Combine(root,Path.GetRelativePath(source,f));Directory.CreateDirectory(Path.GetDirectoryName(t)!);File.Copy(f,t);}
  var hashes=Directory.GetFiles(Path.Combine(root,"intake-documents"),"*",SearchOption.AllDirectories).ToDictionary(f=>f,f=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(f))));
  var actor=new SimPersona("organizer","organizer","Isolated organizer","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");var store=new SimRfqIntakeStore(root);const string id="RFQI-SIM-0036";
  var v=await store.ReadLabor(id);var original=v;var d=await store.ReadDrawingNotes(id,actor);string Id()=>Guid.NewGuid().ToString();
  SimLaborSlide Card(string kind,int page=1)=>new(Id(),kind,kind,"",page,[new(Id(),"First",[],new(page,.5,.5,1,1))],kind=="DRAWING"?d.Source:null);
  var start=Card("START");var end=Card("END");var first=Card("DRAWING");var second=Card("DRAWING",2);
  var main=v.Plan.Operations.First(o=>o.ParentId is null&&o.Name!="Kitting");var child=v.Plan.Operations.First(o=>o.ParentId==main.Id);
  var ops=v.Plan.Operations.Select(o=>o.Id==main.Id?o with{SlidesOrganized=true,Slides=[start,second,first,end]}:o).ToArray();
  SimLaborRequest Req(int contract=4)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,v.Plan.Rate,v.Plan.Markup,false,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1,contract);
  void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
  async Task Reject(SimLaborRequest request,string code){try{await store.SaveLabor(id,request,actor);throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
  await Reject(Req(3),"LABOR_SLIDE_LAYOUT_CONTRACT");
  await Reject(Req() with{Operations=ops.Select(o=>o.Id==main.Id?o with{Slides=[second,start,end]}:o).ToArray()},"LABOR_SLIDE_LAYOUT");
  v=await store.SaveLabor(id,Req(),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.SlideContractVersion==8&&v.Plan.Operations.Single(o=>o.Id==main.Id).SlidesOrganized==true,"organized layout flag survives save/reopen");
  Check(v.Plan.Operations.Single(o=>o.Id==main.Id).Slides!.Select(c=>c.Id).SequenceEqual(new[]{start.Id,second.Id,first.Id,end.Id}),"drawing page order persists");
  ops=v.Plan.Operations.Select(o=>o.Id==main.Id?o with{Slides=[start,end]}:o.Id==child.Id?o with{Slides=(o.Slides??[]).Append(second).ToArray()}:o).ToArray();
  v=await store.SaveLabor(id,Req(),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.Plan.Operations.Single(o=>o.Id==main.Id).Slides!.Length==2&&v.Plan.Operations.Single(o=>o.Id==child.Id).Slides!.Any(c=>c.Id==second.Id&&c.Page==2),"removed page stays absent; moved page retains identity and new owner");
  await Reject(Req(3),"LABOR_SLIDE_LAYOUT_CONTRACT");
  Check(v.Totals==original.Totals&&v.Plan.Operations.Select(o=>o.Instructions).SequenceEqual(original.Plan.Operations.Select(o=>o.Instructions)),"costing and worksheet notes preserved");
  Check(hashes.All(kv=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(kv.Key)))==kv.Value),"all immutable assets preserved");
 }
}
