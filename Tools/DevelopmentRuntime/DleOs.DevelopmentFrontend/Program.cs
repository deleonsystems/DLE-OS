using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using System.Text.Json;
using System.Security.Principal;

const string repository = @"C:\DLE-OS\Repositories\DLE-OS";
const string frontendPrefix = "http://dle-os-host:5051";
const string temporaryPhase61AIpPrefix = "http://192.168.0.105:5051";
const string governedPhase62AHostnamePrefix = "http://dle-os.internal.dlemfg.com:5051";
const string governedPhase62BHttpsPrefix = "https://dle-os.internal.dlemfg.com:443";
const string governedPhase62CIdentityPrefix = "https://auth.internal.dlemfg.com:443";
const string canonicalApplicationOrigin = "https://dle-os.internal.dlemfg.com";
const string keycloakAuthority = "https://auth.internal.dlemfg.com/realms/dle-os";
const string securityConnectionString =
    @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;" +
    "Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadOnly;";
const string kittingDocumentRoute = "/api/development/kitting-documents/v1/work-orders";
const string kittingShortageRoot = @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
const string kittingCompleteRoot = @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
const string requiredRuntimeIdentity = @"DLE-OS-HOST\DLE-OS";
var identitySigningKeyPath = Environment.GetEnvironmentVariable(
    "DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH");
var oidcClientSecret = Environment.GetEnvironmentVariable("DLE_OS_OIDC_CLIENT_SECRET");

