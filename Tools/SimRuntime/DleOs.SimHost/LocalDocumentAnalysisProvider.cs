internal static class DleAnalysisPolicy
{
    internal const string Hosted = "CODEX_APP_SERVER";
    internal const string Local = "LOCAL_DOCUMENT";
    internal static bool HostedApproved(DleAnalysisDocument[] documents)
    {
        var approved = (Environment.GetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256") ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return documents.Length > 0 && documents.All(d => d.Source.Sha256 == DleAnalysisContract.Hash(d.Bytes) && approved.Contains(d.Source.Sha256, StringComparer.OrdinalIgnoreCase));
    }
    internal static string Select(DleAnalysisDocument[] documents) => HostedApproved(documents) ? Hosted : Local;
    internal static void RequirePermitted(string route, DleAnalysisDocument[] documents)
    {
        if (route != Local && (route != Hosted || !HostedApproved(documents)))
            throw new IOException("Hosted document approval unavailable; no documents sent.");
    }
}

internal sealed class PolicyAnalysisProvider(IAnalysisProvider hosted, IAnalysisProvider local) : IAnalysisProvider
{
    public Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents, string instructions, CancellationToken cancellationToken)
    {
        DleAnalysisPolicy.RequirePermitted(input.ProviderRoute, documents);
        // A pinned local job never falls back to the hosted adapter, including on failure.
        return (input.ProviderRoute == DleAnalysisPolicy.Local ? local : hosted).ExecuteAnalysisJob(input, documents, instructions, cancellationToken);
    }
}

internal sealed class LocalDocumentAnalysisProvider(string? stateRoot = null) : IAnalysisProvider
{
    public async Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents, string instructions, CancellationToken cancellationToken)
    {
        if (input.ResultVersion == DleAnalysisContract.EnrichedResultVersion)
            return await LocalBomEnrichment.Execute(input, documents, cancellationToken, stateRoot);
        var governing = documents.SingleOrDefault(d => d.Source.DocumentId == input.GoverningDocumentId);
        if (input.ProviderRoute != DleAnalysisPolicy.Local || governing is null || governing.Source.MimeType != "application/pdf" ||
            documents.Any(d => DleAnalysisContract.Hash(d.Bytes) != d.Source.Sha256))
            throw new IOException("Local analysis source snapshot invalid.");
        var package = new SimTechnicalPackage(documents.Select(d=>new SimPackageDocument(d.Source.DocumentId,d.Source.Name,d.Source.DocumentType,d.Source.Role,d.Source.Applicability,null,d.Source.EmbeddedBom)).ToArray(),input.GoverningDocumentId,"DLE_LOCAL_ANALYSIS",false,input.RequestedBy,input.RequestedAtUtc);
        var persona = new SimPersona("local-analysis","local-analysis",input.RequestedBy,"ACTIVE",[],[],true,"SIM");
        try
        {
            var extracted = await SimCandidateBomProvider.Extract(governing.Bytes,package,persona,cancellationToken);
            var rows = extracted.Rows.Select(row => new DleAnalysisRow(row.Values.ToDictionary(p=>p.Key,p=>new DleAnalysisField(p.Value,
                new(input.GoverningDocumentId,2,null,"PDF table row " + (row.Index+1) + "; bounds " + string.Join(",",row.Bounds.Select(n=>n.ToString(System.Globalization.CultureInfo.InvariantCulture)))),
                "Local text-table extraction; human verification required.","NOT_COMPARED",null,null)))).ToArray();
            return new(new(DleAnalysisContract.ResultVersion,"EXTRACTED","PARTIAL",
                "Local-only extraction of up to ten BOM rows from governing PDF page 2. Supporting documents, including XLS, were not compared; no agreement is asserted.",rows),DleAnalysisPolicy.Local,extracted.Parser,"none");
        }
        catch (SimRfqIntakeProblem)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return new(new(DleAnalysisContract.ResultVersion,"BLOCKED","PARTIAL","Local extraction failed. Needs manual review; no Candidate BOM was fabricated and no hosted fallback was attempted.",[]),DleAnalysisPolicy.Local,"pdfplumber adapter v1","none");
        }
    }
}
