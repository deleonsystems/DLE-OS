using System.Net;
using System.Net.Http.Headers;
using DleOs.Security;
using DleOs.TrustedIdentity;

public static class DevelopmentCompatibilityProxy
{
    private const long MaximumRequestBodyBytes = 2 * 1024 * 1024;
    private static readonly AuthorizationEvaluator Authorization = new();

    public static void AddDevelopmentCompatibilityProxy(this IServiceCollection services)
    {
        services.AddHttpClient("development-compatibility")
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
            {
                UseDefaultCredentials = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
            });
    }

    public static void MapDevelopmentCompatibilityProxy(
        this WebApplication app, DleOsRuntimeConfiguration runtime)
    {
        var canonical = new ProxyBoundary(
            "canonical-read", new Uri(runtime.CanonicalApiBaseUrl), [HttpMethods.Get], null);
        var operational = new ProxyBoundary(
            "operational-write", new Uri(runtime.OperationalApiBaseUrl),
            [HttpMethods.Get, HttpMethods.Post, HttpMethods.Put], TrustedIdentityContract.OperationalAudience);
        var customerFiles = new ProxyBoundary(
            "customer-files-control", new Uri(runtime.CustomerFilesApiBaseUrl),
            [HttpMethods.Get, HttpMethods.Post], null);
        app.MapMethods("/api/platform/live/v1/{**path}", [HttpMethods.Get],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, runtime, canonical, token));

        MapOperational(app, runtime, operational, "/api/work-order-approvals/{**path}");
        MapOperational(app, runtime, operational, "/api/operational-work-order-relationships/{**path}");
        MapOperational(app, runtime, operational, "/api/operations-center/{**path}");
        MapOperational(app, runtime, operational, "/api/kitting-dispositions/{**path}");
        MapOperational(app, runtime, operational, "/api/kitting-cases/{**path}");
        MapOperational(app, runtime, operational, "/api/rma-rework/{**path}");
        MapOperational(app, runtime, operational, "/api/shipment-staging/{**path}");
        MapOperational(app, runtime, operational, "/api/platform/refresh/invoice-history/v1/{**path}");
        MapOperational(app, runtime, operational, "/api/sync/operations");
        MapOperational(app, runtime, operational, "/api/sync/operations/{**path}");
        MapOperational(app, runtime, operational, "/api/development/identity/{**path}");

        app.MapMethods("/api/customer-files/{**path}", [HttpMethods.Get, HttpMethods.Post],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, runtime, customerFiles, token));
    }

    private static void MapOperational(WebApplication app, DleOsRuntimeConfiguration runtime,
        ProxyBoundary operational, string pattern) =>
        app.MapMethods(pattern, [HttpMethods.Get, HttpMethods.Post, HttpMethods.Put],
            (HttpContext context, ICurrentUserContext users, IIdentityAssertionIssuer assertions,
                IHttpClientFactory clients,
                ILoggerFactory logs, CancellationToken token) =>
                ForwardAsync(context, users, assertions, clients, logs, runtime, operational, token));

    private static async Task ForwardAsync(
        HttpContext context,
        ICurrentUserContext currentUsers,
        IIdentityAssertionIssuer assertions,
        IHttpClientFactory clientFactory,
        ILoggerFactory loggerFactory,
        DleOsRuntimeConfiguration runtime,
        ProxyBoundary boundary,
        CancellationToken cancellationToken)
    {
        var current = await currentUsers.ResolveAsync(cancellationToken);
        if (current.Status != CurrentUserStatus.Active || current.User is null)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                code = "DLE_OS_ACTIVE_USER_REQUIRED",
                message = "This development compatibility route requires an active DLE-OS user."
            }, cancellationToken);
            return;
        }

        var requiredPermission = ResolvePermission(context.Request);
        if (!current.User.IsSuperAdmin &&
            (requiredPermission is null || !Authorization.Can(current.User, requiredPermission)))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                code = "DLE_OS_PERMISSION_DENIED",
                message = requiredPermission is null
                    ? "This development route remains restricted to SUPER_ADMIN."
                    : "The DLE-OS user does not have the required application permission.",
                requiredPermission
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
            current.User.UserId, current.User.UserName, runtime.RuntimeMarker, boundary.Name,
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
            // The downstream client authenticates to 5054 with Windows authentication.
            // Buffer the already size-limited body so HttpClient can replay it after the
            // Negotiate challenge; a StreamContent over the inbound request cannot be
            // replayed and causes body-bearing POSTs to arrive anonymously.
            using var body = new MemoryStream();
            await context.Request.Body.CopyToAsync(body, cancellationToken);
            request.Content = new ByteArrayContent(body.ToArray());
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
            byte[]? bufferedBody = null;
            if (downstream.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                bufferedBody = await downstream.Content.ReadAsByteArrayAsync(cancellationToken);
                var downstreamCode = TryReadErrorCode(bufferedBody);
                var serviceIdentityRejected = string.IsNullOrWhiteSpace(downstreamCode) ||
                    string.Equals(downstreamCode, "DLE_OS_IDENTITY_CALLER_NOT_TRUSTED",
                        StringComparison.Ordinal);
                if (serviceIdentityRejected)
                {
                    logger.LogError(
                        "CompatibilityServiceIdentityRejected Boundary={Boundary}; Status={Status}; " +
                        "DownstreamCode={DownstreamCode}; CorrelationId={CorrelationId}",
                        boundary.Name, (int)downstream.StatusCode, downstreamCode, correlationId);
                    context.Response.StatusCode = StatusCodes.Status502BadGateway;
                    await context.Response.WriteAsJsonAsync(new
                    {
                        code = "DLE_OS_DEVELOPMENT_SERVICE_IDENTITY_REJECTED",
                        message = "The governed development service rejected the BFF service identity.",
                        correlationId
                    }, cancellationToken);
                    return;
                }

                logger.LogWarning(
                    "CompatibilityDownstreamAuthorizationRejected Boundary={Boundary}; Status={Status}; " +
                    "DownstreamCode={DownstreamCode}; CorrelationId={CorrelationId}",
                    boundary.Name, (int)downstream.StatusCode, downstreamCode, correlationId);
            }

            context.Response.StatusCode = (int)downstream.StatusCode;
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-DLE-OS-Correlation-ID"] = correlationId;
            if (downstream.Content.Headers.ContentType is not null)
                context.Response.ContentType = downstream.Content.Headers.ContentType.ToString();
            if (downstream.Headers.TryGetValues("X-Request-ID", out var requestIds))
                context.Response.Headers["X-Request-ID"] = requestIds.ToArray();
            if (bufferedBody is not null)
                await context.Response.Body.WriteAsync(bufferedBody, cancellationToken);
            else
                await downstream.Content.CopyToAsync(context.Response.Body, cancellationToken);
        }
    }

    private static string? TryReadErrorCode(byte[] body)
    {
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(body);
            return document.RootElement.TryGetProperty("code", out var code) &&
                   code.ValueKind == System.Text.Json.JsonValueKind.String
                ? code.GetString()
                : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    internal static string? ResolvePermission(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        var write = !HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method);
        if (path.StartsWith("/api/platform/live/v1/sales-orders", StringComparison.OrdinalIgnoreCase))
            return "kitting.view";
        if (path.StartsWith("/api/platform/live/v1/work-orders", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/platform/live/v1/sales-order-work-order-relationships",
                StringComparison.OrdinalIgnoreCase))
            return "work_orders.view";
        if (path.StartsWith("/api/work-order-approvals/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/operational-work-order-relationships/", StringComparison.OrdinalIgnoreCase))
            return write ? "work_orders.approve" : "work_orders.view";
        if (path.StartsWith("/api/kitting-dispositions/", StringComparison.OrdinalIgnoreCase))
            return write ? "kitting.disposition" : "kitting.view";
        if (path.StartsWith("/api/kitting-cases/", StringComparison.OrdinalIgnoreCase))
            return write ? "kitting.disposition" : "kitting.view";
        if (path.StartsWith("/api/rma-rework/", StringComparison.OrdinalIgnoreCase))
            return write ? "rma_rework.manage" : "rma_rework.view";
        if (path.StartsWith("/api/operations-center/v1/verified-statuses/latest", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        if (path.StartsWith("/api/operations-center/", StringComparison.OrdinalIgnoreCase))
            return write ? "operations-center.verified-status.write" : "sync.operations";
        if (path.StartsWith("/api/shipment-staging/", StringComparison.OrdinalIgnoreCase))
            return write ? "shipments.stage" : "shipments.view";
        if (path.StartsWith("/api/platform/refresh/invoice-history/v1/", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        if (path.StartsWith("/api/sync/operations", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        return null;
    }

    private sealed record ProxyBoundary(
        string Name,
        Uri BaseAddress,
        string[] Methods,
        string? Audience);
}
