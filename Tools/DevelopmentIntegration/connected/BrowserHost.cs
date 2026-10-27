using System.Text.Json;
using Microsoft.Extensions.FileProviders;

internal static class BrowserHost
{
 internal static async Task Run(){
  var allowed=Path.GetFullPath("../disposable")+Path.DirectorySeparatorChar;
  var root=Path.GetFullPath(Environment.GetEnvironmentVariable("DLE_REHEARSAL_RESUME_ROOT")??Path.Combine("..","disposable","browser-"+Guid.NewGuid().ToString("N")));
  if(!root.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(root).StartsWith("browser-"))throw new InvalidOperationException("Only a disposable browser run can resume.");
  Directory.CreateDirectory(root);
  using var lease=new FileStream(Path.Combine(root,"browser.lease"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
  var stopFile=Path.Combine(root,"stop-"+Guid.NewGuid().ToString("N"));
  var source=Path.Combine(root,"source");Directory.CreateDirectory(Path.Combine(source,"N"));
  var prior=Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS");Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",JsonSerializer.Serialize(new[]{new SimDrawingRoot("fixture","Disposable source",source)}));
  var store=new SimRfqIntakeStore(Path.Combine(root,"state"),"ISOLATED_DEVELOPMENT_REHEARSAL");
  var preparation=new SimLibraryPreparation(Path.Combine(root,"state"),()=>[new("fixture-assembly-N","fixture","V1.2","SYNTHETIC-49-2","","N","","N",false)],store.PreparationSource,store.OpenDocument);
  var library=new SimLibraryBomStore(Path.Combine(root,"state"),preparation.Headers);store.PreparationLookup=preparation.Find;preparation.FinalReviewLookup=library.FinalReviewFor;store.PreparationFinalReviewLookup=library.FinalReviewFor;store.LibraryRfqSource=library.WithRfqSource;store.LibraryRfqPackageRead=library.ReadRfqPackage;store.LibraryRfqFileRead=library.ReadRfqFile;store.PreviousQuotesAccess=library.WithPreviousQuoteFolder;
  var now=DateTimeOffset.UtcNow;var metadata=new SimStateMetadata("ISOLATED_DEVELOPMENT_REHEARSAL","browser-synthetic",1,1,1,now,now,1,now,1,1,1);
  var builder=WebApplication.CreateBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls("http://127.0.0.1:0");await using var app=builder.Build();
  app.Use(async(c,next)=>{c.Response.Headers.CacheControl="no-store";c.Response.Headers.ContentSecurityPolicy="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:";await next();if(c.Response.StatusCode>=400)await File.AppendAllTextAsync(Path.Combine(root,"http-errors.txt"),$"{c.Request.Method} {c.Request.Path} {c.Response.StatusCode}\n");});
  app.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(Path.GetFullPath("web"))});
  app.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(Path.GetFullPath("../baseline-frontend")),RequestPath="/baseline"});
  app.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(Path.GetFullPath("../baseline-frontend"))});
  app.MapGet("/full",async(HttpContext c)=>{
   var p=ConnectedActors.Persona(c.Request.Cookies["rehearsal-profile"]??"");if(p is null)return Results.Unauthorized();
   var identity=JsonSerializer.Serialize(new{user=new{id=p.Id,userName=p.UserName,displayName=p.DisplayName},roles=p.Roles,permissions=p.Permissions,allowedWorkspaces=p.AllowedWorkspaces,isSuperAdmin=false,fixtureOnly=true});
   var html=await File.ReadAllTextAsync("../baseline-frontend/DLE_Work_Center_v4.0.0.html");
   var head=html.IndexOf("<head>",StringComparison.OrdinalIgnoreCase);if(head<0)throw new InvalidOperationException("Missing HTML head");
   html=html.Insert(head+6,"<script>window.DleOsRuntimeConfig={environment:'ISOLATED_DEVELOPMENT',executionKind:'ISOLATED_REHEARSAL'};</script>");
   html=CandidateIdentityUi.Inject(html,identity);
   var body=html.IndexOf("<body",StringComparison.OrdinalIgnoreCase);var bodyEnd=html.IndexOf('>',body);
   html=html.Insert(bodyEnd+1,"<aside style='position:fixed;bottom:0;z-index:999999;background:#ffd782;color:black;padding:8px'>ISOLATED BASELINE BOOTSTRAP - fixture identity, no live services</aside>");
   html=html.Insert(html.LastIndexOf("</body>",StringComparison.OrdinalIgnoreCase),"<script type='module' src='/full-mount.mjs'></script>");
   return Results.Content(html,"text/html");
  });
  app.MapGet("/",()=>Results.Redirect("/index.html"));
  app.MapPost("/fixture/profile/{name}",(string name,HttpContext c)=>{if(c.Request.Headers["X-Rehearsal-Intent"]!="fixture-only"||ConnectedActors.Persona(name)==null)return Results.BadRequest();if(c.Request.Headers.Origin.FirstOrDefault() is string o&&o!=$"{c.Request.Scheme}://{c.Request.Host}")return Results.BadRequest();c.Response.Cookies.Append("rehearsal-profile",name,new(){HttpOnly=true,SameSite=SameSiteMode.Strict,Path="/"});return Results.NoContent();});
  app.MapConnected(store,preparation,library,metadata,new ManagedLibraryEvidence(root));
  await app.StartAsync();var port=new Uri(app.Urls.Single()).Port;
  if(new[]{5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(port)){await app.StopAsync();throw new Exception("Protected port selected");}
  await File.WriteAllTextAsync("browser-host.json",JsonSerializer.Serialize(new{Url=app.Urls.Single(),Port=port,Root=root,ProcessId=Environment.ProcessId,StopFile=stopFile},new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine("Temporary fixture host "+app.Urls.Single());
  try{var deadline=DateTimeOffset.UtcNow.AddMinutes(60);while(DateTimeOffset.UtcNow<deadline&&!File.Exists(stopFile))await Task.Delay(250);}
  finally{await app.StopAsync();Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",prior);using var probe=new System.Net.Sockets.TcpClient();try{await probe.ConnectAsync("127.0.0.1",port);throw new Exception("Fixture listener still open");}catch(System.Net.Sockets.SocketException){}await File.WriteAllTextAsync("browser-host-closed.json",JsonSerializer.Serialize(new{Port=port,Closed=true}));}
 }
}
