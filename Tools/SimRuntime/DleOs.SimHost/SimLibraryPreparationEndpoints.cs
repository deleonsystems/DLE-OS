internal static partial class SimLibraryPreparationEndpoints
{
 internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimLibraryPreparation store,SimLibraryBomStore? documents=null)
 {
  async Task<IResult> Run(HttpContext c,Func<Task<object>> action){
   c.Response.Headers.CacheControl="private, no-store";
   if(!state.Current.IsHealthy)return Results.Json(new{message="SIM storage is not ready."},statusCode:503);
   try{return Results.Json(await action());}
   catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}
   catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}
   catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or System.Text.Json.JsonException){return Results.Json(new{message="Preparation storage could not be verified. Reopen to check saved state; original intake files are retained."},statusCode:503);}
  }
  MapIncoming(app,state,personas,store);
  app.MapPost("/api/sim/assembly-library/preparation/file-disposition",(PreparationFileDispositionCommand command,HttpContext c)=>Run(c,()=>store.Disposition(command,personas.Resolve(c),documents is null?null:documents.ResolvePreparationDocument)));
  app.MapGet("/api/sim/technical-review/preparation",(string intakeId,int lineNumber,HttpContext c)=>Run(c,()=>store.Assessment(intakeId,lineNumber,personas.Resolve(c))));
  app.MapPost("/api/sim/technical-review/preparation",(PreparationCommand command,HttpContext c)=>Run(c,()=>store.Assess(command,personas.Resolve(c))));
  app.MapGet("/api/sim/technical-review/preparation/file",(string intakeId,string documentId,HttpContext c)=>Run(c,()=>store.IncomingEvidence(intakeId,documentId,personas.Resolve(c))));
  app.MapGet("/api/sim/assembly-library/preparation",async Task<IResult> (HttpContext c)=>await Run(c,()=>store.Queue(personas.Resolve(c))));
  app.MapPost("/api/sim/assembly-library/preparation",(PreparationWorkCommand command,HttpContext c)=>Run(c,()=>store.Work(command,personas.Resolve(c))));
  app.MapGet("/api/sim/assembly-library/preparation/file",(string id,string documentId,HttpContext c)=>Run(c,()=>store.Evidence(id,documentId,personas.Resolve(c))));
 }
}
