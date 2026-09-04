using System.Security.Cryptography;
using System.Text.Json;

public sealed record ValidatedFrontendRelease(
    string ManifestSha256,
    int FileCount);

internal sealed record FrontendReleaseManifest(
    int SchemaVersion,
    string ReleaseId,
    string GitHead,
    int FileCount,
    FrontendReleaseManifestEntry[] Files);

internal sealed record FrontendReleaseManifestEntry(
    string RelativePath,
    long Length,
    string Sha256);

public static class FrontendReleaseManifestValidator
{
    private static readonly StringComparison PathComparison =
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    public static ValidatedFrontendRelease Validate(
        string contentRoot,
        string manifestPath,
        DevRuntimeBuildInfo build)
    {
        build.Validate();
        var root = Path.GetFullPath(contentRoot);
        var manifest = Path.GetFullPath(manifestPath);
        var expectedManifest = Path.GetFullPath(
            Path.Combine(Directory.GetParent(root)?.FullName ?? "", "frontend-manifest.json"));
        if (!manifest.Equals(expectedManifest, PathComparison) || !Directory.Exists(root) ||
            !File.Exists(manifest))
            throw new InvalidOperationException("The immutable frontend release layout is incomplete.");
        RejectReparsePoint(root);

        var manifestSha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(manifest)));
        if (!manifestSha.Equals(build.FrontendManifestSha256,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The frontend manifest digest does not match the runtime identity.");

        var document = JsonSerializer.Deserialize<FrontendReleaseManifest>(
            File.ReadAllText(manifest),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("The frontend manifest is invalid.");
        if (document.SchemaVersion != 1 || document.ReleaseId != build.ReleaseId ||
            !document.GitHead.Equals(build.GitHead, StringComparison.OrdinalIgnoreCase) ||
            document.FileCount != build.FrontendFileCount ||
            document.Files is null || document.Files.Length != document.FileCount)
            throw new InvalidOperationException("The frontend manifest identity is inconsistent.");

        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        var seen = new HashSet<string>(
            OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        foreach (var entry in document.Files)
        {
            var relative = entry.RelativePath?.Replace('\\', '/') ?? "";
            var segments = relative.Split('/');
            if (relative.Length == 0 || Path.IsPathRooted(relative) || relative.Contains(':') ||
                segments.Any(value => value is "" or "." or "..") ||
                !IsAllowedFrontendPath(relative) || !seen.Add(relative) ||
                entry.Length < 0 || entry.Sha256.Length != 64)
                throw new InvalidOperationException("The frontend manifest contains an unsafe entry.");
            var filePath = Path.GetFullPath(Path.Combine(root, Path.Combine(segments)));
            if (!filePath.StartsWith(rootPrefix, PathComparison) || !File.Exists(filePath))
                throw new InvalidOperationException("A frontend manifest entry escapes or is absent.");
            RejectReparsePoints(root, filePath);
            var file = new FileInfo(filePath);
            var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(filePath)));
            if (file.Length != entry.Length ||
                !hash.Equals(entry.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("An immutable frontend file failed integrity validation.");
        }

        var actualFiles = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToArray();
        if (actualFiles.Length != document.FileCount)
            throw new InvalidOperationException("The immutable frontend contains unmanifested files.");
        foreach (var file in actualFiles)
        {
            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (!seen.Contains(relative))
                throw new InvalidOperationException("The immutable frontend contains an unmanifested file.");
        }
        foreach (var entry in Directory.EnumerateFileSystemEntries(root))
        {
            RejectReparsePoint(entry);
            var name = Path.GetFileName(entry);
            if (name != "DLE_Work_Center_v4.0.0.html" && name != "SRC" && name != "ASSETS")
                throw new InvalidOperationException("The immutable frontend contains an unexpected root entry.");
        }

        return new(manifestSha, document.FileCount);
    }

    private static bool IsAllowedFrontendPath(string relative) =>
        relative == "DLE_Work_Center_v4.0.0.html" ||
        relative.StartsWith("SRC/", StringComparison.Ordinal) ||
        relative.StartsWith("ASSETS/", StringComparison.Ordinal);

    private static void RejectReparsePoints(string root, string filePath)
    {
        var current = filePath;
        while (current.StartsWith(root, PathComparison))
        {
            RejectReparsePoint(current);
            if (current.Equals(root, PathComparison)) break;
            current = Directory.GetParent(current)?.FullName ?? root;
        }
    }

    private static void RejectReparsePoint(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Reparse points are forbidden in immutable frontend releases.");
    }
}
