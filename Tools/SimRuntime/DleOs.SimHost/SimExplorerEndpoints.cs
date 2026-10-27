using System.IO.Pipes;
internal static class SimExplorerEndpoints
{
 // No new HTTP redemption route, authentication exemption, CORS, or network listener.
 internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimLibraryBomStore store){
 if(Environment.GetEnvironmentVariable("DLE_OS_SIM_EXPLORER_BRIDGE")!="1")return;
 if(!OperatingSystem.IsWindows() || !Environment.MachineName.Equals("MICHAELDESK",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("SIM Explorer is MichaelDesk-only.");
 var broker=new SimExplorerBroker();
 app.MapPost("/api/sim/assembly-library/folder/desktop",async (HttpContext c)=>{
 c.Response.Headers.CacheControl="no-store";
 if(!state.Current.IsHealthy)return Results.StatusCode(503);
 if(c.Request.Headers.Origin.ToString()!=SimExplorerProtocol.Origin || $"{c.Request.Scheme}://{c.Request.Host}"!=SimExplorerProtocol.Origin)return Results.StatusCode(403);
 if(c.Request.Query.Count!=2 || !c.Request.Query.ContainsKey("key") || !c.Request.Query.ContainsKey("folderToken"))return Results.StatusCode(400);
 var key=c.Request.Query["key"].ToString();var token=c.Request.Query["folderToken"].ToString();
 try{var actor=personas.Resolve(c);var path=await store.ExplorerFolder(key,token,actor);
 var issued=broker.Issue(c.Request.Headers.Origin.ToString(),actor.Can("assembly_library.view"),SimExplorerProtocol.RootId,path,async()=>await store.ExplorerFolder(key,token,actor)==path);
 return Results.Json(issued);
 }catch(LibraryBomPermissionException){return Results.StatusCode(403);}catch(Exception e)when(e is IOException or UnauthorizedAccessException or SimRfqIntakeProblem){return Results.Json(new{message="The linked folder is unavailable or changed. Reopen its details."},statusCode:409);}
 });
 app.Lifetime.ApplicationStarted.Register(()=>{_ = Serve(broker,app.Lifetime.ApplicationStopping,app.Logger);});
 }
 private static async Task Serve(SimExplorerBroker broker,CancellationToken stop,ILogger log){
 try{while(!stop.IsCancellationRequested){using var pipe=SimExplorerPipe.Create();
 await pipe.WaitForConnectionAsync(stop);using var timeout=CancellationTokenSource.CreateLinkedTokenSource(stop);timeout.CancelAfter(TimeSpan.FromSeconds(5));
 try{await SimExplorerProtocol.Write(pipe,await broker.Redeem(await SimExplorerProtocol.Read(pipe,timeout.Token)),timeout.Token);}catch(Exception e)when(e is IOException or OperationCanceledException or UnauthorizedAccessException){/* Fail closed; never log capability payloads. */}}}
 catch(OperationCanceledException)when(stop.IsCancellationRequested){}catch(Exception){log.LogError("SIM Explorer bridge unavailable; no desktop requests can be redeemed.");}}
}
internal sealed partial class SimLibraryBomStore
{
 internal async Task<string> ExplorerFolder(string key,string token,SimPersona actor){Permission(actor);Header(key);await gate.WaitAsync();try{
 var r=await ReadFolder(key);Require(FolderToken(r)==token,"The folder link changed.");var link=r.Current;Require(link is not null,"Link a folder first.");var context=await FolderContext(key);
 Require(link!.DrawingRevision==context.Drawing && link.BomRevision==context.Bom,"Review the folder revision context.");Require(link.RootId==SimExplorerProtocol.RootId,"Root is not approved for desktop access.");
 var resolved=Sources().Resolve(link.RootId,link.RelativePath);Require(Path.GetFullPath(resolved.Root.Path).TrimEnd('\\').Equals(SimExplorerProtocol.Root,StringComparison.OrdinalIgnoreCase),"Desktop root mapping differs.");Require(SimExplorerProtocol.SafePath(resolved.Relative),"Select a folder beneath the drawing root.");return resolved.Relative;
 }finally{gate.Release();}}
}
