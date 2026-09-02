using System.Collections.Concurrent;
using DleOs.Security;
using DleOs.TrustedIdentity;

internal sealed class TrustedRefreshUserContextAccessor
{
    internal TrustedDleOsUserContext? Current { get; set; }
    internal ResolvedSecurityUser? AuthorizedUser { get; set; }
}

internal sealed class RefreshAssertionReplayStore
{
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> assertions = new();
    internal bool TryConsume(Guid id, DateTimeOffset expires, DateTimeOffset now)
    {
        foreach (var entry in assertions.Where(entry => entry.Value <= now))
            assertions.TryRemove(entry.Key, out _);
        return assertions.TryAdd(id, expires);
    }
}

internal static class TrustedRefreshIdentity
{
    private const string TrustedCaller = @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";

    internal static void AddTrustedRefreshIdentity(this IServiceCollection services)
    {
        services.AddSingleton<IIdentityAssertionValidator>(_ =>
            new Es256IdentityAssertionValidator(IdentityAssertionKeyLoader.LoadPublicKey(
                ControlHostRuntimeConfiguration.IdentityAssertionPublicKeyPath)));
        services.AddSingleton<RefreshAssertionReplayStore>();
        services.AddScoped<TrustedRefreshUserContextAccessor>();
    }

    internal static IApplicationBuilder UseTrustedRefreshIdentity(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (!IsInvoiceHistoryPath(context.Request.Path))
            {
                await next();
                return;
            }
            if (!string.Equals(context.User.Identity?.Name, TrustedCaller, StringComparison.OrdinalIgnoreCase))
            {
                await Deny(context, StatusCodes.Status403Forbidden, "DLE_OS_IDENTITY_CALLER_NOT_TRUSTED");
                return;
            }
            var assertion = context.Request.Headers[TrustedIdentityContract.HeaderName].ToString();
            var validation = context.RequestServices.GetRequiredService<IIdentityAssertionValidator>()
                .Validate(assertion, TrustedIdentityContract.OperationalAudience,
                    TrustedIdentityContract.DevelopmentEnvironment);
            if (!validation.IsValid || validation.User is null)
            {
                await Deny(context,
                    validation.Code == "DLE_OS_IDENTITY_ASSERTION_EXPIRED" ? 401 : 403,
                    validation.Code);
                return;
            }
            var correlation = context.Request.Headers["X-DLE-OS-Correlation-ID"].ToString();
            if (string.IsNullOrWhiteSpace(correlation) ||
                !string.Equals(correlation, validation.User.CorrelationId, StringComparison.Ordinal))
            {
                await Deny(context, 403, "DLE_OS_IDENTITY_ASSERTION_INVALID");
                return;
            }
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
                !context.RequestServices.GetRequiredService<RefreshAssertionReplayStore>()
                    .TryConsume(validation.User.AssertionId, validation.User.ExpiresAt, DateTimeOffset.UtcNow))
            {
                await Deny(context, 409, "DLE_OS_IDENTITY_ASSERTION_REPLAYED");
                return;
            }
            context.RequestServices.GetRequiredService<TrustedRefreshUserContextAccessor>().Current = validation.User;
            context.Response.Headers["X-DLE-OS-Assertion-ID"] = validation.User.AssertionId.ToString("D");
            await next();
        });

    internal static bool IsInvoiceHistoryPath(PathString path) =>
        path.Equals("/api/platform/refresh/invoice-history/v1/status") ||
        path.Equals("/api/platform/refresh/invoice-history/v1/run");

    internal static string RequireActorName(HttpContext context) =>
        context.RequestServices.GetRequiredService<TrustedRefreshUserContextAccessor>()
            .AuthorizedUser?.UserName ??
        throw new InvalidOperationException("Trusted downstream user context is unavailable.");

    private static async Task Deny(HttpContext context, int status, string code)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new
        {
            code,
            message = "The trusted DLE-OS identity assertion was not accepted.",
            requestId = context.TraceIdentifier
        });
    }
}
