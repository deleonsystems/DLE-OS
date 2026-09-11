using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimCandidateCorrection(string Field, string Previous, string Value, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimCandidateAlternateAudit(string Action, string? Previous, string? Value,
    string ReviewStatus, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimCandidateAlternate(string Id, string? OriginalPartNumber, string PartNumber,
    string Origin, string ReviewStatus, string Uncertainty, DleAnalysisEvidence? SourceEvidence,
    string? SourceContext, DleAnalysisEvidence? SupportingEvidence, DleAnalysisEvidence? ApprovalEvidence,
    SimCandidateAlternateAudit[] History, DateTimeOffset? RemovedAtUtc = null);
internal sealed record SimCandidateAlternateChange(string Action, string? Id, string? PartNumber,
    string? ReviewStatus, int ExpectedRevision);
internal sealed record SimCandidateComponentChange(string ComponentType, int ExpectedRevision);
internal sealed record SimCandidateRow(int Index, Dictionary<string,string> Extracted, Dictionary<string,string> Values,
    double[] Bounds, Dictionary<string,string> Comparison, bool Confirmed, string? Reviewer, DateTimeOffset? ReviewedAtUtc,
    SimCandidateCorrection[] Corrections, string? RowId = null, Dictionary<string, DleAnalysisField>? AnalysisFields = null,
    SimCandidateAlternate[]? Alternates = null, int AlternateRevision = 0,
    string ComponentType = "STANDARD_COTS", int ComponentTypeRevision = 0);
internal sealed record SimCandidateBom(string Id, string Label, string GoverningDocumentId, string GoverningSha256,
    int Page, string Parser, bool Synthetic, DateTimeOffset ExtractedAtUtc, string RequestedBy,
    string[] SupportingDocumentIds, string SupportingComparison, SimCandidateRow[] Rows, DleCandidateAnalysis? Analysis = null,
    string ContractVersion = "DLE_CANDIDATE_BOM_V1");
internal sealed record SimCandidateReviewRequest(string CandidateId, int RowIndex, Dictionary<string,string>? Values,
    SimCandidateAlternateChange? AlternateChange = null, SimCandidateComponentChange? ComponentChange = null);

internal static class SimCandidateBomProvider
{
    internal const string ContractVersion = "DLE_CANDIDATE_BOM_V3";
    internal static readonly string[] Fields = ["lineNumber", "partNumber", "quantity", "designators", "description"];
    private sealed record ParsedRow(string[] Values, double[] Bounds);
    private sealed record Parsed(string Parser, ParsedRow[] Rows);

    internal static async Task<SimCandidateBom> Extract(byte[] bytes, SimTechnicalPackage package, SimPersona persona)
    {
        // Local SIM adapter only. Deployments may explicitly configure another pdfplumber runtime.
        var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(
            Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cache", "codex-runtimes",
            "codex-primary-runtime", "dependencies", "python", "python.exe");
        if (!File.Exists(python)) throw Unavailable();
        var start = new ProcessStartInfo(python) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-I");
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "sim_candidate_bom.py"));
        using var process = new Process { StartInfo = start };
        var started = false;
        try
        {
            process.Start();
            started = true;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.BaseStream.WriteAsync(bytes, timeout.Token);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            var text = await output;
            await errors;
            if (process.ExitCode != 0) throw Unavailable();
            var parsed = JsonSerializer.Deserialize<Parsed>(text, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (parsed is null || parsed.Rows.Length is < 5 or > 10 || parsed.Rows.Any(r => r.Values.Length != 5 || r.Bounds.Length != 4)) throw Unavailable();
            var rows = parsed.Rows.Select((r, i) => {
                var values = Fields.Zip(r.Values).ToDictionary(p => p.First, p => p.Second);
                return new SimCandidateRow(i, values, new(values), r.Bounds,
                    Fields.ToDictionary(f => f, _ => "UNCERTAIN"), false, null, null, []);
            }).ToArray();
            return new(Guid.NewGuid().ToString("D"), "Candidate BOM — Pilot", package.GoverningBomDocumentId!,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), 2, parsed.Parser, false,
                DateTimeOffset.UtcNow, persona.DisplayName,
                package.Documents.Where(d => d.Role == "SUPPORTING" && d.DocumentType == "BOM").Select(d => d.DocumentId).ToArray(),
                "UNAVAILABLE: Supporting spreadsheet comparison is not implemented; legacy XLS reader unavailable. No matches or differences have been asserted.", rows, ContractVersion: ContractVersion);
        }
        catch (Exception e) when (e is OperationCanceledException or IOException or System.ComponentModel.Win32Exception or JsonException)
        {
            if (started && !process.HasExited) process.Kill(entireProcessTree: true);
            throw Unavailable();
        }
    }

    internal static SimCandidateBom Review(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona persona)
    {
        if (request.CandidateId != bom.Id || request.RowIndex < 0 || request.RowIndex >= bom.Rows.Length)
            throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_STALE", "Reopen the current candidate before reviewing it.");
        if (request.ComponentChange is not null)
        {
            var change = request.ComponentChange;
            var original = bom.Rows[request.RowIndex];
            if (change.ComponentType is not ("STANDARD_COTS" or "SUBASSEMBLY" or "REFERENCE_ONLY" or "OTHER") || request.AlternateChange is not null)
                throw SimRfqIntakeProblem.BadRequest("SIM_COMPONENT_TYPE_INVALID", "Select one of the four supported component types.");
            if (change.ExpectedRevision != original.ComponentTypeRevision)
                throw SimRfqIntakeProblem.Conflict("SIM_COMPONENT_TYPE_STALE", "Component Type changed. Reopen the candidate before saving.");
            if (original.ComponentType == change.ComponentType) return bom;
            var updatedRows = bom.Rows.ToArray();
            updatedRows[request.RowIndex] = original with { ComponentType = change.ComponentType,
                ComponentTypeRevision = original.ComponentTypeRevision + 1,
                Corrections = original.Corrections.Append(new("componentType", original.ComponentType ?? "STANDARD_COTS",
                    change.ComponentType, persona.DisplayName, DateTimeOffset.UtcNow)).ToArray() };
            return bom with { Rows = updatedRows, ContractVersion = ContractVersion };
        }
        if (request.AlternateChange is not null) return ReviewAlternate(bom, request, persona);
        if (request.Values is null || request.Values.Count != 5 || Fields.Any(f => !request.Values.TryGetValue(f, out var value) || value is null || value.Length > 2000) ||
            !int.TryParse(request.Values["lineNumber"], out var line) || line < 1 ||
            !decimal.TryParse(request.Values["quantity"], System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var quantity) || quantity <= 0 ||
            string.IsNullOrWhiteSpace(request.Values["partNumber"]))
            throw SimRfqIntakeProblem.BadRequest("SIM_CANDIDATE_VALUES_INVALID", "Provide a positive line number and quantity, a part number, and the five candidate fields.");
        var row = bom.Rows[request.RowIndex];
        var now = DateTimeOffset.UtcNow;
        var corrections = row.Corrections.Concat(Fields.Where(f => row.Values[f] != request.Values[f])
            .Select(f => new SimCandidateCorrection(f, row.Values[f], request.Values[f], persona.DisplayName, now))).ToArray();
        var rows = bom.Rows.ToArray();
        rows[request.RowIndex] = row with { Values = new(request.Values), Confirmed = true, Reviewer = persona.DisplayName, ReviewedAtUtc = now, Corrections = corrections };
        return bom with { Rows = rows };
    }
    private static SimCandidateBom ReviewAlternate(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona persona)
    {
        var change = request.AlternateChange!;
        var row = bom.Rows[request.RowIndex];
        if (change.ExpectedRevision != row.AlternateRevision)
            throw SimRfqIntakeProblem.Conflict("SIM_ALTERNATE_STALE", "Alternates changed. Reopen this review before saving.");
        var alternates = (row.Alternates ?? []).ToList();
        var index = alternates.FindIndex(a => a.Id == change.Id && a.RemovedAtUtc is null);
        var number = change.PartNumber?.Trim();
        var status = change.ReviewStatus ?? "NEEDS_REVIEW";
        if (change.Action is not ("ADD" or "EDIT" or "REMOVE") ||
            (change.Action != "ADD" && index < 0) || (change.Action == "ADD" && change.Id is not null) ||
            (change.Action != "REMOVE" && (string.IsNullOrWhiteSpace(number) || number.Length > 200 ||
                status is not ("NEEDS_REVIEW" or "CONFIRMED" or "UNCERTAIN"))) ||
            (change.Action == "ADD" && alternates.Count >= 100))
            throw SimRfqIntakeProblem.BadRequest("SIM_ALTERNATE_INVALID", "Provide an alternate part number and a valid review state. This pilot allows 100 alternate history entries per row.");
        var now = DateTimeOffset.UtcNow;
        if (change.Action == "ADD")
        {
            // The reviewer supplies a number, never extraction provenance or engineering approval.
            alternates.Add(new(Guid.NewGuid().ToString("D"), null, number!, "MANUAL", "NEEDS_REVIEW", "",
                null, null, null, null, [new("ADDED", null, number, "NEEDS_REVIEW", persona.DisplayName, now)]));
        }
        else
        {
            var original = alternates[index];
            var removed = change.Action == "REMOVE";
            alternates[index] = original with {
                PartNumber = removed ? original.PartNumber : number!,
                ReviewStatus = removed ? original.ReviewStatus : status,
                RemovedAtUtc = removed ? now : null,
                History = original.History.Append(new(removed ? "REMOVED" : "EDITED", original.PartNumber,
                    removed ? null : number, removed ? original.ReviewStatus : status, persona.DisplayName, now)).ToArray()
            };
        }
        var rows = bom.Rows.ToArray();
        rows[request.RowIndex] = row with { Alternates = alternates.ToArray(), AlternateRevision = row.AlternateRevision + 1 };
        return bom with { Rows = rows, ContractVersion = ContractVersion };
    }
    private static SimRfqIntakeProblem Unavailable() => SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_EXTRACTION_UNAVAILABLE",
        "Candidate extraction unavailable: this pilot requires a local Python/pdfplumber runtime and one readable five-column BOM table on PDF page 2. Nothing was reconstructed or replaced. No OCR or spreadsheet fallback was used.");
}
