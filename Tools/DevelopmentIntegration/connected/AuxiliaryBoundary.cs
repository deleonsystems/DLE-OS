internal static class AuxiliaryBoundary
{
 internal static void MapAuxiliary(this WebApplication app,SimRfqIntakeStore store,SimLibraryPreparation prep,ConnectedActors actors){
  SimPersona EstimateActor(HttpContext c){var p=actors.Resolve(c);if(!p.Can("assembly_library.view")||!p.Can("rfq.view"))throw new LibraryBomPermissionException();return p;}
  async Task<IResult> Incoming(HttpContext c,string module,string intake,int line,string? id,string? document){
   var p=actors.Resolve(c);c.Response.Headers["X-Content-Type-Options"]="nosniff";
   if(module=="intake"&&!p.Can("rfq.intake.create"))throw new LibraryBomPermissionException();
   if(document is null)return Results.Json(await prep.IncomingPackage(intake,line,id,p,module));
   var f=await prep.IncomingPackageFile(intake,line,id,document,p,module);
   c.Response.Headers.ContentDisposition=new System.Net.Http.Headers.ContentDispositionHeaderValue(f.Type=="application/pdf"&&c.Request.Query["download"]!="true"?"inline":"attachment"){FileNameStar=f.Name}.ToString();
   return Results.File(f.Bytes,f.Type,enableRangeProcessing:true);
  }
  foreach(var module in new[]{"intake","review"}){
   var scope=module;var route=module=="review"?"technical-review":"intake";
   app.MapGet("/api/quoting/v1/"+route+"/incoming-package",(string intakeId,int lineNumber,HttpContext c)=>Incoming(c,scope,intakeId,lineNumber,null,null));
   app.MapGet("/api/quoting/v1/"+route+"/incoming-package/file",(string intakeId,int lineNumber,string documentId,HttpContext c)=>Incoming(c,scope,intakeId,lineNumber,null,documentId));
  }
  app.MapGet("/api/quoting/v1/assembly-library/incoming-package",(string id,HttpContext c)=>Incoming(c,"library","",0,id,null));
  app.MapGet("/api/quoting/v1/assembly-library/incoming-package/file",(string id,string documentId,HttpContext c)=>Incoming(c,"library","",0,id,documentId));
  foreach(var scope in new[]{"technical-review","library"}){
   var context=scope;var route=scope=="library"?"assembly-library":"technical-review";
   app.MapGet("/api/quoting/v1/"+route+"/part-requests",async(HttpContext c)=>SupportingBoundary.JsonView(await store.ReadMaterialPartQueue(context,actors.Resolve(c))));
  }
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials/part-requests",async(string id,HttpContext c)=>SupportingBoundary.JsonView(await store.ReadMaterialPartRequests(id,actors.Resolve(c))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/bom-updates",async(string id,HttpContext c)=>Results.Json(await store.ReadBomUpdateNotices(id,actors.Resolve(c))));
  app.MapGet("/api/quoting/v1/assembly-library/estimates",async(string key,string drawingRevision,string bomRevision,HttpContext c)=>{
   var data=System.Text.Json.JsonSerializer.SerializeToNode(await store.ReadAssemblyEstimates(key,drawingRevision,bomRevision,EstimateActor(c)),SimLibraryBomStore.Json)!;
   foreach(var item in data["items"]!.AsArray())foreach(var copy in item!["quoteCopies"]!.AsArray())copy!["url"]=SourceQuoteBoundary.ArchiveUrl(copy["url"]!.GetValue<string>());
   return Results.Json(data);
  });
  app.MapGet("/api/quoting/v1/assembly-library/estimates/version",async(string key,string drawingRevision,string bomRevision,string rfqId,string estimateId,HttpContext c)=>Results.Json(await store.ReadAssemblyEstimate(key,drawingRevision,bomRevision,rfqId,estimateId,EstimateActor(c))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/bom-reference",async(string id,HttpContext c)=>{
   if(!actors.Resolve(c).Can("rfq.view"))throw new LibraryBomPermissionException();
   var rfq=(await store.ReadRfqs()).SingleOrDefault(r=>r.IntakeId==id);if(rfq is null)return Results.NotFound();
   return Results.Content(SimRfqIntakeEndpoints.BomReference(rfq).Replace("/SRC/workspaces/rfqs/bom-reference.js","/incoming/SRC/workspaces/rfqs/bom-reference.js"),"text/html; charset=utf-8");
  });
  app.MapPost("/api/quoting/v1/pdf-readability",async(HttpContext c)=>{
   if(!actors.Resolve(c).Can("rfq.intake.create"))throw new LibraryBomPermissionException();
   using var data=new MemoryStream();await c.Request.Body.CopyToAsync(data,c.RequestAborted);
   return Results.Json(await SimPdfReadability.Inspect(data.ToArray()));
  });
 }
}
