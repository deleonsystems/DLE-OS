using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using System.Text.Json;
using System.Security.Principal;

const string keycloakAuthority = "https://auth.internal.dlemfg.com/realms/dle-os";
const string employeeDirectoryApiPolicy = "DLE-OS-EMPLOYEE-DIRECTORY-API";
const string kittingDocumentRoute = "/api/development/kitting-documents/v1/work-orders";
const string kittingShortageRoot = @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
const string kittingCompleteRoot = @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
const string drawingPrintsRoute = "/api/development/drawing-prints/v1/resolve";
const string desktopCapabilityRedeemRoute = "/api/development/desktop-capabilities/v1/redeem";
var serviceBootstrap = DleOsWindowsServiceBootstrap.Apply(args);
var applicationArgs = serviceBootstrap.ApplicationArguments;
var frontendContentRoot = Path.GetFullPath(
    Environment.GetEnvironmentVariable("DLE_OS_FRONTEND_CONTENT_ROOT") ??
    throw new InvalidOperationException(
        "Required explicit runtime setting DLE_OS_FRONTEND_CONTENT_ROOT is absent."));
var requiredRuntimeIdentity = Environment.GetEnvironmentVariable("DLE_OS_REQUIRED_RUNTIME_IDENTITY") ??
    throw new InvalidOperationException("Required explicit runtime setting DLE_OS_REQUIRED_RUNTIME_IDENTITY is absent.");
var identitySigningKeyPath = Environment.GetEnvironmentVariable(
    "DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH");
var oidcClientSecret = Environment.GetEnvironmentVariable("DLE_OS_OIDC_CLIENT_SECRET");
var keycloakProvisioningClientSecret = Environment.GetEnvironmentVariable("DLE_OS_KEYCLOAK_PROVISIONING_CLIENT_SECRET");
var runtime = DleOsRuntimeConfiguration.Load();
var runtimeBuildInfo = DevRuntimeBuildInfo.Load(
    Path.Combine(AppContext.BaseDirectory, "runtime-build-info.json"));
