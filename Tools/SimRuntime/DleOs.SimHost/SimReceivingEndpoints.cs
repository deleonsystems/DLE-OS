using Microsoft.Data.Sqlite;

internal static class SimReceivingEndpoints
{
    internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimReceivingService service)
    {
        async Task<IResult> Guard(HttpContext context,Func<SimPersona,Task<IResult>> action)
        {
            if(!state.Current.IsHealthy)return Results.StatusCode(503);
            context.Response.Headers.CacheControl="private, no-store";
            try{return await action(personas.Resolve(context));}
            catch(SimPurchasingProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
            catch(Exception e)when(e is IOException or InvalidOperationException or SqliteException){return Results.Json(new{code="receiving_unavailable",message="Receiving could not finish this request. Refresh retained evidence before retrying."},statusCode:503);}
        }
        const string route="/api/sim/receiving";
        app.MapGet(route+"/history",async Task<IResult>(HttpContext c)=>await Guard(c,async a=>Results.Json(await service.History(a))));
        app.MapGet(route+"/po/{purchaseId:guid}",(Guid purchaseId,HttpContext c)=>Guard(c,async a=>Results.Json(await service.ReadPo(purchaseId,a))));
        app.MapPost(route+"/po/{purchaseId:guid}/requirements",(Guid purchaseId,SimReceivingRequirementsRequest r,HttpContext c)=>Guard(c,async a=>Results.Json(await service.Review(purchaseId,r,a))));
        app.MapPost(route+"/po/{purchaseId:guid}/receive",(Guid purchaseId,SimReceiveRequest r,HttpContext c)=>Guard(c,async a=>Results.Json(await service.Receive(purchaseId,r,a))));
        app.MapGet(route+"/accepted-material/{receiptLineId}",(string receiptLineId,HttpContext c)=>Guard(c,async a=>Results.Json(await service.Material(receiptLineId,a))));
        app.MapPost(route+"/accepted-material/{receiptLineId}/stage",(string receiptLineId,SimStageMaterialRequest r,HttpContext c)=>Guard(c,async a=>Results.Json(await service.Stage(receiptLineId,r,a))));
        app.MapPost(route+"/po/{purchaseId:guid}/documents",(Guid purchaseId,HttpContext c)=>Guard(c,async a=> {
            if(!c.Request.Headers.ContainsKey("X-SIM-Document-Upload"))return Results.BadRequest();
            if(c.Request.ContentLength>20*1024*1024)return Results.StatusCode(413);
            return Results.Json(await service.Upload(purchaseId,c.Request.Query["kind"].ToString(),c.Request.Query["name"].ToString(),c.Request.Body,a));
        }));
        app.MapGet(route+"/po/{purchaseId:guid}/documents/{id}",(Guid purchaseId,string id,HttpContext c)=>Guard(c,async a=> {
            var opened=await service.OpenDocument(purchaseId,id,a);
            c.Response.Headers["X-Content-Type-Options"]="nosniff";
            c.Response.Headers["Content-Disposition"]=new System.Net.Http.Headers.ContentDispositionHeaderValue(opened.Document.Type=="application/pdf"?"inline":"attachment"){FileNameStar=opened.Document.Name}.ToString();
            return Results.Bytes(opened.Bytes,opened.Document.Type);
        }));
    }
}
