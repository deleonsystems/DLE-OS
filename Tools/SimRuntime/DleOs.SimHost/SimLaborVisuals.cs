using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimLaborVisual(string DocumentId, string IntakeId, string DefinitionId, string RowId,
    string Sequence, string Operation, string? ParentId, string Assembly, string Revision,
    string Name, string Type, long Size, string Sha256, string Reference, string AddedBy, DateTimeOffset AddedAt,
    string Caption = "", bool Removed = false, string? RemovedBy = null, DateTimeOffset? RemovedAt = null);
internal sealed record SimLaborVisualUpload(int ExpectedRevision, string DefinitionId, string RowId, string Sequence, string Operation, string? ParentId = null);

internal sealed partial class SimIntakeDocuments
{
    // Immutable upload journal: even an abandoned draft has an explicit RFQ/row owner.
    // Binaries are retained for completed versions and removal audit, never silently orphaned.
    internal async Task WriteLaborVisual(string draft, SimLaborVisual visual)
    {
        var path = FilePath(draft, visual.DocumentId, ".labor.json");
        try
        {
            var text = JsonSerializer.Serialize(visual, json);
            await File.WriteAllTextAsync(path, text);
            if (await File.ReadAllTextAsync(path) != text) throw new IOException("Labor visual metadata verification failed.");
        }
        catch { if (File.Exists(path)) File.Delete(path); throw; }
    }
    internal async Task<SimLaborVisual> ReadLaborVisual(string draft, string id)
    {
        var path = FilePath(draft, id, ".labor.json");
        if (!File.Exists(path)) throw SimRfqIntakeProblem.NotFound("LABOR_VISUAL_NOT_FOUND", "This Labor visual is unavailable.");
        return JsonSerializer.Deserialize<SimLaborVisual>(await File.ReadAllTextAsync(path), json) ?? throw new IOException("Invalid Labor visual metadata.");
    }
}

