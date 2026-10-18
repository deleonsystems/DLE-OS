using System.Globalization;
using System.Text.Json;

// Read model only: no planning result is written back into an accepted package,
// Kitting case, buying plan, purchase or expected receipt.
internal sealed record SimMaterialSchedule(string CustomerDueDate, SimManufacturingLead Lead,
    string MaterialNeedBy, int WorkingDays, object Provenance);
internal sealed record SimSupplyRisk(int? BufferWorkingDays, bool? ProductionAtRisk, bool? SupplierLate, string Status);
internal sealed record SimSupplyOrder(Guid PurchaseId, string PoNumber, string PoLine, decimal Ordered,
    decimal? Received, decimal? Open, string ExpectedDate, SimSupplyRisk Risk, bool ReceiptEvidenceVerified = false,
    decimal AppliedQuantity = 0);
internal sealed record SimSupplyAcceptedMaterial(string ReceiptLineId, string PoNumber, string PoLine,
    string PackingSlipNumber, decimal AvailableQuantity, string Uom, string StagingLocation,
    DateTimeOffset ReceivedAtUtc, DateTimeOffset? AcceptedAtUtc);
internal sealed record SimSupplyDemand(string DemandId, string WorkOrderNumber, string SourceRowId,
    string PartNumber, decimal Short, string Progress, SimMaterialSchedule? Schedule,
    SimSupplyOrder[] Orders, string? UnavailableReason, SimSupplyAcceptedMaterial[]? AcceptedMaterials = null,
    SimKittingReturnOrigin? ReturnOrigin = null, decimal AppliedQuantity = 0,
    bool Resolved = false, string? MaterialStatus = null, decimal? RemainingShortQuantity = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimCustomerSupplyLine? CustomerSupply = null)
{
    internal decimal Available => AcceptedMaterials?.Sum(m => m.AvailableQuantity) ?? 0;
}
internal sealed record SimKittingReturnOrigin(Guid CaseId, long WorkingVersion, Guid SubmissionId,
    string ReleasedBomIdentity, string SourceRowId, string RequirementId, string FindNumber,
    string ReleasedSequence, decimal RequiredQuantity, decimal PreviouslyKitted);
internal sealed record SimSupplyWorkOrder(string WorkOrderNumber, string CompactText, SimSupplyDemand[] Demands,
    string? LastPartDue, bool LastPartDueEstablished, string? MaterialNeedBy, int? BufferWorkingDays,
    bool? ProductionAtRisk, int ShortageCount, int OrderedCount, int UncoveredCount, int LateCount,
    string? MaterialStatus = null);
internal sealed record SimMaterialPlanningView(string Rule, string AsOfDate, SimSupplyWorkOrder[] WorkOrders);

