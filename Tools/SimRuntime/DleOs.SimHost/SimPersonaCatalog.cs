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
            ["isSuperAdmin"] = IsSuperAdmin && IsActive, ["synthetic"] = true,
            ["environment"] = "SIM", ["personaId"] = Id
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
        synthetic = true,
        purpose = Purpose
    };
}

internal static class SimPersonaCatalog
{
    internal const string DefaultPersonaId = "administrator";

    internal static readonly IReadOnlyList<SimPersona> All = new[]
    {
        new SimPersona("purchasing-buyer", "sim.purchasing", "SIM Purchasing Buyer", "ACTIVE",
            ["SIM_PURCHASING_BUYER"], ["purchasing.view", "purchasing.manage", "receiving.view", "kitting.view"], false,
            "Synthetic buying decisions and expected supply only; no real supplier orders or physical receiving."),
        new SimPersona("receiving-viewer", "sim.receiving", "SIM Receiving Viewer", "ACTIVE",
            ["SIM_RECEIVING_VIEWER"], ["receiving.view"], false,
            "Read-only expected incoming developmental PO lines; no receipt commands."),
        new SimPersona("receiving-operator", "sim.receiver", "SIM Receiving Operator", "ACTIVE",
            ["SIM_RECEIVING_OPERATOR"], ["receiving.view", "receiving.manage"], false,
            "Operational synthetic arrival, inspection, acceptance and staging; no VPRO accounting receipt or Kitting authority."),
        new SimPersona("order-entry-operator", "sim.orderentry", "SIM Order Entry", "ACTIVE",
            ["SIM_ORDER_ENTRY"], ["order_entry.view", "order_entry.manage"], false,
            "Manual synthetic VPRO bridge work; no commercial acceptance or Operations release authority."),
        new SimPersona("order-reviewer", "sim.orderreview", "SIM Order Reviewer", "ACTIVE",
            ["SIM_ORDER_REVIEWER"], ["order_entry.view", "order_entry.accept", "rfq.intake.create"], false,
            "Explicit New Order acceptance; no ERP or Operations writes."),
        new SimPersona(DefaultPersonaId, "sim.admin", "SIM Administrator", "ACTIVE",
            ["SUPER_ADMIN"], [], true,
            "Safe default with full authority inside the isolated SIM runtime."),
        new SimPersona("miguel-jr", "sim.miguel-jr", "Miguel Jr.", "ACTIVE",
            ["SUPER_ADMIN"], [], true,
            "Miguel Jr. synthetic SIM profile; same simulated rights and workspace as SIM Administrator."),
        new SimPersona("michelle", "sim.michelle", "Michelle", "ACTIVE",
            ["SIM_MATERIALS_LIBRARY_CLERK"], ["rfq.view", "rfq.materials.edit", "assembly_library.view", "assembly_library.edit"], false,
            "Materials entry/completion, Labor read-only and Library preparation/submission; no technical or commercial approval.",
            ["dle-home", "rfqs", "assembly-library"]),
        new SimPersona("ray", "sim.ray", "Ray", "ACTIVE",
            ["SIM_MATERIALS_ESTIMATOR"], ["rfq.intake.create", "rfq.view", "rfq.materials.edit", "rfq.readiness.view", "rfq.part_requests.create", "rfq.quote.prepare", "assembly_library.view"], false,
            "Intake, Materials completion and part-request preparation, Labor/Library read-only, Readiness view; no technical, estimate-allowance or customer quote approval.",
            ["dle-home", "rfq-quoting", "rfqs", "assembly-library"]),
        new SimPersona("adan", "sim.adan", "Adan", "ACTIVE",
            ["SIM_LIBRARY_CLERK"], ["assembly_library.view", "assembly_library.edit"], false,
            "Library-only preparation, editing and request submission for separate final review; no RFQ, Intake, technical approval or server copying.",
            ["dle-home", "assembly-library"]),
        new SimPersona("production-team", "sim.production", "Production Team", "ACTIVE",
            ["SIM_PRODUCTION_TEAM"], ["production.view", "production.team_input", "kitting.view", "work_orders.view", "order_entry.view"], false,
            "Production operational notes and images only; no Traveler management or approval authority."),
        new SimPersona("quality-reviewer", "sim.quality", "Quality Reviewer", "ACTIVE",
            ["SIM_QUALITY_REVIEWER"], ["quality.review", "production.view", "kitting.view", "work_orders.view", "order_entry.view"], false,
            "SIM Quality instruction authoring, addition review and explicit packet release; no Production management authority."),
        new SimPersona("operations-manager", "sim.operations", "Operations Manager", "ACTIVE",
            ["SIM_OPERATIONS_MANAGER"],
            ["work_orders.view", "kitting.view", "production.view", "production.manage", "rma_rework.view", "shipments.view",
             "shipments.release", "sync.operations", "operations-center.verified-status.write", "rfq.intake.create",
             "technical_review.view", "technical_review.disposition"], false,
            "Operational visibility, Operations Center access, and verified-status authority."),
        new SimPersona("kitting-operator", "sim.kitting", "Kitting Operator", "ACTIVE",
            ["SIM_KITTING_OPERATOR"], ["kitting.view", "kitting.disposition"], false,
            "Kitting-focused view and disposition capability."),
        new SimPersona("shipping-operator", "sim.shipping", "Shipping Operator", "ACTIVE",
            ["SIM_SHIPPING_OPERATOR"], ["shipments.view", "shipments.stage"], false,
            "Shipment visibility and staging capability without confirmation or reconciliation authority."),
        new SimPersona("read-only-viewer", "sim.viewer", "Read-Only Viewer", "ACTIVE",
            ["SIM_READ_ONLY"],
            ["work_orders.view", "kitting.view", "production.view", "rma_rework.view", "shipments.view", "purchasing.view", "receiving.view"], false,
            "Repository-qualified cross-workspace read permissions with no write grants."),
        new SimPersona("no-access", "sim.noaccess", "No-Access User", "ACTIVE",
            ["SIM_NO_ACCESS"], [], false,
            "Authenticated identity with no application permissions."),
        new SimPersona("disabled", "sim.disabled", "Disabled User", "DISABLED",
            ["SIM_SHIPPING_OPERATOR"], ["shipments.view", "shipments.stage"], false,
            "Disabled identity proving that account status overrides otherwise assigned grants.")
    };

