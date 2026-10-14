using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
internal static class ExclusionTests
{
 internal static async Task Run(string repo){
  var root=Path.Combine(repo,"tmp/exclusion-store-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
  foreach(var f in Directory.GetFiles(Path.Combine(repo,".sim-state"),"*",SearchOption.AllDirectories)){var t=Path.Combine(root,Path.GetRelativePath(Path.Combine(repo,".sim-state"),f));Directory.CreateDirectory(Path.GetDirectoryName(t)!);File.Copy(f,t);}
  var hashes=Directory.GetFiles(Path.Combine(root,"intake-documents"),"*",SearchOption.AllDirectories).ToDictionary(f=>f,f=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(f))));
  var actor=new SimPersona("exclusions","exclusions","Isolated exclusions","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"SIM");var store=new SimRfqIntakeStore(root);const string id="RFQI-SIM-0036";var v=await store.ReadLabor(id);var original=v;
  var drawing=await store.ReadDrawingNotes(id,actor);var html=SimRfqIntakeEndpoints.BomReference(v.Rfq);var a=v.Rfq.Assemblies[0];var bom=new SimDrawingSource("bom-reference-v3",Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(html))),v.Plan.DefinitionId,a.AssemblyNumber,a.Revision,"View BOM");
  string Id()=>Guid.NewGuid().ToString();SimLaborSlide Card(string kind,SimDrawingSource? source=null)=>new(Id(),kind,kind,"",1,[new(Id(),"Keep saved stage",[],new(1,.4,.4,.7,.7))],source);
  var cards=new[]{Card("START"),Card("BOM",bom),Card("DRAWING",drawing.Source),Card("END")};
  var main=v.Plan.Operations.First(o=>o.ParentId is null&&o.Name!="Kitting");var child=v.Plan.Operations.First(o=>o.ParentId==main.Id);
  var ops=v.Plan.Operations.Select(o=>o.Id==main.Id?o with{SlidesOrganized=true,Slides=cards,ExcludedSlideIds=cards.Select(c=>c.Id).ToArray()}:o.Id==child.Id?o with{ExcludedSlideIds=["generated-"+o.Id]}:o).ToArray();
  SimLaborRequest Req(int contract=6)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,ops,v.Plan.Rate,v.Plan.Markup,false,"LABOR_BATCH_ALLOCATION_V6",1,1,v.Plan.Charges,1,v.Plan.ManufacturingLead,1,v.DrawingContentToken,1,contract);
  void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
  async Task Reject(SimLaborRequest request,string code){try{await store.SaveLabor(id,request,actor);throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
  await Reject(Req(5),"LABOR_SLIDE_EXCLUSION_CONTRACT");
  await Reject(Req() with{Operations=ops.Select(o=>o.Id==main.Id?o with{ExcludedSlideIds=["invalid"]}:o).ToArray()},"LABOR_SLIDE_EXCLUSIONS");
  await Reject(Req() with{Operations=ops.Select(o=>o.Id==child.Id?o with{ExcludedSlideIds=[cards[0].Id]}:o).ToArray()},"LABOR_SLIDE_EXCLUSIONS");
  v=await store.SaveLabor(id,Req(),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.SlideContractVersion==8&&v.Plan.Operations.Single(o=>o.Id==main.Id).ExcludedSlideIds!.SequenceEqual(cards.Select(c=>c.Id)),"all default exclusions persist across a fresh store");
  Check(JsonSerializer.Serialize(v.Plan.Operations.Single(o=>o.Id==main.Id).Slides)==JsonSerializer.Serialize(cards),"excluded cards and saved views retained intact");
  ops=v.Plan.Operations.Select(o=>o with{ExcludedSlideIds=null}).ToArray();await Reject(Req(5),"LABOR_SLIDE_EXCLUSION_CONTRACT");
  v=await store.SaveLabor(id,Req(),actor);v=await new SimRfqIntakeStore(root).ReadLabor(id);
  Check(v.Plan.Operations.All(o=>o.ExcludedSlideIds is null),"restore defaults durably clears exclusions");
  Check(JsonSerializer.Serialize(v.Totals)==JsonSerializer.Serialize(original.Totals)&&v.Plan.Quantity==original.Plan.Quantity,"quantity and calculations unchanged");
  Check(v.Plan.Operations.Select(o=>o.Instructions).SequenceEqual(original.Plan.Operations.Select(o=>o.Instructions)),"source labor instructions unchanged");
  Check(JsonSerializer.Serialize(v.Rfq.Inputs)==JsonSerializer.Serialize(original.Rfq.Inputs)&&hashes.All(kv=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(kv.Key)))==kv.Value),"BOM, drawings and all source assets unchanged");
 }
}
