using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
const string repository = @"C:\DLE-OS\Repositories\DLE-OS";
var provider = new PhysicalFileProvider(repository);
var contentTypes = new FileExtensionContentTypeProvider();
const string kittingDocumentRoute = "/api/development/kitting-documents/v1/work-orders";
const string kittingShortageRoot = @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
const string kittingCompleteRoot = @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
var kittingDocuments = new KittingDocumentService(kittingShortageRoot, kittingCompleteRoot);
var operationalControlBaseUrl = builder.Configuration["DleOs:OperationalControlBaseUrl"] ??
    Environment.GetEnvironmentVariable("DLE_OS_OPERATIONAL_CONTROL_BASE_URL") ??
    "http://DLE-OS-HOST:5054";
app.Lifetime.ApplicationStopped.Register(provider.Dispose);

void NoStore(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

app.MapGet("/", (HttpContext context) =>
{
    NoStore(context.Response);
    var html = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
    var runtimeConfiguration = JsonSerializer.Serialize(new { operationalControlBaseUrl });
    const string headElement = "<head>";
    var headIndex = html.IndexOf(headElement, StringComparison.Ordinal);
    if (headIndex < 0)
        return Results.Problem("The development frontend document head is absent.", statusCode: 500);
    html = html.Insert(headIndex + headElement.Length,
        "<script>window.DleOsRuntimeConfig=" + runtimeConfiguration + ";</script>");
    html = html.Replace("DEVELOPMENT — READ ONLY", "DEVELOPMENT — READ ONLY · Operational API 5054",
        StringComparison.Ordinal);
    return Results.Text(html, "text/html");
});

app.MapGet(kittingDocumentRoute + "/{workOrderNumber}", (HttpContext context, string workOrderNumber) =>
{
    NoStore(context.Response);
    if (context.Request.Query.Count != 0)
        return Results.BadRequest(new { error = "Query parameters are not supported." });

    try
    {
        var evidence = kittingDocuments.GetEvidence(workOrderNumber);
        object? DocumentResponse(KittingDocumentMatch? document) => document is null
            ? null
            : new
            {
                documentType = document.Kind == KittingDocumentKind.Complete ? "complete" : "shortage",
                document.FileName,
                folder = document.FolderLabel,
                openUrl = $"{kittingDocumentRoute}/{evidence.WorkOrderNumber}/documents/" +
                    (document.Kind == KittingDocumentKind.Complete ? "complete" : "shortage")
            };

        return Results.Json(new
        {
            evidence.WorkOrderNumber,
            evidence.Aliases,
            evidence.EvidenceStatus,
            evidence.DisplayLabel,
            evidence.PriorShortageEvidenceExists,
            primaryDocument = DocumentResponse(evidence.Primary),
            secondaryPriorShortageDocument = DocumentResponse(evidence.SecondaryPriorShortage)
        });
    }
    catch (KittingDocumentValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapGet(kittingDocumentRoute + "/{workOrderNumber}/documents/{documentType}",
    (HttpContext context, string workOrderNumber, string documentType) =>
{
    NoStore(context.Response);
    if (context.Request.Query.Count != 0)
        return Results.BadRequest(new { error = "Query parameters are not supported." });

    try
    {
        var path = kittingDocuments.ResolveDocumentPath(workOrderNumber, documentType);
        if (path is null) return Results.NotFound(new { error = "Kitted BOM PDF was not found." });
        var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            64 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Results.Stream(stream, "application/pdf", enableRangeProcessing: true);
    }
    catch (KittingDocumentValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (IOException)
    {
        return Results.Problem("The resolved Kitted BOM PDF is temporarily unavailable.", statusCode: 503);
    }
    catch (UnauthorizedAccessException)
    {
        return Results.Problem("The resolved Kitted BOM PDF is temporarily unavailable.", statusCode: 503);
    }
});

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = provider,
    OnPrepareResponse = context => NoStore(context.Context.Response)
});
app.Run();
