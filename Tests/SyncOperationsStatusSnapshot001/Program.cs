using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

var root = Path.Combine(
    Path.GetTempPath(), "DLE-OS-SyncStatusSnapshot-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var current = Path.Combine(root, "current.json");
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
var app = builder.Build();
app.MapGet("/api/sync/operations/current", () =>
{
    var snapshot = SyncOperationsStatusSnapshot.ReadOptional(current);
    return snapshot is null
        ? Results.Json(new { status = "NEVER_RUN" })
        : Results.Bytes(snapshot, "application/json");
});
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features
    .Get<IServerAddressesFeature>()!.Addresses.Single();
using var client = new HttpClient { BaseAddress = new Uri(address) };

try
{
    File.WriteAllText(current, "{\"sequence\":0}", new UTF8Encoding(false));
    const int replacements = 40;
    for (var sequence = 1; sequence <= replacements; sequence++)
    {
        var stage = Path.Combine(root, $"stage-{sequence}.json");
        File.WriteAllText(stage, $"{{\"sequence\":{sequence}}}", new UTF8Encoding(false));
        using var gapOpened = new ManualResetEventSlim(false);
        var writer = Task.Run(() =>
        {
            File.Delete(current);
            gapOpened.Set();
            Thread.Sleep(25);
            File.Move(stage, current);
        });

        if (!gapOpened.Wait(TimeSpan.FromSeconds(2)))
            throw new InvalidOperationException("The replacement gap was not entered.");
        using var response = await client.GetAsync("/api/sync/operations/current");
        if ((int)response.StatusCode == 500)
            throw new InvalidOperationException("Status polling returned HTTP 500.");
        response.EnsureSuccessStatusCode();
        var snapshot = await response.Content.ReadAsByteArrayAsync();
        using var document = JsonDocument.Parse(snapshot);
        var observed = document.RootElement.GetProperty("sequence").GetInt32();
        if (observed != sequence)
            throw new InvalidOperationException(
                $"Expected replacement {sequence}, observed {observed}.");
        await writer;
    }

    if (SyncOperationsStatusSnapshot.ReadOptional(
            Path.Combine(root, "never-created.json")) is not null)
        throw new InvalidOperationException("An absent optional status was not reported as absent.");

    Console.WriteLine(
        $"SYNC-OPERATIONS-STATUS-SNAPSHOT-001: PASS ({replacements} concurrent replacements, 0 HTTP 500 responses)");
}
finally
{
    await app.StopAsync();
    Directory.Delete(root, recursive: true);
}
