using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Options;

var results = new List<string>();
void Check(bool ok, string message) { if (!ok) throw new Exception(message); results.Add(message); Console.WriteLine("PASS " + message); }
void Refuse(Action action, string message) { try { action(); } catch (Exception e) when(e is InvalidOperationException or DleOs.Quoting.Identity.IdentityDenied or JsonException) { Check(true,message); return; } throw new Exception("Unexpected allow: " + message); }
string root = Path.GetFullPath(args.Single());
Directory.CreateDirectory(root);
string config = Path.Combine(root,"synthetic-config.json");
var settings = new RuntimeSettings(true,"http://127.0.0.1:5060",@"C:\ProgramData\DLE-OS\DevelopmentQuoting",
    Path.Combine(root,"library.json"),new string('A',64),@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND",
    Path.Combine(root,"public.pem"),"http://127.0.0.1:5051/internal/quoting/v1/authorization",[Guid.NewGuid()],Path.Combine(root,"python.exe"),new string('B',64));
void Validate(RuntimeSettings value) { File.WriteAllText(config,JsonSerializer.Serialize(value)); RuntimeApplication.Validate(config); }
try {
    Validate(settings); Check(true,"pure configuration validation accepts explicit synthetic bindings without opening SQL/files");
    Refuse(()=>Validate(settings with {ActivationApproved=false}),"unset activation denied");
    foreach(int port in new[]{80,443,5041,5042,5043,5051,5052,5053,5054,5056,5057})
        Refuse(()=>Validate(settings with{ListenUrl=$"http://127.0.0.1:{port}"}),$"protected port {port} denied");
    Refuse(()=>Validate(settings with{ListenUrl="http://0.0.0.0:5060"}),"nonloopback denied");
    Refuse(()=>Validate(settings with{ReviewerUserIds=[]}),"empty reviewer set denied");
    Refuse(()=>Validate(settings with{ReviewerUserIds=[Guid.Empty]}),"empty reviewer ID denied");
    Refuse(()=>Validate(settings with{ReviewerUserIds=[settings.ReviewerUserIds![0],settings.ReviewerUserIds[0]]}),"duplicate reviewer denied");
    Refuse(()=>Validate(settings with{AuthorizationEndpoint="https://remote.invalid/internal/quoting/v1/authorization"}),"remote authority denied");
    Refuse(()=>Validate(settings with{AuthorizationEndpoint="http://127.0.0.1:5051/other"}),"arbitrary authority path denied");
    Refuse(()=>{File.WriteAllText(config,JsonSerializer.Serialize(settings).TrimEnd('}')+",\"SecurityConnectionString\":\"forbidden\"}");RuntimeApplication.Validate(config);},"legacy SQL configuration rejected rather than ignored");
    Refuse(()=>Validate(settings with{ApplicationRoot=root}),"alternate data root denied");
    Refuse(()=>QuotingServiceLifecycle.Arguments([]),"missing arguments denied");
    Refuse(()=>QuotingServiceLifecycle.Arguments(["--config","relative.json"]),"relative service config denied");
    Refuse(()=>QuotingServiceLifecycle.Arguments(["--config",config,"--fixture"]),"fixture switch denied");
    Check(QuotingServiceLifecycle.Arguments(["--config",config,"--windows-service"]).Service,"explicit SCM arguments accepted");
    Refuse(()=>QuotingServiceLifecycle.CheckServiceContext(true),"SCM switch cannot impersonate real SCM launch");
    QuotingServiceLifecycle.CheckServiceContext(false);
    Check(!WindowsServiceHelpers.IsWindowsService(),"suite not running as a real Windows service");

    int Port() { using var l=new TcpListener(IPAddress.Loopback,0); l.Start(); return ((IPEndPoint)l.LocalEndpoint).Port; }
    WebApplication Make(int port) {
        var b=WebApplication.CreateBuilder(new WebApplicationOptions{Args=[],ContentRootPath=AppContext.BaseDirectory});
        b.WebHost.UseUrls($"http://127.0.0.1:{port}");
        QuotingServiceLifecycle.Configure(b);
        var app=b.Build(); QuotingServiceLifecycle.Attach(app); return app;
    }
    int p=Port();
    await using(var app=Make(p)) {
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var canceled=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        app.MapGet("/work",async ()=>{entered.TrySetResult();await release.Task;return "completed";});
        app.MapGet("/cancel",async (HttpContext c)=>{try{await Task.Delay(Timeout.Infinite,c.RequestAborted);}catch(OperationCanceledException){canceled.TrySetResult();}});
        var state=app.Services.GetRequiredService<QuotingServiceState>();
        Check(state.Snapshot.Phase=="Starting","state begins not ready");
        Check(!state.Enter(),"startup does not admit requests");
        Check(app.Services.GetRequiredService<IOptions<HostOptions>>().Value.ShutdownTimeout==TimeSpan.FromSeconds(30),"shutdown bound is 30 seconds");
        Check(app.Services.GetRequiredService<IHostLifetime>() is not WindowsServiceLifetime,"normal test launch retains non-SCM lifetime");
        Check(app.Environment.ContentRootPath.TrimEnd(Path.DirectorySeparatorChar)==AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar),"content root independent of working directory");
        Check(!app.Services.GetServices<ILoggerProvider>().Any(x=>x.GetType().Name.Contains("EventLog")),"no automatic EventLog registration/provider");
        await app.StartAsync();
        using var http=new HttpClient{BaseAddress=new Uri($"http://127.0.0.1:{p}"),Timeout=TimeSpan.FromSeconds(8)};
        var health=await http.GetStringAsync("/health/readiness");
        Check(health.Contains("\"processReady\":true")&&health.Contains("\"externalDependenciesQualified\":false"),"health distinguishes process readiness from binding qualification");
        using(var cts=new CancellationTokenSource(150)) { try { await http.GetAsync("/cancel",cts.Token); } catch(OperationCanceledException){} }
        await canceled.Task.WaitAsync(TimeSpan.FromSeconds(5)); Check(true,"client cancellation reaches request token");
        var work=http.GetStringAsync("/work"); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        state.Stopping();
        Check((await http.GetAsync("/health/readiness")).StatusCode==HttpStatusCode.ServiceUnavailable,"draining readiness is 503");
        Check((await http.GetAsync("/work")).StatusCode==HttpStatusCode.ServiceUnavailable,"new work denied while draining");
        var stop=app.StopAsync();
        Check(!stop.IsCompleted,"stop drains admitted request");
        release.TrySetResult(); Check(await work=="completed","admitted work completes during drain");
        await stop.WaitAsync(TimeSpan.FromSeconds(5));
        Check(state.Snapshot==("Stopped",0),"stop completes with zero tracked requests");
        state.Stopping(); state.Started(); Check(state.Snapshot.Phase=="Stopped","late repeated lifecycle signals cannot reopen service");
    }
    using(var socket=new TcpClient()) { try { await socket.ConnectAsync(IPAddress.Loopback,p); throw new Exception("listener remains"); } catch(SocketException) { Check(true,"owned listener closed after stop"); } }
    using(var occupied=new TcpListener(IPAddress.Loopback,0)) {
        occupied.Start(); int taken=((IPEndPoint)occupied.LocalEndpoint).Port;
        await using var failed=Make(taken);
        try {await failed.StartAsync();throw new Exception("occupied port accepted");}
        catch(IOException){Check(failed.Services.GetRequiredService<QuotingServiceState>().Snapshot.Phase!="Running","occupied port startup fails without reporting ready");}
    }
    int boundedPort=Port();
    await using(var bounded=Make(boundedPort)) {
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var aborted=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        bounded.MapGet("/wait",async(HttpContext c)=>{entered.TrySetResult();try{await Task.Delay(Timeout.Infinite,c.RequestAborted);}catch(OperationCanceledException){aborted.TrySetResult();}});
        await bounded.StartAsync(); using var http=new HttpClient();
        var request=http.GetAsync($"http://127.0.0.1:{boundedPort}/wait"); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using var deadline=new CancellationTokenSource(250);
        try {await bounded.StopAsync(deadline.Token);}catch(OperationCanceledException){}
        await aborted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try {await request;}catch(HttpRequestException){}
        Check(true,"bounded shutdown cancels unfinished request");
    }
    using(var socket=new TcpClient()) { try { await socket.ConnectAsync(IPAddress.Loopback,boundedPort); throw new Exception("bounded listener remains"); } catch(SocketException) { Check(true,"bounded-shutdown listener closed"); } }
    File.WriteAllText(Path.Combine(root,"service-results.json"),JsonSerializer.Serialize(new{Passed=true,Count=results.Count,Checks=results,RealScmAcceptance=false},new JsonSerializerOptions{WriteIndented=true}));
} catch(Exception e) { Console.Error.WriteLine(e); Environment.ExitCode=1; }
finally { if(File.Exists(config)) File.Delete(config); }
