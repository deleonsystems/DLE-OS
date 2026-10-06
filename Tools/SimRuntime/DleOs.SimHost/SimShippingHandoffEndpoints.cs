using Microsoft.Data.Sqlite;

internal static class SimShippingHandoffEndpoints
{
    internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimProductionService service){
        async Task<IResult> Guard(HttpContext c,Func<SimPersona,Task<object>> action){
            if(!state.Current.IsHealthy)return Results.StatusCode(503);c.Response.Headers.CacheControl="private, no-store";
            try{return Results.Json(await action(personas.Resolve(c)));}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
            catch(KittingCaseProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(Exception e) when(e is IOException or InvalidOperationException or SqliteException){return Results.Json(new{code="shipping_unavailable",message="Verified Shipping source is unavailable. Refresh and review its retained lineage."},statusCode:503);}
        }
        const string path="/api/shipping-handoff/v1/work-orders/{wo}";
        app.MapGet("/api/shipping-handoff/v1/queue",async Task<IResult> (HttpContext c)=>await Guard(c,a=>service.ShippingQueue(a)));
        app.MapGet(path,(string wo,HttpContext c)=>Guard(c,async a=>await service.ReadShipping(wo,a)));
        app.MapPost(path+"/clearances",(string wo,SimClearanceCreate r,HttpContext c)=>Guard(c,async a=>await service.CreateClearance(wo,r,a)));
        app.MapPost(path+"/authorizations",(string wo,SimAuthorizationCreate r,HttpContext c)=>Guard(c,async a=>await service.AuthorizeShipment(wo,r,a)));
        app.MapPost(path+"/authorizations/{id:guid}/sim-departure",(string wo,Guid id,SimShippingConfirm r,HttpContext c)=>Guard(c,async a=>await service.ConfirmSimDeparture(wo,id,r,a)));
        app.MapPost(path+"/clearances/{id:guid}/disposition",(string wo,Guid id,SimShippingDisposition r,HttpContext c)=>Guard(c,async a=>await service.DispositionShipping(wo,id,true,r,a)));
        app.MapPost(path+"/authorizations/{id:guid}/disposition",(string wo,Guid id,SimShippingDisposition r,HttpContext c)=>Guard(c,async a=>await service.DispositionShipping(wo,id,false,r,a)));
    }
}
