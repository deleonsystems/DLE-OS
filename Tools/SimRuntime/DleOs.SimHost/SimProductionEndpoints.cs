using Microsoft.Data.Sqlite;

internal static class SimProductionEndpoints
{
    internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimProductionService service)
    {
        async Task<IResult> Guard(HttpContext context,bool write,Func<SimPersona,Task<IResult>> action){
            if(!state.Current.IsHealthy)return Results.StatusCode(503);var actor=personas.Resolve(context);
            if(!actor.Can(write?"production.manage":"production.view"))return Results.StatusCode(403);
            context.Response.Headers.CacheControl="private, no-store";
            try{return await action(actor);}
            catch(KittingCaseProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
            catch(Exception e)when(e is InvalidOperationException or IOException or SqliteException or System.ComponentModel.Win32Exception){return Results.Json(new{code="production_unavailable",message="The verified Production package is unavailable. Refresh and resolve its retained source before continuing."},statusCode:503);}
        }
        const string route="/api/production/v1/work-orders/{workOrderNumber}";
        app.MapGet(route+"/instructions",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadJobInstructions(workOrderNumber,a))));
        app.MapGet(route+"/instructions/sources",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadInstructionSources(workOrderNumber,a))));
        app.MapGet(route+"/instructions/pages/{documentId}/{hash}/info",(string workOrderNumber,string documentId,string hash,HttpContext c)=>Guard(c,false,async a=>Results.Bytes(await service.ReadInstructionPage(workOrderNumber,documentId,hash,0,2200,a),"application/json")));
        app.MapGet(route+"/instructions/pages/{documentId}/{hash}/{page:int}",(string workOrderNumber,string documentId,string hash,int page,int? pixels,HttpContext c)=>Guard(c,false,async a=>Results.Bytes(await service.ReadInstructionPage(workOrderNumber,documentId,hash,page,pixels??2200,a),"image/png")));
        app.MapPut(route+"/instructions",(string workOrderNumber,SimJobInstructionSave r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.SaveJobInstructions(workOrderNumber,r,a))));
        app.MapPost(route+"/instructions/visuals",(string workOrderNumber,HttpContext c)=>Guard(c,true,async a=>{
            using var bytes=new MemoryStream();var buffer=new byte[81920];int count;
            while((count=await c.Request.Body.ReadAsync(buffer))>0){if(bytes.Length+count>8388608)return Results.StatusCode(413);bytes.Write(buffer,0,count);}
            var asset=await service.UploadInstructionAsset(workOrderNumber,c.Request.Headers["X-Instruction-Baseline"].ToString(),Uri.UnescapeDataString(c.Request.Headers["X-File-Name"].ToString()),bytes.ToArray(),a);
            return Results.Json(new{asset.DocumentId,asset.Sha256,asset.Name,asset.Type});
        }));
        app.MapGet(route+"/instructions/visuals/{documentId}",(string workOrderNumber,string documentId,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.OpenInstructionAsset(workOrderNumber,documentId,a);c.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(file.Bytes,file.Type);
        }));
        const string qualityRoute="/api/sim/quality/work-orders/{workOrderNumber}";
        app.MapGet(qualityRoute+"/release",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadQualityReview(workOrderNumber,a))));
        app.MapPost(qualityRoute+"/release",(string workOrderNumber,SimQualityReleaseRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.ApproveQualityRelease(workOrderNumber,r,a))));
        app.MapGet("/api/sim/kitting/work-orders/{workOrderNumber}/quality-release",async(string workOrderNumber,HttpContext c)=>{
            if(!state.Current.IsHealthy)return Results.StatusCode(503);
            var a=personas.Resolve(c);if(!a.Can("kitting.view"))return Results.StatusCode(403);
            c.Response.Headers.CacheControl="private, no-store";
            try{return Results.Json(await service.ReadQualityQueue(workOrderNumber,a));}
            catch(Exception e)when(e is KittingCaseProblem or SimRfqIntakeProblem){return Results.Json(new{message=e.Message},statusCode:409);}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
        });
        app.MapGet(qualityRoute+"/instructions",(string workOrderNumber,int? version,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadJobInstructions(workOrderNumber,a,true,version))));
        app.MapGet(qualityRoute+"/instructions/sources",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadInstructionSources(workOrderNumber,a,true))));
        app.MapGet(qualityRoute+"/instructions/pages/{documentId}/{hash}/info",(string workOrderNumber,string documentId,string hash,HttpContext c)=>Guard(c,false,async a=>Results.Bytes(await service.ReadInstructionPage(workOrderNumber,documentId,hash,0,2200,a,true),"application/json")));
        app.MapGet(qualityRoute+"/instructions/pages/{documentId}/{hash}/{page:int}",(string workOrderNumber,string documentId,string hash,int page,int? pixels,HttpContext c)=>Guard(c,false,async a=>Results.Bytes(await service.ReadInstructionPage(workOrderNumber,documentId,hash,page,pixels??2200,a,true),"image/png")));
        app.MapPut(qualityRoute+"/instructions",(string workOrderNumber,SimJobInstructionSave r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.SaveJobInstructions(workOrderNumber,r,a,true))));
        app.MapPost(qualityRoute+"/instructions/visuals",(string workOrderNumber,HttpContext c)=>Guard(c,true,async a=>{
            using var bytes=new MemoryStream();var buffer=new byte[81920];int count;
            while((count=await c.Request.Body.ReadAsync(buffer))>0){if(bytes.Length+count>8388608)return Results.StatusCode(413);bytes.Write(buffer,0,count);}
            var asset=await service.UploadInstructionAsset(workOrderNumber,c.Request.Headers["X-Instruction-Baseline"].ToString(),Uri.UnescapeDataString(c.Request.Headers["X-File-Name"].ToString()),bytes.ToArray(),a,true);
            return Results.Json(new{asset.DocumentId,asset.Sha256,asset.Name,asset.Type});
        }));
        app.MapGet(qualityRoute+"/instructions/visuals/{documentId}",(string workOrderNumber,string documentId,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.OpenInstructionAsset(workOrderNumber,documentId,a,true);c.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(file.Bytes,file.Type);
        }));
        app.MapGet(route,(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.Read(workOrderNumber,a))));
        app.MapPost(route+"/team-input",(string workOrderNumber,SimProductionTeamSave r,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.SaveTeamInput(workOrderNumber,r,a))));
        app.MapPost(route+"/production-visuals",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>{
            var metadata=Uri.UnescapeDataString(c.Request.Headers["X-Production-Visual"].ToString());
            SimProductionVisualUpload? r;try{r=System.Text.Json.JsonSerializer.Deserialize<SimProductionVisualUpload>(metadata,SimProductionService.Json);}catch(System.Text.Json.JsonException){return Results.BadRequest(new{message="Invalid visual scope."});}
            if(r is null)return Results.BadRequest();
            return Results.Json(await service.UploadProductionVisual(workOrderNumber,r,Uri.UnescapeDataString(c.Request.Headers["X-File-Name"].ToString()),c.Request.Body,a));
        }));
        app.MapGet(route+"/production-visuals/{visualId:guid}",(string workOrderNumber,Guid visualId,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.OpenProductionVisual(workOrderNumber,visualId,a);c.Response.Headers["X-Content-Type-Options"]="nosniff";
            c.Response.Headers["Content-Security-Policy"]="default-src 'none'; sandbox";return Results.File(file.Bytes,file.Type);
        }));
        app.MapPost(route+"/wo-traveler/edit",(string workOrderNumber,SimWoRevisionBeginRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.BeginWoRevision(workOrderNumber,r,a))));
        app.MapPut(route+"/wo-traveler/draft",(string workOrderNumber,SimWoRevisionSaveRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.SaveWoRevision(workOrderNumber,r,a))));
        app.MapPost(route+"/wo-traveler/approve",(string workOrderNumber,SimWoRevisionApproveRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.ApproveWoRevision(workOrderNumber,r,a))));
        app.MapGet(route+"/wo-traveler/revisions/{revisionId:guid}",(string workOrderNumber,Guid revisionId,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.ReadRevision(workOrderNumber,revisionId,a))));
        app.MapGet(route+"/wo-traveler/draft.pdf",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>
            Results.File(await SimProductionPrint.Create(await service.Read(workOrderNumber,a),"traveler",a,DateTimeOffset.UtcNow,true),"application/pdf")));
        app.MapPost(route+"/traveler/seed",(string workOrderNumber,SimTravelerSeedRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.Seed(workOrderNumber,r,a))));
        app.MapPost(route+"/traveler/lease",(string workOrderNumber,SimTravelerVersionRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.Lease(workOrderNumber,r,a))));
        app.MapPut(route+"/traveler/draft",(string workOrderNumber,SimTravelerDraftRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.Draft(workOrderNumber,r,a))));
        app.MapPost(route+"/traveler/approve",(string workOrderNumber,SimTravelerApproveRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.Approve(workOrderNumber,r,a))));
        app.MapPost(route+"/traveler/bind",(string workOrderNumber,SimTravelerBindRequest r,HttpContext c)=>Guard(c,true,async a=>Results.Json(await service.Bind(workOrderNumber,r,a))));
        app.MapGet(route+"/documents/{documentId}",(string workOrderNumber,string documentId,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.Document(workOrderNumber,documentId,false,a);return Results.File(file.Bytes,file.Type);}));
        app.MapGet(route+"/visuals/{documentId}",(string workOrderNumber,string documentId,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.Document(workOrderNumber,documentId,true,a);return Results.File(file.Bytes,file.Type);}));
        app.MapGet(route+"/kitting.pdf",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>{
            var file=await service.KittingPdf(workOrderNumber,a);return Results.File(file.Bytes,"application/pdf");}));
        foreach(var kind in new[]{"traveler","bom"})app.MapGet(route+"/"+kind+".pdf",(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>{
            var bytes=await SimProductionPrint.Create(await service.Read(workOrderNumber,a),kind,a,DateTimeOffset.UtcNow);return Results.File(bytes,"application/pdf");}));
        // Intentionally no Production Start, operation Start/Complete or execution endpoints in this foundation.
    }
}
