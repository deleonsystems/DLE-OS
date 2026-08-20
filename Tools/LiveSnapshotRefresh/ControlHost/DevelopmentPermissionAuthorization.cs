using DleOs.Security;
using Microsoft.Data.SqlClient;

internal sealed record DevelopmentPermissionRequirement(string Code, string Action);

internal static class DevelopmentPermissionCatalog
{
    internal static readonly string[] Phase51Permissions =
    [
        "work_orders.view", "work_orders.approve", "work_orders.replace",
        "work_orders.revoke", "work_orders.mark_no_work_order_required",
        "kitting.view", "kitting.disposition",
        "pick_list.view",
        "rma_rework.view", "rma_rework.manage",
        "shipments.view", "shipments.stage", "shipments.cancel",
        "shipments.confirm", "shipments.reconcile"
        , "sync.operations", "operations-center.verified-status.write"
    ];

    internal static DevelopmentPermissionRequirement? Resolve(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        var write = !HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method);
        if (path.StartsWith("/api/work-order-approvals/", StringComparison.OrdinalIgnoreCase))
        {
            if (!write) return new("work_orders.view", "work_order.view");
            if (path.EndsWith("/approve", StringComparison.OrdinalIgnoreCase))
                return new("work_orders.approve", "work_order.approve");
            if (path.EndsWith("/replace", StringComparison.OrdinalIgnoreCase))
                return new("work_orders.replace", "work_order.replace");
            if (path.EndsWith("/revoke", StringComparison.OrdinalIgnoreCase))
                return new("work_orders.revoke", "work_order.revoke");
            return new("work_orders.mark_no_work_order_required", "work_order.no_work_order_required");
        }
        if (path.StartsWith("/api/operational-work-order-relationships/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("work_orders.replace", "work_order.relationship_interpretation")
                : new("work_orders.view", "work_order.relationship_view");
        if (path.StartsWith("/api/kitting-dispositions/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("kitting.disposition", "kitting.disposition")
                : new("kitting.view", "kitting.view");
        if (path.StartsWith("/api/kitting-cases/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("kitting.disposition", "kitting.case.write")
                : new("kitting.view", "kitting.case.view");
        if (path.StartsWith("/api/pick-list/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("kitting.disposition", "pick_list.write")
                : new("pick_list.view", "pick_list.view");
        if (path.StartsWith("/api/rma-rework/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("rma_rework.manage", "rma_rework.manage")
                : new("rma_rework.view", "rma_rework.view");
        if (path.StartsWith("/api/operations-center/v1/verified-statuses/latest", StringComparison.OrdinalIgnoreCase))
            return new("sync.operations", "operations_center.verified_status.view");
        if (path.StartsWith("/api/operations-center/", StringComparison.OrdinalIgnoreCase))
            return write
                ? new("operations-center.verified-status.write", "operations_center.verified_status.write")
                : new("sync.operations", "operations_center.verified_status.view");
        if (path.StartsWith("/api/shipment-staging/", StringComparison.OrdinalIgnoreCase))
        {
            if (!write) return new("shipments.view", "shipment.view");
            if (path.Equals("/api/shipment-staging/v1/shipments", StringComparison.OrdinalIgnoreCase))
                return new("shipments.stage", "shipment.stage");
            if (path.EndsWith("/cancel", StringComparison.OrdinalIgnoreCase))
                return new("shipments.cancel", "shipment.cancel");
            if (path.Equals("/api/shipment-staging/v1/reconciliation/run", StringComparison.OrdinalIgnoreCase))
                return new("shipments.reconcile", "shipment.reconcile");
            return new("shipments.confirm", "shipment.confirm_evidence");
        }
        if (path.StartsWith("/api/development/identity/", StringComparison.OrdinalIgnoreCase))
            return new("system.manage", "development.identity_fixture");
        if (path.StartsWith("/api/sync/operations", StringComparison.OrdinalIgnoreCase))
            return new("sync.operations", write ? "sync.operations.start" : "sync.operations.view");
        return null;
    }
}

internal static class DevelopmentPermissionAuthorization
{
    internal static void AddDevelopmentPermissionAuthorization(this IServiceCollection services)
    {
        var connectionString = ControlHostRuntimeConfiguration.SecurityConnectionString;
        var boundary = new SqlConnectionStringBuilder(connectionString);
        if (!string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
            boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The development permission database boundary is invalid.");
        services.AddSingleton<IUserAuthorizationResolver>(
            new SqlUserAuthorizationResolver(connectionString));
        services.AddSingleton<AuthorizationEvaluator>();
        services.AddScoped<PermissionAuthorizationService>();
    }

    internal static IApplicationBuilder UseDevelopmentPermissionAuthorization(
        this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        var requirement = DevelopmentPermissionCatalog.Resolve(context.Request);
        if (requirement is null)
        {
            await next();
            return;
        }

        var trusted = context.RequestServices
            .GetRequiredService<TrustedDleOsUserContextAccessor>().Current;
        if (trusted is null)
        {
            await Deny(context, StatusCodes.Status403Forbidden,
                "DLE_OS_IDENTITY_ASSERTION_MISSING", requirement.Code,
                "A validated DLE-OS identity is required.");
            return;
        }

        PermissionAuthorizationDecision decision;
        try
        {
            decision = await context.RequestServices
                .GetRequiredService<PermissionAuthorizationService>()
                .AuthorizeAsync(trusted.UserId, requirement.Code, context.RequestAborted);
        }
        catch (SqlException error)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("DleOs.DevelopmentAuthorization")
                .LogError(error,
                    "AuthorizationLookupFailed ActorUserId={ActorUserId}; Action={Action}; " +
                    "RequiredPermission={RequiredPermission}; Environment={Environment}; " +
                    "CorrelationId={CorrelationId}", trusted.UserId, requirement.Action,
                    requirement.Code, trusted.Environment, trusted.CorrelationId);
            await Deny(context, StatusCodes.Status503ServiceUnavailable,
                "DLE_OS_SECURITY_UNAVAILABLE", requirement.Code,
                "DLE-OS authorization is temporarily unavailable.");
            return;
        }

        var outcome = decision.Allowed ? "ALLOW" : "DENY";
        context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("DleOs.DevelopmentAuthorization")
            .LogInformation(
                "AuthorizationDecision ActorUserId={ActorUserId}; ActorUserName={ActorUserName}; " +
                "Action={Action}; RequiredPermission={RequiredPermission}; " +
                "AuthorizationResult={AuthorizationResult}; Environment={Environment}; " +
                "CorrelationId={CorrelationId}; AssertionId={AssertionId}",
                trusted.UserId, decision.User?.UserName ?? trusted.UserName, requirement.Action,
                requirement.Code, outcome, trusted.Environment, trusted.CorrelationId,
                trusted.AssertionId);
        if (!decision.Allowed)
        {
            await Deny(context, StatusCodes.Status403Forbidden, decision.Code,
                requirement.Code, decision.Code == "DLE_OS_USER_DISABLED"
                    ? "The mapped DLE-OS account is not active."
                    : decision.Code == "DLE_OS_AUTHENTICATION_PENDING"
                    ? "The DLE-OS account is awaiting an external sign-in identity."
                    : "The DLE-OS user does not have the required application permission.");
            return;
        }

        context.RequestServices.GetRequiredService<TrustedDleOsUserContextAccessor>()
            .AuthorizedUser = decision.User;
        context.Response.Headers["X-DLE-OS-Required-Permission"] = requirement.Code;
        await next();
    });

    private static async Task Deny(
        HttpContext context, int status, string code, string requiredPermission, string message)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new
        {
            code,
            message,
            requiredPermission,
            requestId = context.TraceIdentifier
        });
    }
}
