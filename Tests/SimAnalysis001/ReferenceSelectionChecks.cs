using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
internal static class ReferenceSelectionChecks
{
 internal static async Task Run(string sourceRoot,string root)
 {
  var json=DleAnalysisContract.Json;Directory.CreateDirectory(Path.Combine(root,"data"));
  var data=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(sourceRoot,"data/rfq-intakes.json")))!;
  var record=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0047")!.DeepClone();
  data["records"]=new JsonArray(record);await File.WriteAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"),data.ToJsonString());
  var correlation=record["requestCorrelationId"]!.GetValue<string>();var folder=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(folder);
  foreach(var doc in record["technicalFiles"]!.AsArray())foreach(var ext in new[]{".bin",".json"})File.Copy(Path.Combine(sourceRoot,"intake-documents",correlation,doc!["documentId"]!.GetValue<string>()+ext),Path.Combine(folder,doc!["documentId"]!.GetValue<string>()+ext));
  var store=new SimRfqIntakeStore(root);var actor=new SimPersona("fixture","fixture","Reference test","ACTIVE",[],[],true,"test");
  JsonNode Node(object o)=>JsonSerializer.SerializeToNode(o,json)!;
  async Task<JsonNode> Read()=>Node(await store.ReadPresentation("RFQI-SIM-0047"));
  void Check(bool b,string text){if(!b)throw new Exception(text);Console.WriteLine("PASS "+text);}
  var v=await Read();var draft=v["draft"]!.Deserialize<SimReviewPresentation>(json)!;
  var note=new SimReviewSlide(Guid.NewGuid().ToString("D"),"NOTE","fixture-note",null,1,"Retain note","Existing instruction",new(Guid.NewGuid().ToString("D"),"Annotations",[new(Guid.NewGuid().ToString("D"),1,"text",[new(.2,.2)],"Keep this")],new(1,.5,.5,1,1)));
  await store.SavePresentation("RFQI-SIM-0047",new(draft.Revision,v["bomToken"]!.GetValue<string>(),draft with{Slides=draft.Slides.Append(note).ToArray()}),actor);
  v=await Read();var original=v["record"]!.DeepClone();var id=v["draft"]!["teamDocumentId"]!.GetValue<string>();
  var before=await store.OpenDocument("RFQI-SIM-0047",id);
  var request=new SimReviewReferenceRequest(v["draft"]!["revision"]!.GetValue<int>(),v["bomToken"]!.GetValue<string>(),id);
  v=Node(await store.SaveReviewReference("RFQI-SIM-0047",request,actor));
  Check(v["reference"] is not null&&v["reference"]!["pageCount"]!.GetValue<int>()>0,"Word selection creates viewable PDF pages");
  Check(v["draft"]!["teamDocumentId"]!.GetValue<string>()==id&&v["draft"]!["renditionDocumentId"]!.GetValue<string>()!=id,"original selected and distinct rendition linked");
  var after=await store.OpenDocument("RFQI-SIM-0047",id);Check(before.Document==after.Document&&before.Bytes.SequenceEqual(after.Bytes),"original metadata filename and bytes unchanged");
  var r=v["record"]!.DeepClone();var added=r["technicalFiles"]!.AsArray().Last()!.DeepClone();r["technicalFiles"]!.AsArray().RemoveAt(r["technicalFiles"]!.AsArray().Count-1);r["technicalReview"]!["presentationDraft"]=original["technicalReview"]!["presentationDraft"]!.DeepClone();
  Check(JsonNode.DeepEquals(r,original),"entire record unchanged except added rendition and presentation selection metadata");
  var count=v["record"]!["technicalFiles"]!.AsArray().Count;
  try{await store.SaveReviewReference("RFQI-SIM-0047",request,actor);throw new Exception("stale accepted");}catch(SimRfqIntakeProblem){Console.WriteLine("PASS stale save rejected");}
  request=new(v["draft"]!["revision"]!.GetValue<int>(),v["bomToken"]!.GetValue<string>(),id);v=Node(await store.SaveReviewReference("RFQI-SIM-0047",request,actor));Check(v["record"]!["technicalFiles"]!.AsArray().Count==count,"repeat selection reuses rendition");
  var unchanged=await File.ReadAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"));
  try{await store.SaveReviewReference("RFQI-SIM-0047",new(v["draft"]!["revision"]!.GetValue<int>(),v["bomToken"]!.GetValue<string>(),Guid.NewGuid().ToString("D")),actor);throw new Exception("invalid source accepted");}catch(SimRfqIntakeProblem){}
  Check(unchanged==await File.ReadAllTextAsync(Path.Combine(root,"data/rfq-intakes.json")),"invalid source leaves saved record unchanged");
  Check(JsonNode.DeepEquals(original["technicalReview"]!["presentationDraft"]!["slides"],v["draft"]!["slides"]),"nonempty instruction and annotation marks retained");
  var pdf=await store.OpenDocument("RFQI-SIM-0047",v["draft"]!["renditionDocumentId"]!.GetValue<string>());await File.WriteAllBytesAsync(Path.Combine(root,"reference.pdf"),pdf.Bytes);
  await File.WriteAllTextAsync(Path.Combine(root,"result.json"),v.ToJsonString());
 }
}

