using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimCustomerIdentityEvidence(string DocumentId, string Sha256, string Location, string QuotedNumber);
internal sealed record SimCustomerIdentity(string PartNumber, SimCustomerIdentityEvidence[] Evidence, string ReviewedBy, DateTimeOffset ReviewedAtUtc);
internal sealed record SimCustomerIdentityChange(int Index, string RowId, string SourcePartNumber, string CustomerPartNumber, SimCustomerIdentityEvidence[] Evidence);
internal sealed record SimCustomerIdentityAmendment(string Id, int BaseVersion, string BaseCandidateId, string BaseHash, string Reason,
    SimCustomerIdentityChange[] Changes, string CreatedBy, DateTimeOffset CreatedAtUtc, int? AcceptedVersion = null, string? AcceptedBy = null, DateTimeOffset? AcceptedAtUtc = null);
internal sealed record SimCustomerIdentityRequest(string ExpectedToken, string Reason, SimCustomerIdentityChange[] Changes);
internal sealed record SimCustomerIdentityAcceptRequest(string ExpectedToken, string DraftId, bool MappingsReviewed, bool QuotationWorkSaved);
internal sealed record SimCustomerIdentitySource(string DocumentId, string Name, string Sha256);
internal sealed record SimCustomerIdentityView(string Token, SimBomAcceptance Accepted, SimCustomerIdentityAmendment[] History, SimCustomerIdentitySource[] Sources, bool CanAmend);
internal sealed record SimCompatibleBom(int Version, string CandidateId);

