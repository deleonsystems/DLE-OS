using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;
using System.Text.Json;
using System.Security.Principal;

const string repository = @"C:\DLE-OS\Repositories\DLE-OS";
const string frontendPrefix = "http://dle-os-host:5051";
const string securityConnectionString =
    @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;" +
    "Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadOnly;";
const string kittingDocumentRoute = "/api/development/kitting-documents/v1/work-orders";
const string kittingShortageRoot = @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
const string kittingCompleteRoot = @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
const string requiredRuntimeIdentity = @"DLE-OS-HOST\DLE-OS";
var identitySigningKeyPath = Environment.GetEnvironmentVariable(
    "DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH");

if (!string.Equals(WindowsIdentity.GetCurrent().Name, requiredRuntimeIdentity,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
        $"The authenticated development BFF must run as {requiredRuntimeIdentity}.");

var sqlBoundary = new SqlConnectionStringBuilder(securityConnectionString);
if (!string.Equals(sqlBoundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    sqlBoundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The development frontend security database boundary is invalid.");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(frontendPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = false;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<IIdentityResolver>(new SqlIdentityResolver(securityConnectionString));
builder.Services.AddScoped<ICurrentUserContext, CurrentUserContext>();
builder.Services.AddSingleton(new EmployeeDirectoryService(securityConnectionString));
builder.Services.AddSingleton<IIdentityAssertionIssuer>(_ =>
    new Es256IdentityAssertionIssuer(
        IdentityAssertionKeyLoader.LoadPrivateKey(identitySigningKeyPath ?? "")));
builder.Services.AddDevelopmentCompatibilityProxy();

var app = builder.Build();
var provider = new PhysicalFileProvider(repository);
var contentTypes = new FileExtensionContentTypeProvider();
var kittingDocuments = new KittingDocumentService(kittingShortageRoot, kittingCompleteRoot);
app.Lifetime.ApplicationStopped.Register(provider.Dispose);

void NoStore(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    if (context.Request.Path.Equals("/api/auth/me", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var currentUser = await context.RequestServices
        .GetRequiredService<ICurrentUserContext>()
        .ResolveAsync(context.RequestAborted);
    if (currentUser.Status == CurrentUserStatus.Active)
    {
        await next();
        return;
    }

    NoStore(context.Response);
    var denied = CurrentUserResponseFactory.Create(currentUser);
    context.Response.StatusCode = denied.StatusCode;
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(denied.Body, context.RequestAborted);
    }
    else
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.WriteAsync(
            DevelopmentIdentityUi.AccessStateDocument(denied.Code),
            context.RequestAborted);
    }
});

app.MapGet("/api/auth/me", async (
    HttpContext context,
    ICurrentUserContext currentUserContext,
    ILoggerFactory loggerFactory) =>
{
    NoStore(context.Response);
    var currentUser = await currentUserContext.ResolveAsync(context.RequestAborted);
    var response = CurrentUserResponseFactory.Create(currentUser);
    loggerFactory.CreateLogger("DleOs.AuthenticatedFrontend").LogInformation(
        "CurrentUser Status={Status}; ExternalSubject={ExternalSubject}; UserName={UserName}; " +
        "DisplayName={DisplayName}; IsSuperAdmin={IsSuperAdmin}; UserAgent={UserAgent}",
        currentUser.Status,
        currentUser.ExternalSubject,
        currentUser.User?.UserName,
        currentUser.User?.DisplayName,
        currentUser.User?.IsSuperAdmin,
        context.Request.Headers.UserAgent.ToString());
    return Results.Json(response.Body, statusCode: response.StatusCode);
}).RequireAuthorization();

app.MapGet("/api/development/employees/v1/directory", async (
    HttpContext context,
    ICurrentUserContext currentUserContext,
    EmployeeDirectoryService employees,
    bool includeHistorical = false) =>
{
    NoStore(context.Response);
    var current = await currentUserContext.ResolveAsync(context.RequestAborted);
    if (!EmployeeDirectoryAuthorization.CanAdminister(current))
        return Results.Json(new
        {
            code = "DLE_OS_EMPLOYEE_ADMIN_REQUIRED",
            message = "Employee Directory administration requires an active DLE-OS SUPER_ADMIN."
        }, statusCode: StatusCodes.Status403Forbidden);
    var result = await employees.GetAsync(includeHistorical, context.RequestAborted);
    return Results.Ok(result);
}).RequireAuthorization();

app.MapDevelopmentCompatibilityProxy();

app.MapGet("/", async (HttpContext context, ICurrentUserContext currentUserContext) =>
{
    NoStore(context.Response);
    var currentUser = await currentUserContext.ResolveAsync(context.RequestAborted);
    if (currentUser.Status != CurrentUserStatus.Active || currentUser.User is null)
    {
        var denied = CurrentUserResponseFactory.Create(currentUser);
        return Results.Json(denied.Body, statusCode: denied.StatusCode);
    }

    var html = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
    var runtimeConfiguration = JsonSerializer.Serialize(new
    {
        authenticatedBffBaseUrl = frontendPrefix,
        environment = "ISOLATED_DEVELOPMENT"
    });
    const string headElement = "<head>";
    var headIndex = html.IndexOf(headElement, StringComparison.Ordinal);
    if (headIndex < 0)
        return Results.Problem("The development frontend document head is absent.", statusCode: 500);
    html = html.Insert(headIndex + headElement.Length,
        "<script>window.DleOsRuntimeConfig=" + runtimeConfiguration + ";</script>");
    html = html.Replace("DEVELOPMENT — READ ONLY",
        "DEVELOPMENT — AUTHENTICATED BFF · ISOLATED OPERATIONAL DATA",
        StringComparison.Ordinal);
    html = DevelopmentIdentityUi.Inject(html);
    html = EmployeeDirectoryUi.Inject(html);
    return Results.Text(html, "text/html");
}).RequireAuthorization();

app.MapGet(kittingDocumentRoute + "/{workOrderNumber}", (HttpContext context, string workOrderNumber) =>
{
    NoStore(context.Response);
    if (context.Request.Query.Count != 0)
        return Results.BadRequest(new { error = "Query parameters are not supported." });
    try
    {
        var evidence = kittingDocuments.GetEvidence(workOrderNumber);
        object? DocumentResponse(KittingDocumentMatch? document) => document is null ? null : new
        {
            documentType = document.Kind == KittingDocumentKind.Complete ? "complete" : "shortage",
            document.FileName,
            folder = document.FolderLabel,
            openUrl = $"{kittingDocumentRoute}/{evidence.WorkOrderNumber}/documents/" +
                (document.Kind == KittingDocumentKind.Complete ? "complete" : "shortage")
        };
        return Results.Json(new
        {
            evidence.WorkOrderNumber, evidence.Aliases, evidence.EvidenceStatus, evidence.DisplayLabel,
            evidence.PriorShortageEvidenceExists, primaryDocument = DocumentResponse(evidence.Primary),
            secondaryPriorShortageDocument = DocumentResponse(evidence.SecondaryPriorShortage)
        });
    }
    catch (KittingDocumentValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
}).RequireAuthorization();

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
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, 64 * 1024,
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
}).RequireAuthorization();

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = provider,
    OnPrepareResponse = context => NoStore(context.Context.Response)
});
app.Run();
