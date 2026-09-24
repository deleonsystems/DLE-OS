using Microsoft.Data.Sqlite;

internal static class SimPurchasingEndpoints
{
    internal static void Map(WebApplication app, SimStateStore state, SimPersonaSessionStore personas, SimPurchasingService service)
    {
        async Task<IResult> Guard(HttpContext context, Func<SimPersona, Task<object>> action)
        {
            if (!state.Current.IsHealthy) return Results.StatusCode(503);
            context.Response.Headers.CacheControl = "private, no-store";
            try { return Results.Json(await action(personas.Resolve(context))); }
            catch (SimPurchasingProblem e) { return Results.Json(new { code = e.Code, message = e.Message }, statusCode: e.StatusCode); }
            catch (SimOrderEntryPermissionException) { return Results.StatusCode(403); }
            catch (Exception e) when (e is InvalidOperationException or IOException or SqliteException)
            {
                return Results.Json(new { code = "sim_purchasing_unavailable", message = "The SIM purchasing store could not complete this request. Refresh retained state before retrying." }, statusCode: 503);
            }
        }
        const string route = "/api/sim/purchasing";
        app.MapGet(route, async Task<IResult> (HttpContext c) => await Guard(c, async a => await service.Read(a)));
        app.MapGet(route + "/history", async Task<IResult> (HttpContext c) => await Guard(c, async a => await service.History(a)));
        app.MapGet(route + "/demands/{demandId}/kitted-bom", (string demandId, HttpContext c) => Guard(c, a => service.KittedBom(demandId, a)));
        app.MapPost(route + "/demands/{demandId}/accept", (string demandId, SimPurchasingVersionRequest r, HttpContext c) => Guard(c, async a => await service.Accept(demandId, r, a)));
        app.MapPost(route + "/plans", (SimBuyingPlanRequest r, HttpContext c) => Guard(c, async a => await service.SavePlan(null, r, a)));
        app.MapPut(route + "/plans/{planId:guid}", (Guid planId, SimBuyingPlanRequest r, HttpContext c) => Guard(c, async a => await service.SavePlan(planId, r, a)));
        app.MapPost(route + "/plans/{planId:guid}/ready", (Guid planId, SimPurchasingVersionRequest r, HttpContext c) => Guard(c, async a => await service.Ready(planId, r, a)));
        app.MapPost(route + "/plans/{planId:guid}/purchase", (Guid planId, SimPurchaseRequest r, HttpContext c) => Guard(c, async a => await service.Purchase(planId, r, a)));
        app.MapGet("/api/sim/receiving/expected", async Task<IResult> (HttpContext c) => await Guard(c, async a => await service.Expected(a)));
    }
}