internal sealed class SimMaterialPlanning(SimStateStore state, SimOperationsDataStore operations,
    SimRfqIntakeStore intakes, SimKittingRequirementsProvider requirements)
{
    internal const string Rule = "ACCEPTED_DUE_MINUS_FROZEN_MANUFACTURING_MON_FRI_V1";
    internal Func<DateTimeOffset> UtcNow { get; set; } = () => DateTimeOffset.UtcNow;
    internal static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    internal static bool TryDate(string? value, out DateOnly date) => DateOnly.TryParseExact(value,
        "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    internal static bool Working(DateOnly date) => date.DayOfWeek is not DayOfWeek.Saturday and not DayOfWeek.Sunday;
    internal static DateOnly Subtract(DateOnly date, int days)
    {
        if (days < 0 || days > 10000) throw new InvalidOperationException("Unsupported manufacturing lead.");
        while (days > 0) { date = date.AddDays(-1); if (Working(date)) days--; }
        return date;
    }
    internal static int Buffer(DateOnly eta, DateOnly need)
    {
        if (eta > need) return -Buffer(need, eta);
        var days = 0;
        while (eta < need) { eta = eta.AddDays(1); if (Working(eta)) days++; }
        return days;
    }
    internal static SimSupplyRisk Risk(string? needBy, string? expected, DateOnly today, decimal open)
    {
        if (!TryDate(expected, out var eta)) return new(null, null, null, "Expected Date Missing");
        bool late = open > 0 && eta < today;
        if (!TryDate(needBy, out var need)) return new(null, null, late, "Planning Unavailable");
        var buffer = Buffer(eta, need);
        // Calendar ordering also catches weekend promises after a Friday need-by.
        bool atRisk = open > 0 && (eta > need || today > need);
        return new(buffer, atRisk, late, open <= 0 ? "Received" : late ? "Late" : atRisk ? "At Risk" : eta == today ? "Expected Today" : "On Time");
    }
    internal static SimMaterialSchedule Derive(SimNewOrderPackage package, object provenance)
    {
        var baseline = package.TechnicalSource?.Baseline;
        var quote = package.Quote;
        var due = package.Facts.Lines.SingleOrDefault()?.CustomerDueDate;
        var review = package.ContractDates?.DueDateReview;
        var lead = baseline?.Labor.ManufacturingLead;
        if (package.TechnicalSource?.Status != "QUOTED_DEFINITION_LINKED" || baseline is null || quote is null ||
            baseline.Quote != quote.Reference || baseline.Labor.Version != quote.Approval.Summary.LaborVersion ||
            baseline.Labor.DefinitionId != quote.Approval.Summary.ManufacturingDefinitionId ||
            review?.Disposition != "ACCEPT" || review.Date != due || !TryDate(due, out var date) ||
            lead?.Value is not int value || value < 0 || value > 2000 || lead.Unit is not ("DAYS" or "WEEKS"))
            throw new InvalidOperationException("Accepted due-date review or frozen approved manufacturing lead is unavailable.");
        var days = checked(value * (lead.Unit == "WEEKS" ? 5 : 1));
        return new(due!, lead, Iso(Subtract(date, days)), days, new { acceptance = provenance,
            quote = quote.Reference, laborVersion = baseline.Labor.Version, definitionId = baseline.Labor.DefinitionId,
            technicalSourceToken = baseline.SourceToken, dueDateReview = review, rule = Rule });
    }
    // Coverage is demand-specific. Only governed, accepted and staged material leaves
    // the outstanding LPD set. Neither physical arrival nor this projection resolves Kitting.
    internal static SimSupplyWorkOrder RollUp(string workOrderNumber, SimSupplyDemand[] demands, string? materialStatus = null)
    {
        // Historical shortage/ETA evidence stays in Demands. A completed Kitting case
        // has no current supply blocker, even though its original shortage was positive.
        if (materialStatus == "KIT_COMPLETE")
            return new(workOrderNumber, "Kit Complete", demands, null, false,
                demands.Select(d => d.Schedule?.MaterialNeedBy).FirstOrDefault(v => v is not null),
                null, false, 0, 0, 0, 0, materialStatus);
        var shortages = demands.Where(d => d.Short > 0 && !d.Resolved).ToArray();
        var outstanding = shortages.Where(d => d.UnavailableReason is not null || d.Available + d.AppliedQuantity < d.Short).ToArray();
        var allAvailable = shortages.Length > 0 && outstanding.Length == 0;
        var uncovered = outstanding.Count(d => d.Available + d.AppliedQuantity + d.Orders.Sum(o => o.Open ?? 0) < d.Short);
        var ordered = outstanding.Count(d => d.Available + d.AppliedQuantity + d.Orders.Sum(o => o.Open ?? 0) >= d.Short);
        var late = outstanding.Count(d => d.Orders.Any(o => o.Open > 0 && o.Risk.SupplierLate == true));
        var sourceReview = outstanding.Any(d => d.UnavailableReason is not null);
        var receiptReview = outstanding.Any(d => d.Orders.Any(o => o.Received is null ||
            (o.Received > 0 && !o.ReceiptEvidenceVerified)));
        var undated = outstanding.Count(d => d.Orders.Any(o => o.Open > 0 && !TryDate(o.ExpectedDate, out _)));
        var established = outstanding.Length > 0 && uncovered == 0 && undated == 0 && !sourceReview && !receiptReview &&
            outstanding.All(d => d.Orders.Any(o => o.Open > 0));
        var lpd = established ? outstanding.SelectMany(d => d.Orders).Where(o => o.Open > 0)
            .Select(o => o.ExpectedDate).Max(StringComparer.Ordinal) : null;
        var needs = shortages.Select(d => d.Schedule?.MaterialNeedBy).Distinct().ToArray();
        var need = needs.Length == 1 && TryDate(needs[0], out _) ? needs[0] : null;
        int? buffer = null;
        bool? atRisk = null;
        if (allAvailable) atRisk = false;
        if (TryDate(lpd, out var last) && TryDate(need, out var required))
        {
            buffer = Buffer(last, required);
            atRisk = last > required;
        }
        var attention = new List<string>();
        if (sourceReview) attention.Add("Supply Review Required");
        if (receiptReview) attention.Add("Receipt Availability Requires Review");
        if (uncovered > 0) attention.Add($"{uncovered} Needs Buyer Action");
        if (undated > 0) attention.Add($"{undated} Missing ETA");
        if (late > 0) attention.Add($"{late} Late");
        if (atRisk == true) attention.Add("At Risk");
        if (need is null) attention.Add("Planning Unavailable");
        if (attention.Count == 0) attention.Add(atRisk == false ? "On Time" : "Supply Review Required");
        var text = "LPD " + (TryDate(lpd, out var date) ? date.ToString("MM/dd/yyyy", CultureInfo.InvariantCulture) : "Not Established") +
            " · " + string.Join(" · ", attention);
        if (allAvailable) text = shortages.All(d=>d.AppliedQuantity>=d.Short) ? "Re-Kit Applied \u00b7 Submission Required" : "Accepted Material \u00b7 Awaiting Kitting";
        else if (shortages.Any(d => d.Available > 0)) text += " · Accepted Material Partially Available";
        return new(workOrderNumber, text, demands, lpd, established, need, buffer, atRisk,
            shortages.Length, ordered, uncovered, late, materialStatus);
    }
    internal Task<SimMaterialPlanningView> Read(SimPersona actor) => state.WithStableRuntime<SimMaterialPlanningView>(async runtime =>
    {
        if (!new[] { "kitting.view", "purchasing.view", "receiving.view", "sync.operations" }.Any(actor.Can))
            throw new SimOrderEntryPermissionException();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(UtcNow(),
            TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles")).DateTime);
        var (view, receiving, origins, materialStates) = await operations.ReadKittingSupply(runtime);
        var result = new List<SimSupplyWorkOrder>();
        foreach (var group in view.Demands.GroupBy(d => d.WorkOrderNumber))
        {
            var materialStatus = materialStates.GetValueOrDefault(group.Key);
            SimMaterialSchedule? schedule = null;
            string? unavailable = null;
            try
            {
                schedule = await requirements.WithReleasedRequirements(group.Key, runtime, async released =>
                {
                    var source = released.Lineage.GetProperty("source");
                    var intake = (SimRfqIntakeRecord)(await intakes.ReadAsync(source.GetProperty("intakeId").GetString()!))!;
                    var accepted = intake.OrderEntry!.Acceptance;
                    return Derive(accepted.Package, new { intake.IntakeId, accepted.Id, accepted.PackageRevision, accepted.SourceToken,
                        workOrderNumber = group.Key, released.ReleasedBomIdentity });
                });
            }
            catch (Exception e) when (e is InvalidOperationException or ArgumentException or SimRfqIntakeProblem)
            { unavailable = "Accepted manufacturing planning source requires review."; }
            var demands = group.Select(d =>
            {
                var resolved = d.State == "RESOLVED" && d.ReconciliationId is not null && d.RemainingShortQuantity == 0;
                // SourceCurrent is intentionally false for resolved buying authority.
                // That is fulfillment, not broken historical lineage.
                var current = d.SourceCurrent || resolved ? schedule : null;
                var orders = view.Purchases.Where(p => p.Coverage.Any(c => c.DemandId == d.DemandId)).Select(p =>
                {
                    var c = p.Coverage.Single(c => c.DemandId == d.DemandId);
                    var receipts = receiving.Materials.Where(m => m.PurchaseId == p.PurchaseId).ToArray();
                    var verified = receipts.Sum(m => m.ReceivedQuantity) == p.ReceivedQuantity;
                    // Only governed receipt allocations assign physical arrival to a demand.
                    // Older aggregate receipt values remain visible but cannot imply usable material.
                    decimal? received = verified ? receipts.SelectMany(m => m.Coverage)
                        .Where(a => a.DemandId == d.DemandId).Sum(a => a.ReceivedQuantity) :
                        p.ReceivedQuantity == 0 ? 0 : p.Coverage.Length == 1 && p.ExcessQuantity == 0 ? p.ReceivedQuantity : null;
                    var open = received is null ? (decimal?)null : Math.Max(0, c.Quantity - received.Value);
                    return new SimSupplyOrder(p.PurchaseId, p.PoNumber, p.PoLine, c.Quantity, received,
                        open, p.ExpectedDate,
                        Risk(current?.MaterialNeedBy, p.ExpectedDate, today, open ?? p.OpenQuantity), verified,
                        receipts.SelectMany(m => m.Coverage).Where(a => a.DemandId == d.DemandId).Sum(a => a.AppliedQuantity));
                }).ToArray();
                var accepted = AcceptedForDemand(d.DemandId, receiving.Materials, orders);
                var available = accepted.Sum(m => m.AvailableQuantity);
                var applied = receiving.Materials.SelectMany(m=>m.Coverage).Where(a=>a.DemandId==d.DemandId).Sum(a=>a.AppliedQuantity);
                var ordered = orders.Sum(p => p.Ordered);
                var plans = view.Plans.Where(p => p.State != "ORDERED" && p.Coverage.Any(c => c.DemandId == d.DemandId)).ToArray();
                var progress = materialStatus == "KIT_COMPLETE" ? "Kit Complete" : resolved ? "Shortage Fulfilled" :
                    applied >= d.ShortQuantity ? "Re-Kit Applied \u00b7 Submission Required" : d.SourceCurrent && unavailable is null && available >= d.ShortQuantity ? "Ready for Kitting" :
                    available > 0 ? "Accepted Material Partially Available" :
                    orders.Any(p => p.Received > 0) ? "Received · Awaiting Acceptance / Staging" :
                    ordered >= d.ShortQuantity ? "Ordered" : ordered > 0 ? "Part Ordered" :
                    plans.Any(p => p.State == "READY_FOR_PO") ? "Ready for PO" : plans.Length > 0 ? "Buying Plan" :
                    d.CustomerSupply is not null ? "C/S (Customer supplied) - Customer follow-up" : d.State == "ACCEPTED" ? "Accepted by Purchasing" : "Needs Buyer";
                return new SimSupplyDemand(d.DemandId, group.Key, d.SourceRowId, d.PartNumber, d.ShortQuantity,
                    progress, current, orders, d.SourceCurrent || resolved ? unavailable : "Shortage source changed; review required.",
                    resolved || materialStatus == "KIT_COMPLETE" ? [] : accepted,
                    origins.GetValueOrDefault(d.DemandId), applied, resolved, materialStatus, d.RemainingShortQuantity, d.CustomerSupply);
            }).ToArray();
            result.Add(RollUp(group.Key, demands, materialStatus));
        }
        return new(Rule, Iso(today), result.ToArray());
    });

    internal static SimSupplyAcceptedMaterial[] AcceptedForDemand(string demandId,
        SimAcceptedMaterial[] materials, SimSupplyOrder[] orders)
    {
        return materials.Where(m => m.StagedAtUtc is not null && m.AvailableQuantity > 0 &&
                    m.Coverage.Any(a => a.DemandId == demandId && a.Quantity > a.AppliedQuantity) &&
                    orders.Any(o => o.PurchaseId == m.PurchaseId && o.ReceiptEvidenceVerified))
                    .Select(m => new SimSupplyAcceptedMaterial(m.ReceiptLineId, m.PoNumber, m.PoLine, m.PackingSlipNumber,
                        Math.Min(m.AvailableQuantity, m.Coverage.Single(a => a.DemandId == demandId).Quantity - m.Coverage.Single(a => a.DemandId == demandId).AppliedQuantity),
                        m.PurchasingUom, m.StagingLocation, m.ReceivedAtUtc, m.AcceptedAtUtc)).ToArray();
    }

    internal static void Map(WebApplication app, SimStateStore state, SimPersonaSessionStore personas, SimMaterialPlanning service)
    {
        app.MapGet("/api/sim/material-planning", async (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "private, no-store";
            if (!state.Current.IsHealthy) return Results.StatusCode(503);
            try { return Results.Json(await service.Read(personas.Resolve(context))); }
            catch (SimOrderEntryPermissionException) { return Results.StatusCode(403); }
            catch (Exception e) when (e is InvalidOperationException or IOException or Microsoft.Data.Sqlite.SqliteException)
            { return Results.Json(new { message = "Material planning is unavailable. Refresh before relying on supply dates." }, statusCode: 503); }
        });
    }
}
