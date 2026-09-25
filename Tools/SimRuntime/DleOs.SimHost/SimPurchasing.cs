using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed class SimPurchasingProblem(int statusCode, string code, string message) : Exception(message)
{
    internal int StatusCode { get; } = statusCode;
    internal string Code { get; } = code;
    internal static SimPurchasingProblem Invalid(string code, string message) => new(400, code, message);
    internal static SimPurchasingProblem Conflict(string code, string message) => new(409, code, message);
    internal static SimPurchasingProblem Missing(string message) => new(404, "purchasing_not_found", message);
}

internal sealed record SimPurchasingVersionRequest(long ExpectedVersion, Guid RequestId);
internal sealed record SimDemandCoverageRequest(string DemandId, decimal Quantity, long ExpectedDemandVersion);
internal sealed record SimBuyingPlanRequest(long ExpectedVersion, Guid RequestId, string Supplier,
    string VendorPartNumber, decimal BuyQuantity, string PurchasingUom, decimal UnitCost, string Currency,
    string? RequestedDate, string? ExpectedDate, string? MaterialNeedBy, string? Notes, string? ExcessPurpose,
    SimDemandCoverageRequest[] Coverage);
internal sealed record SimPurchaseRequest(long ExpectedVersion, Guid RequestId, string PoNumber, string PoLine,
    string OrderDate, string? Confirmation, string? Notes);

internal sealed record SimPurchasingQuality(bool PoTraceabilityRequired, bool OriginalPoTraceabilityRequired,
    Guid? TraceabilityAmendmentId, bool? CocRequired, bool? MaterialCertRequired, bool? InspectionRequired,
    bool? TravelerRequired, string SpecialReceivingNotes, string EvidenceSource, JsonElement ContractRequirements);
internal sealed record SimPurchasingDemand(string DemandId, long Version, string State, bool SourceCurrent,
    string SourceFingerprint, Guid CaseId, Guid SubmissionId, int SubmissionVersion, string ReleasedBomIdentity,
    string SourceRowId, string FindNumber, string PartNumber, string ApprovedPartNumber, string Description,
    decimal RequiredQuantity, decimal KittedQuantity, decimal ShortQuantity, string Uom, string WorkOrderNumber,
    string SalesOrderNumber, string SalesOrderLineNumber, string Customer, string CustomerNumber,
    string AssemblyItemNumber, string Revision, decimal BuildQuantity, string CustomerDueDate,
    string MaterialNeedBy, SimPurchasingQuality QualityRequirements, string CompatibilityKey,
    string? AcceptedBy, string? AcceptedActorId, DateTimeOffset? AcceptedAtUtc);
internal sealed record SimDemandCoverage(string DemandId, decimal Quantity, long DemandVersion,
    string SourceFingerprint, string WorkOrderNumber, string SalesOrderNumber, string SalesOrderLineNumber,
    string Customer, string AssemblyItemNumber, string Revision, string CustomerDueDate);
internal sealed record SimBuyingPlan(Guid PlanId, long Version, string State, string PartNumber,
    string ApprovedPartNumber, string Description, string Supplier, string VendorPartNumber,
    decimal BuyQuantity, string PurchasingUom, string PriceBasis, decimal UnitCost, string Currency,
    decimal ExtendedCost, string RequestedDate, string ExpectedDate, string MaterialNeedBy,
    string Notes, decimal ExcessQuantity, string ExcessPurpose, SimDemandCoverage[] Coverage,
    SimPurchasingQuality QualityRequirements, string CreatedBy, DateTimeOffset CreatedAtUtc,
    string UpdatedBy, DateTimeOffset UpdatedAtUtc, string? ReadyBy, DateTimeOffset? ReadyAtUtc,
    Guid? PurchaseId);
internal sealed record SimPurchaseLine(Guid PurchaseId, Guid ExpectedReceiptId, Guid PlanId, long PlanVersion,
    string PoNumber, string PoLine, string Supplier, string PartNumber, string ApprovedPartNumber,
    string VendorPartNumber, string Description, string PurchasingUom, string PriceBasis,
    decimal OrderedQuantity, decimal ReceivedQuantity, decimal OpenQuantity, decimal UnitCost,
    string Currency, decimal ExtendedCost, string OrderDate, string RequestedDate, string ExpectedDate,
    string MaterialNeedBy, string Confirmation, string Notes, decimal ExcessQuantity, string ExcessPurpose,
    SimDemandCoverage[] Coverage, SimPurchasingQuality QualityRequirements, string Provenance,
    string Status, string ReceiptState, string Buyer, string ActorId, DateTimeOffset CreatedAtUtc);
