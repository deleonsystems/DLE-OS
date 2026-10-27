using Microsoft.Extensions.Hosting.WindowsServices;
using System.Security.Principal;

internal sealed class QuotingServiceState
{
    readonly object gate = new();
    string phase = "Starting";
    int active;
    public (string Phase, int Active) Snapshot { get { lock (gate) return (phase, active); } }
    public void Started() { lock (gate) if (phase == "Starting") phase = "Running"; }
    public void Stopping() { lock (gate) if (phase != "Stopped") phase = "Draining"; }
    public void Stopped() { lock (gate) phase = "Stopped"; }
    public bool Enter() { lock (gate) { if (phase != "Running") return false; active++; return true; } }
    public void Leave() { lock (gate) active--; }
}

internal static class QuotingServiceLifecycle
{
    public const string Name = "DleOsDevelopmentQuoting";
    public const string Identity = @"NT SERVICE\DleOsDevelopmentQuoting";
    public const int ShutdownSeconds = 30;
    public const int ProposedPort = 5060;

    public static (string Config, bool Service) Arguments(string[] args)
    {
        bool service = args.Length == 3 && args[2] == "--windows-service";
        if ((!service && args.Length != 2) || args[0] != "--config" || !Path.IsPathFullyQualified(args[1]))
            throw new InvalidOperationException("Explicit absolute --config path and optional --windows-service required");
        return (args[1], service);
    }

    public static void CheckServiceContext(bool requested)
    {
        bool actual = OperatingSystem.IsWindows() && WindowsServiceHelpers.IsWindowsService();
        if (requested != actual) throw new InvalidOperationException("SCM context and explicit service mode must match");
        if (requested && !WindowsIdentity.GetCurrent().Name.Equals(Identity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Unexpected service identity");
    }

    public static void Configure(WebApplicationBuilder builder)
    {
        // Framework selects WindowsServiceLifetime only under SCM. Never emulate SCM.
        builder.Host.UseWindowsService(o => o.ServiceName = Name);
        // Do not create an EventLog source implicitly. SCM receives process failure codes;
        // console diagnostics contain only phase/type, never configuration or secrets.
        builder.Logging.ClearProviders();
        builder.Logging.AddSimpleConsole(o => o.SingleLine = true);
        builder.Services.Configure<HostOptions>(o => {
            o.ShutdownTimeout = TimeSpan.FromSeconds(ShutdownSeconds);
            o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost;
        });
        builder.Services.AddSingleton<QuotingServiceState>();
    }

    public static void Attach(WebApplication app)
    {
        var state = app.Services.GetRequiredService<QuotingServiceState>();
        app.Lifetime.ApplicationStarted.Register(state.Started);
        app.Lifetime.ApplicationStopping.Register(state.Stopping);
        app.Lifetime.ApplicationStopped.Register(state.Stopped);
        app.Use(async (context, next) => {
            if (context.Request.Path == "/health/readiness") { await next(context); return; }
            if (!state.Enter()) { context.Response.StatusCode = 503; return; }
            try { await next(context); } finally { state.Leave(); }
        });
        app.MapGet("/health/readiness", () => {
            var s = state.Snapshot;
            return Results.Json(new { phase = s.Phase, activeRequests = s.Active,
                processReady = s.Phase == "Running", externalDependenciesQualified = false },
                statusCode: s.Phase == "Running" ? 200 : 503);
        });
    }
}
