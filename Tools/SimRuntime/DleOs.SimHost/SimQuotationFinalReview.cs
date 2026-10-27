using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimFinalAnswers(string Delivery, bool? Outsourced, bool? HighUnitCost, bool? CanMeetDelivery,
    string RiskSeverity, string RiskNotes, string Class, bool? Itar, string NewContractRequirements, int? DeliveryValue = null, string? DeliveryUnit = null, SimQuickTurnInput? QuickTurn = null);
internal sealed record SimQuickTurnInput(string Mode, decimal? Value);
internal sealed record SimQuickTurnTotal(string Mode, decimal Value, decimal Basis, decimal Amount);
internal sealed record SimCustomerSuppliedMaterial(int Index, string FindNo, string InternalPartNumber);
internal sealed record SimFinalSummary(string IntakeId, string Customer, string Assembly, string Revision, int Quantity,
    string? Description, string? QuoteDue, decimal? MaterialUnitSale, decimal? LaborUnitSale, decimal? CombinedUnitPrice,
    decimal? Total, decimal NreTotal, SimLaborCharge[] NreLines, int? MaterialLongestLeadDays, string? ManufacturingLead,
    bool? CustomerSuppliedMaterial, bool TechnicalPackageAvailable, bool TechnicalComplete, bool MaterialsComplete,
    bool LaborComplete, int? MaterialsVersion, int? LaborVersion, string? ManufacturingDefinitionId, string Currency = "USD", int? ManufacturingLeadDays = null, int? SuggestedLeadDays = null, SimCustomerSuppliedMaterial[]? CustomerSuppliedItems = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialCommercialTotals? MaterialSupplemental = null, SimQuickTurnTotal? QuickTurn = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialPartFlag[]? MaterialPartFlags = null)
{
    public decimal? PreRushTotal => Total + NreTotal + (MaterialSupplemental?.SeparateCharges ?? 0) + (MaterialSupplemental?.MaterialNre ?? 0);
    public decimal? QuoteTotal => PreRushTotal + (QuickTurn?.Amount ?? 0);
}
internal sealed record SimFinalApproval(string Id, int Version, string SourceToken, SimFinalSummary Summary,
    SimFinalAnswers Answers, string ApprovedBy, string ApprovedById, DateTimeOffset ApprovedAt, string ContractVersion = "QUOTATION_FINAL_REVIEW_V1");
internal sealed record SimFinalReviewView(SimFinalSummary Summary, string SourceToken, string[] Blockers, SimFinalApproval[] Approvals, bool ApprovalCurrent,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimRfqSectionHold? MaterialsHold = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimRfqSectionHold? LaborHold = null, bool CanEditMaterials = false, int MaterialEditContractVersion = 0, SimEstimatePartRoute[]? EstimatePartRoutes=null,int PartRoutingContractVersion=0,int QuoteCopiesContractVersion=0);
internal sealed record SimFinalApproveRequest(string SourceToken, int ExpectedApprovalCount, SimFinalAnswers Answers);