internal sealed record SimPurchasingView(string Environment, long Generation, bool CanManage,
    SimPurchasingDemand[] Demands, SimBuyingPlan[] Plans, SimPurchaseLine[] Purchases);
internal sealed record SimExpectedReceivingView(string Environment, long Generation, bool CanReceive,
    SimPurchaseLine[] Items);
internal sealed record SimPurchasingAudit(Guid EventId, string EventType, string EntityId,
    string ActorId, string Actor, DateTimeOffset AtUtc, long ExpectedVersion, long ResultingVersion,
    string PriorState, string NewState, JsonElement Detail);

// Purchasing owns decisions and planned supply only. Neither this service nor its store writes
// Kitting, canonical orders, actual VPRO orders, inventory allocations or physical receipts.
internal sealed class SimPurchasingService(SimStateStore state, SimOperationsDataStore operations)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal Func<DateTimeOffset> UtcNow { get; set; } = () => DateTimeOffset.UtcNow;
    private static void Permission(SimPersona actor, bool write)
    {
        if (!actor.Can(write ? "purchasing.manage" : "purchasing.view")) throw new SimOrderEntryPermissionException();
    }
    internal Task<SimPurchasingView> Read(SimPersona actor) => state.WithStableRuntime(async runtime =>
    {
        Permission(actor, false);
        return await operations.ReadPurchasing(runtime, actor.Can("purchasing.manage"));
    });
    internal Task<SimExpectedReceivingView> Expected(SimPersona actor) => state.WithStableRuntime(async runtime =>
    {
        if (!actor.Can("receiving.view") && !actor.Can("purchasing.view")) throw new SimOrderEntryPermissionException();
        var view = await operations.ReadPurchasing(runtime, false);
        return new SimExpectedReceivingView("SIM", runtime.Generation, actor.Can("receiving.manage"),
            view.Purchases.OrderBy(p => string.IsNullOrEmpty(p.ExpectedDate) ? "9999-12-31" : p.ExpectedDate,
                StringComparer.Ordinal).ThenBy(p => p.PoNumber).ThenBy(p => p.PoLine).ToArray());
    });
    internal Task<object> KittedBom(string demandId, SimPersona actor) => state.WithStableRuntime(async runtime =>
    {
        Permission(actor, false);
        return await operations.ReadPurchasingKittedBom(demandId, runtime);
    });
    internal Task<SimPurchasingAudit[]> History(SimPersona actor) => state.WithStableRuntime(async runtime =>
    {
        Permission(actor, false);
        return await operations.ReadPurchasingHistory(runtime);
    });
    internal Task<SimPurchasingDemand> Accept(string demandId, SimPurchasingVersionRequest request, SimPersona actor) =>
        Command("ACCEPT:" + demandId, request.RequestId, request, actor, (view, now) =>
        {
            var demand = Demand(view, demandId);
            Version(demand.Version, request.ExpectedVersion);
            Current(demand);
            if (demand.State != "INCOMING") throw SimPurchasingProblem.Conflict("demand_already_accepted", "This demand already belongs to Purchasing. Refresh its current buyer state.");
            var next = demand with { Version = demand.Version + 1, State = "ACCEPTED", AcceptedBy = actor.DisplayName,
                AcceptedActorId = actor.Id, AcceptedAtUtc = now };
            return new SimPurchasingChange(next, null, null,
                Audit("SHORTAGE_ACCEPTED", demandId, actor, now, demand.Version, next.Version, demand.State, next.State, next));
        }, change => change.Demand!);

    internal Task<SimBuyingPlan> SavePlan(Guid? planId, SimBuyingPlanRequest request, SimPersona actor) =>
        Command("SAVE_PLAN:" + planId?.ToString(), request.RequestId, request, actor, (view, now) =>
        {
            var prior = planId is null ? null : Plan(view, planId.Value);
            Version(prior?.Version ?? 0, request.ExpectedVersion);
            if (prior?.State == "ORDERED") throw SimPurchasingProblem.Conflict("purchase_already_recorded", "An ordered plan cannot be edited. Its retained purchase is immutable.");
            if (request.Coverage is null || request.Coverage.Length is < 1 or > 100 ||
                request.Coverage.Any(x => x is null || string.IsNullOrWhiteSpace(x.DemandId)) ||
                request.Coverage.Select(x => x.DemandId).Distinct(StringComparer.Ordinal).Count() != request.Coverage.Length)
                throw SimPurchasingProblem.Invalid("coverage_required", "Provide distinct accepted demand coverage lines.");
            var sources = request.Coverage.Select(c => Demand(view, c.DemandId)).ToArray();
            for (var i = 0; i < sources.Length; i++)
            {
                Current(sources[i]); Version(sources[i].Version, request.Coverage[i].ExpectedDemandVersion);
                if (sources[i].State != "ACCEPTED") throw SimPurchasingProblem.Conflict("accept_demand_first", "Accept each demand before preparing a buying plan.");
            }
            // Until a reviewed cross-job compatibility mechanism exists, group only exact governed
            // identities under the same released BOM and requirements policy, never matching text alone.
            if (sources.Select(d => d.CompatibilityKey).Distinct(StringComparer.Ordinal).Count() != 1)
                throw SimPurchasingProblem.Invalid("incompatible_demand", "These demands do not share the same governed identity, UOM and reviewed requirement policy.");
            var first = sources[0];
            var uom = Clean(request.PurchasingUom, 20).ToUpperInvariant();
            if (uom != first.Uom) throw SimPurchasingProblem.Invalid("purchasing_uom", "Use the released demand UOM. Pack conversions require a separate reviewed conversion and are not supported in this slice.");
            Quantity(request.BuyQuantity, "Buy quantity"); Cost(request.UnitCost);
            var coverage = sources.Select((d, i) => new SimDemandCoverage(d.DemandId, request.Coverage[i].Quantity,
                d.Version, d.SourceFingerprint, d.WorkOrderNumber, d.SalesOrderNumber, d.SalesOrderLineNumber,
                d.Customer, d.AssemblyItemNumber, d.Revision, d.CustomerDueDate)).ToArray();
            CheckCoverage(view, prior?.PlanId, coverage);
            var excess = request.BuyQuantity - coverage.Sum(c => c.Quantity);
            var purpose = Clean(request.ExcessPurpose, 2000);
            if (excess < 0 || excess > 0 && purpose.Length == 0)
                throw SimPurchasingProblem.Invalid("excess_purpose", "Buy quantity must cover the planned demand; any excess needs an explicit purpose.");
            var currency = Clean(request.Currency, 3).ToUpperInvariant();
            if (!Regex.IsMatch(currency, "^[A-Z]{3}$")) throw SimPurchasingProblem.Invalid("currency", "Enter a three-letter currency.");
            var next = new SimBuyingPlan(prior?.PlanId ?? Guid.NewGuid(), (prior?.Version ?? 0) + 1, "DRAFT",
                first.PartNumber, first.ApprovedPartNumber, first.Description, Clean(request.Supplier, 200),
                Clean(request.VendorPartNumber, 200), request.BuyQuantity, uom, "PER_PURCHASING_UOM",
                request.UnitCost, currency, Extended(request.BuyQuantity, request.UnitCost),
                Date(request.RequestedDate), Date(request.ExpectedDate), Date(request.MaterialNeedBy),
                Clean(request.Notes, 4000), excess, purpose, coverage, first.QualityRequirements,
                prior?.CreatedBy ?? actor.DisplayName, prior?.CreatedAtUtc ?? now, actor.DisplayName, now, null, null, null);
            return new SimPurchasingChange(null, next, null, Audit(prior is null ? "BUYING_PLAN_CREATED" : "BUYING_PLAN_UPDATED",
                next.PlanId.ToString(), actor, now, prior?.Version ?? 0, next.Version, prior?.State ?? "NONE", next.State, next));
        }, change => change.Plan!);

    internal Task<SimBuyingPlan> Ready(Guid planId, SimPurchasingVersionRequest request, SimPersona actor) =>
        Command("READY:" + planId, request.RequestId, request, actor, (view, now) =>
        {
            var plan = Plan(view, planId); Version(plan.Version, request.ExpectedVersion);
            if (plan.State != "DRAFT") throw SimPurchasingProblem.Conflict("plan_not_draft", "Only a draft buying plan can move to Shop List.");
            ValidateReady(view, plan);
            var next = plan with { Version = plan.Version + 1, State = "READY_FOR_PO", ReadyBy = actor.DisplayName,
                ReadyAtUtc = now, UpdatedBy = actor.DisplayName, UpdatedAtUtc = now };
            return new SimPurchasingChange(null, next, null, Audit("READY_FOR_PO", planId.ToString(), actor, now,
                plan.Version, next.Version, plan.State, next.State, next));
        }, change => change.Plan!);

    internal Task<SimPurchaseLine> Purchase(Guid planId, SimPurchaseRequest request, SimPersona actor) =>
        Command("PURCHASE:" + planId, request.RequestId, request, actor, (view, now) =>
        {
            var plan = Plan(view, planId); Version(plan.Version, request.ExpectedVersion);
            if (plan.State != "READY_FOR_PO") throw SimPurchasingProblem.Conflict("plan_not_ready", "Move this buying plan to Shop List before recording a purchase.");
            ValidateReady(view, plan);
            var po = Clean(request.PoNumber, 20); var line = Clean(request.PoLine, 3);
            // Retain the existing seven-digit shape or an unmistakable SIM-PO reference. Both live
            // only in this developmental store, never the imported/verified VPRO namespace.
            if (!Regex.IsMatch(po, "^(?:[0-9]{7}|SIM-PO-[0-9]{4,7})$") || !Regex.IsMatch(line, "^[0-9]{3}$"))
                throw SimPurchasingProblem.Invalid("po_identifier", "Use a SIM-PO numeric reference or seven-digit synthetic PO, with a three-digit line.");
            if (view.Purchases.Any(p => p.Supplier == plan.Supplier && p.PoNumber == po && p.PoLine == line))
                throw SimPurchasingProblem.Conflict("duplicate_po_line", "That supplier/PO/line already has a retained developmental purchase.");
            var purchase = new SimPurchaseLine(Guid.NewGuid(), Guid.NewGuid(), plan.PlanId, plan.Version,
                po, line, plan.Supplier, plan.PartNumber, plan.ApprovedPartNumber, plan.VendorPartNumber,
                plan.Description, plan.PurchasingUom, plan.PriceBasis, plan.BuyQuantity, 0, plan.BuyQuantity,
                plan.UnitCost, plan.Currency, plan.ExtendedCost, Date(request.OrderDate, true), plan.RequestedDate,
                plan.ExpectedDate, plan.MaterialNeedBy, Clean(request.Confirmation, 200), Clean(request.Notes, 4000),
                plan.ExcessQuantity, plan.ExcessPurpose, plan.Coverage, plan.QualityRequirements,
                "SIMULATED_DEVELOPMENTAL", "EXPECTED", "AWAITING_RECEIPT", actor.DisplayName, actor.Id, now);
            var next = plan with { Version = plan.Version + 1, State = "ORDERED", PurchaseId = purchase.PurchaseId,
                UpdatedBy = actor.DisplayName, UpdatedAtUtc = now };
            return new SimPurchasingChange(null, next, purchase, Audit("PURCHASE_RECORDED", purchase.PurchaseId.ToString(), actor,
                now, plan.Version, next.Version, plan.State, next.State, purchase));
        }, change => change.Purchase!);

    private Task<T> Command<T>(string action, Guid requestId, object request, SimPersona actor,
        Func<SimPurchasingView, DateTimeOffset, SimPurchasingChange> mutate, Func<SimPurchasingChange, T> select) =>
        state.WithStableRuntime(async runtime =>
        {
            Permission(actor, true);
            if (requestId == Guid.Empty) throw SimPurchasingProblem.Invalid("request_id", "A UUID request ID is required for safe retries.");
            return await operations.ChangePurchasing(runtime, action, requestId, request, actor, UtcNow(), mutate, select);
        });
    private static void ValidateReady(SimPurchasingView view, SimBuyingPlan plan)
    {
        if (!(plan.Supplier.StartsWith("SIM-", StringComparison.Ordinal) || plan.Supplier.StartsWith("DLE-SIM-", StringComparison.Ordinal)) || plan.Supplier.Length <= 4)
            throw SimPurchasingProblem.Invalid("synthetic_supplier", "Select an explicitly synthetic supplier beginning SIM- or DLE-SIM-. No real supplier order is supported.");
        if (plan.VendorPartNumber.Length == 0) throw SimPurchasingProblem.Invalid("vendor_part", "Enter the supplier's ordered part reference.");
        if (plan.ExpectedDate.Length == 0) throw SimPurchasingProblem.Invalid("expected_date", "Enter an explicit expected date for this developmental order.");
        foreach (var c in plan.Coverage)
        {
            var demand = Demand(view, c.DemandId); Current(demand); Version(demand.Version, c.DemandVersion);
            if (demand.SourceFingerprint != c.SourceFingerprint) throw SimPurchasingProblem.Conflict("source_changed", "Source evidence changed. Review a new buying plan decision.");
        }
        CheckCoverage(view, plan.PlanId, plan.Coverage);
    }
    private static void CheckCoverage(SimPurchasingView view, Guid? planId, SimDemandCoverage[] coverage)
    {
        foreach (var c in coverage)
        {
            Quantity(c.Quantity, "Coverage quantity");
            var demand = Demand(view, c.DemandId);
            var reserved = view.Plans.Where(p => p.PlanId != planId).SelectMany(p => p.Coverage)
                .Where(x => x.DemandId == c.DemandId).Sum(x => x.Quantity);
            if (reserved + c.Quantity > demand.ShortQuantity)
                throw SimPurchasingProblem.Conflict("demand_overcovered", "Coverage exceeds this source shortage or overlaps another saved buying plan.");
        }
    }
    internal static SimPurchasingDemand Demand(SimPurchasingView view, string id) => view.Demands.FirstOrDefault(d => d.DemandId == id)
        ?? throw SimPurchasingProblem.Missing("The source shortage demand was not found.");
    private static SimBuyingPlan Plan(SimPurchasingView view, Guid id) => view.Plans.FirstOrDefault(p => p.PlanId == id)
        ?? throw SimPurchasingProblem.Missing("The buying plan was not found.");
    private static void Current(SimPurchasingDemand demand)
    {
        if (!demand.SourceCurrent) throw SimPurchasingProblem.Conflict("source_changed", "The submitted Kitting or order evidence has changed. Retained purchasing history requires reviewed reconciliation before more buying.");
    }
    private static void Version(long actual, long expected)
    {
        if (actual != expected) throw SimPurchasingProblem.Conflict("purchasing_version_changed", "Another buyer changed this record. Refresh before continuing.");
    }
    private static void Quantity(decimal value, string label)
    {
        if (value <= 0 || value > 1000000000m || decimal.Round(value, 6) != value)
            throw SimPurchasingProblem.Invalid("quantity", label + " must be positive with at most six decimal places.");
    }
    private static void Cost(decimal value)
    {
        if (value < 0 || value > 1000000000m || decimal.Round(value, 6) != value)
            throw SimPurchasingProblem.Invalid("unit_cost", "Unit cost must be nonnegative with at most six decimal places.");
    }
    private static decimal Extended(decimal quantity, decimal cost) => decimal.Round(quantity * cost, 2, MidpointRounding.AwayFromZero);
    private static string Clean(string? value, int limit)
    {
        var text = (value ?? "").Trim();
        if (text.Length > limit) throw SimPurchasingProblem.Invalid("text_length", $"Text exceeds {limit} characters.");
        return text;
    }
    private static string Date(string? value, bool required = false)
    {
        var text = Clean(value, 10);
        if (text.Length == 0 && !required) return "";
        if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            throw SimPurchasingProblem.Invalid("date_only", "Dates must be valid date-only YYYY-MM-DD values.");
        return text;
    }
    internal static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));
    internal static string StableId(string value) => "SIM-DEMAND-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static SimPurchasingAudit Audit(string type, string id, SimPersona actor, DateTimeOffset now,
        long expected, long resulting, string prior, string next, object detail) =>
        new(Guid.NewGuid(), type, id, actor.Id, actor.DisplayName, now, expected, resulting, prior, next,
            JsonSerializer.SerializeToElement(detail, Json));
}

internal sealed record SimPurchasingChange(SimPurchasingDemand? Demand, SimBuyingPlan? Plan,
    SimPurchaseLine? Purchase, SimPurchasingAudit Audit);
