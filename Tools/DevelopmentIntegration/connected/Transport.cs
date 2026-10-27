using System.Net.Http.Json;
using System.Text.Json;

internal sealed class Transport(HttpClient client)
{
 internal static string E(string s)=>Uri.EscapeDataString(s);
 internal static string Who(SimPersona? p)=>p?.Id switch{"11111111-1111-1111-1111-111111111111"=>"ray","22222222-2222-2222-2222-222222222222"=>"michelle","44444444-4444-4444-4444-444444444444"=>"adan",_=>"junior"};
 internal async Task<T> Send<T>(string path,object? body=null,SimPersona? p=null,HttpContent? content=null){
  using var r=new HttpRequestMessage(body==null&&content==null?HttpMethod.Get:HttpMethod.Post,"/api/quoting/v1/"+path);
  r.Headers.Add("X-Fixture-Session",Who(p));r.Headers.Add("X-Rehearsal-Intent","fixture-only");r.Content=content??(body==null?null:JsonContent.Create(body));
  using var response=await client.SendAsync(r);var text=await response.Content.ReadAsStringAsync();
  if(!response.IsSuccessStatusCode)throw new Exception($"{r.Method} {path}: {(int)response.StatusCode} {text}");
  return JsonSerializer.Deserialize<T>(text,SimLibraryBomStore.Json)!;
 }
}
internal sealed class RfqClient(Transport t)
{
 internal async Task<SimRfqIntakeDocument> StageDocument(string draft,string name,long modified,Stream s,SimPersona p){using var b=new MemoryStream();await s.CopyToAsync(b);return await t.Send<SimRfqIntakeDocument>($"intake-drafts/{draft}/documents?name={Transport.E(name)}",p:p,content:new ByteArrayContent(b.ToArray()));}
 internal Task<object> CreateAsync(SimRfqIntakeCreateRequest r,SimPersona p,SimStateMetadata m)=>t.Send<object>("rfq-intakes",r,p);
 internal Task<PreparationIntake> PreparationSource(string id)=>t.Send<PreparationIntake>($"technical-review/source?intakeId={Transport.E(id)}");
 internal async Task<(SimRfqIntakeDocument Document,byte[] Bytes)> OpenDocument(string id,string doc){var f=await t.Send<SourceFile>($"technical-review/source/file?intakeId={Transport.E(id)}&documentId={doc}");return(f.Document,f.Bytes);}
 internal Task<object> PreviewRfqHandoff(string id,int line,SimPersona p)=>t.Send<object>($"technical-review/rfq-handoff?intakeId={Transport.E(id)}&lineNumber={line}",p:p);
 internal Task<object> SendRfqHandoff(SimLibraryRfqHandoffCommand r,SimPersona p)=>t.Send<object>("technical-review/rfq-handoff",r,p);
 internal Task<SimMaterialView> ReadMaterials(string id)=>t.Send<SimMaterialView>($"rfqs/{id}/materials");
 internal Task<SimMaterialView> SaveMaterials(string id,SimMaterialRequest r,SimPersona p)=>t.Send<SimMaterialView>($"rfqs/{id}/materials",r,p);
 internal Task<SimLaborView> ReadLabor(string id)=>t.Send<SimLaborView>($"rfqs/{id}/labor");
 internal Task<SimLaborView> SaveLabor(string id,SimLaborRequest r,SimPersona p)=>t.Send<SimLaborView>($"rfqs/{id}/labor",r,p);
 internal Task<SimEstimateSubmissionView> ReadEstimateSubmission(string id,SimPersona p)=>t.Send<SimEstimateSubmissionView>($"rfqs/{id}/estimate-submission",p:p);
 internal Task<SimEstimateSubmissionView> SubmitEstimate(string id,SimEstimateSubmitRequest r,SimPersona p)=>t.Send<SimEstimateSubmissionView>($"rfqs/{id}/estimate-submission",r,p);
 internal Task<SimQuoteSourceView> ReadQuoteSource(string id,SimPersona p)=>t.Send<SimQuoteSourceView>($"rfqs/{id}/quote-source",p:p);
 internal Task<SimQuoteDraftView> RenderQuoteCopy(string id,SimQuoteDraftRequest r,SimPersona p)=>t.Send<SimQuoteDraftView>($"rfqs/{id}/preview",r,p);
 internal Task<SimQuoteCopyView> SaveQuoteCopy(string id,SimQuoteSaveRequest r,SimPersona p)=>t.Send<SimQuoteCopyView>($"rfqs/{id}/copies",r,p);
 internal Task<SimQuoteCopyView> RecordManualQuoteSend(string id,string copy,SimQuoteManualSendRequest r,SimPersona p)=>t.Send<SimQuoteCopyView>($"rfqs/{id}/copies/{copy}/manual-send",r,p);
 private sealed record SourceFile(SimRfqIntakeDocument Document,byte[] Bytes);
}
internal sealed class PreparationClient(Transport t)
{
 internal Task<object> Assessment(string id,int line,SimPersona p)=>t.Send<object>($"technical-review/preparation?intakeId={Transport.E(id)}&lineNumber={line}",p:p);
 internal Task<object> Assess(PreparationCommand r,SimPersona p)=>t.Send<object>("technical-review/preparation",r,p);
 internal Task<object> Work(PreparationWorkCommand r,SimPersona p)=>t.Send<object>("assembly-library/preparation",r,p);
 internal Task<object> Disposition(PreparationFileDispositionCommand r,SimPersona p,object? ignored=null)=>t.Send<object>("assembly-library/preparation/file-disposition",r,p);
}
internal sealed class LibraryClient(Transport t)
{
 internal Task<LibraryFolderView> Folder(string key,SimPersona p)=>t.Send<LibraryFolderView>($"assembly-library/folder?key={Transport.E(key)}",p:p);
 internal Task<LibraryFolderView> LinkFolder(LibraryFolderCommand r,SimPersona p)=>t.Send<LibraryFolderView>("assembly-library/folder",r,p);
 internal Task<LibraryBomView> Get(string key,SimPersona p)=>t.Send<LibraryBomView>($"assembly-library/bom?key={Transport.E(key)}",p:p);
 internal Task<LibraryBomView> Change(LibraryBomCommand r,SimPersona p)=>t.Send<LibraryBomView>("assembly-library/bom",r,p);
 internal Task<object> Documents(string key,SimPersona p)=>t.Send<object>($"assembly-library/documents?key={Transport.E(key)}",p:p);
 internal Task<object> DescribeDocument(string key,string token,string path,SimPersona p)=>t.Send<object>($"assembly-library/documents/describe?key={Transport.E(key)}&folderToken={token}&relativePath={Transport.E(path)}",p:p);
 internal Task<object> SaveDocument(LibraryDocumentCommand r,SimPersona p)=>t.Send<object>("assembly-library/documents",r,p);
 internal Task<object> ReviewPreview(string key,string id,SimPersona p,object ignored)=>t.Send<object>($"assembly-library/package/preview?key={Transport.E(key)}&preparationId={id}",p:p);
 internal Task<object> SubmitReviewedPackage(LibraryPackageCommand r,SimPersona p,object ignored)=>t.Send<object>("assembly-library/package",r,p);
 internal Task<object> ChangePackage(LibraryPackageCommand r,SimPersona p,bool review)=>t.Send<object>("technical-review/library-packages",r,p);
}
