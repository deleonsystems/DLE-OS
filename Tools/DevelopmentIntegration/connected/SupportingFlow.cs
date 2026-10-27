using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
internal static class SupportingFlow{
 internal static async Task Run(HttpClient client,string id,string key,string preparationId,LibraryRowEdit row,Action<bool,string> check){
  async Task<JsonElement> Call(string path,string who="junior",object? body=null,string method="GET",int expected=200,HttpContent? content=null){
   using var req=new HttpRequestMessage(new HttpMethod(method),"/api/quoting/v1/"+path);req.Headers.Add("X-Fixture-Session",who);req.Headers.Add("X-Rehearsal-Intent","fixture-only");req.Content=content??(body==null?null:JsonContent.Create(body));
   using var resp=await client.SendAsync(req);var text=await resp.Content.ReadAsStringAsync();check((int)resp.StatusCode==expected,$"flow {method} {path} {who} expected {expected}, got {(int)resp.StatusCode}"+(resp.IsSuccessStatusCode?"":" "+text));return string.IsNullOrEmpty(text)?default:JsonDocument.Parse(text).RootElement.Clone();
  }
  string Token(JsonElement j)=>j.GetProperty("token").GetString()!;
  T D<T>(JsonElement j)=>j.Deserialize<T>(SimLibraryBomStore.Json)!;
  var material=D<SimMaterialView>(await Call($"rfqs/{id}/materials"));
  await Call($"rfqs/{id}/materials","ray",new SimMaterialRequest(material.Plan.Revision,material.Plan.Rows.Select(r=>r with{MfgPartNumber="SYNTHETIC-PROPOSED-1",MfgPartNumberSource="MANUAL_QUOTE_ONLY",PartReviewMode="PROPOSED_PART",CustomerSupplied=true,SourcingStatus="CUSTOMER_SUPPLIED",Uom="EA"}).ToArray(),true,ExpectedAcceptedBomVersion:material.Rfq.Inputs.Materials.Version,PartReviewContractVersion:1,VendorReferenceContractVersion:1),"POST");
  var completedMaterial=D<SimMaterialView>(await Call($"rfqs/{id}/materials"));
  var labor=D<SimLaborView>(await Call($"rfqs/{id}/labor"));
  labor=D<SimLaborView>(await Call($"rfqs/{id}/labor",body:new SimLaborRequest(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Quantity,[new("assembly","Synthetic assembly",OperationQuantity:1,RunSeconds:60)],75,25,true,SimRfqIntakeStore.LaborUnitBatchCalculation,ManufacturingLead:new(2,"WEEKS"),LeadContractVersion:1,TimingCalculationContractVersion:1),method:"POST"));
  var materialSnapshots=JsonSerializer.Serialize(completedMaterial.Plan.Versions);var laborSnapshots=JsonSerializer.Serialize(labor.Plan.Versions);
  var source=await Call($"rfqs/{id}/materials/part-requests","ray");var batchId=Guid.NewGuid().ToString();
  async Task<JsonElement> Evidence(string token,string text,string? update=null){using var form=new MultipartFormDataContent();form.Add(JsonContent.Create(new SimPartRequestUpload(token,batchId,update)),"metadata");form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(text)),"file","synthetic-evidence.txt");return await Call($"rfqs/{id}/materials/part-requests/evidence","ray",method:"POST",content:form);}
  var firstEvidence=await Evidence(Token(source),"Initial synthetic engineering evidence.");
  var command=new SimMaterialPartCreate(Token(source),batchId,"INTERNAL_BOM_UPDATE",source.GetProperty("items").EnumerateArray().Select(x=>x.GetProperty("index").GetInt32()).ToArray(),"Synthetic proposed manufacturer number",RoutingContractVersion:2,BasisReference:"fixture engineering record 1",AttachmentIds:[firstEvidence.GetProperty("documentId").GetString()!]);
  var batch=await Call($"rfqs/{id}/materials/part-requests","ray",command,"POST");
  check(batch.GetProperty("estimateAllowed").GetBoolean()==false,"Ray request grants no estimate allowance");
  var repeat=await Call($"rfqs/{id}/materials/part-requests","ray",command,"POST");check(Token(repeat)==Token(batch),"creation retry retains original request");
  await Call($"rfqs/{id}/materials/part-requests","junior",command,"POST",409);
  var allow=new SimMaterialPartActionRequest(Token(batch),"ALLOW_ESTIMATE","Synthetic engineering basis verified for estimate only");
  batch=await Call($"technical-review/part-requests/{batchId}/actions",body:allow,method:"POST");check(batch.GetProperty("estimateAllowed").GetBoolean(),"reviewer allowance is explicit");
  var updateId=Guid.NewGuid().ToString();var updateEvidence=await Evidence(Token(batch),"Revised synthetic engineering evidence.",updateId);
  var update=new SimMaterialPartUpdateRequest(Token(batch),updateId,"Revised synthetic request reason","fixture engineering record 2",[updateEvidence.GetProperty("documentId").GetString()!]);
  await Call($"rfqs/{id}/materials/part-requests/{batchId}/update","michelle",update,"POST",403);
  await Call($"rfqs/{id}/materials/part-requests/{batchId}/update","ray",update with{ExpectedToken="stale"},"POST",409);
  batch=await Call($"rfqs/{id}/materials/part-requests/{batchId}/update","ray",update,"POST");
  check(batch.GetProperty("requestRevision").GetInt32()==2&&!batch.GetProperty("estimateAllowed").GetBoolean(),"reason/evidence update appends revision and clears prior estimate allowance");
  repeat=await Call($"rfqs/{id}/materials/part-requests/{batchId}/update","ray",update,"POST");check(repeat.GetProperty("requestRevision").GetInt32()==2,"update retry does not add a revision");
  foreach(var e in batch.GetProperty("requestEvidence").GetProperty("attachments").EnumerateArray()){
   var url=e.GetProperty("downloadUrl").GetString()!;check(url.StartsWith("/api/quoting/v1/"),"updated evidence URL belongs to candidate");
   using var get=new HttpRequestMessage(HttpMethod.Get,url);get.Headers.Add("X-Fixture-Session","ray");using var response=await client.SendAsync(get);var bytes=await response.Content.ReadAsByteArrayAsync();check(response.IsSuccessStatusCode&&Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))==e.GetProperty("sha256").GetString(),"archived request evidence retrieves exact hash");
  }
  var route=new SimMaterialPartActionRequest(Token(batch),"SEND_TO_LIBRARY","Resolve synthetic proposed number in controlled package");
  batch=await Call($"technical-review/part-requests/{batchId}/actions",body:route,method:"POST");
  await Call($"technical-review/part-requests/{batchId}/actions",body:route,method:"POST");
  await Call($"rfqs/{id}/materials/part-requests/{batchId}/update","ray",update with{UpdateId=Guid.NewGuid().ToString(),ExpectedToken=Token(batch)},"POST",409);
  var queue=await Call($"assembly-library/part-requests/{batchId}","adan");check(queue.GetProperty("status").GetString()=="IN_LIBRARY","routed request visible to Library clerk");
  check(SimRfqIntakeStore.SupportsInternalBomRoute(3,"INTERNAL_BOM_UPDATE","TECHNICAL_REVIEW",null),"new review-only request needs no blanket attestation");
  check(SimRfqIntakeStore.SupportsInternalBomRoute(1,"INTERNAL_BOM_UPDATE","TECHNICAL_REVIEW",true),"legitimate explicitly attested legacy route retained");
  check(!SimRfqIntakeStore.SupportsInternalBomRoute(2,"INTERNAL_BOM_UPDATE","TECHNICAL_REVIEW",false),"explicit legacy restriction stays blocked");
  check(!SimRfqIntakeStore.SupportsInternalBomRoute(3,"ASK_CUSTOMER","CUSTOMER",null),"customer approval route remains separate");
  check(!SimRfqIntakeStore.SupportsInternalBomRoute(99,"INTERNAL_BOM_UPDATE","TECHNICAL_REVIEW",null),"unknown unattested format fails closed");
  var results=await Call($"technical-review/part-requests/{batchId}/approved-result");
  check(results.GetProperty("items").GetArrayLength()==0,"no final-approved replacement selectable before Library revision");
  await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",body:new SimBomAdoptCommand("unlinked",Guid.NewGuid().ToString()),method:"POST",expected:409);
  var l=new LibraryClient(new Transport(client));var clerk=ConnectedActors.Persona("adan")!;var reviewer=ConnectedActors.Persona("junior")!;
  var summary=await Call($"assembly-library/package/preview?key={key}&preparationId={preparationId}","adan");
  await l.SubmitReviewedPackage(new(key,summary.GetProperty("packageToken").GetString()!,"START_CHANGES",summary.GetProperty("bomToken").GetString()!),clerk,new());
  var bom=await l.Get(key,clerk);
  await l.Change(new(key,bom.Token,"ACCEPT_ROW",DrawingRevision:"N",BomRevision:"N",QuantityBasis:"PER_ASSEMBLY",Rows:[row with{IdentityBasis="MFG",ManufacturerPartNumber="SYNTHETIC-PROPOSED-1",ManufacturerName="Synthetic manufacturer",IdentityConfirmed=true}],RowId:row.Id),clerk);
  summary=await Call($"assembly-library/package/preview?key={key}&preparationId={preparationId}","adan");
  check(summary.GetProperty("canSubmit").GetBoolean(),"revised controlled package can submit");
  var submitted=JsonSerializer.SerializeToElement(await l.SubmitReviewedPackage(new(key,summary.GetProperty("packageToken").GetString()!,"SUBMIT",summary.GetProperty("bomToken").GetString()!,summary.GetProperty("documentsToken").GetString()!,PreparationId:preparationId,ExpectedPreviewToken:summary.GetProperty("previewToken").GetString(),SubmissionNote:"Synthetic part resolution"),clerk,new()));
  var versions=submitted.GetProperty("record").GetProperty("versions");var latest=versions[versions.GetArrayLength()-1];
  await l.ChangePackage(new(key,submitted.GetProperty("packageToken").GetString()!,"APPROVE",ReviewId:latest.GetProperty("id").GetString()),reviewer,true);
  var pinned=D<SimMaterialView>(await Call($"rfqs/{id}/materials"));check(pinned.Rfq.LibraryRfq!.PackageVersion==material.Rfq.LibraryRfq!.PackageVersion,"Library approval alone leaves original RFQ package pinned");
  results=await Call($"technical-review/part-requests/{batchId}/approved-result");
  check(results.GetProperty("items").GetArrayLength()==1,"only exact final-approved replacement is eligible");
  var selected=results.GetProperty("items")[0];
  var link=new SimBomUpdateCommand(Token(results),selected.GetProperty("packageId").GetString()!,selected.GetProperty("governingDocumentId").GetString());
  await Call($"technical-review/part-requests/{batchId}/approved-result","adan",link,"POST",403);
  await Call($"technical-review/part-requests/{batchId}/approved-result",body:link with{ExpectedToken="stale"},method:"POST",expected:409);
  await Call($"technical-review/part-requests/{batchId}/approved-result",body:link,method:"POST");
  await Call($"technical-review/part-requests/{batchId}/approved-result",body:link,method:"POST");
  var compare=await Call($"rfqs/{id}/bom-updates/{batchId}");
  check(compare.GetProperty("materialsRecheck").GetBoolean()&&compare.GetProperty("laborRecheck").GetBoolean(),"comparison explicitly requires both affected lane reviews");
  var adoption=new SimBomAdoptCommand(Token(compare),Guid.NewGuid().ToString());
  foreach(var actor in new[]{"ray","michelle","adan"})await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",actor,adoption,"POST",403);
  await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",body:adoption with{ExpectedToken="stale"},method:"POST",expected:409);
  var adopted=await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",body:adoption,method:"POST");
  check(adopted.GetProperty("adopted").GetBoolean(),"explicit authorized adoption succeeds");
  repeat=await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",body:adoption,method:"POST");check(repeat.GetProperty("duplicate").GetBoolean(),"adoption retry returns one retained result");
  await Call($"rfqs/{id}/bom-updates/{batchId}/adopt",body:adoption with{RequestId=Guid.NewGuid().ToString()},method:"POST",expected:409);
  var changed=D<SimMaterialView>(await Call($"rfqs/{id}/materials"));check(changed.Rfq.LibraryRfq!.PackageVersion>pinned.Rfq.LibraryRfq!.PackageVersion&&changed.Rfq.Lanes.Materials.Status=="IN_PROGRESS","adoption changes working baseline and returns materials to review");
  var changedLabor=D<SimLaborView>(await Call($"rfqs/{id}/labor"));
  check(changedLabor.Rfq.Lanes.Labor.Status=="IN_PROGRESS","adoption returns completed Labor to review");
  check(materialSnapshots==JsonSerializer.Serialize(changed.Plan.Versions)&&laborSnapshots==JsonSerializer.Serialize(changedLabor.Plan.Versions),"adoption retains exact completed Materials and Labor snapshots");
  var review=D<SimEstimateSubmissionView>(await Call($"rfqs/{id}/estimate-submission"));check(!review.CanSubmit,"adopted working estimate needs review before submission");
 }
}
