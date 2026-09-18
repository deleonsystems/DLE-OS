using System.Globalization;
using System.Text.Json;

internal sealed record SimMaterialRow(int Index, string Vendor = "", decimal? UnitPrice = null, decimal? OrderQuantity = null,
    int? LeadDays = null, string Notes = "", bool CustomerSupplied = false,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? MfgPartNumber = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? VendorPartNumber = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Uom = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? MfgPartNumberSource = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? LeadTimeMode = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? LeadTimeValue = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? VendorSource = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? OrderQuantityMode = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialCharge[]? Charges = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialEvidence? Evidence = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? AssemblyPartNumber = null);
internal sealed record SimMaterialResultRow(SimMaterialRow Quote, decimal? RequiredQuantity, decimal? ExtendedCost, string[] Issues, bool Required = true,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? AssemblyCost = null);
internal sealed record SimMaterialSnapshot(int Version, int BomVersion, string CandidateId, int RfqQuantity,
    SimMaterialResultRow[] Rows, decimal TotalCost, string Currency, string UpdatedBy, DateTimeOffset AtUtc, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? MarkupPercent = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? MaterialUnitSalePrice = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialCommercialTotals? SupplementalTotals = null);
internal sealed record SimMaterialPlan(int Revision, int BomVersion, string CandidateId, SimMaterialRow[] Rows,
    string UpdatedBy, DateTimeOffset AtUtc, SimMaterialSnapshot[] Versions, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? MarkupPercent = null);
internal sealed record SimMaterialRequest(int ExpectedRevision, SimMaterialRow[] Rows, bool Complete = false, decimal? MarkupPercent = null, int ChargeContractVersion = 0, int EvidenceContractVersion = 0);
internal sealed record SimMaterialView(SimRfqWorkspace Rfq, SimMaterialPlan Plan, SimMaterialResultRow[] Rows,
    int LinesQuoted, decimal TotalCost, int? LongestLeadDays, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialCommercialTotals? SupplementalTotals = null);

