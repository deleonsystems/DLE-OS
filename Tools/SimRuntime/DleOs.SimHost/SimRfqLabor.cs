using System.Text.Json;

internal sealed record SimLaborOperation(string Id, string Name, decimal? SetupMinutes = null, decimal? RunMinutes = null, string Instructions = "", decimal? OperationQuantity = null, decimal? RunSeconds = null, string? ParentId = null, string TimeBasis = "PER_UNIT");
internal sealed record SimLaborTotals(decimal SetupMinutes, decimal RunMinutes, decimal TotalMinutes, decimal TotalHours, decimal Cost, decimal SaleTotal, decimal UnitSalePrice, decimal? TotalSeconds = null);
internal sealed record SimLaborSnapshot(int Version, string DefinitionId, int Quantity, SimLaborOperation[] Operations,
    decimal Rate, decimal Markup, SimLaborTotals Totals, string UpdatedBy, DateTimeOffset AtUtc, string CalculationVersion = "LABOR_MINUTES_V1");
internal sealed record SimLaborPlan(int Revision, string DefinitionId, int Quantity, string Template, SimLaborOperation[] Operations,
    decimal? Rate, decimal Markup, string UpdatedBy, DateTimeOffset AtUtc, SimLaborSnapshot[] Versions, string CalculationVersion = "LABOR_MINUTES_V1");
internal sealed record SimLaborRequest(int ExpectedRevision, string DefinitionId, int Quantity, SimLaborOperation[] Operations, decimal? Rate, decimal Markup, bool Complete = false, string CalculationVersion = "LABOR_OPERATION_QTY_V2");
internal sealed record SimLaborView(SimRfqWorkspace Rfq, SimLaborPlan Plan, SimLaborTotals Totals);

