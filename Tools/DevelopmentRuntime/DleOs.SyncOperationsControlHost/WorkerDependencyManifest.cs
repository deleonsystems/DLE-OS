using System.Security.Cryptography;
using System.Text.Json;

internal static class WorkerDependencyManifest
{
    internal static WorkerDependencyVerification Verify()
    {
        var manifestPath = Path.Combine(AppContext.BaseDirectory, "worker-dependencies.json");
        if (!File.Exists(manifestPath))
            throw new InvalidOperationException("The protected worker dependency manifest is absent.");

        var manifest = JsonSerializer.Deserialize<WorkerDependencyDeclaration>(
            File.ReadAllText(manifestPath), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? throw new InvalidOperationException(
                "The protected worker dependency manifest is invalid.");

        if (!string.Equals(manifest.Schema, "dle-os.sync-operations-worker-dependencies.v1",
                StringComparison.Ordinal) || manifest.Dependencies.Count == 0)
            throw new InvalidOperationException(
                "The protected worker dependency manifest contract was rejected.");

        var verified = new List<VerifiedWorkerDependency>();
        foreach (var dependency in manifest.Dependencies)
        {
            if (!Path.IsPathFullyQualified(dependency.Path) || !File.Exists(dependency.Path))
                throw new InvalidOperationException(
                    $"Required Sync Operations dependency is unavailable: {dependency.Path}");
            var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(dependency.Path)));
            if (!string.Equals(actual, dependency.Sha256, StringComparison.Ordinal))
                throw new InvalidOperationException(
                    $"Sync Operations dependency hash mismatch: {dependency.Path}");
            verified.Add(new VerifiedWorkerDependency(dependency.Path, actual));
        }

        return new WorkerDependencyVerification(manifestPath, verified);
    }

    private sealed class WorkerDependencyDeclaration
    {
        public string Schema { get; set; } = "";
        public List<WorkerDependency> Dependencies { get; set; } = [];
    }

    private sealed class WorkerDependency
    {
        public string Path { get; set; } = "";
        public string Sha256 { get; set; } = "";
    }
}

internal sealed record WorkerDependencyVerification(
    string ManifestPath,
    IReadOnlyList<VerifiedWorkerDependency> Dependencies);

internal sealed record VerifiedWorkerDependency(string Path, string Sha256);
