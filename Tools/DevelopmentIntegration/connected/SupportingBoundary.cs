using System.Text.Json;
using System.Text.Json.Nodes;
internal static class SupportingBoundary
{
 internal static IResult JsonView(object value){var node=JsonSerializer.SerializeToNode(value,SimLibraryBomStore.Json);void Visit(JsonNode? n){if(n is JsonObject o){foreach(var key in o.Select(x=>x.Key).ToArray()){if(key is "downloadUrl" or "url"&&o[key] is JsonValue v&&v.TryGetValue<string>(out var s)&&s.StartsWith("/api/sim/",StringComparison.Ordinal))o[key]="/api/quoting/v1/"+s[9..];else Visit(o[key]);}}else if(n is JsonArray a)foreach(var item in a)Visit(item);}Visit(node);return Results.Json(node);}
 internal static void MapSupporting(this WebApplication app,SimRfqIntakeStore store,ConnectedActors actors){
  SimPersona Need(HttpContext c,string permission){var p=actors.Resolve(c);if(!p.Can(permission))throw new LibraryBomPermissionException();return p;}
  // Only URL-bearing DTO fields are remapped; record text, identifiers and evidence are untouched.
  IResult Json(object value)=>JsonView(value);
  app.MapPost("/api/quoting/v1/rfqs/{id}/holds/{section}",async(string id,string section,SimRfqSectionHoldRequest r,HttpContext c)=>Json(await store.TransitionRfqSectionHold(id,section,r,Need(c,"technical_review.disposition"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/labor/revise",async(string id,SimLaborReviseRequest r,HttpContext c)=>Json(await store.ReviseLabor(id,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/forms/labor-templates",async(HttpContext c)=>Json(await store.ListLaborTemplates(Need(c,"assembly_library.view"))));
  app.MapGet("/api/quoting/v1/forms/labor-templates/{templateId}",async(string templateId,HttpContext c)=>Json(await store.GetLaborTemplate(templateId,Need(c,"assembly_library.view"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor/template-preview",async(string id,HttpContext c)=>Json(await store.PreviewLaborTemplate(id,Need(c,"rfq.view"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/labor/templates",async(string id,SimLaborTemplateSave r,HttpContext c)=>Json(await store.SaveLaborTemplate(id,r,Need(c,"technical_review.disposition"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/labor/use-template",async(string id,SimLaborTemplateUse r,HttpContext c)=>Json(await store.UseLaborTemplate(id,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor/drawing-notes",async(string id,int? version,HttpContext c)=>Json(await store.ReadDrawingNotes(id,Need(c,"rfq.view"),version)));
  app.MapPut("/api/quoting/v1/rfqs/{id}/labor/drawing-notes/{step}",async(string id,string step,SimDrawingNotesRequest r,HttpContext c)=>Json(await store.SaveDrawingNotes(id,step,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor/drawing-notes/pages/{documentId}/{sha256}/info",async(string id,string documentId,string sha256,HttpContext c)=>Json(new{pageCount=await store.DrawingNotesPageCount(id,documentId,sha256,Need(c,"rfq.view"))}));
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor/drawing-notes/pages/{documentId}/{sha256}/{page:int}",async(string id,string documentId,string sha256,int page,int? pixels,HttpContext c)=>Results.File(await store.DrawingNotesPage(id,documentId,sha256,page,Need(c,"rfq.view"),pixels??2200),"image/png"));
  app.MapGet("/api/quoting/v1/rfqs/{id}/bom-process",async(string id,HttpContext c)=>Json(await store.ReadBomProcess(id,Need(c,"technical_review.view"))));
  app.MapPut("/api/quoting/v1/rfqs/{id}/bom-process",async(string id,SimBomProcessRequest r,HttpContext c)=>Json(await store.SaveBomProcess(id,r,Need(c,"technical_review.disposition"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/materials/part-requests",async(string id,SimMaterialPartCreate r,HttpContext c)=>Json(await store.CreateMaterialPartRequest(id,r,Need(c,"rfq.part_requests.create"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials/part-requests/{batchId}",async(string id,string batchId,HttpContext c)=>Json(await store.ReadMaterialPartBatch(batchId,"materials",Need(c,"rfq.view"),id)));
  app.MapPost("/api/quoting/v1/rfqs/{id}/materials/part-requests/{batchId}/update",async(string id,string batchId,SimMaterialPartUpdateRequest r,HttpContext c)=>Json(await store.UpdateMaterialPartRequest(id,batchId,r,Need(c,"rfq.part_requests.create"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/materials/part-requests/{batchId}/actions",async(string id,string batchId,SimMaterialPartActionRequest r,HttpContext c)=>Json(await store.CancelPartRequest(id,batchId,r,Need(c,"rfq.part_requests.create"))));
  async Task<IResult> Evidence(string batchId,string documentId,string scope,SimPersona p,string? id=null){var f=await store.OpenMaterialPartEvidence(batchId,documentId,scope,p,id);return Results.File(f.Bytes,f.Type,f.Name);}
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials/part-requests/{batchId}/evidence/{documentId}",(string id,string batchId,string documentId,HttpContext c)=>Evidence(batchId,documentId,"materials",Need(c,"rfq.view"),id));
  foreach(var scope in new[]{"technical-review","library"}){var captured=scope;var route=scope=="library"?"assembly-library":"technical-review";var permission=scope=="library"?"assembly_library.view":"technical_review.view";
   app.MapGet("/api/quoting/v1/"+route+"/part-requests/{batchId}",async(string batchId,HttpContext c)=>Json(await store.ReadMaterialPartBatch(batchId,captured,Need(c,permission))));
   app.MapGet("/api/quoting/v1/"+route+"/part-requests/{batchId}/evidence/{documentId}",(string batchId,string documentId,HttpContext c)=>Evidence(batchId,documentId,captured,Need(c,permission)));
  }
  app.MapPost("/api/quoting/v1/technical-review/part-requests/{batchId}/actions",async(string batchId,SimMaterialPartActionRequest r,HttpContext c)=>Json(await store.ActMaterialPartRequest(batchId,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/technical-review/part-requests/{batchId}/approved-result",async(string batchId,HttpContext c)=>Json(await store.ReadBomResults(batchId,Need(c,"technical_review.view"))));
  app.MapPost("/api/quoting/v1/technical-review/part-requests/{batchId}/approved-result",async(string batchId,SimBomUpdateCommand r,HttpContext c)=>Json(await store.LinkBomResult(batchId,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/bom-updates/{batchId}",async(string id,string batchId,HttpContext c)=>Json(await store.PreviewBomUpdate(id,batchId,Need(c,"rfq.view"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/bom-updates/{batchId}/adopt",async(string id,string batchId,SimBomAdoptCommand r,HttpContext c)=>Json(await store.AdoptBomUpdate(id,batchId,r,Need(c,"technical_review.disposition"))));
  async Task<IResult> Upload<T>(HttpContext c,string right,Func<T,string,Stream,SimPersona,Task<object>> action){
   var p=Need(c,right);if(!c.Request.HasFormContentType)return Results.BadRequest();
   var form=await c.Request.ReadFormAsync(new Microsoft.AspNetCore.Http.Features.FormOptions{MultipartBodyLengthLimit=6*1024*1024,ValueLengthLimit=4096});
   if(form.Files.Count!=1||form["metadata"].ToString().Length>4096)return Results.BadRequest();
   var file=form.Files[0];if(file.Length==0||file.Length>5*1024*1024)return Results.StatusCode(413);
   T? r;try{r=JsonSerializer.Deserialize<T>(form["metadata"].ToString(),new JsonSerializerOptions(JsonSerializerDefaults.Web));}catch(JsonException){return Results.BadRequest();}if(r is null)return Results.BadRequest();
   await using var stream=file.OpenReadStream();return Json(await action(r,file.FileName,stream,p));
  }
  app.MapPost("/api/quoting/v1/rfqs/{id}/materials/part-requests/evidence",(string id,HttpContext c)=>Upload<SimPartRequestUpload>(c,"rfq.part_requests.create",async(r,n,s,p)=>await store.StagePartRequestEvidence(id,r,n,s,p)));
  app.MapPost("/api/quoting/v1/rfqs/{id}/materials/attachments",(string id,HttpContext c)=>Upload<SimMaterialEvidenceUpload>(c,"rfq.materials.edit",async(r,n,s,p)=>await store.StageMaterialAttachment(id,r,n,s,p)));
  app.MapPost("/api/quoting/v1/rfqs/{id}/labor/visuals",(string id,HttpContext c)=>Upload<SimLaborVisualUpload>(c,"technical_review.disposition",async(r,n,s,p)=>await store.StageLaborVisual(id,r,n,s,p)));
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials/attachments/{documentId}",async(string id,string documentId,HttpContext c)=>{Need(c,"rfq.view");var f=await store.OpenMaterialAttachment(id,documentId);c.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(f.Bytes,f.Attachment.Type,f.Attachment.Name);});
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor/visuals/{documentId}",async(string id,string documentId,HttpContext c)=>{Need(c,"rfq.view");var f=await store.OpenLaborVisual(id,documentId);c.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(f.Bytes,f.Visual.Type,f.Visual.Name);});
  app.MapGet("/api/quoting/v1/rfqs/{id}/previous-quotes",async(string id,string department,string? path,HttpContext c)=>Json(await store.PreviousQuotes(id,department,path,Need(c,"rfq.view"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/previous-quotes/describe",async(string id,string department,string folderToken,string path,HttpContext c)=>Json(await store.DescribePreviousQuote(id,department,folderToken,path,Need(c,"rfq.view"))));
  app.MapPut("/api/quoting/v1/rfqs/{id}/previous-quotes/selection",async(string id,SimPreviousQuoteCommand r,HttpContext c)=>Json(await store.SelectPreviousQuote(id,r,Need(c,"rfq.materials.edit"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/previous-quotes/file",async(string id,string department,string selectionToken,HttpContext c)=>{var f=await store.OpenSelectedPreviousQuote(id,department,selectionToken,Need(c,"rfq.view"));return Results.File(f.Bytes,f.Type,f.Name);});
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials/vendors",async(string id,string? q,HttpContext c)=>Json(await store.ReadMaterialVendors(id,q,Need(c,"rfq.view"))));
 }
}