    internal static SimPersona Default => Get(DefaultPersonaId)!;

    internal static SimPersona? Get(string? id) => All.FirstOrDefault(persona =>
        string.Equals(persona.Id, id, StringComparison.Ordinal));
}

internal sealed class SimPersonaSessionStore
{
    private const string CookieName = "dle-os-sim-session";
    private readonly ConcurrentDictionary<string, string> selections = new(StringComparer.Ordinal);

    internal SimPersona Resolve(HttpContext context)
    {
        if (context.Request.Cookies.TryGetValue(CookieName, out var sessionId) &&
            selections.TryGetValue(sessionId, out var personaId))
        {
            return SimPersonaCatalog.Get(personaId) ?? SimPersonaCatalog.Default;
        }
        return SimPersonaCatalog.Default;
    }

    internal void Select(HttpContext context, SimPersona persona)
    {
        var sessionId = context.Request.Cookies.TryGetValue(CookieName, out var existing) &&
            selections.ContainsKey(existing)
                ? existing
                : Guid.NewGuid().ToString("N");
        selections[sessionId] = persona.Id;
        context.Response.Cookies.Append(CookieName, sessionId, new CookieOptions
        {
            HttpOnly = true,
            IsEssential = true,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            MaxAge = TimeSpan.FromHours(12)
        });
    }

    internal void ResetAll(HttpContext context)
    {
        selections.Clear();
        context.Response.Cookies.Delete(CookieName, new CookieOptions
        {
            HttpOnly = true,
            IsEssential = true,
            SameSite = SameSiteMode.Strict,
            Path = "/"
        });
    }
}

internal sealed record SelectSimPersonaRequest(string? PersonaId);

internal static class SimAuthorization
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