internal sealed partial class SimRfqIntakeStore
{
    internal static SimFinalSummary WithQuickTurn(SimFinalSummary summary, SimFinalAnswers answers)
    {
        var input = answers.QuickTurn;
        if (input is null) return summary with {QuickTurn=null};
        if (input.Mode is not ("LABOR_PERCENT" or "ORDER_PERCENT" or "FLAT") || input.Value is null or < 0 ||
            input.Value > (input.Mode=="FLAT" ? 1000000000m : 10000m) ||
            decimal.Round(input.Value.Value, input.Mode=="FLAT" ? 2 : 6) != input.Value.Value)
            throw SimRfqIntakeProblem.BadRequest("QUICK_TURN", "Enter a nonnegative quick-turn percentage (up to six decimals) or flat amount (cents).");
        var basis = input.Mode=="LABOR_PERCENT" ? summary.LaborUnitSale * summary.Quantity : summary.PreRushTotal;
        if (basis is null) throw SimRfqIntakeProblem.Conflict("QUICK_TURN_BASIS", "Complete pricing before adding a quick-turn charge.");
        var amount = input.Mode=="FLAT" ? input.Value.Value : decimal.Round(basis.Value * input.Value.Value / 100m, 2, MidpointRounding.AwayFromZero);
        return summary with {QuickTurn=new(input.Mode,input.Value.Value,basis.Value,amount)};
    }
    internal static string LeadDisplay(int days) => days == 0 ? "Stock" : days < 7 ? days+" "+(days==1?"Day":"Days") : ((days+6)/7)+" "+((days+6)/7==1?"Week":"Weeks");
    private static string FinalSourceToken(SimRfqIntakeRecord record, SimRfqLanes lanes) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new {record.IntakeId, record.Status, record.Customer, record.Assemblies, record.TechnicalReview,
            lanes.Materials, lanes.Labor, lanes.MaterialsQuote, lanes.LaborQuote}))));
    private static SimFinalReviewView FinalReviewView(SimRfqIntakeRecord record, SimRfqLanes lanes)
    {
        var a = record.Assemblies.FirstOrDefault(); var qty = a?.Quantity ?? 0;
        var m = lanes.MaterialsQuote; var l = lanes.LaborQuote;
        var ms = m?.Versions.LastOrDefault(); var ls = l?.Versions.LastOrDefault();
        var inputs = record.TechnicalReview?.Workflow?.Outputs;
        bool Compatible(int v, string id) => inputs is not null && CompatibleCustomerBoms(record).Any(b => b.Version == v && b.CandidateId == id);
        var technical = record.LibraryRfq is not null || RfqEligible(record);
        var needsMaterials=record.LibraryRfq is null || record.DeLeonScope!="LABOR_ONLY";
        var needsLabor=record.LibraryRfq is null || record.DeLeonScope!="MATERIAL_ONLY";
        var package = !needsLabor || inputs?.Manufacturing.Package.Documents.Any(d => d.DocumentId == inputs.Manufacturing.GoverningDocumentId) == true;
        var materials = lanes.Materials.Status == "COMPLETE" && ms is not null && Compatible(m!.BomVersion, m.CandidateId) && ms.CandidateId == m.CandidateId && ms.BomVersion == m.BomVersion && ms.RfqQuantity == qty;
        var labor = lanes.Labor.Status == "COMPLETE" && ls is not null && l!.DefinitionId == inputs?.Manufacturing.Id &&
            ls.DefinitionId == l.DefinitionId && ls.Quantity == qty && l.Quantity == qty;
        var materialPrice = materials ? ms!.MaterialUnitSalePrice : null;
        decimal? laborPrice = labor ? ls!.Totals.UnitSalePrice : null;
        var combined = (needsMaterials?materialPrice:0m) + (needsLabor?laborPrice:0m);
        var nre = labor ? ls!.Charges?.Where(c => c.Kind == "NRE").ToArray() ?? [] : [];
        int? materialDays = materials ? ms!.Rows.Where(r => r.Required && !r.Quote.CustomerSupplied).Select(r => MaterialLeadDays(r.Quote)).DefaultIfEmpty().Max() : null;
        int? manufacturingDays = labor && ls!.ManufacturingLead is {Value: not null} lead ? lead.Value * (lead.Unit=="WEEKS"?7:1) : null;
        var materialIdentityCurrent = m is not null && Compatible(m.BomVersion, m.CandidateId);
        var supplied = materialIdentityCurrent ? m!.Rows.Where(r => r.CustomerSupplied).Select(r => {
            var source = inputs!.Materials.Candidate.Rows.Single(s => s.Index == r.Index);
            return new SimCustomerSuppliedMaterial(r.Index, source.Values.GetValueOrDefault("lineNumber") ?? "Not provided", CustomerNumber(source) is { Length: > 0 } customerNumber ? customerNumber : "Not provided");
        }).ToArray() : null;
        var flagCandidate=materials ? record.TechnicalReview?.BomAcceptances?.SingleOrDefault(b=>b.Candidate.Id==ms!.CandidateId&&b.Version==ms.BomVersion)?.Candidate
            ?? (inputs?.Materials.Candidate.Id==ms!.CandidateId?inputs.Materials.Candidate:null) : inputs?.Materials.Candidate;
        var partFlags=flagCandidate is null||m is null ? [] : MaterialPartFlagsForRows(materials?ms!.Rows.Select(r=>r.Quote):m.Rows,flagCandidate);
        var summary = new SimFinalSummary(record.IntakeId, record.Customer.CustomerName, a?.AssemblyNumber ?? "", a?.Revision ?? "", qty,
            record.TechnicalReview?.AssemblyType?.Replace('_',' '), null, materialPrice, laborPrice, combined, combined * qty,
            labor ? ls!.Totals.NreTotal ?? 0 : 0, nre,
            materialDays,
            manufacturingDays is int md ? LeadDisplay(md) : null, supplied is null ? null : supplied.Length > 0,
            package, technical, materials, labor, ms?.Version, ls?.Version, inputs?.Manufacturing.Id, ManufacturingLeadDays: manufacturingDays, SuggestedLeadDays: (needsMaterials?materialDays:0)+(needsLabor?manufacturingDays:0), CustomerSuppliedItems: supplied, MaterialSupplemental: materials ? ms!.SupplementalTotals : null, MaterialPartFlags:partFlags.Length>0?partFlags:null);
        var blockers = new List<string>();
        if(summary.MaterialPartFlags is {Length:>0})blockers.Add(SimQuotationPdf.PendingPartRequestsMessage);
        if(record.LibraryRfq is not null) blockers.Add("Customer quote composition is the next step. Materials and Labor can be completed independently.");
        if (!technical) blockers.Add("Complete Technical Review.");
        if (!package) blockers.Add("Confirm the governing technical package.");
        if (record.Assemblies.Length != 1 || qty <= 0) blockers.Add("A valid quantity for one assembly is required.");
        if (needsMaterials&&!materials) blockers.Add("Complete Materials for the current accepted BOM and quantity.");
        if (needsLabor&&!labor) blockers.Add("Complete Labor for the current manufacturing definition and quantity.");
        if (needsMaterials&&(materialPrice is null or < 0)) blockers.Add("Material Unit Sale is unavailable; complete Materials pricing.");
        if (needsLabor&&(laborPrice is null or < 0)) blockers.Add("Labor Unit Sale is unavailable; complete Labor pricing.");
        var token = FinalSourceToken(record, lanes); var approvals = lanes.FinalReviews ?? [];
        var current=approvals.LastOrDefault()?.SourceToken == token && blockers.Count == 0;
        // A hold pauses completion without changing the approved business version.
        blockers.AddRange(RfqSectionHoldBlockers(lanes));
        return new(current ? approvals.Last().Summary : summary, token, blockers.ToArray(), approvals, current, lanes.MaterialsHold, lanes.LaborHold);
    }
    private static SimFinalAnswers ValidateFinalAnswers(SimFinalAnswers? a)
    {
        if (a is null) throw SimRfqIntakeProblem.BadRequest("FINAL_ANSWERS", "Complete the review answers.");
        var errors = new List<string>();
        if (a.DeliveryValue is not null || a.DeliveryUnit is not null) {
            if (a.DeliveryValue is null or < 0 or > 36500 || a.DeliveryUnit is not ("DAYS" or "WEEKS")) errors.Add("Enter a whole Quoted Delivery value from 0 to 36500 and Days or Weeks.");
            else a = a with {Delivery=a.DeliveryValue+" "+(a.DeliveryUnit=="DAYS"?"Days":"Weeks")};
        }
        if (string.IsNullOrWhiteSpace(a.Delivery) || a.Delivery.Length > 200) errors.Add("Enter Quoted Delivery / Lead Time (up to 200 characters).");
        if ((a.RiskNotes?.Length ?? 0) > 2000 || (a.NewContractRequirements?.Length ?? 0) > 2000) errors.Add("Keep notes to 2000 characters each.");
        if (errors.Count > 0) throw SimRfqIntakeProblem.BadRequest("FINAL_ANSWERS", string.Join(" ",errors));
        return a with {Delivery=a.Delivery.Trim(),RiskNotes=(a.RiskNotes ?? "").Trim(),NewContractRequirements=(a.NewContractRequirements ?? "").Trim()};
    }
    internal async Task<SimFinalReviewView> ReadFinalReview(string id)
    {
        await gate.WaitAsync();
        try {
            var records=(await ReadDatasetAsync()).Records;
            var r = records.SingleOrDefault(r => r.IntakeId == id && r.Environment == "SIM") ?? await RequireRfqRecord(id);
            var lanes = (await ReadRfqLanes()).GetValueOrDefault(id) ?? new(new(),new());
            return FinalReviewView(r,lanes) with {CanEditMaterials=r.DeLeonScope!="LABOR_ONLY"&&QuotationEditBlocker(id,lanes.Commercial,records) is null,MaterialEditContractVersion=1,EstimatePartRoutes=await PartEstimateRoutes(r,lanes),PartRoutingContractVersion=2,QuoteCopiesContractVersion=r.LibraryRfq is null?0:1};
        } finally {gate.Release();}
    }
    internal async Task<SimFinalReviewView> ApproveFinalReview(string id, SimFinalApproveRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            var r=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id && r.Environment=="SIM") ?? await RequireRfqRecord(id);
            RequireCustomerQuoteDeliveryAvailable(r);
            var lanes=await ReadRfqLanes(); var current=lanes.GetValueOrDefault(id) ?? new(new(),new()); var view=FinalReviewView(r,current);
            if (request.SourceToken!=view.SourceToken || request.ExpectedApprovalCount!=view.Approvals.Length)
                throw SimRfqIntakeProblem.Conflict("FINAL_STALE","Source work or approval history changed. Reopen Final Review before approving.");
            if(view.Blockers.Length>0)throw SimRfqIntakeProblem.Conflict("FINAL_BLOCKED",string.Join(" ",view.Blockers));
            if(view.ApprovalCurrent)throw SimRfqIntakeProblem.Conflict("FINAL_APPROVED","This source version is already approved.");
            var answers=ValidateFinalAnswers(request.Answers);
            var approval=new SimFinalApproval(Guid.NewGuid().ToString("D"),view.Approvals.Length+1,view.SourceToken,WithQuickTurn(view.Summary,answers),answers,persona.DisplayName,persona.Id,DateTimeOffset.UtcNow);
            lanes[id]=current with {FinalReviews=view.Approvals.Append(approval).ToArray()};
            var temporary=RfqLanesPath+".write-"+Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            try {var text=JsonSerializer.Serialize(lanes,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("Review write verification failed.");File.Move(temporary,RfqLanesPath,true);}
            finally {if(File.Exists(temporary))File.Delete(temporary);}
            return FinalReviewView(r,lanes[id]);
        }finally{gate.Release();}
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapFinalReview(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        MapQuotationPdf(app,state,store,personas);
        app.MapGet("/api/sim/rfqs/{id}/final-review",async Task<IResult>(string id,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"rfq.readiness.view");if(denied is not null)return denied;
            try{return Results.Json(await store.ReadFinalReview(id));}catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
        });
        app.MapPost("/api/sim/rfqs/{id}/final-review/approve",async Task<IResult>(string id,SimFinalApproveRequest request,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.ApproveFinalReview(id,request,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Approval could not be saved. Your answers remain available; retry."},statusCode:503);}
        });
    }
}
