using System.Text.Json;

internal sealed record SimRfqLane(string Status = "NOT_STARTED", string? UpdatedBy = null, DateTimeOffset? UpdatedAtUtc = null);
internal sealed record SimRfqLanes(SimRfqLane Materials, SimRfqLane Labor,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialPlan? MaterialsQuote = null);
internal sealed record SimRfqLaneRequest(string Status);
internal sealed record SimRfqWorkspace(string IntakeId, SimRfqIntakeCustomer Customer, SimRfqIntakeAssembly[] Assemblies,
    string Scope, SimRfqLanes Lanes, string Status, SimQuotationInputs Inputs);

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
        var status = value.Materials.Status == "COMPLETE" && value.Labor.Status == "COMPLETE" ? "READY_FOR_QUOTE_ASSEMBLY" :
            value.Materials.Status == "NOT_STARTED" && value.Labor.Status == "NOT_STARTED" ? "READY_TO_WORK" : "IN_PROGRESS";
        return new(r.IntakeId, r.Customer, r.Assemblies, r.DeLeonScope, value, status, r.TechnicalReview!.Workflow!.Outputs!);
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
    internal async Task<SimRfqWorkspace> SaveRfqLane(string id, string lane, string status, SimPersona persona)
    {
        if (lane is not ("materials" or "labor") || status is not ("NOT_STARTED" or "IN_PROGRESS" or "COMPLETE"))
            throw SimRfqIntakeProblem.Conflict("RFQ_LANE_INVALID", "Choose a valid lane and work status.");
        if (lane == "materials") throw SimRfqIntakeProblem.Conflict("MATERIALS_WORKBENCH_REQUIRED", "Save and complete Materials in the Materials workbench.");
        await gate.WaitAsync();
        try
        {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r))
                ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Completed Technical Review inputs are required.");
            var lanes = await ReadRfqLanes();
            var current = lanes.GetValueOrDefault(id) ?? new(new(), new());
            var next = new SimRfqLane(status, persona.DisplayName, DateTimeOffset.UtcNow);
            lanes[id] = lane == "materials" ? current with { Materials = next } : current with { Labor = next };
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            var temporary = RfqLanesPath + ".write-" + Guid.NewGuid().ToString("N");
            try
            {
                var text = JsonSerializer.Serialize(lanes, jsonOptions);
                await File.WriteAllTextAsync(temporary, text);
                if (await File.ReadAllTextAsync(temporary) != text) throw new IOException("RFQ lane write verification failed.");
                File.Move(temporary, RfqLanesPath, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return RfqView(record, lanes);
        }
        finally { gate.Release(); }
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapRfqs(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        MapMaterials(app, state, store, personas);
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