internal sealed partial class SimRfqIntakeStore
{
    internal static decimal LaborOperationSeconds(SimLaborOperation operation, SimLaborOperation[] operations, int quantity = 1)
    {
        var children = operations.Where(o => o.ParentId == operation.Id).ToArray();
        decimal Own(SimLaborOperation o) => (o.RunSeconds ?? 0) * (o.OperationQuantity ?? 0) / (o.TimeBasis == "BATCH" ? quantity : 1);
        return children.Length == 0 ? Own(operation) : children.Sum(Own);
    }
    internal static SimLaborTotals CalculateLabor(SimLaborOperation[] operations, int quantity, decimal rate, decimal markup)
    {
        var setup = 0m;
        var seconds = operations.Where(o => o.ParentId is null).Sum(o => LaborOperationSeconds(o, operations, quantity));
        var run = seconds / 60;
        var minutes = setup + run;
        decimal Round(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);
        // Round currency only at each final output; do not price from rounded display hours/cost.
        var cost = seconds * rate / 3600;
        var sale = seconds * rate * (100 + markup) / 360000;
        return new(setup, run, minutes, seconds / 3600, Round(cost), Round(sale), Round(sale), seconds);
    }
    private static SimLaborView LaborView(SimRfqWorkspace rfq)
    {
        if (rfq.Assemblies.Length != 1 || rfq.Assemblies[0].Quantity <= 0)
            throw SimRfqIntakeProblem.Conflict("LABOR_SCOPE", "Labor V1 requires one assembly and a positive quoted quantity.");
        // V1 default for legacy RFQs without a recorded type is the requested editable
        // PCB template. This chooses a quote starting plan, not a technical classification.
        var pcb = string.IsNullOrEmpty(rfq.AssemblyType) || rfq.AssemblyType == "PCB_ASSEMBLY";
        var names = pcb ? new[] { "Kitting", "PCB Preparation", "SMT Setup", "Solder Paste", "SMT Placement", "Reflow", "First Piece / In-Process Inspection", "Thru-Hole Assembly", "Hand Solder", "Cleaning", "Final Inspection", "Test", "Packaging" } : new[] { "Kitting", "Assembly", "Inspection", "Pack" };
        var plan = rfq.Lanes.LaborQuote ?? new(0, rfq.Inputs.Manufacturing.Id, rfq.Assemblies[0].Quantity,
            pcb ? "PCB Assembly — SMT / Thru-Hole" : "General Assembly", names.Select((n, i) => new SimLaborOperation("op-" + (i + 1), n, OperationQuantity: i == 0 ? rfq.Inputs.Materials.Candidate.Rows.Length : null)).ToArray(), 75m, 0, "", default, [], "LABOR_BATCH_ALLOCATION_V6");
        plan = NormalizeLaborHierarchy(plan);
        if (plan.CalculationVersion != "LABOR_BATCH_ALLOCATION_V6") throw SimRfqIntakeProblem.Conflict("LABOR_LEGACY_PLAN", "This preserved setup-time plan requires review before conversion to operation quantities.");
        if (plan.DefinitionId != rfq.Inputs.Manufacturing.Id || plan.Quantity != rfq.Assemblies[0].Quantity)
            throw SimRfqIntakeProblem.Conflict("LABOR_SOURCE_CHANGED", "Manufacturing Definition or quantity changed. Preserve this Labor plan for review before continuing.");
        return new(rfq, plan, CalculateLabor(plan.Operations, plan.Quantity, plan.Rate ?? 0, plan.Markup));
    }
    internal static SimLaborPlan NormalizeLaborHierarchy(SimLaborPlan plan)
    {
        plan = NormalizeLaborSeconds(plan);
        return plan.CalculationVersion is "LABOR_SECONDS_V3" or "LABOR_HIERARCHY_V4" or "LABOR_TIME_BASIS_V5" ? plan with { CalculationVersion = "LABOR_BATCH_ALLOCATION_V6" } : plan;
    }
    internal static SimLaborPlan NormalizeLaborSeconds(SimLaborPlan plan) => plan.CalculationVersion == "LABOR_OPERATION_QTY_V2"
        ? plan with { CalculationVersion = "LABOR_SECONDS_V3", Operations = plan.Operations.Select(o => o with { RunSeconds = o.RunMinutes * 60, RunMinutes = null }).ToArray() }
        : plan;
    internal async Task<SimLaborView> ReadLabor(string id) => LaborView((await ReadRfqs()).SingleOrDefault(r => r.IntakeId == id)
        ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found."));

    internal async Task<SimLaborView> SaveLabor(string id, SimLaborRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r))
                ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found.");
            var lanes = await ReadRfqLanes();
            var view = LaborView(RfqView(record, lanes));
            if (request.CalculationVersion != "LABOR_BATCH_ALLOCATION_V6") throw SimRfqIntakeProblem.Conflict("LABOR_UNITS_CHANGED", "Reload Labor before saving: the time-basis contract has changed.");
            if (request.ExpectedRevision != view.Plan.Revision || request.DefinitionId != view.Plan.DefinitionId || request.Quantity != view.Plan.Quantity)
                throw SimRfqIntakeProblem.Conflict("LABOR_STALE", "Labor or its source changed. Reopen Labor before saving again.");
            bool Precise(decimal? v) => v is null || decimal.Round(v.Value, 6) == v;
            if (request.Operations is null || request.Operations.Length > 200 || request.Operations.Any(o => o is null || string.IsNullOrWhiteSpace(o.Id) || o.Id.Length > 80 || !o.Id.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') || (o.Name?.Length ?? 0) > 200 || (o.Instructions?.Length ?? 0) > 4000 || o.SetupMinutes is < 0 or > 1000000 || o.RunMinutes is < 0 or > 1000000 || !Precise(o.SetupMinutes) || !Precise(o.RunMinutes) || o.RunMinutes is not null || o.TimeBasis is not ("PER_UNIT" or "BATCH") || o.RunSeconds is < 0 or > 60000000 || !Precise(o.RunSeconds) || o.OperationQuantity is < 0 or > 1000000 || !Precise(o.OperationQuantity))
                || request.Operations.Select(o => o.Id).Distinct().Count() != request.Operations.Length || request.Rate is < 0 or > 1000000 || request.Markup is < 0 or > 10000 || !Precise(request.Rate) || !Precise(request.Markup))
                throw SimRfqIntakeProblem.Conflict("LABOR_VALUES", "Use unique operations, nonnegative times/rate up to 1000000, and markup from 0 to 10000 percent.");
            if (request.Operations.Any(o => o.ParentId is not null && !request.Operations.Any(p => p.Id == o.ParentId && p.ParentId is null && p.Id != o.Id)))
                throw SimRfqIntakeProblem.Conflict("LABOR_HIERARCHY", "Sub-operations must belong to an existing main operation. Only one child level is supported.");
            var operations = request.Operations.Select(o => o with { Name = (o.Name ?? "").Trim(), Instructions = (o.Instructions ?? "").Trim() }).ToArray();
            // Canonical flat order keeps every child beside its parent; IDs remain stable.
            operations = operations.Where(o => o.ParentId is null).SelectMany(p => new[] { p }.Concat(operations.Where(c => c.ParentId == p.Id))).ToArray();
            if (request.Complete && (operations.Length == 0 || operations.Any(o => o.Name.Length == 0) || request.Rate is null))
                throw SimRfqIntakeProblem.Conflict("LABOR_INCOMPLETE", "Name at least one operation and enter a Labor Rate before completing.");
            var now = DateTimeOffset.UtcNow;
            var plan = view.Plan with { Revision = view.Plan.Revision + 1, Operations = operations, Rate = request.Rate, Markup = request.Markup, UpdatedBy = persona.DisplayName, AtUtc = now };
            if (request.Complete)
                plan = plan with { Versions = plan.Versions.Append(new(plan.Versions.Length + 1, plan.DefinitionId, plan.Quantity, operations, plan.Rate!.Value, plan.Markup, CalculateLabor(operations, plan.Quantity, plan.Rate.Value, plan.Markup), persona.DisplayName, now, "LABOR_BATCH_ALLOCATION_V6")).ToArray() };
            // Read latest lanes under the same persistence gate as Materials, replacing only Labor fields.
            lanes[id] = view.Rfq.Lanes with { LaborQuote = plan, Labor = new(request.Complete ? "COMPLETE" : "IN_PROGRESS", persona.DisplayName, now) };
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            var temporary = RfqLanesPath + ".write-" + Guid.NewGuid().ToString("N");
            try
            {
                var text = JsonSerializer.Serialize(lanes, jsonOptions);
                await File.WriteAllTextAsync(temporary, text);
                if (await File.ReadAllTextAsync(temporary) != text) throw new IOException("Labor write verification failed.");
                File.Move(temporary, RfqLanesPath, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return LaborView(RfqView(record, lanes));
        }
        finally { gate.Release(); }
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapLabor(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/{id}/bom-reference", async Task<IResult> (string id, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view"); if (denied is not null) return denied;
            var rfq = (await store.ReadRfqs()).SingleOrDefault(r => r.IntakeId == id);
            if (rfq is null) return Results.NotFound();
            context.Response.Headers.CacheControl = "no-store";
            return Results.Content(BomReference(rfq), "text/html; charset=utf-8");
        });
        app.MapGet("/api/sim/rfqs/{id}/labor", async Task<IResult> (string id, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view"); if (denied is not null) return denied;
            try { return Results.Json(await store.ReadLabor(id)); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
        });
        app.MapPut("/api/sim/rfqs/{id}/labor", async Task<IResult> (string id, SimLaborRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition"); if (denied is not null) return denied;
            try { return Results.Json(await store.SaveLabor(id, request, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "Labor could not be saved. Your edits remain available; retry." }, statusCode: 503); }
        });
    }
    internal static string BomReference(SimRfqWorkspace rfq)
    {
        string E(object? v) => System.Net.WebUtility.HtmlEncode(v?.ToString() ?? "");
        var accepted = rfq.Inputs.Materials;
        var rows = accepted.Candidate.Rows.Select(r =>
        {
            var identity = r.ManufacturerIdentity;
            var confirmed = identity is null ? "" : string.Join(" / ", identity.Proposals.Where(p => identity.Decision(p.Id) == "CONFIRMED").Select(p => p.PartNumber).Distinct());
            return "<tr tabindex=\"0\" aria-selected=\"false\" data-quantity=\"" + E(r.Values.GetValueOrDefault("quantity")) + "\">" + new[] { r.Values.GetValueOrDefault("lineNumber"), r.Values.GetValueOrDefault("partNumber"), confirmed, r.Values.GetValueOrDefault("description"), r.Values.GetValueOrDefault("designators"), r.Values.GetValueOrDefault("quantity"), r.ComponentType ?? "STANDARD_COTS" }.Select(v => "<td>" + E(v) + "</td>").Aggregate("", (a,b) => a+b) + "</tr>";
        });
        return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Accepted BOM — read-only reference</title><style>body{font:14px system-ui;margin:24px;color:#183247;background:#f4f7fa}h1{font-size:22px}table{border-collapse:collapse;width:100%;background:white}th,td{padding:7px 9px;border:1px solid #d4dfe7;text-align:left}th{position:sticky;top:0;background:#dce7ee}tr:nth-child(even){background:#f1f6fa}tbody tr{cursor:pointer}tbody tr[aria-selected=true]{background:#cce5f5}tbody tr:focus-visible{outline:2px solid #286b96;outline-offset:-2px}.analysis{position:sticky;bottom:0;background:#e4eef4;padding:10px;display:flex;gap:16px;align-items:center}td{overflow-wrap:anywhere}body{font-size:13px}</style><h1>Accepted BOM — read-only reference</h1><p>" + E(rfq.Customer.CustomerName) + " · " + E(rfq.Assemblies[0].AssemblyNumber) + " · Rev " + E(rfq.Assemblies[0].Revision) + " · Accepted BOM v" + accepted.Version + "</p><p><strong>BOM Lines: " + accepted.Candidate.Rows.Length + "</strong> · Total Components: <strong id=\"bom-total\">—</strong></p><p>Click a row · Ctrl+Click to add/remove · Shift+Click for a range · Escape to clear. Selection is temporary and read-only.</p><table><thead><tr>" + string.Join("", new[] { "Find / Line #", "Customer / BOM P/N", "Confirmed MFG P/N", "Description", "Ref Des", "Qty / Assy", "Component Type" }.Select(h => "<th>" + h + "</th>")) + "</tr></thead><tbody>" + string.Join("", rows) + "</tbody></table><div class=\"analysis\"><span id=\"bom-selection\" role=\"status\" aria-live=\"polite\">Selected: 0 lines · 0 components</span><button id=\"bom-clear\" type=\"button\">Clear selection</button></div><script src=\"/SRC/workspaces/rfqs/bom-reference.js\" defer></script></html>";
    }
}
