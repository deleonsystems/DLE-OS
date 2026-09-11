using System.Security.Cryptography;
using System.Text.Json;

// DLE contracts: provider protocol types must stay inside the provider adapter.
internal interface IAnalysisProvider
{
    Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents,
        string instructions, CancellationToken cancellationToken);
}
internal sealed record DleAnalysisSource(string DocumentId, string Sha256, string Name, string MimeType,
    string DocumentType, string Role, string Applicability, bool EmbeddedBom);
internal sealed record DleAnalysisInput(string JobId, string JobType, string IntakeId, string Assembly,
    string Revision, int Quantity, string GoverningDocumentId, DleAnalysisSource[] Sources,
    int GoverningPage, int PilotRowLimit, string ContractVersion, string ResultVersion,
    string InstructionVersion, string InstructionHash, string AuthorityRule, string RequestedBy,
    DateTimeOffset RequestedAtUtc, DateTimeOffset DeadlineUtc);
internal sealed record DleAnalysisDocument(DleAnalysisSource Source, byte[] Bytes);
internal sealed record DleAnalysisEvidence(string DocumentId, int? Page, string? Sheet, string Location);
internal sealed record DleAnalysisField(string? Value, DleAnalysisEvidence Evidence, string Uncertainty,
    string Relationship, string? SupportingValue, DleAnalysisEvidence? SupportingEvidence);
internal sealed record DleAnalysisRow(Dictionary<string, DleAnalysisField> Fields);
internal sealed record DleAnalysisResult(string ContractVersion, string Outcome, string Coverage,
    string CoverageReason, DleAnalysisRow[] Rows);
internal sealed record DleAnalysisResponse(DleAnalysisResult Result, string Provider, string ProviderVersion, string Model);
internal sealed record DleAnalysisJob(DleAnalysisInput Input, string Status, DateTimeOffset UpdatedAtUtc,
    string? ErrorCode = null, string? Message = null, string? CandidateId = null);
internal sealed record DleCandidateAnalysis(string JobId, DleAnalysisInput SourceSnapshot,
    string Provider, string ProviderVersion, string Model, string Coverage, string CoverageReason,
    string Status = "NEEDS_REVIEW");

internal static class DleAnalysisContract
{
    internal const string InputVersion = "DLE_ANALYSIS_JOB_V1";
    internal const string ResultVersion = "DLE_CANDIDATE_ANALYSIS_RESULT_V1";
    internal const string InstructionVersion = "CANDIDATE_BOM_INSTRUCTION_V1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static string Instructions => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Analysis", "candidate-bom-v1.md"));
    internal static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static bool Active(string status) => status is "QUEUED" or "RUNNING" or "VALIDATING";

    internal static void Validate(DleAnalysisInput input, DleAnalysisResult result)
    {
        if (result.ContractVersion != ResultVersion || result.Outcome != "EXTRACTED" || result.Coverage != "PARTIAL" ||
            string.IsNullOrWhiteSpace(result.CoverageReason) || result.CoverageReason.Length > 2000 ||
            result.Rows is null || result.Rows.Length is < 5 or > 10 || result.Rows.Length > input.PilotRowLimit)
            throw new InvalidDataException("RESULT_INVALID");
        foreach (var row in result.Rows)
        {
            if (row is null || row.Fields is null || row.Fields.Count != 5 || SimCandidateBomProvider.Fields.Any(f => !row.Fields.ContainsKey(f)))
                throw new InvalidDataException("RESULT_INVALID");
            foreach (var field in row.Fields.Values)
            {
                if (field is null || field.Value?.Length > 2000 || field.SupportingValue?.Length > 2000 ||
                    field.Uncertainty is null || field.Uncertainty.Length > 2000 ||
                    field.Relationship is not ("MATCH" or "CONFLICT" or "NOT_FOUND" or "NOT_COMPARED") ||
                    (field.Value is null && string.IsNullOrWhiteSpace(field.Uncertainty))) throw new InvalidDataException("RESULT_INVALID");
                Evidence(field.Evidence, input.GoverningDocumentId, input.GoverningPage);
                if (field.SupportingEvidence is not null)
                {
                    if (!input.Sources.Any(s => s.DocumentId == field.SupportingEvidence.DocumentId && s.Role == "SUPPORTING"))
                        throw new InvalidDataException("RESULT_INVALID");
                    Evidence(field.SupportingEvidence, field.SupportingEvidence.DocumentId, null);
                }
                if (field.Relationship is "MATCH" or "CONFLICT")
                {
                    if (field.SupportingValue is null || field.Value is null || field.SupportingEvidence is null)
                        throw new InvalidDataException("RESULT_INVALID");
                    var equal = field.Value.Trim() == field.SupportingValue.Trim();
                    if ((field.Relationship == "MATCH") != equal) throw new InvalidDataException("RESULT_INVALID");
                }
            }
        }
    }
    private static void Evidence(DleAnalysisEvidence? e, string documentId, int? page)
    {
        if (e is null || e.DocumentId != documentId || string.IsNullOrWhiteSpace(e.Location) || e.Location.Length > 2000 ||
            (page is not null && e.Page != page) || (e.Page is <= 0) || e.Sheet?.Length > 200)
            throw new InvalidDataException("RESULT_INVALID");
    }
}

