using System.Collections.Concurrent;

internal sealed record SimPersona(
    string Id,
    string UserName,
    string DisplayName,
    string AccountStatus,
    string[] Roles,
    string[] Permissions,
    bool IsSuperAdmin,
    string Purpose, string[]? AllowedWorkspaces = null)
{
    internal bool IsActive => string.Equals(AccountStatus, "ACTIVE", StringComparison.Ordinal);

    internal bool Can(string permission) =>
        IsActive && (IsSuperAdmin || Permissions.Contains(permission, StringComparer.Ordinal) ||
            permission == "rfq.view" && Permissions.Contains("technical_review.view", StringComparer.Ordinal) ||
            permission == "rfq.materials.edit" && Permissions.Contains("technical_review.disposition", StringComparer.Ordinal) ||
            permission == "rfq.readiness.view" && Permissions.Contains("technical_review.view", StringComparer.Ordinal) ||
            permission == "rfq.part_requests.create" && Permissions.Contains("technical_review.disposition", StringComparer.Ordinal));

    internal object CurrentUserContract()
    {
        var value = new Dictionary<string, object?> {
            ["isAuthenticated"] = true,
            ["user"] = new { userName = UserName, displayName = DisplayName, accountStatus = AccountStatus },
            ["roles"] = Roles, ["permissions"] = Permissions.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            ["isSuperAdmin"] = IsSuperAdmin && IsActive, ["synthetic"] = false,
            ["environment"] = "DEVELOPMENT", ["personaId"] = Id
        };
        if (AllowedWorkspaces is not null) value["allowedWorkspaces"] = AllowedWorkspaces;
        return value;
    }

    internal object CatalogContract() => new
    {
        id = Id,
        displayName = DisplayName,
        accountStatus = AccountStatus,
        roles = Roles,
        permissions = Permissions.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
        isSuperAdmin = IsSuperAdmin && IsActive,
        synthetic = false,
        purpose = Purpose
    };
}

// Runtime build: no fixture identities, selector, cookie or fallback can be activated.
internal static class SimPersonaCatalog {
 internal const string DefaultPersonaId="DISABLED";
 internal static readonly System.Collections.Generic.IReadOnlyList<SimPersona> All=System.Array.Empty<SimPersona>();
 internal static SimPersona Default=>throw new System.InvalidOperationException("Fixture identities are not compiled into this runtime");
 internal static SimPersona? Get(string? id)=>null;
}
internal sealed class SimPersonaSessionStore {
 internal SimPersona Resolve(HttpContext c)=>throw new System.InvalidOperationException("Fixture session disabled");
 internal void Select(HttpContext c,SimPersona p)=>throw new System.InvalidOperationException("Fixture session disabled");
 internal void ResetAll(HttpContext c)=>throw new System.InvalidOperationException("Fixture session disabled");
}
internal sealed record SelectSimPersonaRequest(string? PersonaId);internal static class SimAuthorization
{
    internal static string? ResolvePermission(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        var write = !HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method);
        if (path.StartsWith("/api/platform/live/v1/sales-orders", StringComparison.OrdinalIgnoreCase))
            return "kitting.view";
        if (path.StartsWith("/api/platform/live/v1/work-orders", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/platform/live/v1/sales-order-work-order-relationships", StringComparison.OrdinalIgnoreCase))
            return "work_orders.view";
        if (path.StartsWith("/api/platform/live/v1/invoice-history", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        if (path.StartsWith("/api/work-order-approvals/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/operational-work-order-relationships/", StringComparison.OrdinalIgnoreCase))
            return write ? "work_orders.approve" : "work_orders.view";
        if (path.StartsWith("/api/kitting-dispositions/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/kitting-cases/", StringComparison.OrdinalIgnoreCase))
            return write ? "kitting.disposition" : "kitting.view";
        if (path.StartsWith("/api/rma-rework/", StringComparison.OrdinalIgnoreCase))
            return write ? "rma_rework.manage" : "rma_rework.view";
        if (path.StartsWith("/api/operations-center/v1/verified-statuses/latest", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        if (path.StartsWith("/api/operations-center/", StringComparison.OrdinalIgnoreCase))
            return write ? "operations-center.verified-status.write" : "sync.operations";
        if (path.StartsWith("/api/shipment-staging/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/shipments/", StringComparison.OrdinalIgnoreCase))
            return write ? "shipments.stage" : "shipments.view";
        if (path.StartsWith("/api/platform/refresh/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/platform/refresh-center/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/platform/operations-refresh/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/platform/daily-operations-sync/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/sync/operations", StringComparison.OrdinalIgnoreCase))
            return "sync.operations";
        return null;
    }
}