if (serviceBootstrap.IsWindowsService)
{
    var expectedFrontendContentRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "frontend"));
    if (!frontendContentRoot.Equals(expectedFrontendContentRoot,
            StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException(
            "The governed DEV service cannot serve frontend files outside its immutable release.");
    _ = FrontendReleaseManifestValidator.Validate(
        frontendContentRoot,
        Path.Combine(AppContext.BaseDirectory, "frontend-manifest.json"),
        runtimeBuildInfo);
}
var canonicalApplicationOrigin = runtime.ApplicationOrigin;
var canonicalApplicationHost = new Uri(canonicalApplicationOrigin).Host;
var authenticationKeyRoot = Path.Combine(runtime.AuthenticationStateRoot, "DataProtectionKeys");
var authenticationTicketRoot = Path.Combine(runtime.AuthenticationStateRoot, "Tickets");
var securityConnectionString =
    $@"Server=lpc:.\SQLEXPRESS;Database={runtime.SecurityDatabase};Integrated Security=True;" +
    "Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;";

if (!string.Equals(WindowsIdentity.GetCurrent().Name, requiredRuntimeIdentity,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
        $"The authenticated development BFF must run as {requiredRuntimeIdentity}.");
if (string.IsNullOrWhiteSpace(oidcClientSecret) || oidcClientSecret.Length < 32)
    throw new InvalidOperationException("The protected DLE-OS OIDC client secret is unavailable.");
if (runtime.EnableUserProvisioning &&
    (string.IsNullOrWhiteSpace(keycloakProvisioningClientSecret) || keycloakProvisioningClientSecret.Length < 32))
    throw new InvalidOperationException("The protected Keycloak provisioning client secret is unavailable.");

var sqlBoundary = new SqlConnectionStringBuilder(securityConnectionString);
if (!string.Equals(sqlBoundary.InitialCatalog, runtime.SecurityDatabase, StringComparison.Ordinal))
    throw new InvalidOperationException("The configured frontend security database boundary is invalid.");

var builder = WebApplication.CreateBuilder(applicationArgs);
if (serviceBootstrap.IsWindowsService)
    builder.Host.UseWindowsService(options => options.ServiceName = DleOsWindowsServiceBootstrap.ServiceName);
builder.WebHost.UseHttpSys(options =>
{
    foreach (var prefix in runtime.FrontendPrefixes)
        options.UrlPrefixes.Add(prefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddDataProtection()
    .SetApplicationName("DLE-OS-DevelopmentFrontend-DEV")
    .PersistKeysToFileSystem(new DirectoryInfo(authenticationKeyRoot))
    .ProtectKeysWithDpapi(protectToLocalMachine: true);
builder.Services.AddSingleton<ServerSideOidcTicketStore>(services => new(
    authenticationTicketRoot,
    services.GetRequiredService<IDataProtectionProvider>(),
    services.GetRequiredService<ILogger<ServerSideOidcTicketStore>>()));
builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = DleOsOidcSchemes.Cookie;
        options.DefaultSignInScheme = DleOsOidcSchemes.Cookie;
        options.DefaultChallengeScheme = DleOsOidcSchemes.Challenge;
    })
    .AddPolicyScheme(DleOsOidcSchemes.Challenge, DleOsOidcSchemes.Challenge, options =>
    {
        options.ForwardDefaultSelector = context =>
            OidcChallengeBehavior.RequiresStatusCode(context.Request)
                ? DleOsOidcSchemes.Cookie
                : DleOsOidcSchemes.OpenIdConnect;
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
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = OidcChallengeBehavior.IsBrowserFetch(context.Request)
                ? StatusCodes.Status403Forbidden
                : StatusCodes.Status401Unauthorized;
            context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
            if (OidcChallengeBehavior.RequiresStatusCode(context.Request))
                context.Response.Headers["X-DLE-OS-Authentication-Required"] = "true";
            context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("DleOs.Authentication")
                .LogWarning(
                    "Authentication required for non-interactive request {Method} {Path}; returning {StatusCode}.",
                    context.Request.Method, context.Request.Path.Value, context.Response.StatusCode);
            return Task.CompletedTask;
        };
    })
    .AddOpenIdConnect(DleOsOidcSchemes.OpenIdConnect, options =>
    {
        options.Authority = keycloakAuthority;
        options.ClientId = runtime.OidcClientId;
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
                context.ProtocolMessage.RedirectUri = canonicalApplicationOrigin + "/signin-oidc";
                return Task.CompletedTask;
            },
            OnRedirectToIdentityProviderForSignOut = context =>
            {
                context.ProtocolMessage.IdTokenHint = context.Properties.GetTokenValue("id_token");
                context.ProtocolMessage.PostLogoutRedirectUri = canonicalApplicationOrigin + "/auth/signin";
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
    options.AddPolicy(employeeDirectoryApiPolicy, policy =>
    {
        policy.AddAuthenticationSchemes(DleOsOidcSchemes.Cookie);
        policy.RequireAuthenticatedUser();
    });
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
if (runtime.EnableUserProvisioning)
{
    builder.Services.AddSingleton(sp => new KeycloakProvisioningClient(
        sp.GetRequiredService<IHttpClientFactory>().CreateClient("KeycloakLoopback"),
        keycloakProvisioningClientSecret!));
    builder.Services.AddSingleton<UserProvisioningService>(sp => new(
        securityConnectionString, sp.GetRequiredService<KeycloakProvisioningClient>()));
}
builder.Services.AddSingleton<IIdentityAssertionIssuer>(_ =>
    new Es256IdentityAssertionIssuer(
        IdentityAssertionKeyLoader.LoadPrivateKey(identitySigningKeyPath ?? "")));
builder.Services.AddDevelopmentCompatibilityProxy();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});

var app = builder.Build();
var provider = new PhysicalFileProvider(frontendContentRoot);
var contentTypes = new FileExtensionContentTypeProvider();
var brandingAssetRoot = Path.Combine(frontendContentRoot, "ASSETS", "ICONS");
var kittingDocuments = new KittingDocumentService(kittingShortageRoot, kittingCompleteRoot);
var drawingPrints = new DrawingPrintsResolver(
    DrawingPrintsResolver.GovernedRoot,
    new SystemDrawingPrintsFileSystem(),
    diagnostic => app.Logger.LogWarning(
        new EventId(50511, "DrawingPrintsResolutionFailure"),
        "Drawing-Prints resolver failure. CorrelationId={CorrelationId}; Stage={Stage}; Category={Category}; HResult={HResult}",
        diagnostic.CorrelationId,
        diagnostic.Stage,
        diagnostic.Category,
        diagnostic.HResult));
var desktopCapabilities = new GovernedDesktopCapabilityBroker();
var authenticatedShellSource = File.ReadAllText(
    Path.Combine(frontendContentRoot, "DLE_Work_Center_v4.0.0.html"));
var shellIdentityJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var sharedDeviceWelcomeDocument = SharedDeviceWelcomeUi.Render(
    SharedDeviceWelcomeUi.ExtractAuthenticatedHeaderLogo(authenticatedShellSource));
app.Lifetime.ApplicationStopped.Register(provider.Dispose);

void NoStore(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

app.UseResponseCompression();
app.UseMiddleware<KeycloakGatewayMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.Use(async (context, next) =>
{
    if (IsSharedEntryPath(context.Request.Path) || IsAuthenticationPath(context.Request.Path) ||
        IsRuntimeInfoPath(context.Request.Path) || IsBrandingAssetPath(context.Request.Path) ||
        IsDesktopCapabilityRedemptionPath(context.Request.Path))
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

app.MapGet("/api/runtime/info", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.Ok(runtimeBuildInfo.ToSafeResponse());
}).AllowAnonymous();

app.MapGet("/apple-touch-icon.png", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(Path.Combine(brandingAssetRoot, "apple-touch-icon.png"), "image/png");
}).AllowAnonymous();

app.MapGet("/favicon-32x32.png", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(Path.Combine(brandingAssetRoot, "favicon-32x32.png"), "image/png");
}).AllowAnonymous();

app.MapGet("/dle-os-icon-192.png", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(Path.Combine(brandingAssetRoot, "dle-os-icon-192.png"), "image/png");
}).AllowAnonymous();

app.MapGet("/dle-os-icon-512.png", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(Path.Combine(brandingAssetRoot, "dle-os-icon-512.png"), "image/png");
}).AllowAnonymous();