internal sealed partial class SimRfqIntakeStore
{
    private static string IdentityHash(object value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    private static string IdentityToken(SimRfqIntakeRecord record, SimRfqLanes lanes) => IdentityHash(new { record, lanes });
    internal static string CustomerNumber(SimCandidateRow row) => row.CustomerIdentity?.PartNumber ??
        (SimCandidateBomProvider.HasCustomerIdentity(row) ? row.PrimaryIdentity!.PartNumber! : "");
    private static bool SameExceptCustomerIdentity(SimCandidateBom a, SimCandidateBom b) =>
        IdentityHash(a with { Id = "", Rows = a.Rows.Select(r => r with { CustomerIdentity = null }).ToArray() }) ==
        IdentityHash(b with { Id = "", Rows = b.Rows.Select(r => r with { CustomerIdentity = null }).ToArray() });

    // Commercial records and evidence owners retain their original BOM identity. Only a verified,
    // explicitly accepted customer-only lineage may use those records against the newer display BOM.
    internal static SimCompatibleBom[] CompatibleCustomerBoms(SimRfqIntakeRecord record)
    {
        var review = record.TechnicalReview!; var current = review.Workflow!.Outputs!.Materials;
        var result = new List<SimCompatibleBom> { new(current.Version, current.Candidate.Id) };
        while (true) {
            var amendment = review.CustomerIdentityAmendments?.SingleOrDefault(a => a.AcceptedVersion == current.Version);
            if (amendment is null) break;
            var prior = review.BomAcceptances?.SingleOrDefault(a => a.Version == amendment.BaseVersion && a.Candidate.Id == amendment.BaseCandidateId);
            if (prior is null || amendment.BaseHash != IdentityHash(prior) || !SameExceptCustomerIdentity(prior.Candidate, current.Candidate)) break;
            result.Add(new(prior.Version, prior.Candidate.Id)); current = prior;
        }
        return result.ToArray();
    }
    internal static bool CompatibleMaterialSource(SimRfqWorkspace rfq, int version, string candidateId) =>
        rfq.Inputs.Materials.Version == version && rfq.Inputs.Materials.Candidate.Id == candidateId ||
        rfq.CompatibleCustomerBoms?.Any(b => b.Version == version && b.CandidateId == candidateId) == true;
    private static bool CanAmendCustomerIdentity(SimRfqIntakeRecord record, SimRfqLanes lanes) =>
        RfqEligible(record) && (lanes.FinalReviews?.Length ?? 0) == 0;
    private static void IdentityPermission(SimPersona persona, bool write)
    {
        if (!persona.Can(write ? "technical_review.disposition" : "technical_review.view"))
            throw SimRfqIntakeProblem.Conflict("CUSTOMER_IDENTITY_DENIED", "Technical Review permission is required.");
    }
    private async Task<SimCustomerIdentitySource[]> IdentitySources(SimRfqIntakeRecord record)
    {
        var sources = new List<SimCustomerIdentitySource>();
        foreach (var file in record.TechnicalFiles.Where(f => f.DocumentId is not null && f.BinaryStatus == "VERIFIED")) {
            await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
            sources.Add(new(file.DocumentId!, file.Name, Convert.ToHexString(SHA256.HashData(await documents.Bytes(record.RequestCorrelationId, file.DocumentId!))).ToLowerInvariant()));
        }
        return sources.ToArray();
    }
    private async Task<SimCustomerIdentityView> IdentityView(SimRfqIntakeRecord record, SimRfqLanes lanes, SimPersona persona) =>
        new(IdentityToken(record, lanes), record.TechnicalReview!.Workflow!.Outputs!.Materials,
            record.TechnicalReview.CustomerIdentityAmendments ?? [], await IdentitySources(record),
            persona.Can("technical_review.disposition") && CanAmendCustomerIdentity(record, lanes));
    internal async Task<SimCustomerIdentityView> ReadCustomerIdentity(string id, SimPersona persona)
    {
        IdentityPermission(persona, false); await gate.WaitAsync();
        try {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r))
                ?? throw SimRfqIntakeProblem.NotFound("CUSTOMER_IDENTITY_SCOPE", "A released quotation BOM is required.");
            var lanes = (await ReadRfqLanes()).GetValueOrDefault(id) ?? new(new(), new());
            return await IdentityView(record, lanes, persona);
        } finally { gate.Release(); }
    }
    private static void ValidateIdentityChanges(SimBomAcceptance accepted, SimCustomerIdentityChange[] changes, SimCustomerIdentitySource[] sources)
    {
        if (changes is null || changes.Length == 0 || changes.Length > accepted.Candidate.Rows.Length || changes.Select(c => c?.Index).Distinct().Count() != changes.Length)
            throw SimRfqIntakeProblem.BadRequest("CUSTOMER_IDENTITY_VALUES", "Choose unique BOM rows and supply their customer numbers and source evidence.");
        foreach (var change in changes) {
            var row = change is null ? null : accepted.Candidate.Rows.SingleOrDefault(r => r.Index == change.Index && r.RowId == change.RowId && r.Values.GetValueOrDefault("partNumber") == change.SourcePartNumber);
            if (row is null || string.IsNullOrWhiteSpace(change!.RowId) || string.IsNullOrWhiteSpace(change.CustomerPartNumber) || change.CustomerPartNumber.Length > 200 || change.CustomerPartNumber != change.CustomerPartNumber.Trim() || change.CustomerPartNumber == CustomerNumber(row) || change.Evidence is null || change.Evidence.Length is < 1 or > 10)
                throw SimRfqIntakeProblem.BadRequest("CUSTOMER_IDENTITY_VALUES", "Each changed row needs an unambiguous new customer number and source evidence.");
            foreach (var evidence in change.Evidence)
                if (evidence is null || evidence.QuotedNumber != change.CustomerPartNumber || string.IsNullOrWhiteSpace(evidence.Location) || evidence.Location.Length > 500 || !sources.Any(s => s.DocumentId == evidence.DocumentId && s.Sha256 == evidence.Sha256))
                    throw SimRfqIntakeProblem.BadRequest("CUSTOMER_IDENTITY_EVIDENCE", "Evidence must identify a current verified source, its location, and the exact customer number. Resolve conflicting numbers before saving.");
        }
    }
    internal async Task<SimCustomerIdentityView> SaveCustomerIdentity(string id, SimCustomerIdentityRequest? request, SimCustomerIdentityAcceptRequest? accept, SimPersona persona)
    {
        IdentityPermission(persona, true); await gate.WaitAsync();
        try {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == id && RfqEligible(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("CUSTOMER_IDENTITY_SCOPE", "A released quotation BOM is required.");
            var record = dataset.Records[index]; var review = record.TechnicalReview!;
            var lanes = (await ReadRfqLanes()).GetValueOrDefault(id) ?? new(new(), new());
            if (!CanAmendCustomerIdentity(record, lanes)) throw SimRfqIntakeProblem.Conflict("CUSTOMER_IDENTITY_CLOSED", "An approved quotation requires a separate quotation revision; customer-only amendments are unavailable.");
            if ((request?.ExpectedToken ?? accept?.ExpectedToken) != IdentityToken(record, lanes))
                throw SimRfqIntakeProblem.Conflict("CUSTOMER_IDENTITY_STALE", "The BOM, amendment, or quotation work changed. Reload this amendment and review again; your draft has not been applied.");
            var current = review.Workflow!.Outputs!.Materials; var history = review.CustomerIdentityAmendments ?? [];
            var sources = await IdentitySources(record); var now = DateTimeOffset.UtcNow;
            if (request is not null && accept is null) {
                if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length > 1000) throw SimRfqIntakeProblem.BadRequest("CUSTOMER_IDENTITY_REASON", "Explain the customer-number correction.");
                ValidateIdentityChanges(current, request.Changes, sources);
                var draft = new SimCustomerIdentityAmendment(Guid.NewGuid().ToString(), current.Version, current.Candidate.Id, IdentityHash(current), request.Reason.Trim(), request.Changes, persona.DisplayName, now);
                review = review with { CustomerIdentityAmendments = history.Append(draft).ToArray() };
            } else {
                if (accept is null || !accept.MappingsReviewed || !accept.QuotationWorkSaved) throw SimRfqIntakeProblem.BadRequest("CUSTOMER_IDENTITY_REVIEW", "Review the mappings and confirm all quotation editors have saved their work before accepting.");
                var draft = history.LastOrDefault();
                if (draft is null || draft.Id != accept.DraftId || draft.AcceptedVersion is not null || draft.BaseVersion != current.Version || draft.BaseCandidateId != current.Candidate.Id || draft.BaseHash != IdentityHash(current))
                    throw SimRfqIntakeProblem.Conflict("CUSTOMER_IDENTITY_STALE", "This is not the current unaccepted amendment.");
                ValidateIdentityChanges(current, draft.Changes, sources);
                var candidate = current.Candidate with { Id = Guid.NewGuid().ToString(), Rows = current.Candidate.Rows.Select(row => {
                    var change = draft.Changes.SingleOrDefault(c => c.Index == row.Index);
                    return change is null ? row : row with { CustomerIdentity = new(change.CustomerPartNumber, change.Evidence, persona.DisplayName, now) };
                }).ToArray() };
                if (!SameExceptCustomerIdentity(current.Candidate, candidate)) throw new InvalidOperationException("Non-identity amendment rejected.");
                var next = new SimBomAcceptance((review.BomAcceptances ?? []).Max(a => a.Version) + 1, candidate, current.Package, persona.DisplayName, now);
                review = review with { CandidateBom = candidate, BomAcceptances = (review.BomAcceptances ?? []).Append(next).ToArray(),
                    CustomerIdentityAmendments = history.Select(d => d.Id == draft.Id ? d with { AcceptedVersion = next.Version, AcceptedBy = persona.DisplayName, AcceptedAtUtc = now } : d).ToArray(),
                    Workflow = review.Workflow with { Outputs = review.Workflow.Outputs with { Materials = next } } };
            }
            record = record with { TechnicalReview = review }; dataset.Records[index] = record; dataset.UpdatedAtUtc = now;
            // One atomic intake write. No lane records, completed snapshots, or evidence files are migrated.
            await WriteVerifiedAsync(dataset);
            return await IdentityView(record, lanes, persona);
        } finally { gate.Release(); }
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapCustomerIdentityAmendments(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/technical-reviews/{id}/customer-identities", async Task<IResult>(string id, HttpContext context) => {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view"); if (denied is not null) return denied;
            try { return Results.Json(await store.ReadCustomerIdentity(id, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode:p.StatusCode); }
        });
        app.MapPost("/api/sim/technical-reviews/{id}/customer-identities", async Task<IResult>(string id, SimCustomerIdentityRequest request, HttpContext context) => {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition"); if (denied is not null) return denied;
            try { return Results.Json(await store.SaveCustomerIdentity(id, request, null, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode:p.StatusCode); }
        });
        app.MapPost("/api/sim/technical-reviews/{id}/customer-identities/accept", async Task<IResult>(string id, SimCustomerIdentityAcceptRequest request, HttpContext context) => {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition"); if (denied is not null) return denied;
            try { return Results.Json(await store.SaveCustomerIdentity(id, null, request, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode:p.StatusCode); }
        });
    }
}
