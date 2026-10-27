using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
internal static class LibraryBomTestServer
{
 internal static async Task Run(string root){
  var temp=Path.Combine(Path.GetTempPath(),"SimLibraryBomBrowser-"+Guid.NewGuid().ToString("N"));
  var source=Path.Combine(temp,"source");Directory.CreateDirectory(Path.Combine(source,"Assembly"));
  Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",System.Text.Json.JsonSerializer.Serialize(new[]{new SimDrawingRoot("fixture","Fixture drawings",source)}));
  var txt=string.Join('\t',SimVproParser.Headers)+"\tDRAW#=PART REV A\n"+string.Join('\t',new[]{"001","CPN","Resistor","","1","1","EA","1","0","0","0","P",""})+"\n"+string.Join('\t',new[]{"002","","(1) R1","","0","0","","0","0","0","0","",""})+"\n";
  await File.WriteAllTextAsync(Path.Combine(source,"Assembly","fixture.txt"),txt,System.Text.Encoding.ASCII);
  var state=new SimStateStore(temp);await state.InitializeAsync();var sessions=new SimPersonaSessionStore();
  var header=new SimAssemblyHeader("01PART                ","fixture","V1.2","PART                ","PART","A","202020","A",false);
  // Optional read-only input; all HTTP writes still target this fixture's new temporary store.
  if(Environment.GetEnvironmentVariable("DLE_LIBRARY_FIXTURE_RECORD") is {} input){
   var bytes=await File.ReadAllBytesAsync(input);var record=System.Text.Json.JsonSerializer.Deserialize<LibraryBomRecord>(bytes,SimLibraryBomStore.Json)!;
   header=header with{SourceKeyRaw=record.SourceKeyRaw,BillNumber=record.Draft!.AssemblyNumber};
   var copyRoot=Path.Combine(temp,"assembly-library-v1");Directory.CreateDirectory(Path.Combine(copyRoot,"evidence"));
   await File.WriteAllBytesAsync(Path.Combine(copyRoot,SimLibraryBomStore.Hash(System.Text.Encoding.UTF8.GetBytes(record.SourceKeyRaw))+".json"),bytes);
   var evidence=record.Draft.EvidenceHash+".txt";await File.WriteAllBytesAsync(Path.Combine(copyRoot,"evidence",evidence),await File.ReadAllBytesAsync(Path.Combine(Path.GetDirectoryName(input)!,"evidence",evidence)));
  }
  var store=new SimLibraryBomStore(temp,()=>[header,header with{SourceKeyRaw="01VPRO                ",BillNumber="VPRO                "}]);
  var builder=WebApplication.CreateBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls("http://127.0.0.1:0");var app=builder.Build();
  SimLibraryBomEndpoints.Map(app,state,sessions,store);
  app.MapGet("/",()=>Results.Content("<html><head><link rel='stylesheet' href='/library.css'></head><body style='background:#050b12;margin:0'><main class='assembly-library-view'><div id='editor'></div><button id='review'>Open Technical Review</button><div id='queue'></div></main><script>window.DleOsRuntimeConfig={environment:'SIM'};window.DleOsCapabilities={can:()=>true};</script><script src='/library.js'></script><script>window.header={sourceKeyRaw:'01PART                '};window.DleLibraryBom.mount(document.getElementById('editor'),header);document.getElementById('review').onclick=()=>window.DleLibraryBom.queue(document.getElementById('queue'));</script></body></html>","text/html"));
  app.MapGet("/library.js",()=>Results.Text(File.ReadAllText(Path.Combine(root,"SRC/workspaces/assembly-library/library-bom.js")),"text/javascript"));
  app.MapGet("/library.css",()=>Results.Text(File.ReadAllText(Path.Combine(root,"SRC/workspaces/assembly-library/assembly-library-workspace.css")),"text/css"));
  app.MapPost("/fixture-persona/{id}",(string id,HttpContext c)=>{sessions.Select(c,SimPersonaCatalog.Get(id)!);return Results.Ok();});
  app.MapPost("/fixture-stop",()=>{app.Lifetime.StopApplication();return Results.Ok();});
  await app.StartAsync();Console.WriteLine("FIXTURE_URL="+app.Urls.Single());await app.WaitForShutdownAsync();await app.DisposeAsync();
 }
}
