using System.Text.Json;
using System.Text.Json.Nodes;
internal static class PresentationChecks {
 internal static async Task Run(string pdf,string output) {
  var root=Path.Combine(Path.GetTempPath(),"dle-review-presentation-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
  var json=DleAnalysisContract.Json;var actor=new SimPersona("fixture","fixture","Presentation test","ACTIVE",[],[],true,"test");var correlation=Guid.NewGuid().ToString("D");var docs=new SimIntakeDocuments(root);
  var source=await docs.Stage(correlation,"reference.pdf",0,new MemoryStream(await File.ReadAllBytesAsync(pdf)),actor.DisplayName);
  using var wordStream=new MemoryStream();using(var zip=new System.IO.Compression.ZipArchive(wordStream,System.IO.Compression.ZipArchiveMode.Create,true)){using var writer=new StreamWriter(zip.CreateEntry("word/document.xml").Open());writer.Write("<document>Harmless synthetic reference</document>");}wordStream.Position=0;
  var word=await docs.Stage(correlation,"reference.docx",1,wordStream,actor.DisplayName);
  var seed=new {intakeId="RFQI-SIM-PRESENTATION",requestCorrelationId=correlation,environment="SIM",intakeType="NEW_QUOTE_REQUEST",status="TECHNICAL_REVIEW_IN_PROGRESS",schema="DLE_RFQ_INTAKE_V1",createdBy=actor.DisplayName,customer=new{customerId="SIM-CUSTOMER-E2E-001",customerNumber="990901",customerName="Synthetic"},assemblies=new[]{new{lineNumber=1,assemblyNumber="TEST",revision="",quantity=1}},technicalFiles=new[]{source,word},technicalReview=new{reviewStatus="TECHNICAL_REVIEW_IN_PROGRESS",workflow=new{version="UNIFIED_PACKAGE_REVIEW_V2"},technicalPackage=new{documents=Array.Empty<object>()}}};
  await File.WriteAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"),JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{seed}},json));var store=new SimRfqIntakeStore(root);
  JsonNode Node(object v)=>JsonSerializer.SerializeToNode(v,json)!;async Task<JsonNode> Read()=>Node(await new SimRfqIntakeStore(root).ReadPresentation(seed.intakeId));
  void Check(bool b,string name){if(!b)throw new Exception(name);Console.WriteLine("PASS: "+name);}async Task Denied(Func<Task> a,string name){try{await a();throw new Exception("Not blocked: "+name);}catch(SimRfqIntakeProblem){Console.WriteLine("PASS: "+name);}}
  var view=await Read();Check(view["draft"]!["revision"]!.GetValue<int>()==0&&view["warning"] is not null,"read does not create draft; missing reference actionable");
  var original=view["record"]!.DeepClone();var d=view["draft"]!.Deserialize<SimReviewPresentation>(json)!;
  async Task Save(SimReviewPresentation draft){var v=await Read();await store.SavePresentation(seed.intakeId,new(v["draft"]!["revision"]!.GetValue<int>(),v["bomToken"]!.GetValue<string>(),draft),actor);}
  d=d with{TeamDocumentId=word.DocumentId,ReferenceStatus="PRELIMINARY"};await Save(d);view=await Read();Check(view["reference"] is null&&view["warning"]!.GetValue<string>().Contains("PDF rendition"),"Word original has actionable missing-PDF message");
  d=view["draft"]!.Deserialize<SimReviewPresentation>(json)!;
  d=d with{RenditionDocumentId=source.DocumentId};await Save(d);view=await Read();Check(view["reference"]!["pageCount"]!.GetValue<int>()==2,"PDF rendition pages verified without changing original");
  d=view["draft"]!.Deserialize<SimReviewPresentation>(json)!;
  var note=new SimReviewSlide(Guid.NewGuid().ToString("D"),"NOTE","note",null,1,"Instruction","Known values only",new(Guid.NewGuid().ToString("D"),"Stage 1",[],new(1,.5,.5,1,1)));
  await Save(d with{Slides=[note]});view=await Read();Check(view["draft"]!["slides"]!.AsArray().Count==1,"instruction draft save and fresh-store reopen");
  await Denied(async()=>{await store.SavePresentation(seed.intakeId,new(0,view["bomToken"]!.GetValue<string>(),d),actor);},"stale draft rejected");
  d=view["draft"]!.Deserialize<SimReviewPresentation>(json)!;await Denied(()=>Save(d with{Slides=[]}),"existing annotations cannot silently disappear");
  var envelope=Node((await store.ReadTechnicalReviewAsync(seed.intakeId))!);await store.CreateManualBom(seed.intakeId,new(envelope["packageReviewToken"]!.GetValue<string>()),actor);view=await Read();var bom=view["record"]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
  var oldToken=view["bomToken"]!.GetValue<string>();var overlay=new SimReviewSlide(Guid.NewGuid().ToString("D"),"BOM",oldToken,null,1,"BOM annotation","",new(Guid.NewGuid().ToString("D"),"Stage 1",[],new(1,.5,.5,1,1)));await Save(d with{Slides=[note,overlay]});
  await store.AddManualBomRow(seed.intakeId,new(bom.Id,Guid.NewGuid().ToString("D"),0),actor);view=await Read();Check(view["bomToken"]!.GetValue<string>()!=oldToken&&view["draft"]!["slides"]!.AsArray().Count==2,"BOM edits change preview token while annotations are retained");
  d=view["draft"]!.Deserialize<SimReviewPresentation>(json)!;await Denied(()=>Save(d with{Slides=[note,overlay with{SourceToken=view["bomToken"]!.GetValue<string>()}]}),"annotations cannot silently move to changed BOM");
  Check(JsonNode.DeepEquals(original["technicalFiles"],view["record"]!["technicalFiles"])&&JsonNode.DeepEquals(original["technicalReview"]!["workflow"],view["record"]!["technicalReview"]!["workflow"]),"original files and workflow/release gates unchanged");
  await File.WriteAllTextAsync(output,root);Console.WriteLine("Fixture: "+root);
 }
}
