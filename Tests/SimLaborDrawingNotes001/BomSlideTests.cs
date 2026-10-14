using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
internal static class BomSlideTests
{
 internal static async Task Run(string repo){
  var root=Path.Combine(repo,"tmp/bom-store-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
  foreach(var f in Directory.GetFiles(Path.Combine(repo,".sim-state"),"*",SearchOption.AllDirectories)){var t=Path.Combine(root,Path.GetRelativePath(Path.Combine(repo,".sim-state"),f));Directory.CreateDirectory(Path.GetDirectoryName(t)!);File.Copy(f,t);}
  var actor=new SimPersona("bom","bom","Isolated BOM","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");var store=new SimRfqIntakeStore(root);const string id="RFQI-SIM-0036";var v=await store.ReadLabor(id);var original=v;
  var html=SimRfqIntakeEndpoints.BomReference(v.Rfq);Directory.CreateDirectory(Path.Combine(repo,"tmp/bom"));await File.WriteAllTextAsync(Path.Combine(repo,"tmp/bom/reference.html"),html);
  await File.WriteAllTextAsync(Path.Combine(repo,"tmp/bom/expected.json"),JsonSerializer.Serialize(new{rows=SimRfqIntakeEndpoints.BomReferenceCells(v.Rfq),pages=SimRfqIntakeEndpoints.BomReferencePageCount(v.Rfq)}));
  var a=v.Rfq.Assemblies[0];var source=new SimDrawingSource("bom-reference-v3",Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(html))),v.Plan.DefinitionId,a.AssemblyNumber,a.Revision,"View BOM");
  string Id()=>Guid.NewGuid().ToString();var card=new SimLaborSlide(Id(),"BOM","BOM reference - page 1","",1,[new(Id(),"Stage 1",[],new(1,.5,.5,1,1))],source);
  var main=v.Plan.Operations.First(o=>o.ParentId is null&&o.Name!="Kitting");var ops=v.Plan.Operations.Select(o=>o.Id==main.Id?o with{Slides=(o.Slides??[]).Append(card).ToArray()}:o).ToArray();
  SimLaborRequest Req(int contract=5)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,v.Plan.Rate,v.Plan.Markup,false,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1,contract);
  void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
  async Task Reject(SimLaborRequest request){try{await store.SaveLabor(id,request,actor);throw new Exception("Expected BOM rejection");}catch(SimRfqIntakeProblem e){Check(e.Code.StartsWith("LABOR_"),e.Code);}}
  await Reject(Req(4));await Reject(Req() with{Operations=ops.Select(o=>o.Id==main.Id?o with{Slides=[card with{Source=source with{Sha256=new string('0',64)}}]}:o).ToArray()});
  await Reject(Req() with{Operations=ops.Select(o=>o.Id==main.Id?o with{Slides=[card with{Page=999,Stages=[new(Id(),"Stage",[],new(999,.5,.5,1,1))]}]}:o).ToArray()});
  v=await store.SaveLabor(id,Req(),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.SlideContractVersion==8&&v.Plan.Operations.Single(o=>o.Id==main.Id).Slides!.Any(c=>c==card||c.Source==source),"BOM source and stage survive durable save/reopen");
  ops=v.Plan.Operations;await Reject(Req(4));await Reject(Req() with{Operations=ops.Select(o=>o.Id==main.Id?o with{Slides=o.Slides!.Select(c=>c.Id==card.Id?c with{Page=2}:c).ToArray()}:o).ToArray()});
  Check(v.Plan.Quantity==original.Plan.Quantity&&JsonSerializer.Serialize(v.Totals)==JsonSerializer.Serialize(original.Totals),"quantity and calculations unchanged");
  Check(JsonSerializer.Serialize(v.Rfq.Inputs)==JsonSerializer.Serialize(original.Rfq.Inputs),"BOM and drawing source inputs unchanged");
  Console.WriteLine("View BOM fixture: "+Path.Combine(repo,"tmp/bom/reference.html"));
 }
}
