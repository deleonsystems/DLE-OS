using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimFinalAnswers(string Delivery, bool? Outsourced, bool? HighUnitCost, bool? CanMeetDelivery,
    string RiskSeverity, string RiskNotes, string Class, bool? Itar, string NewContractRequirements, int? DeliveryValue = null, string? DeliveryUnit = null);
internal sealed record SimCustomerSuppliedMaterial(int Index, string FindNo, string InternalPartNumber);
internal sealed record SimFinalSummary(string IntakeId, string Customer, string Assembly, string Revision, int Quantity,
    string? Description, string? QuoteDue, decimal? MaterialUnitSale, decimal? LaborUnitSale, decimal? CombinedUnitPrice,
    decimal? Total, decimal NreTotal, SimLaborCharge[] NreLines, int? MaterialLongestLeadDays, string? ManufacturingLead,
    bool? CustomerSuppliedMaterial, bool TechnicalPackageAvailable, bool TechnicalComplete, bool MaterialsComplete,
    bool LaborComplete, int? MaterialsVersion, int? LaborVersion, string? ManufacturingDefinitionId, string Currency = "USD", int? ManufacturingLeadDays = null, int? SuggestedLeadDays = null, SimCustomerSuppliedMaterial[]? CustomerSuppliedItems = null)
{
    public decimal? QuoteTotal => Total + NreTotal;
}
internal sealed record SimFinalApproval(string Id, int Version, string SourceToken, SimFinalSummary Summary,
    SimFinalAnswers Answers, string ApprovedBy, string ApprovedById, DateTimeOffset ApprovedAt, string ContractVersion = "QUOTATION_FINAL_REVIEW_V1");
internal sealed record SimFinalReviewView(SimFinalSummary Summary, string SourceToken, string[] Blockers, SimFinalApproval[] Approvals, bool ApprovalCurrent);
internal sealed record SimFinalApproveRequest(string SourceToken, int ExpectedApprovalCount, SimFinalAnswers Answers);

internal sealed partial class SimRfqIntakeStore
{
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
        var technical = RfqEligible(record);
        var package = inputs?.Manufacturing.Package.Documents.Any(d => d.DocumentId == inputs.Manufacturing.GoverningDocumentId) == true;
        var materials = lanes.Materials.Status == "COMPLETE" && ms is not null && m!.CandidateId == inputs?.Materials.Candidate.Id &&
            m.BomVersion == inputs?.Materials.Version && ms.CandidateId == m.CandidateId && ms.BomVersion == m.BomVersion && ms.RfqQuantity == qty;
        var labor = lanes.Labor.Status == "COMPLETE" && ls is not null && l!.DefinitionId == inputs?.Manufacturing.Id &&
            ls.DefinitionId == l.DefinitionId && ls.Quantity == qty && l.Quantity == qty;
        var materialPrice = materials ? ms!.MaterialUnitSalePrice : null;
        decimal? laborPrice = labor ? ls!.Totals.UnitSalePrice : null;
        var combined = materialPrice + laborPrice;
        var nre = labor ? ls!.Charges?.Where(c => c.Kind == "NRE").ToArray() ?? [] : [];
        int? materialDays = materials ? ms!.Rows.Where(r => r.Required && !r.Quote.CustomerSupplied).Select(r => MaterialLeadDays(r.Quote)).DefaultIfEmpty().Max() : null;
        int? manufacturingDays = labor && ls!.ManufacturingLead is {Value: not null} lead ? lead.Value * (lead.Unit=="WEEKS"?7:1) : null;
        var materialIdentityCurrent = m is not null && m.CandidateId == inputs?.Materials.Candidate.Id && m.BomVersion == inputs?.Materials.Version;
        var supplied = materialIdentityCurrent ? m!.Rows.Where(r => r.CustomerSupplied).Select(r => {
            var source = inputs!.Materials.Candidate.Rows.Single(s => s.Index == r.Index);
            return new SimCustomerSuppliedMaterial(r.Index, source.Values.GetValueOrDefault("lineNumber") ?? "Not provided", source.Values.GetValueOrDefault("partNumber") ?? "Not provided");
        }).ToArray() : null;
        var summary = new SimFinalSummary(record.IntakeId, record.Customer.CustomerName, a?.AssemblyNumber ?? "", a?.Revision ?? "", qty,
            record.TechnicalReview?.AssemblyType?.Replace('_',' '), null, materialPrice, laborPrice, combined, combined * qty,
            labor ? ls!.Totals.NreTotal ?? 0 : 0, nre,
            materialDays,
            manufacturingDays is int md ? LeadDisplay(md) : null, supplied is null ? null : supplied.Length > 0,
            package, technical, materials, labor, ms?.Version, ls?.Version, inputs?.Manufacturing.Id, ManufacturingLeadDays: manufacturingDays, SuggestedLeadDays: materialDays + manufacturingDays, CustomerSuppliedItems: supplied);
        var blockers = new List<string>();
        if (!technical) blockers.Add("Complete Technical Review.");
        if (!package) blockers.Add("Confirm the governing technical package.");
        if (record.Assemblies.Length != 1 || qty <= 0) blockers.Add("A valid quantity for one assembly is required.");
        if (!materials) blockers.Add("Complete Materials for the current accepted BOM and quantity.");
        if (!labor) blockers.Add("Complete Labor for the current manufacturing definition and quantity.");
        if (materialPrice is null or < 0) blockers.Add("Material Unit Sale is unavailable; complete Materials pricing.");
        if (laborPrice is null or < 0) blockers.Add("Labor Unit Sale is unavailable; complete Labor pricing.");
        var token = FinalSourceToken(record, lanes); var approvals = lanes.FinalReviews ?? [];
        return new(summary, token, blockers.ToArray(), approvals, approvals.LastOrDefault()?.SourceToken == token && blockers.Count == 0);
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
            var r = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && r.Environment == "SIM") ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_FOUND", "RFQ not found.");
            var lanes = (await ReadRfqLanes()).GetValueOrDefault(id) ?? new(new(),new());
            return FinalReviewView(r,lanes);
        } finally {gate.Release();}
    }
    internal async Task<SimFinalReviewView> ApproveFinalReview(string id, SimFinalApproveRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            var r=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id && r.Environment=="SIM") ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_FOUND","RFQ not found.");
            var lanes=await ReadRfqLanes(); var current=lanes.GetValueOrDefault(id) ?? new(new(),new()); var view=FinalReviewView(r,current);
            if (request.SourceToken!=view.SourceToken || request.ExpectedApprovalCount!=view.Approvals.Length)
                throw SimRfqIntakeProblem.Conflict("FINAL_STALE","Source work or approval history changed. Reopen Final Review before approving.");
            if(view.Blockers.Length>0)throw SimRfqIntakeProblem.Conflict("FINAL_BLOCKED",string.Join(" ",view.Blockers));
            if(view.ApprovalCurrent)throw SimRfqIntakeProblem.Conflict("FINAL_APPROVED","This source version is already approved.");
            var answers=ValidateFinalAnswers(request.Answers);
            var approval=new SimFinalApproval(Guid.NewGuid().ToString("D"),view.Approvals.Length+1,view.SourceToken,view.Summary,answers,persona.DisplayName,persona.Id,DateTimeOffset.UtcNow);
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
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
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
