using System.Security.Principal;
using System.Text.Json.Serialization;
using DleOs.CustomerFilesControl;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string authorizedOperator = @"DLE-OS-HOST\DLE-OS";
const string allowedOrigin = "http://dle-os-host:5051";
const string controlPrefix = "http://dle-os-host:5053";
const string fixedCanonicalBaseUrl = "http://DLE-OS-HOST:5052";
const string corsPolicy = "CustomerFilesDevelopmentExactOrigin";
const string authorizationPolicy = "CustomerFilesOperator";

var builder = WebApplication.CreateBuilder(args);
var configuredRoot = builder.Configuration["CustomerFiles:Root"]
    ?? throw new InvalidOperationException("CustomerFiles:Root is required.");
var configuredCanonicalBaseUrl =
    builder.Configuration["CustomerFiles:CanonicalDirectoryBaseUrl"]
    ?? throw new InvalidOperationException(
        "CustomerFiles:CanonicalDirectoryBaseUrl is required.");
var resolvedRoot = Path.GetFullPath(configuredRoot).TrimEnd(
    Path.DirectorySeparatorChar,
    Path.AltDirectorySeparatorChar);
if (
    !string.Equals(
        resolvedRoot,
        CustomerFolderService.GovernedRoot,
        StringComparison.OrdinalIgnoreCase) ||
    !string.Equals(
        configuredCanonicalBaseUrl.TrimEnd('/'),
        fixedCanonicalBaseUrl,
        StringComparison.OrdinalIgnoreCase)
)
{
    throw new InvalidOperationException(
        "Customer Files configuration departed from the governed boundary.");
}
if (!OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException(
        "Customer Files control is supported only on DLE-OS-HOST.");
if (!string.Equals(
    Environment.MachineName,
    "DLE-OS-HOST",
    StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
        "Customer Files control may run only on DLE-OS-HOST.");
if (!Directory.Exists(resolvedRoot))
    throw new DirectoryNotFoundException(
        "The approved Customer Files root is unavailable.");
if ((File.GetAttributes(resolvedRoot) & FileAttributes.ReparsePoint) != 0)
    throw new InvalidOperationException(
        "The approved Customer Files root must not be a reparse point.");

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(controlPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(authorizationPolicy, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context => string.Equals(
            context.User.Identity?.Name,
            authorizedOperator,
            StringComparison.OrdinalIgnoreCase));
    });
});
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        corsPolicy,
        policy => policy
            .WithOrigins(allowedOrigin)
            .WithMethods(HttpMethods.Get, HttpMethods.Post)
            .WithHeaders("Accept")
            .AllowCredentials());
});
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(
        new JsonStringEnumConverter()));
builder.Services.AddSingleton<ICustomerFileSystem, SystemCustomerFileSystem>();
builder.Services.AddHttpClient<ICustomerDirectory, CustomerDirectoryClient>(
    client =>
    {
        client.BaseAddress = new Uri(fixedCanonicalBaseUrl);
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    })
    .ConfigurePrimaryHttpMessageHandler(() =>
        new HttpClientHandler
        {
            UseDefaultCredentials = true,
            AutomaticDecompression =
                System.Net.DecompressionMethods.GZip |
                System.Net.DecompressionMethods.Deflate
        });
builder.Services.AddSingleton(serviceProvider =>
    new CustomerFolderService(
        resolvedRoot,
        serviceProvider.GetRequiredService<ICustomerDirectory>(),
        serviceProvider.GetRequiredService<ICustomerFileSystem>(),
        serviceProvider.GetRequiredService<
            ILogger<CustomerFolderService>>()));

var app = builder.Build();
app.UseCors(corsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapGet(
        "/health",
        (HttpContext context) => Results.Json(new
        {
            status = "Ready",
            root = resolvedRoot,
            rootAvailable = Directory.Exists(resolvedRoot),
            executionIdentity = WindowsIdentity.GetCurrent().Name,
            authenticatedIdentity = context.User.Identity?.Name,
            authorized = string.Equals(
                context.User.Identity?.Name,
                authorizedOperator,
                StringComparison.OrdinalIgnoreCase)
        }))
    .RequireAuthorization(authorizationPolicy);

app.MapGet(
        "/api/customer-files/v1/customers/{customerNumber}/folder",
        async (
            string customerNumber,
            CustomerFolderService service,
            CancellationToken cancellationToken) =>
            Results.Json(await service.VerifyAsync(
                customerNumber,
                cancellationToken)))
    .RequireAuthorization(authorizationPolicy);

app.MapPost(
        "/api/customer-files/v1/customers/{customerNumber}/folder",
        async (
            HttpRequest request,
            string customerNumber,
            CustomerFolderService service,
            CancellationToken cancellationToken) =>
        {
            if (request.ContentLength is > 0)
                return Results.BadRequest(new
                {
                    code = "request_body_not_allowed",
                    message =
                        "Only the canonical Customer Number route value is accepted."
                });
            return Results.Json(await service.CreateAsync(
                customerNumber,
                cancellationToken));
        })
    .RequireAuthorization(authorizationPolicy);

app.MapGet(
        "/api/customer-files/v1/customers/{customerNumber}/requirements-compliance",
        async (
            HttpRequest request,
            string customerNumber,
            CustomerFolderService service,
            CancellationToken cancellationToken) =>
        {
            if (request.QueryString.HasValue)
                return Results.BadRequest(new
                {
                    code = "request_parameters_not_allowed",
                    message =
                        "Only the canonical Customer Number route value is accepted."
                });
            return Results.Json(
                await service.VerifyRequirementsComplianceAsync(
                    customerNumber,
                    cancellationToken));
        })
    .RequireAuthorization(authorizationPolicy);

app.MapPost(
        "/api/customer-files/v1/customers/{customerNumber}/requirements-compliance",
        async (
            HttpRequest request,
            string customerNumber,
            CustomerFolderService service,
            CancellationToken cancellationToken) =>
        {
            if (request.ContentLength is > 0 || request.QueryString.HasValue)
                return Results.BadRequest(new
                {
                    code = "request_parameters_not_allowed",
                    message =
                        "Only the canonical Customer Number route value is accepted."
                });
            return Results.Json(
                await service.CreateRequirementsComplianceAsync(
                    customerNumber,
                    cancellationToken));
        })
    .RequireAuthorization(authorizationPolicy);

app.MapGet(
        "/api/customer-files/v1/manifest/dry-run",
        async (
            CustomerFolderService service,
            CancellationToken cancellationToken) =>
            Results.Json(await service.BuildManifestAsync(cancellationToken)))
    .RequireAuthorization(authorizationPolicy);

app.Run();
