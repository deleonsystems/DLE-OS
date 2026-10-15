using Microsoft.Data.Sqlite;
internal static class SimKittingEndpoints
{
    internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimKittingCases service)
    {
        async Task<IResult> Guard(HttpContext context,bool write,Func<SimPersona,Task<object>> action){
            if(!state.Current.IsHealthy)return Results.StatusCode(503);
            var actor=personas.Resolve(context);if(!actor.Can(write?"kitting.disposition":"kitting.view"))return Results.StatusCode(403);
            context.Response.Headers.CacheControl="private, no-store";
            try{return Results.Json(await action(actor));}
            catch(KittingCaseProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
            catch(Exception e)when(e is InvalidOperationException or IOException or SqliteException){return Results.Json(new{code="sim_kitting_unavailable",message="The SIM Kitting store could not complete the request. Reload the retained case before retrying."},statusCode:503);}
        }
        const string route="/api/kitting-cases/v1/work-orders/{workOrderNumber}";
        app.MapGet(route,(string workOrderNumber,HttpContext c)=>Guard(c,false,a=>service.Read(workOrderNumber,a)));
        app.MapGet(route+"/released-requirements",(string workOrderNumber,HttpContext c)=>Guard(c,false,a=>service.Released(workOrderNumber,a)));
        app.MapGet(route+"/history",(string workOrderNumber,HttpContext c)=>Guard(c,false,a=>service.History(workOrderNumber,a)));
        app.MapGet(route+"/submissions",(string workOrderNumber,HttpContext c)=>Guard(c,false,a=>service.Submissions(workOrderNumber,a)));
        app.MapPost(route+"/production-bom-correction",(string workOrderNumber,SimProductionBomCorrectionRequest r,HttpContext c)=>Guard(c,true,a=>service.CorrectProductionBom(workOrderNumber,r,a)));
        app.MapPost(route+"/start",(string workOrderNumber,SimKittingStartRequest r,HttpContext c)=>Guard(c,true,a=>service.Start(workOrderNumber,r,a)));
        app.MapPost(route+"/resume",(string workOrderNumber,SimKittingVersionRequest r,HttpContext c)=>Guard(c,true,a=>service.Resume(workOrderNumber,r,a)));
        app.MapPut(route+"/draft",(string workOrderNumber,SimKittingSaveRequest r,HttpContext c)=>Guard(c,true,a=>service.Save(workOrderNumber,r,a)));
        app.MapPost(route+"/save-exit",(string workOrderNumber,SimKittingSaveRequest r,HttpContext c)=>Guard(c,true,a=>service.Save(workOrderNumber,r,a,true)));
        app.MapPost(route+"/abandon",(string workOrderNumber,SimKittingEditableRequest r,HttpContext c)=>Guard(c,true,a=>service.Abandon(workOrderNumber,r,a)));
        app.MapPut(route+"/po-traceability",(string workOrderNumber,SimKittingTraceabilityRequest r,HttpContext c)=>Guard(c,true,a=>service.Traceability(workOrderNumber,r,a)));
        app.MapPost(route+"/po-traceability-amendment",(string workOrderNumber,SimKittingTraceabilityAmendmentRequest r,HttpContext c)=>Guard(c,true,a=>service.AmendTraceability(workOrderNumber,r,a)));
        app.MapGet(route+"/accepted-material",(string workOrderNumber,HttpContext c)=>Guard(c,false,a=>service.MaterialContext(workOrderNumber,a)));
        app.MapPost(route+"/apply-accepted-material",(string workOrderNumber,SimKittingMaterialRequest r,HttpContext c)=>Guard(c,true,a=>service.ApplyMaterial(workOrderNumber,r,a)));
        app.MapPost(route+"/correct-manual-allocation",(string workOrderNumber,SimKittingCorrectionRequest r,HttpContext c)=>Guard(c,true,a=>service.CorrectAllocation(workOrderNumber,r,a)));
        app.MapPost(route+"/reverse-material-application",(string workOrderNumber,SimKittingReversalRequest r,HttpContext c)=>Guard(c,true,a=>service.ReverseMaterial(workOrderNumber,r,a)));
        app.MapPost(route+"/submit",(string workOrderNumber,SimKittingSaveRequest r,HttpContext c)=>Guard(c,true,a=>service.Submit(workOrderNumber,r,a)));
        app.MapGet(route+"/submissions/{submissionId:guid}/pdf",async Task<IResult>(string workOrderNumber,Guid submissionId,HttpContext c)=>{
            var actor=personas.Resolve(c);if(!actor.Can("kitting.view"))return Results.StatusCode(403);
            try{var pdf=await service.Pdf(workOrderNumber,submissionId,actor);return Results.File(pdf.Bytes,"application/pdf",pdf.Name);}
            catch(KittingCaseProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
        });
    }
}
