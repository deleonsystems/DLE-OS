using System.Collections.Concurrent;
using System.Security.Principal;
using System.Text.Json;
using DleOs.Security;
using DleOs.TrustedIdentity;

internal sealed class TrustedDleOsUserContextAccessor
{
    internal TrustedDleOsUserContext? Current { get; set; }
    internal ResolvedSecurityUser? AuthorizedUser { get; set; }
}

internal sealed class DevelopmentAssertionReplayStore
{
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> writeAssertions = new();

    internal bool TryConsume(Guid assertionId, DateTimeOffset expiresAt, DateTimeOffset now)
    {
        foreach (var item in writeAssertions.Where(item => item.Value <= now))
            writeAssertions.TryRemove(item.Key, out _);
        return writeAssertions.TryAdd(assertionId, expiresAt);
    }
}

internal static class TrustedDevelopmentIdentity
{
    private const string ServiceIdentity = @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";

    internal static void AddTrustedDevelopmentIdentity(this IServiceCollection services)
    {
        var publicKeyPath = ControlHostRuntimeConfiguration.IdentityAssertionPublicKeyPath;
        services.AddSingleton<IIdentityAssertionValidator>(_ =>
            new Es256IdentityAssertionValidator(
                IdentityAssertionKeyLoader.LoadPublicKey(publicKeyPath)));
        services.AddSingleton<DevelopmentAssertionReplayStore>();
        services.AddScoped<TrustedDleOsUserContextAccessor>();
    }

    internal static IApplicationBuilder UseTrustedDevelopmentIdentity(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "";
            if (!IsIdentityAwareOperationalPath(path))
            {
                await next();
                return;
            }

            if (!string.Equals(context.User.Identity?.Name, ServiceIdentity,
                    StringComparison.OrdinalIgnoreCase))
            {
                await Deny(context, StatusCodes.Status403Forbidden,
                    "DLE_OS_IDENTITY_CALLER_NOT_TRUSTED",
                    "The downstream service caller is not trusted.");
                return;
            }

            var assertion = context.Request.Headers[TrustedIdentityContract.HeaderName].ToString();
            var validation = context.RequestServices.GetRequiredService<IIdentityAssertionValidator>()
                .Validate(assertion, TrustedIdentityContract.OperationalAudience,
                    TrustedIdentityContract.DevelopmentEnvironment);
            if (!validation.IsValid || validation.User is null)
            {
                var status = validation.Code == "DLE_OS_IDENTITY_ASSERTION_EXPIRED"
                    ? StatusCodes.Status401Unauthorized : StatusCodes.Status403Forbidden;
                await Deny(context, status, validation.Code,
                    "The trusted DLE-OS identity assertion was not accepted.");
                return;
            }

            var correlationId = context.Request.Headers["X-DLE-OS-Correlation-ID"].ToString();
            if (string.IsNullOrWhiteSpace(correlationId) ||
                !string.Equals(correlationId, validation.User.CorrelationId, StringComparison.Ordinal))
            {
                await Deny(context, StatusCodes.Status403Forbidden,
                    "DLE_OS_IDENTITY_ASSERTION_INVALID",
                    "The trusted DLE-OS identity assertion was not accepted.");
                return;
            }
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
            {
                var now = DateTimeOffset.UtcNow;
                var replay = context.RequestServices.GetRequiredService<DevelopmentAssertionReplayStore>();
                if (!replay.TryConsume(validation.User.AssertionId, validation.User.ExpiresAt, now))
                {
                    await Deny(context, StatusCodes.Status409Conflict,
                        "DLE_OS_IDENTITY_ASSERTION_REPLAYED",
                        "The trusted DLE-OS identity assertion has already authorized a write.");
                    return;
                }
            }

            context.RequestServices.GetRequiredService<TrustedDleOsUserContextAccessor>().Current =
                validation.User;
            context.Response.Headers["X-DLE-OS-Assertion-ID"] = validation.User.AssertionId.ToString("D");
            await next();
        });

    internal static void MapDevelopmentIdentityAuditFixture(this WebApplication app, string policy)
    {
        app.MapPost("/api/development/identity/v1/audit-fixture",
            (HttpContext context, TrustedDleOsUserContextAccessor users) =>
            {
                var user = users.Current ?? throw new InvalidOperationException(
                    "Trusted downstream user context is unavailable.");
                var fixtureId = Guid.NewGuid();
                var timestamp = DateTimeOffset.UtcNow;
                var record = new
                {
                    fixtureId,
                    actorUserId = user.UserId,
                    actorUserName = user.UserName,
                    actorDisplayName = user.DisplayName,
                    actorIsSuperAdmin = user.IsSuperAdmin,
                    roles = user.Roles,
                    environment = user.Environment,
                    correlationId = user.CorrelationId,
                    assertionId = user.AssertionId,
                    timestamp,
                    executionIdentity = WindowsIdentity.GetCurrent().Name,
                    fixture = "DISPOSABLE_DEVELOPMENT_IDENTITY_AUDIT"
                };
                var root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "DLE-OS", "DevelopmentIdentity", "AuditFixtures");
                Directory.CreateDirectory(root);
                var path = Path.Combine(root, fixtureId.ToString("D") + ".json");
                using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write,
                           FileShare.Read, 4096, FileOptions.WriteThrough))
                    JsonSerializer.Serialize(stream, record, new JsonSerializerOptions { WriteIndented = true });
                return Results.Json(record, statusCode: StatusCodes.Status201Created);
            }).RequireAuthorization(policy);
    }

    internal static string RequireActorName(HttpContext context)
    {
        if (!ControlHostRuntimeConfiguration.IsIsolatedDevelopment)
            return context.User.Identity?.Name ?? throw new InvalidOperationException(
                "The authenticated service actor is unavailable.");
        return context.RequestServices.GetRequiredService<TrustedDleOsUserContextAccessor>()
                   .AuthorizedUser?.UserName ??
               throw new InvalidOperationException("Trusted downstream user context is unavailable.");
    }

    private static bool IsIdentityAwareOperationalPath(string path) =>
        path.StartsWith("/api/work-order-approvals/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api/kitting-dispositions/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api/rma-rework/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api/operational-work-order-relationships/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api/shipment-staging/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api/development/identity/", StringComparison.OrdinalIgnoreCase);

    private static async Task Deny(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new { code, message, requestId = context.TraceIdentifier });
    }
}
