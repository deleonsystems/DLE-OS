using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimCandidateCorrection(string Field, string Previous, string Value, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimCandidateRow(int Index, Dictionary<string,string> Extracted, Dictionary<string,string> Values,
    double[] Bounds, Dictionary<string,string> Comparison, bool Confirmed, string? Reviewer, DateTimeOffset? ReviewedAtUtc,
    SimCandidateCorrection[] Corrections);
internal sealed record SimCandidateBom(string Id, string Label, string GoverningDocumentId, string GoverningSha256,
    int Page, string Parser, bool Synthetic, DateTimeOffset ExtractedAtUtc, string RequestedBy,
    string[] SupportingDocumentIds, string SupportingComparison, SimCandidateRow[] Rows);
internal sealed record SimCandidateReviewRequest(string CandidateId, int RowIndex, Dictionary<string,string> Values);

internal static class SimCandidateBomProvider
{
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
                "UNAVAILABLE: Supporting spreadsheet comparison is not implemented; legacy XLS reader unavailable. No matches or differences have been asserted.", rows);
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
    private static SimRfqIntakeProblem Unavailable() => SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_EXTRACTION_UNAVAILABLE",
        "Candidate extraction unavailable: this pilot requires a local Python/pdfplumber runtime and one readable five-column BOM table on PDF page 2. Nothing was reconstructed or replaced. No OCR or spreadsheet fallback was used.");
}