app.MapGet("/site.webmanifest", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(Path.Combine(brandingAssetRoot, "site.webmanifest"),
        "application/manifest+json");
}).AllowAnonymous();

app.MapGet("/auth/signin", (HttpContext context) =>
{
    NoStore(context.Response);
    if (!context.Request.IsHttps ||
        !context.Request.Host.Host.Equals(canonicalApplicationHost, StringComparison.OrdinalIgnoreCase))
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
        RedirectUri = canonicalApplicationOrigin + "/auth/signin"
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
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapGet("/api/development/employees/v1/{employeeId:guid}/administration", async (
    HttpContext context, Guid employeeId, ICurrentUserContext currentUserContext,
    UserProvisioningService provisioning) =>
{
    NoStore(context.Response);
    var current=await currentUserContext.ResolveAsync(context.RequestAborted);
    if(!EmployeeDirectoryAuthorization.CanAdminister(current)) return Results.Json(new {code="DLE_OS_EMPLOYEE_ADMIN_REQUIRED"},statusCode:403);
    try { return Results.Ok(await provisioning.GetAdministrationAsync(employeeId,context.RequestAborted)); }
    catch(UserProvisioningException failure) { return Results.Json(new {code=failure.Code,message=failure.Message},statusCode:(int)failure.Status); }
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapPost("/api/development/employees/v1/provision", async (
    HttpContext context, ProvisionEmployeeUserRequest request, ICurrentUserContext currentUserContext,
    UserProvisioningService provisioning, IAntiforgery antiforgery) =>
{
    NoStore(context.Response);
    try { await antiforgery.ValidateRequestAsync(context); }
    catch(AntiforgeryValidationException) { return Results.Json(new {code="DLE_OS_CSRF_INVALID"},statusCode:400); }
    var current=await currentUserContext.ResolveAsync(context.RequestAborted);
    if(!EmployeeDirectoryAuthorization.CanAdminister(current)||current.User is null) return Results.Json(new {code="DLE_OS_EMPLOYEE_ADMIN_REQUIRED"},statusCode:403);
    try { return Results.Ok(await provisioning.ProvisionAsync(request,current.User.UserId,$"DLE_OS:{current.User.UserName}",Guid.NewGuid(),context.RequestAborted)); }
    catch(UserProvisioningException failure) { return Results.Json(new {code=failure.Code,message=failure.Message},statusCode:(int)failure.Status); }
    catch(SqlException failure) { return Results.Json(new {code="DLE_OS_PROVISIONING_REJECTED",message=failure.Message},statusCode:409); }
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapPost("/api/development/employees/v1/credentials/reset", async (
    HttpContext context, ResetUserCredentialRequest request, ICurrentUserContext currentUserContext,
    UserProvisioningService provisioning, IAntiforgery antiforgery) =>
{
    NoStore(context.Response); try { await antiforgery.ValidateRequestAsync(context); } catch(AntiforgeryValidationException){return Results.Json(new{code="DLE_OS_CSRF_INVALID"},statusCode:400);}
    var current=await currentUserContext.ResolveAsync(context.RequestAborted); if(!EmployeeDirectoryAuthorization.CanAdminister(current)||current.User is null)return Results.Json(new{code="DLE_OS_EMPLOYEE_ADMIN_REQUIRED"},statusCode:403);
    try{return Results.Ok(await provisioning.ResetCredentialAsync(request,current.User.UserId,$"DLE_OS:{current.User.UserName}",Guid.NewGuid(),context.RequestAborted));}
    catch(UserProvisioningException failure){return Results.Json(new{code=failure.Code,message=failure.Message},statusCode:(int)failure.Status);}
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapPost("/api/development/employees/v1/users/{action:regex(^(disable|reenable|sessions-revoke)$)}", async (
    HttpContext context,string action,SetUserEnabledRequest request,ICurrentUserContext currentUserContext,
    UserProvisioningService provisioning,IAntiforgery antiforgery) =>
{
    NoStore(context.Response);try{await antiforgery.ValidateRequestAsync(context);}catch(AntiforgeryValidationException){return Results.Json(new{code="DLE_OS_CSRF_INVALID"},statusCode:400);}
    var current=await currentUserContext.ResolveAsync(context.RequestAborted);if(!EmployeeDirectoryAuthorization.CanAdminister(current)||current.User is null)return Results.Json(new{code="DLE_OS_EMPLOYEE_ADMIN_REQUIRED"},statusCode:403);
    try
    {
        if(action=="sessions-revoke")await provisioning.RevokeSessionsAsync(request.UserId,current.User.UserId,$"DLE_OS:{current.User.UserName}",Guid.NewGuid(),context.RequestAborted);
        else await provisioning.SetEnabledAsync(request.UserId,action=="reenable",current.User.UserId,$"DLE_OS:{current.User.UserName}",Guid.NewGuid(),context.RequestAborted);
        return Results.Ok(new{status="OK"});
    }
    catch(UserProvisioningException failure){return Results.Json(new{code=failure.Code,message=failure.Message},statusCode:(int)failure.Status);}
    catch(SqlException failure){return Results.Json(new{code="DLE_OS_USER_LIFECYCLE_REJECTED",message=failure.Message},statusCode:409);}
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapPost("/api/development/employees/v1/roles", async (
    HttpContext context,SetUserRolesRequest request,ICurrentUserContext currentUserContext,
    UserProvisioningService provisioning,IAntiforgery antiforgery) =>
{
    NoStore(context.Response);try{await antiforgery.ValidateRequestAsync(context);}catch(AntiforgeryValidationException){return Results.Json(new{code="DLE_OS_CSRF_INVALID"},statusCode:400);}
    var current=await currentUserContext.ResolveAsync(context.RequestAborted);if(!EmployeeDirectoryAuthorization.CanAdminister(current)||current.User is null)return Results.Json(new{code="DLE_OS_EMPLOYEE_ADMIN_REQUIRED"},statusCode:403);
    try{await provisioning.SetRolesAsync(request,current.User.UserId,$"DLE_OS:{current.User.UserName}",Guid.NewGuid(),context.RequestAborted);return Results.Ok(new{status="OK"});}
    catch(SqlException failure){return Results.Json(new{code="DLE_OS_ROLE_CHANGE_REJECTED",message=failure.Message},statusCode:409);}
}).RequireAuthorization(employeeDirectoryApiPolicy);

app.MapDevelopmentCompatibilityProxy(runtime);

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

    var html = File.ReadAllText(
        Path.Combine(frontendContentRoot, "DLE_Work_Center_v4.0.0.html"));
    var runtimeConfiguration = JsonSerializer.Serialize(new
    {
        authenticatedBffBaseUrl = runtime.ApplicationOrigin,
        environment = runtime.RuntimeMarker,
        environmentName = runtime.Environment,
        environmentLabel = runtime.DisplayLabel,
        canonicalApiBaseUrl = runtime.CanonicalApiBaseUrl,
        operationalControlBaseUrl = runtime.OperationalApiBaseUrl
    });
    const string headElement = "<head>";
    var headIndex = html.IndexOf(headElement, StringComparison.Ordinal);
    if (headIndex < 0)
        return Results.Problem("The development frontend document head is absent.", statusCode: 500);
    html = html.Insert(headIndex + headElement.Length,
        "<script>window.DleOsRuntimeConfig=" + runtimeConfiguration + ";</script>");
    html = html.Replace("DEVELOPMENT — READ ONLY",
        runtime.DisplayLabel,
        StringComparison.Ordinal);
    var identityPayload = JsonSerializer.Serialize(
        CurrentUserResponseFactory.Create(currentUser).Body,
        shellIdentityJsonOptions);
    html = DevelopmentIdentityUi.Inject(html, identityPayload);
    var antiforgeryToken = antiforgery.GetAndStoreTokens(context).RequestToken ??
        throw new InvalidOperationException("The governed logout antiforgery token was not generated.");
    html = SharedDeviceSessionUi.Inject(html, antiforgeryToken);
    html = RuntimeIdentityUi.Inject(html, runtimeBuildInfo);
    html = EmployeeDirectoryUi.Inject(html, antiforgeryToken);
    html = TestIdentitiesUi.Inject(html);
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

app.MapGet(drawingPrintsRoute, (
    HttpContext context,
    string customerName,
    string assemblyNumber,
    string? revision) =>
{
    NoStore(context.Response);
    var allowedKeys = new HashSet<string>(
        ["customerName", "assemblyNumber", "revision"],
        StringComparer.OrdinalIgnoreCase);
    if (context.Request.Query.Keys.Any(key => !allowedKeys.Contains(key)))
        return Results.BadRequest(new { error = "Only governed manufacturing identity parameters are supported." });
    var resolution = drawingPrints.Resolve(
        customerName,
        assemblyNumber,
        revision,
        context.TraceIdentifier);
    return Results.Json(desktopCapabilities.Attach(resolution, context.TraceIdentifier));
}).RequireAuthorization();

app.MapPost(desktopCapabilityRedeemRoute, async (HttpContext context) =>
{
    NoStore(context.Response);
    if (!GovernedDesktopCapabilityBroker.IsSameHostRequest(context)) return Results.NotFound();
    if (context.Request.Query.Count != 0 || context.Request.ContentLength is > 4096)
        return Results.BadRequest(new { error = "Invalid desktop capability request." });

    DesktopCapabilityRedeemRequest? request;
    try
    {
        request = await context.Request.ReadFromJsonAsync<DesktopCapabilityRedeemRequest>();
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Invalid desktop capability request." });
    }
    if (!desktopCapabilities.TryRedeem(request, out var redemption, out var failureCategory))
        return Results.BadRequest(new { error = failureCategory });
    return Results.Json(redemption);
}).AllowAnonymous();

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = provider,
    OnPrepareResponse = context =>
        context.Context.Response.Headers.CacheControl = "public, max-age=0, must-revalidate"
});
app.Run();

static bool IsSharedEntryPath(PathString path) =>
    path.Equals("/shared", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/shared/", StringComparison.OrdinalIgnoreCase);

static bool IsRuntimeInfoPath(PathString path) =>
    path.Equals("/api/runtime/info", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/api/runtime/info/", StringComparison.OrdinalIgnoreCase);

static bool IsDesktopCapabilityRedemptionPath(PathString path) =>
    path.Equals("/api/development/desktop-capabilities/v1/redeem", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/api/development/desktop-capabilities/v1/redeem/", StringComparison.OrdinalIgnoreCase);

static bool IsBrandingAssetPath(PathString path) =>
    path.Equals("/apple-touch-icon.png", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/favicon-32x32.png", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/dle-os-icon-192.png", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/dle-os-icon-512.png", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/site.webmanifest", StringComparison.OrdinalIgnoreCase);

static bool IsAuthenticationPath(PathString path) =>
    path.StartsWithSegments("/auth") ||
    path.Equals("/signin-oidc", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/signout-oidc", StringComparison.OrdinalIgnoreCase) ||
    path.Equals("/signout-callback-oidc", StringComparison.OrdinalIgnoreCase);
