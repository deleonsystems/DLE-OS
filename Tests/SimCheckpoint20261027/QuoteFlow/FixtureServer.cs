using System.Text.Json;
internal static class FixtureServer
{
 internal static async Task Run(string output){
 var q=await QuoteFixture.Create();var admin=SimPersonaCatalog.Default;var builder=WebApplication.CreateBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls("http://127.0.0.1:0");var app=builder.Build();
 SimPersona Actor(HttpContext c)=>SimPersonaCatalog.Get(c.Request.Headers["X-Quote-Fixture-Actor"].ToString())??SimPersonaCatalog.Get("ray")!;
 bool Allow(HttpContext c,bool archive=false){var a=Actor(c);return archive?a.Can("rfq.view")&&a.Can("assembly_library.view"):a.Can("rfq.quote.prepare");}
 app.Use(async(c,next)=>{try{await next();}catch(SimRfqIntakeProblem e){c.Response.StatusCode=e.StatusCode;await c.Response.WriteAsJsonAsync(new{code=e.Code,message=e.Message});}catch(LibraryBomPermissionException){c.Response.StatusCode=403;}});
 app.MapGet("/fixture",async()=>{var m=await q.Store.ReadMaterials(q.Id);return Results.Json(new{rfq=m.Rfq,context=new{key=q.F.Receipts[0].Binding.LibraryKey,drawingRevision=q.F.Packages[0].Bom.DrawingRevision,bomRevision=q.F.Packages[0].Bom.BomRevision},permissions=SimPersonaCatalog.Get("ray")!.Permissions});});
 app.MapGet("/fixture/protected",async()=>{var m=await q.Store.ReadMaterials(q.Id);return Results.Json(new{sourceUnchanged=q.F.SourcesUnchanged(),keptUnchanged=q.KeptBytes==await File.ReadAllTextAsync(Path.Combine(q.F.Root,"material-part-requests-v1",q.Kept.Id+".json")),noIssuance=m.Rfq.Lanes.Commercial is null&&m.Rfq.Lanes.FinalReviews is null&&m.Rfq.Lanes.EstimateSubmissions is null,materialsVersion=m.Plan.Versions.Last().Version});});
 app.MapGet("/api/sim/rfqs/commercial",async()=>Results.Json(await q.Store.ReadRfqCommercialQueue()));
 app.MapPost("/api/sim/rfqs/{id}/quote-copies/{copyId}/manual-send",async Task<IResult>(string id,string copyId,SimQuoteManualSendRequest r,HttpContext c)=>Allow(c)?Results.Json(await q.Store.RecordManualQuoteSend(id,copyId,r,Actor(c))):Results.StatusCode(403));
 app.MapGet("/api/sim/rfqs/{id}/final-review",async(string id)=>Results.Json(await q.Store.ReadFinalReview(id)));
 app.MapGet("/api/sim/rfqs/{id}/estimate-submission",async(string id,HttpContext c)=>Results.Json(await q.Store.ReadEstimateSubmission(id,Actor(c))));
 app.MapGet("/api/sim/rfqs/{id}/quote-copies",async Task<IResult>(string id,HttpContext c)=>Allow(c)?Results.Json(await q.Store.ReadQuoteSource(id,Actor(c))):Results.StatusCode(403));
 app.MapPost("/api/sim/rfqs/{id}/quote-copies/preview",async Task<IResult>(string id,SimQuoteDraftRequest r,HttpContext c)=>Allow(c)?Results.Json(await q.Store.RenderQuoteCopy(id,r,Actor(c))):Results.StatusCode(403));
 app.MapPost("/api/sim/rfqs/{id}/quote-copies",async Task<IResult>(string id,SimQuoteSaveRequest r,HttpContext c)=>Allow(c)?Results.Json(await q.Store.SaveQuoteCopy(id,r,Actor(c))):Results.StatusCode(403));
 async Task<IResult> Pdf(HttpContext c,Func<Task<SimQuoteCopyFile>> read,bool archive=false){if(!Allow(c,archive))return Results.StatusCode(403);var f=await read();if(c.Request.Query["download"]=="true")return Results.File(f.Bytes,"application/pdf",f.Name);c.Response.Headers.ContentDisposition="inline; filename=\""+f.Name+"\"";return Results.File(f.Bytes,"application/pdf");}
 app.MapGet("/api/sim/rfqs/{id}/quote-copies/drafts/{draftId}/pdf",(string id,string draftId,HttpContext c)=>Pdf(c,()=>q.Store.ReadDraftQuotePdf(id,draftId,Actor(c))));
 app.MapGet("/api/sim/assembly-library/estimates",async Task<IResult>(string key,string drawingRevision,string bomRevision,HttpContext c)=>Allow(c,true)?Results.Json(await q.Store.ReadAssemblyEstimates(key,drawingRevision,bomRevision,Actor(c))):Results.StatusCode(403));
 app.MapGet("/api/sim/assembly-library/estimates/version",async Task<IResult>(string key,string drawingRevision,string bomRevision,string rfqId,string estimateId,HttpContext c)=>Allow(c,true)?Results.Json(await q.Store.ReadAssemblyEstimate(key,drawingRevision,bomRevision,rfqId,estimateId,Actor(c))):Results.StatusCode(403));
 app.MapGet("/api/sim/assembly-library/quote-copies/{copyId}/pdf",(string copyId,string key,string drawingRevision,string bomRevision,string rfqId,HttpContext c)=>Pdf(c,()=>q.Store.ReadSavedQuotePdf(copyId,key,drawingRevision,bomRevision,rfqId,Actor(c)),true));
 app.MapPost("/fixture/stop",()=>{app.Lifetime.StopApplication();return Results.Ok();});
 await app.StartAsync();await File.WriteAllTextAsync(Path.Combine(output,"SERVER.json"),JsonSerializer.Serialize(new{url=app.Urls.Single(),fixtureRoot=q.F.Root,pid=Environment.ProcessId}));await app.WaitForShutdownAsync();
 }
}