if (!string.Equals(WindowsIdentity.GetCurrent().Name, requiredRuntimeIdentity,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
        $"The authenticated development BFF must run as {requiredRuntimeIdentity}.");
if (string.IsNullOrWhiteSpace(oidcClientSecret) || oidcClientSecret.Length < 32)
    throw new InvalidOperationException("The protected DLE-OS OIDC client secret is unavailable.");

var sqlBoundary = new SqlConnectionStringBuilder(securityConnectionString);
if (!string.Equals(sqlBoundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    sqlBoundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The development frontend security database boundary is invalid.");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(frontendPrefix);
    options.UrlPrefixes.Add(temporaryPhase61AIpPrefix);
    options.UrlPrefixes.Add(governedPhase62AHostnamePrefix);
    options.UrlPrefixes.Add(governedPhase62BHttpsPrefix);
    options.UrlPrefixes.Add(governedPhase62CIdentityPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddSingleton<ServerSideOidcTicketStore>();
builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = DleOsOidcSchemes.Cookie;
        options.DefaultSignInScheme = DleOsOidcSchemes.Cookie;
        options.DefaultChallengeScheme = DleOsOidcSchemes.OpenIdConnect;
    })
    .AddCookie(DleOsOidcSchemes.Cookie, options =>
    {
        options.Cookie.Name = "__Host-DLEOS-Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.Path = "/";
        options.ExpireTimeSpan = TimeSpan.FromMinutes(30);
        options.SlidingExpiration = false;
    })
    .AddOpenIdConnect(DleOsOidcSchemes.OpenIdConnect, options =>
    {
        options.Authority = keycloakAuthority;
        options.ClientId = "dle-os-development-bff";
        options.ClientSecret = oidcClientSecret;
        options.ResponseType = OpenIdConnectResponseType.Code;
        options.ResponseMode = OpenIdConnectResponseMode.Query;
        options.UsePkce = true;
        options.RequireHttpsMetadata = true;
        options.SaveTokens = true;
        options.GetClaimsFromUserInfoEndpoint = false;
        options.MapInboundClaims = false;
        options.CallbackPath = "/signin-oidc";
        options.SignedOutCallbackPath = "/signout-callback-oidc";
        options.RemoteSignOutPath = "/signout-oidc";
        options.Scope.Clear();
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.TokenValidationParameters = new TokenValidationParameters
        {
            NameClaimType = "preferred_username",
            RoleClaimType = "roles"
        };
        options.CorrelationCookie.Name = "__Host-DLEOS-Correlation.";
        options.CorrelationCookie.HttpOnly = true;
        options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.Always;
        options.CorrelationCookie.SameSite = SameSiteMode.None;
        options.CorrelationCookie.Path = "/";
        options.NonceCookie.Name = "__Host-DLEOS-Nonce.";
        options.NonceCookie.HttpOnly = true;
        options.NonceCookie.SecurePolicy = CookieSecurePolicy.Always;
        options.NonceCookie.SameSite = SameSiteMode.None;
        options.NonceCookie.Path = "/";
        options.Events = new OpenIdConnectEvents
        {
            OnRedirectToIdentityProvider = context =>
            {
                context.ProtocolMessage.Prompt = "login";
                context.ProtocolMessage.RedirectUri = canonicalApplicationOrigin + "/signin-oidc";
                return Task.CompletedTask;
            },
            OnRedirectToIdentityProviderForSignOut = context =>
            {
                context.ProtocolMessage.IdTokenHint = context.Properties.GetTokenValue("id_token");
                context.ProtocolMessage.PostLogoutRedirectUri = canonicalApplicationOrigin + "/shared";
                return Task.CompletedTask;
            },
            OnRemoteFailure = context =>
            {
                context.HandleResponse();
                context.Response.Redirect("/shared?authenticationFailed=1");
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddOptions<CookieAuthenticationOptions>(DleOsOidcSchemes.Cookie)
    .Configure<ServerSideOidcTicketStore>((options, store) => options.SessionStore = store);
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});
builder.Services.AddHttpContextAccessor();
builder.Services.AddAntiforgery(options =>
{
    options.Cookie.Name = "__Host-DLEOS-CSRF";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.Path = "/";
});
builder.Services.AddHttpClient("KeycloakLoopback")
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = System.Net.DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(10)
    });
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
var authenticatedShellSource = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
var sharedDeviceWelcomeDocument = SharedDeviceWelcomeUi.Render(
    SharedDeviceWelcomeUi.ExtractAuthenticatedHeaderLogo(authenticatedShellSource));
app.Lifetime.ApplicationStopped.Register(provider.Dispose);

void NoStore(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

app.UseMiddleware<KeycloakGatewayMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.Use(async (context, next) =>
{
    if (IsSharedEntryPath(context.Request.Path) || IsAuthenticationPath(context.Request.Path))
    {
        await next();
        return;
    }

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

app.MapGet("/shared", (HttpContext context) =>
{
    NoStore(context.Response);
    SharedDeviceWelcomeUi.ApplySecurityHeaders(context.Response);
    return Results.Text(sharedDeviceWelcomeDocument, "text/html; charset=utf-8");
}).AllowAnonymous();

app.MapGet("/auth/signin", (HttpContext context) =>
{
    NoStore(context.Response);
    if (!context.Request.IsHttps ||
        !context.Request.Host.Host.Equals("dle-os.internal.dlemfg.com", StringComparison.OrdinalIgnoreCase))
        return Results.Redirect(canonicalApplicationOrigin + "/auth/signin");
    return Results.Challenge(
        new AuthenticationProperties { RedirectUri = canonicalApplicationOrigin + "/" },
        [DleOsOidcSchemes.OpenIdConnect]);
}).AllowAnonymous();

app.MapGet("/auth/windows", (HttpContext context) =>
{
    NoStore(context.Response);
    if (context.User.Identity?.IsAuthenticated == true)
        return Results.Redirect(canonicalApplicationOrigin + "/");
    context.Response.Headers.WWWAuthenticate = "Negotiate";
    return Results.StatusCode(StatusCodes.Status401Unauthorized);
}).AllowAnonymous();

app.MapPost("/auth/logout", async (HttpContext context, IAntiforgery antiforgery) =>
{
    NoStore(context.Response);
    try
    {
        await antiforgery.ValidateRequestAsync(context);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest(new { error = new { code = "DLE_OS_LOGOUT_CSRF_INVALID" } });
    }
    var idToken = await context.GetTokenAsync(DleOsOidcSchemes.Cookie, "id_token");
    var properties = new AuthenticationProperties
    {
        RedirectUri = canonicalApplicationOrigin + "/shared"
    };
    if (!string.IsNullOrWhiteSpace(idToken))
        properties.StoreTokens([new AuthenticationToken { Name = "id_token", Value = idToken }]);
    return Results.SignOut(properties,
        [DleOsOidcSchemes.Cookie, DleOsOidcSchemes.OpenIdConnect]);
}).RequireAuthorization();

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

app.MapGet("/", async (
    HttpContext context,
    ICurrentUserContext currentUserContext,
    IAntiforgery antiforgery) =>
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
    var antiforgeryToken = antiforgery.GetAndStoreTokens(context).RequestToken ??
        throw new InvalidOperationException("The governed logout antiforgery token was not generated.");
    html = SharedDeviceSessionUi.Inject(html, antiforgeryToken);
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

static bool IsSharedEntryPath(PathString path) =>
    path.Equals("/shared", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/shared/", StringComparison.OrdinalIgnoreCase);

static bool IsAuthenticationPath(PathString path) =>
    path.StartsWithSegments("/auth") ||
    path.Equals("/signin-oidc", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/signout-oidc", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/signout-callback-oidc", StringComparison.OrdinalIgnoreCase);
