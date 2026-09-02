using DleOs.Security;
using Microsoft.Data.SqlClient;

internal static class RefreshPermissionAuthorization
{
    private const string RequiredPermission = "sync.operations";

    internal static void AddRefreshPermissionAuthorization(this IServiceCollection services)
    {
        var connection = ControlHostRuntimeConfiguration.SecurityConnectionString;
        var boundary = new SqlConnectionStringBuilder(connection);
        if (!string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
            boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(boundary.ApplicationIntent.ToString(), "ReadOnly", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The refresh permission database boundary is invalid.");
        services.AddSingleton<IUserAuthorizationResolver>(new SqlUserAuthorizationResolver(connection));
        services.AddSingleton<AuthorizationEvaluator>();
        services.AddScoped<PermissionAuthorizationService>();
    }

    internal static IApplicationBuilder UseRefreshPermissionAuthorization(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (!TrustedRefreshIdentity.IsInvoiceHistoryPath(context.Request.Path))
            {
                await next();
                return;
            }
            var trusted = context.RequestServices.GetRequiredService<TrustedRefreshUserContextAccessor>().Current;
            if (trusted is null)
            {
                await Deny(context, 403, "DLE_OS_IDENTITY_ASSERTION_MISSING",
                    "A validated DLE-OS identity is required.");
                return;
            }
            PermissionAuthorizationDecision decision;
            try
            {
                decision = await context.RequestServices.GetRequiredService<PermissionAuthorizationService>()
                    .AuthorizeAsync(trusted.UserId, RequiredPermission, context.RequestAborted);
            }
            catch (SqlException error)
            {
                context.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("DleOs.GovernedRefreshAuthorization")
                    .LogError(error, "AuthorizationLookupFailed ActorUserId={ActorUserId} RequiredPermission={Permission}",
                        trusted.UserId, RequiredPermission);
                await Deny(context, 503, "DLE_OS_SECURITY_UNAVAILABLE",
                    "DLE-OS authorization is temporarily unavailable.");
                return;
            }
            if (!decision.Allowed)
            {
                await Deny(context, 403, decision.Code,
                    decision.Code == "DLE_OS_USER_DISABLED"
                        ? "The mapped DLE-OS account is not active."
                        : decision.Code == "DLE_OS_AUTHENTICATION_PENDING"
                            ? "The DLE-OS account is awaiting an external sign-in identity."
                            : "The DLE-OS user does not have the required application permission.");
                return;
            }
            context.RequestServices.GetRequiredService<TrustedRefreshUserContextAccessor>().AuthorizedUser = decision.User;
            context.Response.Headers["X-DLE-OS-Required-Permission"] = RequiredPermission;
            await next();
        });

    private static async Task Deny(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new
        {
            code, message, requiredPermission = RequiredPermission, requestId = context.TraceIdentifier
        });
    }
}
