using System.Globalization;
using System.Text.Json;

internal sealed record SimMaterialRow(int Index, string Vendor = "", decimal? UnitPrice = null, decimal? OrderQuantity = null,
    int? LeadDays = null, string Notes = "", bool CustomerSupplied = false,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? MfgPartNumber = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? VendorPartNumber = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Uom = null);
internal sealed record SimMaterialResultRow(SimMaterialRow Quote, decimal? RequiredQuantity, decimal? ExtendedCost, string[] Issues, bool Required = true,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? AssemblyCost = null);
internal sealed record SimMaterialSnapshot(int Version, int BomVersion, string CandidateId, int RfqQuantity,
    SimMaterialResultRow[] Rows, decimal TotalCost, string Currency, string UpdatedBy, DateTimeOffset AtUtc);
internal sealed record SimMaterialPlan(int Revision, int BomVersion, string CandidateId, SimMaterialRow[] Rows,
    string UpdatedBy, DateTimeOffset AtUtc, SimMaterialSnapshot[] Versions);
internal sealed record SimMaterialRequest(int ExpectedRevision, SimMaterialRow[] Rows, bool Complete = false);
internal sealed record SimMaterialView(SimRfqWorkspace Rfq, SimMaterialPlan Plan, SimMaterialResultRow[] Rows,
    int LinesQuoted, decimal TotalCost, int? LongestLeadDays);