internal sealed partial class SimRfqIntakeStore
{
    private static bool VisualRowId(string? id) => !string.IsNullOrEmpty(id) && id.Length <= 80 && id.All(c => char.IsAsciiLetterOrDigit(c) || c == '-');
    internal async Task<SimLaborVisual> StageLaborVisual(string id, SimLaborVisualUpload request, string name, Stream input, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r))
                ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found.");
            var view = LaborView(RfqView(record, await ReadRfqLanes()));
            if (view.Plan.Revision != request.ExpectedRevision || view.Plan.DefinitionId != request.DefinitionId)
                throw SimRfqIntakeProblem.Conflict("LABOR_STALE", "Labor changed. Reopen Labor before attaching images.");
            if (!VisualRowId(request.RowId) || (request.ParentId is not null && (!VisualRowId(request.ParentId) || request.ParentId == request.RowId)) || string.IsNullOrWhiteSpace(request.Sequence) || request.Sequence.Length > 20 || !request.Sequence.All(c => char.IsAsciiDigit(c) || c == '.') || (request.Operation?.Length ?? 0) > 200)
                throw SimRfqIntakeProblem.BadRequest("LABOR_VISUAL_SCOPE", "Choose a valid Labor operation.");
            using var memory = new MemoryStream();
            var buffer = new byte[81920]; int read;
            while ((read = await input.ReadAsync(buffer)) > 0)
            {
                if (memory.Length + read > 8 * 1024 * 1024) throw SimRfqIntakeProblem.BadRequest("LABOR_VISUAL_SIZE", "Choose an image up to 8 MB.");
                memory.Write(buffer, 0, read);
            }
            var bytes = memory.ToArray();
            var type = bytes.AsSpan().StartsWith(new byte[] { 137,80,78,71,13,10,26,10 }) ? "image/png" : bytes.AsSpan().StartsWith(new byte[] { 255,216,255 }) ? "image/jpeg" : "";
            if (type == "") throw SimRfqIntakeProblem.BadRequest("LABOR_VISUAL_TYPE", "Paste or choose a PNG or JPEG image.");
            memory.Position = 0;
            var doc = await documents.Stage(record.RequestCorrelationId, name, 0, memory, persona.DisplayName);
            var a = record.Assemblies[0];
            var visual = new SimLaborVisual(doc.DocumentId!, id, view.Plan.DefinitionId, request.RowId, request.Sequence, request.Operation ?? "", request.ParentId,
                a.AssemblyNumber, a.Revision, doc.Name, type, bytes.Length, Convert.ToHexString(SHA256.HashData(bytes)), doc.DocumentReference!, persona.DisplayName, DateTimeOffset.UtcNow);
            try { await documents.WriteLaborVisual(record.RequestCorrelationId, visual); }
            catch { await documents.Remove(record.RequestCorrelationId, doc.DocumentId!, persona.DisplayName); throw; }
            return visual;
        }
        finally { gate.Release(); }
    }
    private async Task<SimLaborVisual> VerifiedLaborVisual(SimRfqIntakeRecord record, string documentId)
    {
        var visual = await documents.ReadLaborVisual(record.RequestCorrelationId, documentId);
        var bytes = await documents.Bytes(record.RequestCorrelationId, documentId);
        if (visual.IntakeId != record.IntakeId || visual.DocumentId != documentId || visual.Size != bytes.Length || visual.Sha256 != Convert.ToHexString(SHA256.HashData(bytes)))
            throw SimRfqIntakeProblem.Conflict("LABOR_VISUAL_REFERENCE", "The Labor visual reference failed verification.");
        return visual;
    }
    internal async Task<(SimLaborVisual Visual, byte[] Bytes)> OpenLaborVisual(string id, string documentId)
    {
        await gate.WaitAsync();
        try
        {
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id)
                ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_FOUND", "RFQ not found.");
            var visual = await VerifiedLaborVisual(record, documentId);
            return (visual, await documents.Bytes(record.RequestCorrelationId, documentId));
        }
        finally { gate.Release(); }
    }
    private async Task<(SimLaborOperation[] Operations, SimLaborVisual[]? Removed)> ValidateLaborVisuals(SimRfqIntakeRecord record, SimLaborPlan plan, SimLaborOperation[] operations, int contract, SimPersona persona)
    {
        var existing = plan.Operations.SelectMany(o => o.Visuals ?? []).ToArray();
        var incoming = operations.SelectMany(o => o.Visuals ?? []).ToArray();
        if ((existing.Length > 0 || incoming.Length > 0 || plan.RemovedVisuals?.Length > 0) && contract != 1)
            throw SimRfqIntakeProblem.Conflict("LABOR_VISUAL_CONTRACT", "Reload Labor before saving its visual references.");
        if (incoming.Length > 1000 || operations.Any(o => (o.Visuals?.Length ?? 0) > 50) || incoming.Any(v => v is null || (v.Caption?.Length ?? 0) > 500) || incoming.Select(v => v.DocumentId).Distinct().Count() != incoming.Length)
            throw SimRfqIntakeProblem.BadRequest("LABOR_VISUAL_VALUES", "Use unique visuals, up to 50 per operation and captions up to 500 characters.");
        var result = new List<SimLaborOperation>();
        var removed = (plan.RemovedVisuals ?? []).ToList();
        SimLaborVisual Remove(SimLaborVisual v) => v.Removed ? v : v with { Removed = true, RemovedBy = persona.DisplayName, RemovedAt = DateTimeOffset.UtcNow };
        foreach (var operation in operations)
        {
            var visuals = new List<SimLaborVisual>();
            foreach (var supplied in operation.Visuals ?? [])
            {
                var trusted = await VerifiedLaborVisual(record, supplied.DocumentId);
                if (trusted.RowId != operation.Id || trusted.DefinitionId != plan.DefinitionId || removed.Any(v => v.DocumentId == trusted.DocumentId))
                    throw SimRfqIntakeProblem.Conflict("LABOR_VISUAL_SCOPE", "Visuals must remain with their original Labor operation and definition.");
                var old = existing.SingleOrDefault(v => v.DocumentId == trusted.DocumentId);
                var value = trusted with { Caption = (supplied.Caption ?? "").Trim() };
                visuals.Add(old?.Removed == true ? old : supplied.Removed ? Remove(value) : value);
            }
            // Omitted references are retained as tombstones, including saves from stale clients.
            visuals.AddRange(existing.Where(v => v.RowId == operation.Id && !visuals.Any(n => n.DocumentId == v.DocumentId)).Select(Remove));
            result.Add(operation with { Visuals = visuals.Count == 0 ? null : visuals.ToArray() });
        }
        removed.AddRange(existing.Where(v => !operations.Any(o => o.Id == v.RowId)).Select(Remove));
        return (result.ToArray(), removed.Count == 0 ? null : removed.ToArray());
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapLaborVisuals(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/rfqs/{id}/labor/visuals", async Task<IResult> (string id, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition"); if (denied is not null) return denied;
            if (!context.Request.Headers.ContainsKey("X-SIM-Document-Upload") || !context.Request.HasFormContentType) return Results.BadRequest();
            try
            {
                if (context.Request.ContentLength > 9 * 1024 * 1024) return Results.StatusCode(413);
                var form = await context.Request.ReadFormAsync(new Microsoft.AspNetCore.Http.Features.FormOptions { MultipartBodyLengthLimit = 9 * 1024 * 1024, ValueLengthLimit = 4096 });
                if (form.Files.Count != 1 || form["metadata"].ToString().Length > 4096) return Results.BadRequest();
                var request = JsonSerializer.Deserialize<SimLaborVisualUpload>(form["metadata"].ToString(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                if (request is null) return Results.BadRequest();
                var file = form.Files[0]; await using var stream = file.OpenReadStream();
                return Results.Json(await store.StageLaborVisual(id, request, file.FileName, stream, personas.Resolve(context)));
            }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (JsonException) { return Results.BadRequest(new { message = "Invalid visual metadata." }); }
            catch (InvalidDataException) { return Results.BadRequest(new { message = "Choose one PNG or JPEG image up to 8 MB." }); }
            catch (IOException) { return Results.Json(new { message = "SIM could not stage this image. Retry the upload." }, statusCode: 503); }
        });
        app.MapGet("/api/sim/rfqs/{id}/labor/visuals/{documentId}", async Task<IResult> (string id, string documentId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view"); if (denied is not null) return denied;
            try
            {
                var result = await store.OpenLaborVisual(id, documentId);
                context.Response.Headers.CacheControl = "private, no-store";
                context.Response.Headers["X-Content-Type-Options"] = "nosniff";
                context.Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
                context.Response.Headers["Content-Disposition"] = new System.Net.Http.Headers.ContentDispositionHeaderValue("inline") { FileNameStar = result.Visual.Name }.ToString();
                return Results.File(result.Bytes, result.Visual.Type);
            }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "SIM visual storage is unavailable." }, statusCode: 503); }
        });
    }
}
