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
        app.MapGet(route,(string workOrderNumber,HttpContext c)=>Guard(c,false,async a=>Results.Json(await service.Read(workOrderNumber,a))));
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
