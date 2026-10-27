using DleOs.Integration;

// Explicit adapter for unchanged checkpoint quote methods. No /api/sim endpoints are registered.
// Store must be dedicated to this integration; caller supplies an authenticated server resolver.
internal static class SourceQuoteBoundary
{
 internal static SimQuoteSourceView View(SimQuoteSourceView view)=>view with{Copies=view.Copies?.Select(c=>c with{PdfUrl=ArchiveUrl(c.PdfUrl)}).ToArray()};
 internal static string? ArchiveUrl(string? url){
  const string prefix="/api/sim/assembly-library/quote-copies/";
  if(url is null)return null;
  if(!url.StartsWith(prefix,StringComparison.Ordinal))throw new BoundaryProblem(503,"UNMAPPED_ARCHIVE_URL");
  return "/api/quoting/v1/assembly-library/quote-copies/"+url[prefix.Length..];
 }
 internal static void MapSourceQuoteBoundary(this WebApplication app,SimRfqIntakeStore store,IActorResolver resolver,IRequestIntegrity integrity)
 {
  app.Use(async(c,next)=>{try{await next();}
   catch(BoundaryProblem e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code});}
   catch(SimRfqIntakeProblem e){c.Response.StatusCode=e.StatusCode;await c.Response.WriteAsJsonAsync(new{code=e.Code,message=e.Message});}
  });
  async Task<SimPersona> Actor(HttpContext c,bool write,bool archive=false){
   var a=await resolver.Resolve(c)??throw new BoundaryProblem(401,"AUTHENTICATION_REQUIRED");
   if(a.UserId==Guid.Empty)throw new BoundaryProblem(401,"IDENTITY_NOT_BOUND");
   var required=archive?new[]{"rfq.view","assembly_library.view"}:new[]{"rfq.quote.prepare"};
   if(required.Any(p=>!a.Permissions.Contains(p)))throw new BoundaryProblem(403,"PERMISSION_DENIED");
   if(write&&!await integrity.Validate(c))throw new BoundaryProblem(403,"ANTIFORGERY_REQUIRED");
   // No SUPER_ADMIN conversion or permission inference at the API boundary.
   return new(a.UserId.ToString(),a.UserId.ToString(),a.DisplayName,"ACTIVE",[],a.Permissions.ToArray(),false,"Isolated DEV adapter");
  }
  async Task<T> Body<T>(HttpContext c){
   using var data=new MemoryStream();var buffer=new byte[8192];int n;
   while((n=await c.Request.Body.ReadAsync(buffer,c.RequestAborted))>0){if(data.Length+n>QuotingLimits.JsonLimit)throw new BoundaryProblem(413,"JSON_LIMIT");await data.WriteAsync(buffer.AsMemory(0,n),c.RequestAborted);}
   try{return System.Text.Json.JsonSerializer.Deserialize<T>(data.ToArray(),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))??throw new System.Text.Json.JsonException();}
   catch(System.Text.Json.JsonException){throw new BoundaryProblem(400,"INVALID_JSON");}
  }
  app.MapPost("/api/quoting/v1/rfqs/{id}/quote-copies/preview",async(string id,HttpContext c)=>{
   var a=await Actor(c,true);var r=await Body<SimQuoteDraftRequest>(c);var result=await store.RenderQuoteCopy(id,r,a);
   return Results.Json(result with{PdfUrl=$"/api/quoting/v1/rfqs/{Uri.EscapeDataString(id)}/drafts/{result.Id}/pdf"});
  });
  app.MapPost("/api/quoting/v1/rfqs/{id}/quote-copies",async(string id,HttpContext c)=>{
   var a=await Actor(c,true);var result=await store.SaveQuoteCopy(id,await Body<SimQuoteSaveRequest>(c),a);
   // Archive retrieval requires explicit Library/RFQ context; never return a SIM URL.
   return Results.Json(result with{PdfUrl=null});
  });
  app.MapGet("/api/quoting/v1/rfqs/{id}/quote-copies/drafts/{draft}/pdf",async(string id,string draft,HttpContext c)=>{
   var result=await store.ReadDraftQuotePdf(id,draft,await Actor(c,false));c.Response.Headers.CacheControl="no-store";
   return Results.File(result.Bytes,"application/pdf",result.Name);
  });
  app.MapGet("/api/quoting/v1/assembly-library/quote-copies/{copy}/pdf",async(string copy,string key,string drawingRevision,string bomRevision,string rfqId,HttpContext c)=>{
   var result=await store.ReadSavedQuotePdf(copy,key,drawingRevision,bomRevision,rfqId,await Actor(c,false,true));c.Response.Headers.CacheControl="no-store";
   return Results.File(result.Bytes,"application/pdf",result.Name);
  });
  app.MapPost("/api/quoting/v1/rfqs/{id}/quote-copies/{copy}/manual-send",async(string id,string copy,HttpContext c)=>{
   var a=await Actor(c,true);var result=await store.RecordManualQuoteSend(id,copy,await Body<SimQuoteManualSendRequest>(c),a);
   return Results.Json(result with{PdfUrl=null});
  });

 }
}
