using System.Text.Json;

internal sealed record SimRfqSectionHoldEvent(string RequestId, string Action, int Revision, string Reason,
    string ActorId, string Actor, DateTimeOffset AtUtc);
internal sealed record SimRfqSectionHold(int Revision = 0, bool Active = false, string? Reason = null,
    string? Actor = null, string? ActorId = null, DateTimeOffset? AtUtc = null, SimRfqSectionHoldEvent[]? History = null);
internal sealed record SimRfqSectionHoldRequest(string Action, int ExpectedRevision, string RequestId, string? Reason = null);

internal sealed partial class SimRfqIntakeStore
{
    private static SimRfqSectionHold? RfqSectionHold(SimRfqLanes lanes, string section) =>
        section == "materials" ? lanes.MaterialsHold : lanes.LaborHold;
    private static string RfqSectionName(string section) => section == "materials" ? "Materials" : "Labor";
    private static string[] RfqSectionHoldBlockers(SimRfqLanes lanes) =>
        new[] { "materials", "labor" }.Where(section => RfqSectionHold(lanes, section)?.Active == true)
            .Select(section => RfqSectionName(section) + " on hold: " + RfqSectionHold(lanes, section)!.Reason).ToArray();
    private static void RequireRfqSectionNotHeld(SimRfqLanes lanes, string section)
    {
        if (RfqSectionHold(lanes, section) is { Active: true } hold)
            throw SimRfqIntakeProblem.Conflict("RFQ_SECTION_HELD", RfqSectionName(section) + " is on hold: " + hold.Reason + ". Release Hold before completing.");
    }
    private static void RequireRfqSectionsNotHeld(SimRfqLanes lanes)
    {
        var blockers = RfqSectionHoldBlockers(lanes);
        if (blockers.Length > 0)
            throw SimRfqIntakeProblem.Conflict("RFQ_SECTION_HELD", string.Join("; ", blockers) + ". Release Hold before submitting the quotation.");
    }

    internal async Task<SimRfqWorkspace> TransitionRfqSectionHold(string id, string section,
        SimRfqSectionHoldRequest request, SimPersona persona)
    {
        if (!persona.Can("technical_review.disposition"))
            throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_DENIED", "Changing RFQ holds is not permitted.");
        if (section is not ("materials" or "labor"))
            throw SimRfqIntakeProblem.BadRequest("RFQ_HOLD_SECTION", "Choose Materials or Labor.");
        if (request.Action is not ("PLACE" or "RELEASE"))
            throw SimRfqIntakeProblem.BadRequest("RFQ_HOLD_ACTION", "Choose Place on Hold or Release Hold.");
        if (!Guid.TryParse(request.RequestId, out _) || request.ExpectedRevision < 0)
            throw SimRfqIntakeProblem.BadRequest("RFQ_HOLD_REQUEST", "Refresh the hold controls and try again.");
        var reason = request.Reason?.Trim() ?? "";
        if (request.Action == "PLACE" && (reason.Length == 0 || reason.Length > 500))
            throw SimRfqIntakeProblem.BadRequest("RFQ_HOLD_REASON", "Enter a hold reason from 1 to 500 characters.");
        if (request.Action == "RELEASE" && reason.Length > 0)
            throw SimRfqIntakeProblem.BadRequest("RFQ_HOLD_REASON", "Release Hold uses the recorded hold reason.");
        await gate.WaitAsync();
        try
        {
            var record = await RequireRfqRecord(id);
            RequireRequestedRfqDepartment(record,section);
            var lanes = await ReadRfqLanes();
            var current = lanes.GetValueOrDefault(id) ?? new(new(), new());
            var hold = RfqSectionHold(current, section) ?? new();
            var history = hold.History ?? [];
            var duplicate = history.SingleOrDefault(e => e.RequestId == request.RequestId);
            var otherHold = RfqSectionHold(current, section == "materials" ? "labor" : "materials");
            if ((otherHold?.History ?? []).Any(e => e.RequestId == request.RequestId))
                throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_REQUEST_REUSED", "This request belongs to another hold action.");
            if (duplicate is not null)
            {
                if (duplicate.Action != request.Action || duplicate.Revision != request.ExpectedRevision + 1 ||
                    duplicate.ActorId != persona.Id || (request.Action == "PLACE" && duplicate.Reason != reason))
                    throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_REQUEST_REUSED", "This request belongs to another hold action.");
                return RfqView(record, lanes);
            }
            if (hold.Revision != request.ExpectedRevision)
                throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_STALE", RfqSectionName(section) + " hold changed. Refresh before continuing.");
            if (request.Action == "PLACE" && hold.Active)
                throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_ACTIVE", RfqSectionName(section) + " is already on hold.");
            if (request.Action == "RELEASE" && !hold.Active)
                throw SimRfqIntakeProblem.Conflict("RFQ_HOLD_INACTIVE", RfqSectionName(section) + " is not on hold.");
            var now = DateTimeOffset.UtcNow;
            var entry = new SimRfqSectionHoldEvent(request.RequestId, request.Action, hold.Revision + 1,
                request.Action == "PLACE" ? reason : hold.Reason!, persona.Id, persona.DisplayName, now);
            var next = new SimRfqSectionHold(hold.Revision + 1, request.Action == "PLACE",
                request.Action == "PLACE" ? reason : null, persona.DisplayName, persona.Id, now, history.Append(entry).ToArray());
            // Keep quotation progress, plan revisions and saved approvals independent from the hold.
            lanes[id] = section == "materials" ? current with { MaterialsHold = next } : current with { LaborHold = next };
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            var temporary = RfqLanesPath + ".write-" + Guid.NewGuid().ToString("N");
            try
            {
                var text = JsonSerializer.Serialize(lanes, jsonOptions);
                await File.WriteAllTextAsync(temporary, text);
                if (await File.ReadAllTextAsync(temporary) != text) throw new IOException("RFQ hold write verification failed.");
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
    private static void MapRfqSectionHolds(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/rfqs/{id}/holds/{section}", async Task<IResult> (string id, string section, SimRfqSectionHoldRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.TransitionRfqSectionHold(id, section, request, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "Hold could not be saved. Retry the same request." }, statusCode: 503); }
        });
    }
}
