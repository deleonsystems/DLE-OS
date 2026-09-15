using System.Diagnostics;
using System.Text.Json;

internal static class LocalBomEnrichment
{
    internal static async Task<DleAnalysisResponse> Execute(DleAnalysisInput input, DleAnalysisDocument[] documents, CancellationToken cancellationToken, string? stateRoot = null)
    {
        if (input.ProviderRoute != DleAnalysisPolicy.Local || documents.Any(d => DleAnalysisContract.Hash(d.Bytes) != d.Source.Sha256))
            throw new IOException("Local source snapshot invalid.");
        var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(
            Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
        var start = new ProcessStartInfo(python) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-I"); start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "sim_bom_enrichment.py"));
        start.Environment["DLE_OS_SIM_ANALYSIS_PACKAGES"] = Environment.GetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_PACKAGES") ??
            Path.GetFullPath(Path.Combine(stateRoot ?? ".sim-state", "analysis-python-packages"));
        using var process = Process.Start(start) ?? throw new IOException("Local parser unavailable.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try {
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.WriteAsync(JsonSerializer.Serialize(new { job = input,
                documents = documents.Select(d => new { source = d.Source, binary = Convert.ToBase64String(d.Bytes) }) }, DleAnalysisContract.Json).AsMemory(), timeout.Token);
            process.StandardInput.Close(); await process.WaitForExitAsync(timeout.Token); await errors;
            if (process.ExitCode != 0) throw new IOException("Local governing extraction unavailable; no result published.");
            var result = JsonSerializer.Deserialize<DleAnalysisResult>(await output, DleAnalysisContract.Json) ?? throw new InvalidDataException("RESULT_INVALID");
            DleAnalysisContract.Validate(input, result);
            return new(result, DleAnalysisPolicy.Local, "local-bom-enrichment-v1", "none");
        } finally { if (!process.HasExited) process.Kill(true); }
    }
}
