using System.Text.Json;

internal sealed record SimRfqLane(string Status = "NOT_STARTED", string? UpdatedBy = null, DateTimeOffset? UpdatedAtUtc = null);
internal sealed record SimRfqLanes(SimRfqLane Materials, SimRfqLane Labor,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialPlan? MaterialsQuote = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimLaborPlan? LaborQuote = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimFinalApproval[]? FinalReviews = null);
internal sealed record SimRfqLaneRequest(string Status);
internal sealed record SimRfqWorkspace(string IntakeId, SimRfqIntakeCustomer Customer, SimRfqIntakeAssembly[] Assemblies,
    string Scope, SimRfqLanes Lanes, string Status, SimQuotationInputs Inputs, string? AssemblyType = null);

internal sealed partial class SimRfqIntakeStore
{
    private string RfqLanesPath => Path.Combine(Path.GetDirectoryName(dataPath)!, "rfq-lanes.json");
    private static bool RfqEligible(SimRfqIntakeRecord r) => r.Environment == "SIM" && r.IntakeType == "NEW_QUOTE_REQUEST" &&
        r.Status == "READY_FOR_RFQ_WORKING_QUEUE" && r.TechnicalReview?.Workflow?.Outputs is
        { Status: "READY", MaterialsTarget: "QUOTATION_MATERIALS", ManufacturingTarget: "QUOTATION_LABOR",
          Materials.Candidate: not null, Manufacturing: { NothingMissing: true } };
    private static SimRfqWorkspace RfqView(SimRfqIntakeRecord r, Dictionary<string, SimRfqLanes> lanes)
    {
        var value = lanes.GetValueOrDefault(r.IntakeId) ?? new(new(), new());
        var status = value.FinalReviews?.Length > 0 && FinalReviewView(r, value).ApprovalCurrent ? "QUOTE_APPROVED" : value.Materials.Status == "COMPLETE" && value.Labor.Status == "COMPLETE" ? "READY_FOR_QUOTE_ASSEMBLY" :
            value.Materials.Status == "NOT_STARTED" && value.Labor.Status == "NOT_STARTED" ? "READY_TO_WORK" : "IN_PROGRESS";
        return new(r.IntakeId, r.Customer, r.Assemblies, r.DeLeonScope, value, status, r.TechnicalReview!.Workflow!.Outputs!, r.TechnicalReview.AssemblyType);
    }
    private async Task<Dictionary<string, SimRfqLanes>> ReadRfqLanes() => !File.Exists(RfqLanesPath) ? new() :
        JsonSerializer.Deserialize<Dictionary<string, SimRfqLanes>>(await File.ReadAllTextAsync(RfqLanesPath), jsonOptions)
        ?? throw new IOException("RFQ lane state is unreadable.");
    internal async Task<SimRfqWorkspace[]> ReadRfqs()
    {
        await gate.WaitAsync();
        try { var lanes = await ReadRfqLanes(); return (await ReadDatasetAsync()).Records.Where(RfqEligible).Select(r => RfqView(r, lanes)).ToArray(); }
        finally { gate.Release(); }
    }
    internal Task<SimRfqWorkspace> SaveRfqLane(string id, string lane, string status, SimPersona persona) =>
        Task.FromException<SimRfqWorkspace>(SimRfqIntakeProblem.Conflict("QUOTATION_WORKSPACE_REQUIRED", "Save and complete each quotation in its dedicated workspace."));
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapRfqs(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        MapMaterials(app, state, store, personas);
        MapLabor(app, state, store, personas);
        MapFinalReview(app, state, store, personas);
        app.MapGet("/api/sim/rfqs", async Task<IResult> (HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view");
            if (denied is not null) return denied;
            return Results.Json(new { items = await store.ReadRfqs() });
        });
        app.MapPut("/api/sim/rfqs/{id}/lanes/{lane}", async Task<IResult> (string id, string lane, SimRfqLaneRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.SaveRfqLane(id, lane, request.Status, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "RFQ status could not be saved. Refresh and retry." }, statusCode: 503); }
        });
    }
}
