using System.Text;
using System.Text.Json;

if(args.Contains("--serve")){await BrowserHost.Run();return;}
var checks=new List<string>();
void Check(bool ok,string label){if(!ok)throw new Exception(label);checks.Add(label);Console.WriteLine("PASS "+label);}
JsonElement J(object v)=>JsonSerializer.SerializeToElement(v,SimLibraryBomStore.Json);
string Token(object v)=>J(v).GetProperty("token").GetString()!;
LibraryPreparation R(object v)=>J(v).GetProperty("record").Deserialize<LibraryPreparation>(SimLibraryBomStore.Json)!;
var root=Path.GetFullPath(Path.Combine("..","disposable","connected-"+Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var state=Path.Combine(root,"state");var sources=Path.Combine(root,"source");Directory.CreateDirectory(Path.Combine(sources,"N"));
var prior=Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS");
Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",JsonSerializer.Serialize(new[]{new SimDrawingRoot("quoting-evidence","Disposable synthetic sources",sources)}));
SimPersona P(string id,params string[] permissions)=>new(id,id,"Fixture "+id,"ACTIVE",[],permissions,false,"isolated fixture");
var ray=P("11111111-1111-1111-1111-111111111111","rfq.intake.create","rfq.view","rfq.materials.edit","rfq.readiness.view","rfq.quote.prepare","assembly_library.view");
var michelle=P("22222222-2222-2222-2222-222222222222","rfq.view","rfq.materials.edit","assembly_library.view","assembly_library.edit");
var junior=P("33333333-3333-3333-3333-333333333333","rfq.intake.create","rfq.view","rfq.materials.edit","rfq.readiness.view","rfq.quote.prepare","technical_review.view","technical_review.disposition","assembly_library.view","assembly_library.edit");
var adan=P("44444444-4444-4444-4444-444444444444","assembly_library.view","assembly_library.edit");
ray=ConnectedActors.Persona("ray")!;michelle=ConnectedActors.Persona("michelle")!;adan=ConnectedActors.Persona("adan")!;
RoleChecks.Catalog(Check);
var rfqStore=new SimRfqIntakeStore(state,"ISOLATED_DEVELOPMENT_REHEARSAL");
var key="fixture-assembly-N";
var prepStore=new SimLibraryPreparation(state,()=>[new(key,"fixture","V1.2","SYNTHETIC-49-2","","N","","N",false)],rfqStore.PreparationSource,rfqStore.OpenDocument);
var libraryStore=new SimLibraryBomStore(state,prepStore.Headers);
libraryStore.BoundDrawingSources=()=>new SimDrawingFolders(JsonSerializer.Serialize(new[]{new SimDrawingRoot("quoting-evidence","Disposable synthetic sources",sources)}));
rfqStore.PreparationLookup=prepStore.Find;prepStore.FinalReviewLookup=libraryStore.FinalReviewFor;rfqStore.PreparationFinalReviewLookup=libraryStore.FinalReviewFor;
rfqStore.LibraryRfqSource=libraryStore.WithRfqSource;rfqStore.LibraryRfqPackageRead=libraryStore.ReadRfqPackage;rfqStore.LibraryRfqFileRead=libraryStore.ReadRfqFile;
rfqStore.PreviousQuotesAccess=libraryStore.WithPreviousQuoteFolder;
var now=DateTimeOffset.UtcNow;var meta=new SimStateMetadata("ISOLATED_DEVELOPMENT_REHEARSAL","synthetic",1,1,1,now,now,1,now,1,1,1);
var builder=WebApplication.CreateBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls("http://127.0.0.1:0");
await using var app=builder.Build();app.MapConnected(rfqStore,prepStore,libraryStore,meta,new ManagedLibraryEvidence(root,"quoting-evidence"));await app.StartAsync();
using var client=new HttpClient{BaseAddress=new Uri(app.Urls.Single())};var port=client.BaseAddress.Port;
if(new[]{5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(port)){await app.StopAsync();throw new Exception("Protected port selected");}
var transport=new Transport(client);var rfq=new RfqClient(transport);var prep=new PreparationClient(transport);var library=new LibraryClient(transport);try{
 var draft=Guid.NewGuid().ToString();
 var pdf=await File.ReadAllBytesAsync("fixtures/drawing.pdf");var xls=await File.ReadAllBytesAsync("fixtures/bom.xls");
 var drawing=await rfq.StageDocument(draft,"drawing.pdf",0,new MemoryStream(pdf),ray);
 var bomFile=await rfq.StageDocument(draft,"bom.xls",0,new MemoryStream(xls),ray);
 Check(drawing.Size==3929922&&bomFile.Size==50176,"stage requested file sizes through actual intake store");

 var request=new SimRfqIntakeCreateRequest("NEW_QUOTE_REQUEST",new("fixture-customer","F001","Synthetic fixture customer","isolated-fixture-directory"),3,
  [new(1,"SYNTHETIC-49-1","N",10,Guid.NewGuid().ToString(),"MATERIAL_AND_LABOR"),new(2,"SYNTHETIC-49-2","N",50,Guid.NewGuid().ToString(),"MATERIAL_AND_LABOR"),new(3,"SYNTHETIC-49-3","N",20,Guid.NewGuid().ToString(),"MATERIAL_AND_LABOR")],
  "MATERIAL_AND_LABOR",true,[drawing with{SharedAcrossProjects=true},bomFile with{SharedAcrossProjects=true}],["PRICE","LEAD_TIME"],null,draft);
 var created=J(await rfq.CreateAsync(request,ray,meta));var intake=created.GetProperty("record").Deserialize<SimRfqIntakeRecord>(SimLibraryBomStore.Json)!;
 Check(J(await rfq.CreateAsync(request,ray,meta)).GetProperty("duplicate").GetBoolean(),"identical intake retry returns committed receipt");
 async Task Status(string path,object? body,string? who,int expected,bool intent=true,HttpContent? content=null){
  using var message=new HttpRequestMessage(body==null&&content==null?HttpMethod.Get:HttpMethod.Post,"/api/quoting/v1/"+path);
  if(who!=null)message.Headers.Add("X-Fixture-Session",who);if(intent)message.Headers.Add("X-Rehearsal-Intent","fixture-only");message.Content=content??(body==null?null:System.Net.Http.Json.JsonContent.Create(body));
  using var response=await client.SendAsync(message);Check((int)response.StatusCode==expected,$"HTTP {expected}: {who??"anonymous"} {path}");
 }
 await Status("rfq-intakes",request with{AssemblyCount=2,Assemblies=request.Assemblies![..2]},"ray",409);
 await Status("rfq-intakes",request,"junior",409);
 await Status("rfq-intakes",request,"michelle",403);
 await Status("rfq-intakes",request,"adan",403);
 await Status("rfq-intakes",request,null,401);
 await Status("rfq-intakes",request,"ray",403,false);
 await Status("technical-reviews",null,"ray",403);
 await Status("technical-reviews",null,"michelle",403);
 await Status("intake-drafts/"+Guid.NewGuid()+"/documents?name=oversized.pdf",null,"ray",413,content:new ByteArrayContent(new byte[5*1024*1024+1]));
 await Status("intake-drafts/"+Guid.NewGuid()+"/documents?name=wrong.pdf",null,"ray",415,content:new ByteArrayContent(new byte[20]));
 Check(intake.Environment==meta.Environment&&intake.IntakeId.StartsWith("RFQI-REHEARSAL-"),"explicit rehearsal environment and new identities");
 var id=intake.IntakeId;var sourceBefore=JsonSerializer.Serialize(await rfq.PreparationSource(id),SimLibraryBomStore.Json);
 var a=await prep.Assessment(id,2,junior);
 a=await prep.Assess(new(id,2,Token(a),J(a).GetProperty("sourceFingerprint").GetString()!,"SEND",null,"","","Build controlled BOM from synthetic sources.",[drawing.DocumentId!,bomFile.DocumentId!],["IDENTIFY_FILES","BUILD_BOM","COMPARE_FILES"]),junior);
 Check(R(a).Status=="NEEDS_PREPARATION","Technical Review routes actual intake line to Library");
 await Status($"assembly-library/incoming-package?id={R(a).Id}",null,"adan",200);
 await Status($"assembly-library/incoming-package?id={R(a).Id}",null,"ray",200);
 await Status($"technical-review/incoming-package?intakeId={id}&lineNumber=2",null,"ray",403);
 await Status("technical-review/part-requests",null,"junior",200);
 await Status("technical-review/part-requests",null,"michelle",403);
 await Status("assembly-library/part-requests",null,"adan",200);
 await Status("pdf-readability",null,"ray",200,content:new ByteArrayContent(pdf));
 await Status("pdf-readability",null,"ray",413,content:new ByteArrayContent(new byte[5*1024*1024+1]));
 a=await prep.Work(new(R(a).Id,Token(a),"START",Destination:"existing",LibraryKey:key,DrawingRevision:"N",BomRevision:"N"),adan);
 foreach(var doc in new[]{drawing,bomFile})a=await prep.Work(new(R(a).Id,Token(a),"PROMOTE",doc.DocumentId),adan);
 var evidencePaths=new Dictionary<string,string>();
 foreach(var doc in new[]{drawing,bomFile}){
  var target=await transport.Send<JsonElement>($"assembly-library/preparation/managed-evidence?id={R(a).Id}&token={Token(a)}&documentId={doc.DocumentId}",p:adan);
  var transfer=new ManagedEvidenceCommand(R(a).Id,Token(a),doc.DocumentId!,Guid.NewGuid().ToString(),target.GetProperty("expectedFolderToken").GetString()!);
  await Status("assembly-library/preparation/managed-evidence",transfer,"ray",403);
  await Status("assembly-library/preparation/managed-evidence",transfer with{ExpectedFolderToken="stale"},"adan",409);
  var placed=await transport.Send<JsonElement>("assembly-library/preparation/managed-evidence",transfer,adan);
  await Status("assembly-library/preparation/managed-evidence",transfer,"michelle",409);
  await Status("assembly-library/preparation/managed-evidence",transfer with{RequestId=Guid.NewGuid().ToString()},"adan",409);
  var retry=await transport.Send<JsonElement>("assembly-library/preparation/managed-evidence",transfer,adan);
  Check(placed.GetProperty("receipt").GetProperty("sha256").GetString()==retry.GetProperty("receipt").GetProperty("sha256").GetString(),"managed evidence transfer verified and retry retained exact bytes");
  evidencePaths[doc.DocumentId!]=placed.GetProperty("receipt").GetProperty("relativePath").GetString()!;
 }
 var folder=await library.Folder(key,adan); var bom=await library.Get(key,adan);bom=await library.Change(new(key,bom.Token,"START"),adan);
 var row=new LibraryRowEdit(Guid.NewGuid().ToString(),"1","SYNTHETIC-BOARD","Bare board","1","EA","","CUSTOMER","","",false,false,"Synthetic only",false);
 bom=await library.Change(new(key,bom.Token,"ACCEPT_ROW",DrawingRevision:"N",BomRevision:"N",QuantityBasis:"PER_ASSEMBLY",Rows:[row],RowId:row.Id),adan);
 foreach(var doc in new[]{drawing,bomFile}){
  var d=await library.Documents(key,adan);var path=evidencePaths[doc.DocumentId!];var description=J(await library.DescribeDocument(key,folder.Token,path,adan));
  await library.SaveDocument(new(key,Token(d),folder.Token,path,description.GetProperty("source").GetProperty("sourceToken").GetString()!,doc==drawing?["DRAWING"]:["BOM_SOURCE"],doc==drawing?"BOTH":"MATERIALS","","","UNKNOWN","CUSTOMER_ORIGINAL"),adan);
  a=await prep.Disposition(new(R(a).Id,Token(a),doc.DocumentId!,"ALREADY_IN_RECORDS",true,Guid.NewGuid().ToString()),adan);
 }
 var preview=J(await library.ReviewPreview(key,R(a).Id,adan,prep));
 Check(preview.GetProperty("canSubmit").GetBoolean(),"actual controlled BOM and identified evidence ready for review");
 var submit=new LibraryPackageCommand(key,preview.GetProperty("packageToken").GetString()!,"SUBMIT",preview.GetProperty("bomToken").GetString()!,preview.GetProperty("documentsToken").GetString()!,PreparationId:R(a).Id,ExpectedPreviewToken:preview.GetProperty("previewToken").GetString(),SubmissionNote:"Synthetic independent line 2 rehearsal");
 await Status("assembly-library/package",submit,"ray",403);
 var submitted=J(await library.SubmitReviewedPackage(submit,adan,prep));var package=submitted.GetProperty("record").Deserialize<LibraryPackagesRecord>(SimLibraryBomStore.Json)!.Versions.Single();
 await library.ChangePackage(new(key,submitted.GetProperty("packageToken").GetString()!,"APPROVE",ReviewId:package.Id),junior,true);
 await Status("technical-review/library-packages",new LibraryPackageCommand(key,submitted.GetProperty("packageToken").GetString()!,"APPROVE",ReviewId:package.Id),"adan",403);
 Check((await libraryStore.FinalReviewFor(R(a)))?.Status=="APPROVED","reviewer approves submitted immutable Library package");
 var handoff=J(await rfq.PreviewRfqHandoff(id,2,junior));
 Check(handoff.GetProperty("canSend").GetBoolean(),"approved line can enter RFQ queue");
 var received=J(await rfq.SendRfqHandoff(new(id,2,handoff.GetProperty("packageId").GetString()!,handoff.GetProperty("token").GetString()!,handoff.GetProperty("governingDocumentId").GetString()),junior));
 var lineId=received.GetProperty("rfqId").GetString()!;
 await SupportingChecks.Run(client,lineId,Check);
 await RoleChecks.Routes(client,lineId,Check);
 if(args.Contains("--support")){
  foreach(var file in Directory.GetFiles(state,"*",SearchOption.AllDirectories)){var target=Path.Combine(root,"template-target",Path.GetRelativePath(state,file));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(file,target,false);}
  var receiptHashes=Directory.GetFiles(Path.Combine(state,"rfq-projects-v1")).ToDictionary(f=>f,f=>Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(f))));
  await SupportingFlow.Run(client,lineId,key,R(a).Id,row,Check);
  Check(receiptHashes.All(p=>p.Value==Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(p.Key)))),"explicit adoption preserves immutable original RFQ receipt bytes");
  await LaborSupportFlow.Run(client,lineId,root,key,rfqStore,Check);
  await VendorContractChecks.Run(root,Check);
  Check(sourceBefore==JsonSerializer.Serialize(await rfq.PreparationSource(id),SimLibraryBomStore.Json),"supporting edits preserve intake and siblings");
  await File.WriteAllTextAsync("supporting-results.json",JsonSerializer.Serialize(new{ChecksPassed=true,Count=checks.Count,Checks=checks,Root=root,Port=port,AdoptionSucceeded=true,BrowserTested=false},new JsonSerializerOptions{WriteIndented=true}));return;
 }
 var materials=await rfq.ReadMaterials(lineId);
 var staleMaterial=new SimMaterialRequest(materials.Plan.Revision,materials.Plan.Rows);
 materials=await rfq.SaveMaterials(lineId,new(materials.Plan.Revision,materials.Plan.Rows.Select(r=>r with{CustomerSupplied=true,SourcingStatus="CUSTOMER_SUPPLIED",Uom="EA"}).ToArray(),true,ExpectedAcceptedBomVersion:materials.Rfq.Inputs.Materials.Version,PartReviewContractVersion:1,VendorReferenceContractVersion:1),michelle);
 Check(materials.Rfq.Lanes.Materials.Status=="COMPLETE","Michelle completes actual Materials plan");
 await Status($"rfqs/{lineId}/materials",staleMaterial,"michelle",409);
 await Status($"rfqs/{lineId}/materials",staleMaterial,"adan",403);
 var labor=await rfq.ReadLabor(lineId);
 labor=await rfq.SaveLabor(lineId,new(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Quantity,[new("assembly","Synthetic assembly",OperationQuantity:1,RunSeconds:60)],75,25,true,SimRfqIntakeStore.LaborUnitBatchCalculation,ManufacturingLead:new(2,"WEEKS"),LeadContractVersion:1,TimingCalculationContractVersion:1),junior);
 Check(labor.Rfq.Lanes.Labor.Status=="COMPLETE","reviewer completes actual Labor plan");
 var estimate=await rfq.ReadEstimateSubmission(lineId,junior);Check(estimate.CanSubmit,"line 2 estimate eligible while siblings unprocessed: "+string.Join(";",estimate.Blockers));
 var estimateCommand=new SimEstimateSubmitRequest(Guid.NewGuid().ToString(),estimate.Revision,estimate.Token,estimate.EstimateId!);
 await Status($"rfqs/{lineId}/estimate-submission",estimateCommand,"ray",403);
 await Status($"rfqs/{lineId}/estimate-submission",estimateCommand,"michelle",403);
 estimate=await rfq.SubmitEstimate(lineId,estimateCommand,junior);Check(estimate.Current,"independent line 2 submitted internally");
 Check((await rfq.SubmitEstimate(lineId,estimateCommand,junior)).History.Length==1,"estimate retry creates no second submission");
 var quote=await rfq.ReadQuoteSource(lineId,ray);var eligible=quote.Lines.Single(l=>l.Eligible);
 var rendered=await rfq.RenderQuoteCopy(lineId,new(Guid.NewGuid().ToString(),[new(eligible.RfqId,eligible.EstimateId!,eligible.Token!)]),ray);
 async Task<byte[]> GetPdf(string path,string actor){using var req=new HttpRequestMessage(HttpMethod.Get,path);req.Headers.Add("X-Fixture-Session",actor);using var response=await client.SendAsync(req);if(!response.IsSuccessStatusCode)throw new Exception("PDF retrieval failed: "+response.StatusCode);return await response.Content.ReadAsByteArrayAsync();}
 var draftBytes=await GetPdf(rendered.PdfUrl,"ray");
 await Status($"rfqs/{lineId}/drafts/{rendered.Id}/pdf",null,"junior",409);
 var copy=await rfq.SaveQuoteCopy(lineId,new(Guid.NewGuid().ToString(),rendered.Id,rendered.Token),ray);
 var archiveBytes=await GetPdf($"/api/quoting/v1/copies/{copy.Id}/pdf?key={key}&drawingRevision=N&bomRevision=N&rfqId={lineId}","michelle");
 Check(draftBytes.SequenceEqual(archiveBytes)&&copy.Sha256==rendered.Sha256,"new intake reaches exact Draft PDF archive over HTTP");
 await Status($"copies/{copy.Id}/pdf?key={key}&drawingRevision=N&bomRevision=N&rfqId={lineId}",null,"adan",403);
 await Status("new-orders",null,"junior",404);
 copy=await rfq.RecordManualQuoteSend(lineId,copy.Id,new(Guid.NewGuid().ToString(),copy.Token!,copy.Sha256),ray);
 Check(copy.ManualSend!=null&&!copy.CustomerIssued&&rendered.Projection.Draft,"internal manual-send annotation preserves Draft/not issued");
 var browserSource=await transport.Send<JsonElement>($"rfqs/{lineId}/quote-copies",p:ray);
 Check(browserSource.GetProperty("copies")[0].GetProperty("pdfUrl").GetString()!.StartsWith("/api/quoting/v1/"),"saved-copy UI response has explicit candidate archive URL");
 var history=await transport.Send<JsonElement>($"assembly-library/estimates?key={key}&drawingRevision=N&bomRevision=N",p:michelle);
 var archiveUrl=history.GetProperty("items")[0].GetProperty("quoteCopies")[0].GetProperty("url").GetString()!;
 Check(archiveUrl.StartsWith("/api/quoting/v1/")&&(await GetPdf(archiveUrl,"michelle")).SequenceEqual(draftBytes),"Library history route retrieves exact archived bytes");
 await Status($"assembly-library/estimates?key={key}&drawingRevision=N&bomRevision=N",null,"adan",403);
 Check(sourceBefore==JsonSerializer.Serialize(await rfq.PreparationSource(id),SimLibraryBomStore.Json),"intake and sibling source records unchanged");
 await File.WriteAllBytesAsync(Path.Combine(root,"connected-draft.pdf"),archiveBytes);
 await File.WriteAllTextAsync("connected-results.json",JsonSerializer.Serialize(new{Passed=true,Count=checks.Count,Checks=checks,Root=root,IntakeId=id,LineId=lineId,copy.Sha256,Environment=meta.Environment,FixtureOnly=true,HttpWorkflow=true,Port=port},new JsonSerializerOptions{WriteIndented=true}));
}catch(Exception e){Console.Error.WriteLine(e);Environment.ExitCode=1;}finally{await app.StopAsync();Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",prior);using var probe=new System.Net.Sockets.TcpClient();try{await probe.ConnectAsync("127.0.0.1",port);throw new Exception("Listener remained open");}catch(System.Net.Sockets.SocketException){} await File.WriteAllTextAsync("listener-closed.json",JsonSerializer.Serialize(new{Port=port,Closed=true}));}