internal sealed partial class SimRfqIntakeStore
{
    internal static SimMaterialResultRow CalculateMaterial(SimMaterialRow row, SimCandidateRow source, int quantity)
    {
        decimal? required = decimal.TryParse(source.Values.GetValueOrDefault("quantity"), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var per) && per > 0 && per <= 1000000 ? per * quantity : null;
        if (source.ComponentType == "REFERENCE_ONLY") return new(row, required, 0, [], false, 0);
        var issues = new List<string>();
        if (required is null) issues.Add("Qty / Assy needs review");
        if (row.CustomerSupplied) { if (string.IsNullOrWhiteSpace(row.Notes)) issues.Add("Identify customer-supply assumption in Notes"); }
        else
        {
            if (string.IsNullOrWhiteSpace(row.Vendor)) issues.Add("Vendor required");
            if (row.UnitPrice is null) issues.Add("Unit price required");
            if (row.OrderQuantity is null || row.OrderQuantity < required) issues.Add("Order quantity must cover required quantity");
            if (row.LeadDays is null) issues.Add("Lead time required");
        }
        decimal? extended = row.CustomerSupplied ? 0 : row.UnitPrice.HasValue && row.OrderQuantity.HasValue ? decimal.Round(row.UnitPrice.Value * row.OrderQuantity.Value, 2, MidpointRounding.AwayFromZero) : null;
        decimal? assemblyCost = row.CustomerSupplied ? 0 : required.HasValue && row.UnitPrice.HasValue ? decimal.Round(per * row.UnitPrice.Value, 2, MidpointRounding.AwayFromZero) : null;
        return new(row, required, extended, issues.ToArray(), true, assemblyCost);
    }
    private static SimMaterialView MaterialView(SimRfqWorkspace rfq)
    {
        if (rfq.Assemblies.Length != 1) throw SimRfqIntakeProblem.Conflict("MATERIALS_ASSEMBLY_SCOPE", "Phase 1 Materials requires one assembly per RFQ.");
        var accepted = rfq.Inputs.Materials;
        var plan = rfq.Lanes.MaterialsQuote ?? new(0, accepted.Version, accepted.Candidate.Id,
            accepted.Candidate.Rows.Select(r => new SimMaterialRow(r.Index)).ToArray(), "", default, []);
        if (plan.BomVersion != accepted.Version || plan.CandidateId != accepted.Candidate.Id)
            throw SimRfqIntakeProblem.Conflict("MATERIALS_SOURCE_CHANGED", "Accepted BOM changed; preserve this plan for review before continuing.");
        var rows = plan.Rows.Select(r => CalculateMaterial(r, accepted.Candidate.Rows.Single(s => s.Index == r.Index), rfq.Assemblies[0].Quantity)).ToArray();
        return new(rfq, plan, rows, rows.Count(r => r.Required && !r.Quote.CustomerSupplied && r.Issues.Length == 0), rows.Sum(r => r.ExtendedCost ?? 0),
            rows.Where(r => r.Required && !r.Quote.CustomerSupplied).Select(r => r.Quote.LeadDays).DefaultIfEmpty().Max());
    }
    internal async Task<SimMaterialView> ReadMaterials(string id)
    {
        var rfq = (await ReadRfqs()).SingleOrDefault(r => r.IntakeId == id) ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found.");
        return MaterialView(rfq);
    }
    internal async Task<SimMaterialView> SaveMaterials(string id, SimMaterialRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r)) ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found.");
            var lanes = await ReadRfqLanes();
            var view = MaterialView(RfqView(record, lanes));
            if (request.ExpectedRevision != view.Plan.Revision) throw SimRfqIntakeProblem.Conflict("MATERIALS_STALE", "Another user saved this plan. Reopen Materials before saving again.");
            if (request.Rows is null || request.Rows.Length != view.Plan.Rows.Length || request.Rows.Select(r => r.Index).Distinct().Count() != request.Rows.Length || request.Rows.Any(r => !view.Plan.Rows.Any(p => p.Index == r.Index)))
                throw SimRfqIntakeProblem.Conflict("MATERIALS_ROWS", "Quotation rows must match the accepted BOM.");
            if (request.Rows.Any(r => r.UnitPrice is < 0 or > 1000000000 || r.OrderQuantity is <= 0 or > 1000000000 || r.LeadDays is < 0 or > 36500 || (r.Vendor?.Length ?? 0) > 200 || (r.Notes?.Length ?? 0) > 4000 || (r.MfgPartNumber?.Length ?? 0) > 200 || (r.VendorPartNumber?.Length ?? 0) > 200 || (r.Uom?.Length ?? 0) > 24))
                throw SimRfqIntakeProblem.Conflict("MATERIALS_VALUES", "Use nonnegative prices, positive order quantities, and lead time in days; keep vendor and notes concise.");
            var now = DateTimeOffset.UtcNow;
            var plan = view.Plan with {Revision=view.Plan.Revision+1, Rows=request.Rows.Select(r=>r with {Vendor=(r.Vendor??"").Trim(),Notes=(r.Notes??"").Trim(),MfgPartNumber=r.MfgPartNumber?.Trim(),VendorPartNumber=r.VendorPartNumber?.Trim(),Uom=r.Uom?.Trim()}).ToArray(),UpdatedBy=persona.DisplayName,AtUtc=now};
            var current = view.Rfq.Lanes with {MaterialsQuote=plan, Materials=new("IN_PROGRESS",persona.DisplayName,now)};
            var calculated = MaterialView(view.Rfq with {Lanes=current});
            if (request.Complete)
            {
                var incomplete = calculated.Rows.Where(r=>r.Issues.Length>0).Select(r=>"Line " + (r.Quote.Index+1) + ": " + string.Join(", ", r.Issues)).ToArray();
                if (incomplete.Length>0) throw SimRfqIntakeProblem.Conflict("MATERIALS_INCOMPLETE",string.Join("; ",incomplete));
                var snapshot = new SimMaterialSnapshot(plan.Versions.Length+1,plan.BomVersion,plan.CandidateId,view.Rfq.Assemblies[0].Quantity,calculated.Rows,calculated.TotalCost,"USD",persona.DisplayName,now);
                current = current with {MaterialsQuote=plan with {Versions=plan.Versions.Append(snapshot).ToArray()},Materials=new("COMPLETE",persona.DisplayName,now)};
            }
            lanes[id] = current;
            var temporary = RfqLanesPath + ".write-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            try
            {
                var text=JsonSerializer.Serialize(lanes,jsonOptions);
                await File.WriteAllTextAsync(temporary,text);
                if(await File.ReadAllTextAsync(temporary)!=text) throw new IOException("Materials write verification failed.");
                File.Move(temporary,RfqLanesPath,true);
            }
            finally {if(File.Exists(temporary))File.Delete(temporary);}
            return MaterialView(RfqView(record,lanes));
        }
        finally {gate.Release();}
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapMaterials(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/{id}/materials", async Task<IResult> (string id,HttpContext context)=>
        {
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{return Results.Json(await store.ReadMaterials(id));}catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
        });
        app.MapPut("/api/sim/rfqs/{id}/materials", async Task<IResult> (string id,SimMaterialRequest request,HttpContext context)=>
        {
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.SaveMaterials(id,request,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Materials could not be saved. Your edits remain available; retry."},statusCode:503);}
        });
    }
}
