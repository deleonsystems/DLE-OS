using System.Security.Cryptography;
using System.Text.Json;

internal static class WorkerDependencyManifest
{
    internal static WorkerDependencyVerification Verify()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "worker-dependencies.json");
        if (!File.Exists(path)) throw new InvalidOperationException("The worker dependency manifest is absent.");
        var manifest = JsonSerializer.Deserialize<WorkerDependencyDeclaration>(File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("The worker dependency manifest is invalid.");
        if (!string.Equals(manifest.Schema, "dle-os.invoice-history-worker-dependencies.v1",
                StringComparison.Ordinal) || manifest.Dependencies.Count == 0)
            throw new InvalidOperationException("The worker dependency manifest contract was rejected.");
        var verified = new List<VerifiedWorkerDependency>();
        foreach (var dependency in manifest.Dependencies)
            verified.Add(VerifyOne(dependency.Path, dependency.Sha256));
        return new(path, verified);
    }

    internal static QualificationDependencyMismatchEvidence VerifyQualificationMismatch()
    {
        var fixture = Path.Combine(AppContext.BaseDirectory, "qualification-dependency-fixture.txt");
        if (!File.Exists(fixture))
            throw new InvalidOperationException("The release-manifested dependency qualification fixture is absent.");
        var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(fixture)));
        const string deliberatelyIncorrectExpected =
            "0000000000000000000000000000000000000000000000000000000000000000";
        try
        {
            VerifyOne(fixture, deliberatelyIncorrectExpected);
            throw new InvalidOperationException("The deliberate dependency mismatch was accepted.");
        }
        catch (InvalidOperationException failure) when
            (failure.Message.StartsWith("Invoice History dependency hash mismatch:",
                StringComparison.Ordinal))
        {
            return new(fixture, deliberatelyIncorrectExpected, actual, true,
                "Rejected before lease, lock, package, SQL, or worker creation.");
        }
    }

    private static VerifiedWorkerDependency VerifyOne(string path, string expected)
    {
        if (!Path.IsPathFullyQualified(path) || !File.Exists(path))
            throw new InvalidOperationException($"Required Invoice History dependency is unavailable: {path}");
        var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
        if (!string.Equals(actual, expected, StringComparison.Ordinal))
            throw new InvalidOperationException($"Invoice History dependency hash mismatch: {path}");
        return new(path, actual);
    }
    private sealed class WorkerDependencyDeclaration
    { public string Schema { get; set; } = ""; public List<WorkerDependency> Dependencies { get; set; } = []; }
    private sealed class WorkerDependency
    { public string Path { get; set; } = ""; public string Sha256 { get; set; } = ""; }
}
internal sealed record QualificationDependencyMismatchEvidence(string Path,
    string ExpectedSha256, string ActualSha256, bool Rejected, string Containment);
internal sealed record WorkerDependencyVerification(string ManifestPath,
    IReadOnlyList<VerifiedWorkerDependency> Dependencies);
internal sealed record VerifiedWorkerDependency(string Path, string Sha256);