internal sealed partial class SimRfqIntakeStore
{
    // Compare commercial content, not audit timestamps, version numbers or row display order.
    internal static bool SameMaterialBusiness(SimMaterialSnapshot a, SimMaterialSnapshot b)
    {
        string? Number(decimal? value) => value?.ToString("G29", CultureInfo.InvariantCulture);
        object Canonical(SimMaterialSnapshot s) => new {
            s.BomVersion, s.CandidateId, s.RfqQuantity, Currency=s.Currency.Trim().ToUpperInvariant(),
            Markup=Number(s.MarkupPercent ?? 0), Total=Number(s.TotalCost),
            Sale=Number(s.MaterialUnitSalePrice ?? MaterialUnitSale(s.TotalCost,s.MarkupPercent ?? 0,s.RfqQuantity)),
            Rows=s.Rows.OrderBy(r=>r.Quote.Index).Select(r=>new {
                r.Quote.Index, Evidence=MaterialEvidenceContent(r.Quote.Evidence), Charges=(r.Quote.Charges ?? []).OrderBy(c=>c.Id).Select(c=>new {c.Id, Description=c.Description.Trim(),c.Category,RawCost=Number(c.RawCost),Quantity=Number(c.Quantity ?? 1),c.Treatment,c.MarkupTreatment,CustomMarkup=c.MarkupTreatment=="CUSTOM"?Number(c.CustomMarkupPercent):null,Notes=c.Notes.Trim(),Evidence=MaterialEvidenceContent(c.Evidence)}).ToArray(), Vendor=(r.Quote.Vendor ?? "").Trim(), UnitPrice=Number(r.Quote.UnitPrice),
                OrderQuantity=Number(r.Quote.OrderQuantity), LeadDays=MaterialLeadDays(r.Quote),
                Notes=(r.Quote.Notes ?? "").Trim(), r.Quote.CustomerSupplied,
                AssemblyPartNumber=r.Quote.AssemblyPartNumber, MfgPartNumber=(r.Quote.MfgPartNumber ?? "").Trim(), VendorPartNumber=(r.Quote.VendorPartNumber ?? "").Trim(),
                Uom=string.IsNullOrEmpty(r.Quote.Uom)?"EA":r.Quote.Uom.Trim(),
                MfgSource=r.Quote.MfgPartNumberSource ?? "", VendorSource=r.Quote.VendorSource ?? "",
                OrderMode=r.Quote.OrderQuantityMode ?? (r.Quote.OrderQuantity is null?"AUTO":"MANUAL"),
                RequiredQuantity=Number(r.RequiredQuantity), ExtendedCost=Number(r.ExtendedCost), r.Required
            }).ToArray()
        };
        return JsonSerializer.Serialize(Canonical(a)) == JsonSerializer.Serialize(Canonical(b));
    }
    internal static decimal MaterialUnitSale(decimal total, decimal markup, int quantity) => decimal.Round(total * (1 + markup / 100) / quantity, 2, MidpointRounding.AwayFromZero);
    internal static int? MaterialLeadDays(SimMaterialRow row) => row.LeadTimeMode switch { "STOCK" => 0, "DAYS" => row.LeadTimeValue, "WEEKS" => row.LeadTimeValue * 7, _ => row.LeadDays };
    internal static SimMaterialResultRow CalculateMaterial(SimMaterialRow row, SimCandidateRow source, int quantity)
    {
        decimal? required = decimal.TryParse(source.Values.GetValueOrDefault("quantity"), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var per) && per > 0 && per <= 1000000 ? per * quantity : null;
        if (source.ComponentType == "REFERENCE_ONLY") return new(row, required, 0, [], false, 0);
        var issues = new List<string>();
        if (required is null) issues.Add("Qty / Assy needs review");
        if (row.CustomerSupplied) { if (string.IsNullOrWhiteSpace(row.Notes) && !(row.Evidence?.Notes.Any(n=>n.Purpose=="SOURCING_PURCHASING") ?? false)) issues.Add("Identify customer-supply assumption in Notes"); }
        else
        {
            if (string.IsNullOrWhiteSpace(row.Vendor)) issues.Add("Vendor required");
            if (row.UnitPrice is null) issues.Add("Unit price required");
            if (row.OrderQuantity is null || row.OrderQuantity < required) issues.Add("Order quantity must cover required quantity");
            if (MaterialLeadDays(row) is null) issues.Add("Lead time required");
        }
        decimal? extended = row.CustomerSupplied ? 0 : row.UnitPrice.HasValue && row.OrderQuantity.HasValue ? decimal.Round(row.UnitPrice.Value * row.OrderQuantity.Value, 2, MidpointRounding.AwayFromZero) : null;
        decimal? assemblyCost = row.CustomerSupplied ? 0 : required.HasValue && row.UnitPrice.HasValue ? decimal.Round(per * row.UnitPrice.Value, 2, MidpointRounding.AwayFromZero) : null;
        return new(row, required, extended, issues.ToArray(), true, assemblyCost);
    }
    internal static SimMaterialRow DefaultMaterialQuantity(SimMaterialRow row, SimCandidateRow source, int quantity)
    {
        var mode=row.OrderQuantityMode ?? (row.OrderQuantity is null ? "AUTO" : "MANUAL");
        if(mode=="MANUAL")return row with{OrderQuantityMode=mode};
        var required=CalculateMaterial(row,source,quantity).RequiredQuantity;
        return row with{OrderQuantityMode="AUTO",OrderQuantity=row.CustomerSupplied||source.ComponentType=="REFERENCE_ONLY"?null:required};
    }
    internal static string[] MaterialIdentityChoices(SimCandidateRow row) =>
        (row.ManufacturerIdentity?.Proposals.Where(p=>row.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED").Select(p=>p.PartNumber) ?? [])
        .Concat((row.Alternates ?? []).Where(a=>a.RemovedAtUtc is null && a.ReviewStatus=="APPROVED").Select(a=>a.PartNumber))
        .Where(p=>!string.IsNullOrWhiteSpace(p)).Distinct().ToArray();
    internal static SimMaterialRow MaterialIdentityDefaults(SimMaterialRow row, SimCandidateRow source)
    {
        if(source.ComponentType=="SUBASSEMBLY" && source.AssemblyIdentity is {} assembly)
            return row with {AssemblyPartNumber=assembly.PartNumber};
        if(row.MfgPartNumber is not null)return row with {MfgPartNumberSource=row.MfgPartNumberSource??"MANUAL_QUOTE_ONLY"};
        var identity=source.ManufacturerIdentity;
        var number=identity?.Proposals.FirstOrDefault(p=>identity.Decision(p.Id)=="CONFIRMED"&&!string.IsNullOrWhiteSpace(p.PartNumber))?.PartNumber;
        return row with {MfgPartNumber=number,MfgPartNumberSource=number is null?null:"CONFIRMED_ACCEPTED_BOM"};
    }
    private static SimMaterialView MaterialView(SimRfqWorkspace rfq)
    {
        if (rfq.Assemblies.Length != 1) throw SimRfqIntakeProblem.Conflict("MATERIALS_ASSEMBLY_SCOPE", "Phase 1 Materials requires one assembly per RFQ.");
        var accepted = rfq.Inputs.Materials;
        var plan = rfq.Lanes.MaterialsQuote ?? new(0, accepted.Version, accepted.Candidate.Id,
            accepted.Candidate.Rows.Select(r => new SimMaterialRow(r.Index)).ToArray(), "", default, []);
        if (plan.BomVersion != accepted.Version || plan.CandidateId != accepted.Candidate.Id)
            throw SimRfqIntakeProblem.Conflict("MATERIALS_SOURCE_CHANGED", "Accepted BOM changed; preserve this plan for review before continuing.");
        // Default only missing quotation selections; never rewrite completed snapshots or technical decisions.
        plan = plan with {Rows=plan.Rows.Select(r=>MaterialIdentityDefaults(r,accepted.Candidate.Rows.Single(s=>s.Index==r.Index))).ToArray()};
        plan=plan with{Rows=plan.Rows.Select(r=>DefaultMaterialQuantity(r,accepted.Candidate.Rows.Single(s=>s.Index==r.Index),rfq.Assemblies[0].Quantity)).ToArray()};
        var rows = plan.Rows.Select(r => CalculateMaterial(r, accepted.Candidate.Rows.Single(s => s.Index == r.Index), rfq.Assemblies[0].Quantity)).ToArray();
        return new(rfq, plan, rows, rows.Count(r => r.Required && !r.Quote.CustomerSupplied && r.Issues.Length == 0), rows.Sum(r => r.ExtendedCost ?? 0),
            rows.Where(r => r.Required && !r.Quote.CustomerSupplied).Select(r => MaterialLeadDays(r.Quote)).DefaultIfEmpty().Max(),
            MaterialCommercial(rows.Sum(r=>r.ExtendedCost ?? 0),plan.Rows,plan.MarkupPercent ?? 0,rfq.Assemblies[0].Quantity));
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
            ValidateMaterialCharges(request,view.Plan);
            request=request with {Rows=await ValidateMaterialEvidence(record,view.Plan,request,persona)};
            foreach (var row in request.Rows)
            {
                if(row.OrderQuantityMode is not (null or "AUTO" or "MANUAL"))throw SimRfqIntakeProblem.Conflict("MATERIALS_ORDER_MODE","Invalid Order Qty mode.");
                if (row.VendorSource is not (null or "SIM_LIST" or "MANUAL_QUOTE_ONLY") || (row.VendorSource == "SIM_LIST" && row.Vendor is not ("Digi-Key" or "Mouser" or "Newark" or "Arrow" or "Avnet")))
                    throw SimRfqIntakeProblem.Conflict("MATERIALS_VENDOR_SOURCE", "Choose a SIM vendor or enter a quote-only vendor.");
                var assemblySource=view.Rfq.Inputs.Materials.Candidate.Rows.Single(s=>s.Index==row.Index);
                if(row.AssemblyPartNumber is not null && (assemblySource.ComponentType!="SUBASSEMBLY" || row.AssemblyPartNumber!=assemblySource.AssemblyIdentity?.PartNumber))
                    throw SimRfqIntakeProblem.Conflict("MATERIALS_IDENTITY_SOURCE","Assembly P/N must match the Accepted BOM.");
                if (row.MfgPartNumberSource is not (null or "MANUAL_QUOTE_ONLY" or "CONFIRMED_ACCEPTED_BOM"))
                    throw SimRfqIntakeProblem.Conflict("MATERIALS_IDENTITY_SOURCE", "Choose an Accepted BOM identity or manual quote-only entry.");
                if (!string.IsNullOrEmpty(row.MfgPartNumber) && row.MfgPartNumberSource == "CONFIRMED_ACCEPTED_BOM")
                {
                    var source=view.Rfq.Inputs.Materials.Candidate.Rows.Single(s=>s.Index==row.Index);
                    if (!MaterialIdentityChoices(source).Contains(row.MfgPartNumber))
                        throw SimRfqIntakeProblem.Conflict("MATERIALS_IDENTITY_SOURCE", "This P/N is not a confirmed identity in the Accepted BOM.");
                }
            }
            if (request.Rows.Any(r => r.UnitPrice is < 0 or > 1000000000 || r.OrderQuantity is <= 0 or > 1000000000 || r.LeadDays is < 0 or > 36500 || (r.Vendor?.Length ?? 0) > 200 || (r.Notes?.Length ?? 0) > 4000 || (r.MfgPartNumber?.Length ?? 0) > 200 || (r.VendorPartNumber?.Length ?? 0) > 200 || (r.Uom?.Length ?? 0) > 24))
                throw SimRfqIntakeProblem.Conflict("MATERIALS_VALUES", "Use nonnegative prices, positive order quantities, and lead time in days; keep vendor and notes concise.");
            foreach (var row in request.Rows)
            {
                if (row.LeadTimeMode is not (null or "STOCK" or "DAYS" or "WEEKS") ||
                    (row.LeadTimeMode == "STOCK" && row.LeadTimeValue is not null) ||
                    (row.LeadTimeMode is "DAYS" or "WEEKS" && (row.LeadTimeValue is null or <= 0 or > 36500)) ||
                    (row.LeadTimeMode is null && row.LeadTimeValue is not null))
                    throw SimRfqIntakeProblem.Conflict("MATERIALS_LEAD_TIME", "Choose Stock, or Days/Weeks with a positive whole-number value up to 36500.");
                var existingUom = view.Plan.Rows.Single(r => r.Index == row.Index).Uom;
                if (!string.IsNullOrEmpty(row.Uom) && row.Uom is not ("EA" or "FT") && row.Uom != existingUom)
                    throw SimRfqIntakeProblem.Conflict("MATERIALS_UOM", "Choose EA or FT.");
            }
            if (request.MarkupPercent is < 0 or > 10000) throw SimRfqIntakeProblem.Conflict("MATERIALS_MARKUP", "Use a markup from 0 to 10000 percent.");
            var now = DateTimeOffset.UtcNow;
            var plan = view.Plan with {Revision=view.Plan.Revision+1, MarkupPercent=request.MarkupPercent ?? view.Plan.MarkupPercent ?? 0, Rows=request.Rows.Select(r=>r with {Charges=r.Charges?.Select(c=>c with {Description=c.Description.Trim(),Notes=c.Notes.Trim(),Quantity=c.Quantity==1?null:c.Quantity,CustomMarkupPercent=c.MarkupTreatment=="CUSTOM"?c.CustomMarkupPercent:null}).ToArray(),Vendor=(r.Vendor??"").Trim(),Notes=(r.Notes??"").Trim(),MfgPartNumber=r.MfgPartNumber?.Trim(),MfgPartNumberSource=string.IsNullOrEmpty(r.MfgPartNumber)?null:r.MfgPartNumberSource??"MANUAL_QUOTE_ONLY",VendorPartNumber=r.VendorPartNumber?.Trim(),Uom=string.IsNullOrEmpty(r.Uom)?"EA":r.Uom,LeadDays=r.LeadTimeMode is null?r.LeadDays:null}).ToArray(),UpdatedBy=persona.DisplayName,AtUtc=now};
            plan=plan with{Rows=plan.Rows.Select(r=>DefaultMaterialQuantity(r,view.Rfq.Inputs.Materials.Candidate.Rows.Single(s=>s.Index==r.Index),view.Rfq.Assemblies[0].Quantity)).ToArray()};
            var current = view.Rfq.Lanes with {MaterialsQuote=plan, Materials=new("IN_PROGRESS",persona.DisplayName,now)};
            var calculated = MaterialView(view.Rfq with {Lanes=current});
            if (request.Complete)
            {
                var incomplete = calculated.Rows.Where(r=>r.Issues.Length>0).Select(r=>"Line " + (r.Quote.Index+1) + ": " + string.Join(", ", r.Issues)).ToArray();
                if (incomplete.Length>0) throw SimRfqIntakeProblem.Conflict("MATERIALS_INCOMPLETE",string.Join("; ",incomplete));
                var snapshot = new SimMaterialSnapshot(plan.Versions.Length+1,plan.BomVersion,plan.CandidateId,view.Rfq.Assemblies[0].Quantity,calculated.Rows,calculated.TotalCost,"USD",persona.DisplayName,now,plan.MarkupPercent,calculated.SupplementalTotals!.MaterialUnitSalePrice,calculated.SupplementalTotals);
                var previous = plan.Versions.LastOrDefault();
                var unchanged = previous is not null && SameMaterialBusiness(previous, snapshot);
                current = current with {MaterialsQuote=plan with {Versions=unchanged?plan.Versions:plan.Versions.Append(snapshot).ToArray()},Materials=new("COMPLETE",persona.DisplayName,now)};
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
        MapMaterialEvidence(app,state,store,personas);
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
