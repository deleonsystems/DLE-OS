using System.Net;
using System.Net.Http.Headers;
using DleOs.TrustedIdentity;

public static class DevelopmentCompatibilityProxy
{
    private const string EnvironmentName = "ISOLATED_DEVELOPMENT";
    private const long MaximumRequestBodyBytes = 2 * 1024 * 1024;

    private static readonly ProxyBoundary Canonical = new(
        "canonical-read", new Uri("http://DLE-OS-HOST:5052"), [HttpMethods.Get], null);
    private static readonly ProxyBoundary Operational = new(
        "operational-development", new Uri("http://DLE-OS-HOST:5054"),
        [HttpMethods.Get, HttpMethods.Post], TrustedIdentityContract.OperationalAudience);
    private static readonly ProxyBoundary CustomerFiles = new(
        "customer-files-control", new Uri("http://DLE-OS-HOST:5053"),
        [HttpMethods.Get, HttpMethods.Post], null);

    public static void AddDevelopmentCompatibilityProxy(this IServiceCollection services)
    {
        services.AddHttpClient("development-compatibility")
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
            {
                UseDefaultCredentials = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
            });
    }

    public static void MapDevelopmentCompatibilityProxy(this WebApplication app)
    {
        app.MapMethods("/api/platform/live/v1/{**path}", [HttpMethods.Get],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, Canonical, token));

        MapOperational(app, "/api/work-order-approvals/{**path}");
        MapOperational(app, "/api/operational-work-order-relationships/{**path}");
        MapOperational(app, "/api/kitting-dispositions/{**path}");
        MapOperational(app, "/api/rma-rework/{**path}");
        MapOperational(app, "/api/shipment-staging/{**path}");
        MapOperational(app, "/api/development/identity/{**path}");

        app.MapMethods("/api/customer-files/{**path}", [HttpMethods.Get, HttpMethods.Post],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, CustomerFiles, token));
    }

    private static void MapOperational(WebApplication app, string pattern) =>
        app.MapMethods(pattern, [HttpMethods.Get, HttpMethods.Post],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, Operational, token));

    private static async Task ForwardAsync(
        HttpContext context,
        ICurrentUserContext currentUsers,
        IIdentityAssertionIssuer assertions,
        IHttpClientFactory clientFactory,
        ILoggerFactory loggerFactory,
        ProxyBoundary boundary,
        CancellationToken cancellationToken)
    {
        var current = await currentUsers.ResolveAsync(cancellationToken);
        if (current.Status != CurrentUserStatus.Active || current.User is null ||
            !current.User.IsSuperAdmin)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                code = "DLE_OS_DEVELOPMENT_SUPER_ADMIN_REQUIRED",
                message = "This development compatibility route requires an active DLE-OS SUPER_ADMIN."
            }, cancellationToken);
            return;
        }

        if (!boundary.Methods.Contains(context.Request.Method, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
            return;
        }
        if (context.Request.ContentLength is > MaximumRequestBodyBytes)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return;
        }

        var correlationId = Guid.NewGuid().ToString("D");
        var downstreamUri = new Uri(boundary.BaseAddress,
            context.Request.Path.Value + context.Request.QueryString.Value);
        var logger = loggerFactory.CreateLogger("DleOs.DevelopmentCompatibility");
        logger.LogInformation(
            "CompatibilityRequest UserId={UserId}; UserName={UserName}; Environment={Environment}; " +
            "Boundary={Boundary}; Method={Method}; Route={Route}; CorrelationId={CorrelationId}",
            current.User.UserId, current.User.UserName, EnvironmentName, boundary.Name,
            context.Request.Method, context.Request.Path, correlationId);

        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), downstreamUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("X-DLE-OS-Correlation-ID", correlationId);
        if (boundary.Audience is not null)
        {
            var assertion = assertions.Issue(new IdentityAssertionIssueRequest(
                current.User.UserId,
                current.User.UserName,
                current.User.DisplayName,
                current.User.Roles.Select(role => role.RoleCode).ToArray(),
                current.User.IsSuperAdmin,
                boundary.Audience,
                TrustedIdentityContract.DevelopmentEnvironment,
                correlationId));
            request.Headers.TryAddWithoutValidation(TrustedIdentityContract.HeaderName, assertion);
        }
        if (context.Request.ContentLength is > 0)
        {
            request.Content = new StreamContent(context.Request.Body);
            if (!string.IsNullOrWhiteSpace(context.Request.ContentType))
                request.Content.Headers.TryAddWithoutValidation("Content-Type", context.Request.ContentType);
        }

        HttpResponseMessage downstream;
        try
        {
            downstream = await clientFactory.CreateClient("development-compatibility")
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (HttpRequestException error)
        {
            logger.LogError(error,
                "CompatibilityDownstreamUnavailable Boundary={Boundary}; CorrelationId={CorrelationId}",
                boundary.Name, correlationId);
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new
            {
                code = "DLE_OS_DEVELOPMENT_DOWNSTREAM_UNAVAILABLE",
                message = "The governed development service is temporarily unavailable.",
                correlationId
            }, cancellationToken);
            return;
        }

        using (downstream)
        {
            if (downstream.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                logger.LogError(
                    "CompatibilityServiceIdentityRejected Boundary={Boundary}; Status={Status}; " +
                    "CorrelationId={CorrelationId}", boundary.Name, (int)downstream.StatusCode, correlationId);
                context.Response.StatusCode = StatusCodes.Status502BadGateway;
                await context.Response.WriteAsJsonAsync(new
                {
                    code = "DLE_OS_DEVELOPMENT_SERVICE_IDENTITY_REJECTED",
                    message = "The governed development service rejected the BFF service identity.",
                    correlationId
                }, cancellationToken);
                return;
            }

            context.Response.StatusCode = (int)downstream.StatusCode;
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-DLE-OS-Correlation-ID"] = correlationId;
            if (downstream.Content.Headers.ContentType is not null)
                context.Response.ContentType = downstream.Content.Headers.ContentType.ToString();
            if (downstream.Headers.TryGetValues("X-Request-ID", out var requestIds))
                context.Response.Headers["X-Request-ID"] = requestIds.ToArray();
            await downstream.Content.CopyToAsync(context.Response.Body, cancellationToken);
        }
    }

    private sealed record ProxyBoundary(
        string Name,
        Uri BaseAddress,
        string[] Methods,
        string? Audience);
}
