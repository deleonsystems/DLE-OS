using System.Net.Http.Json;
using System.Text.Json;
internal static class SupportingChecks
{
 internal static async Task Run(HttpClient client,string id,Action<bool,string> check){
  async Task<JsonElement> Send(string path,string actor,int expected,object? body=null,string method="GET"){
   using var request=new HttpRequestMessage(new HttpMethod(method),"/api/quoting/v1/"+path);
   request.Headers.Add("X-Fixture-Session",actor);request.Headers.Add("X-Rehearsal-Intent","fixture-only");
   if(body!=null)request.Content=JsonContent.Create(body);
   using var response=await client.SendAsync(request);var text=await response.Content.ReadAsStringAsync();
   check((int)response.StatusCode==expected,$"support {method} {path}: {actor} expected {expected}, actual {(int)response.StatusCode}: "+(response.IsSuccessStatusCode?"ok":text));
   return string.IsNullOrEmpty(text)?default:JsonDocument.Parse(text).RootElement.Clone();
  }
  foreach(var path in new[]{"forms/labor-templates",$"rfqs/{id}/labor/template-preview",$"rfqs/{id}/labor/drawing-notes",$"rfqs/{id}/bom-process"})await Send(path,"junior",200);
  await Send("forms/labor-templates","adan",200);
  await Send($"rfqs/{id}/labor/drawing-notes","michelle",200);
  await Send($"rfqs/{id}/labor/drawing-notes","adan",403);
  await Send($"rfqs/{id}/bom-process","ray",403);
  await Send($"rfqs/{id}/materials/vendors","michelle",503);
  await Send($"rfqs/{id}/materials/vendors","adan",403);
  var requests=await Send($"rfqs/{id}/materials/part-requests","ray",200);
  var recipients=requests.GetProperty("recipients").EnumerateArray().ToArray();
  check(recipients.All(r=>r.GetProperty("id").GetString() is "TECHNICAL_REVIEW_TEAM" or "33333333-3333-3333-3333-333333333333"),"part-request recipients contain only candidate team and isolated reviewer");
  var notes=await Send($"rfqs/{id}/labor/drawing-notes","junior",200);
  var source=notes.GetProperty("source");var document=source.GetProperty("documentId").GetString();var hash=source.GetProperty("sha256").GetString();
  var pages=await Send($"rfqs/{id}/labor/drawing-notes/pages/{document}/{hash}/info","junior",200);
  check(pages.GetProperty("pageCount").GetInt32()>0,"retained synthetic drawing verified by actual PDF page reader");
  await Send($"rfqs/{id}/labor/drawing-notes/pages/{document}/{new string('0',64)}/info","junior",409);
  var hold=new SimRfqSectionHoldRequest("PLACE",0,Guid.NewGuid().ToString(),"Synthetic qualification hold");
  foreach(var actor in new[]{"ray","michelle","adan"})await Send($"rfqs/{id}/holds/materials",actor,403,hold,"POST");
  await Send($"rfqs/{id}/holds/materials","junior",200,hold,"POST");
  await Send($"rfqs/{id}/holds/materials","junior",200,hold,"POST");
  await Send($"rfqs/{id}/holds/materials","junior",409,hold with{RequestId=Guid.NewGuid().ToString()},"POST");
  await Send($"rfqs/{id}/holds/materials","junior",200,new SimRfqSectionHoldRequest("RELEASE",1,Guid.NewGuid().ToString()),"POST");
  foreach(var path in new[]{$"rfqs/{id}/labor/revise",$"rfqs/{id}/labor/templates",$"rfqs/{id}/labor/use-template",$"rfqs/{id}/bom-updates/missing/adopt","technical-review/part-requests/missing/actions","technical-review/part-requests/missing/approved-result"})
   await Send(path,"michelle",403,new{},"POST");
  await Send($"rfqs/{id}/labor/drawing-notes/assembly","michelle",403,new{},"PUT");
  await Send($"rfqs/{id}/bom-process","ray",403,new{},"PUT");
  await Send($"rfqs/{id}/materials/part-requests","michelle",403,new{},"POST");
  // These exercise denial before parsing, not browser uploads or successful file transfers.
  foreach(var path in new[]{$"rfqs/{id}/materials/part-requests/evidence",$"rfqs/{id}/materials/attachments",$"rfqs/{id}/labor/visuals"})await Send(path,"adan",403,new{},"POST");
 }
}