internal sealed class DleAnalysisJobService(SimRfqIntakeStore store, IAnalysisProvider provider) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await store.RecoverAnalysisJobs();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var claimed = await store.ClaimAnalysisJob();
                if (claimed is not null)
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    deadline.CancelAfter(TimeSpan.FromMinutes(3));
                    try
                    {
                        var remaining = claimed.Value.Job.Input.DeadlineUtc - DateTimeOffset.UtcNow;
                        deadline.CancelAfter(remaining > TimeSpan.Zero ? remaining : TimeSpan.FromMilliseconds(1));
                        var response = await provider.ExecuteAnalysisJob(claimed.Value.Job.Input, claimed.Value.Documents,
                            DleAnalysisContract.Instructions, deadline.Token);
                        await store.SetAnalysisState(claimed.Value.Job.Input.JobId, "VALIDATING");
                        if (response.Result.Outcome == "BLOCKED")
                        {
                            await store.SetAnalysisState(claimed.Value.Job.Input.JobId, "FAILED", "GOVERNING_UNREADABLE",
                                "The provider could not interpret the governing source. No candidate was published. Retry is available.");
                            continue;
                        }
                        DleAnalysisContract.Validate(claimed.Value.Job.Input, response.Result);
                        await store.PublishAnalysis(claimed.Value.Job.Input.JobId, response);
                    }
                    catch (OperationCanceledException)
                    {
                        await store.SetAnalysisState(claimed.Value.Job.Input.JobId, stoppingToken.IsCancellationRequested ? "CANCELLED" : "TIMED_OUT",
                            "ANALYSIS_INTERRUPTED", "Analysis stopped before publication. Retry is available.");
                    }
                    catch (InvalidDataException)
                    {
                        await store.SetAnalysisState(claimed.Value.Job.Input.JobId, "FAILED", "RESULT_INVALID",
                            "The result did not satisfy the DLE analysis contract. No candidate was replaced. Retry is available.");
                    }
                    catch (Exception e) when (e is IOException or InvalidOperationException or JsonException or System.ComponentModel.Win32Exception)
                    {
                        await store.SetAnalysisState(claimed.Value.Job.Input.JobId, "FAILED", "ANALYSIS_FAILED",
                            "Analysis could not produce a validated result. No candidate was replaced. Retry is available.");
                    }
                    continue;
                }
            }
            catch (Exception e) when (e is IOException or JsonException or SimRfqIntakeProblem)
            {
                // Persistence unavailable: leave durable state for recovery, never publish in memory only.
            }
            await Task.Delay(1000, stoppingToken);
        }
    }
}
