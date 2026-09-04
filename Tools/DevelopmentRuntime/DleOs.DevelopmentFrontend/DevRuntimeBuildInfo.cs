using System.Text.Json;
using System.Text.RegularExpressions;

public sealed record DevRuntimeBuildInfo(
    int SchemaVersion,
    string Environment,
    string ReleaseId,
    DateTimeOffset BuiltAtUtc,
    string GitHead,
    bool SourceDirty,
    string SourceDigestSha256,
    int SourceFileCount,
    string FrontendManifestSha256,
    int FrontendFileCount,
    string FrontendContentRootIdentity,
    string ServiceName,
    string ServiceIdentity)
{
    private static readonly Regex ReleasePattern = new(
        @"^\d{8}T\d{6}Z$", RegexOptions.CultureInvariant);
    private static readonly Regex GitHeadPattern = new(
        @"^[0-9a-fA-F]{40,64}$", RegexOptions.CultureInvariant);
    private static readonly Regex Sha256Pattern = new(
        @"^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant);

    public static DevRuntimeBuildInfo Load(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
            throw new InvalidOperationException("The DEV runtime build identity is absent.");
        var result = JsonSerializer.Deserialize<DevRuntimeBuildInfo>(
            File.ReadAllText(fullPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("The DEV runtime build identity is invalid.");
        result.Validate();
        return result;
    }

    public void Validate()
    {
        if (SchemaVersion != 2 || Environment != "Development" ||
            !ReleasePattern.IsMatch(ReleaseId) || !GitHeadPattern.IsMatch(GitHead) ||
            SourceDirty || !Sha256Pattern.IsMatch(SourceDigestSha256) || SourceFileCount <= 0 ||
            !Sha256Pattern.IsMatch(FrontendManifestSha256) || FrontendFileCount <= 0 ||
            FrontendContentRootIdentity != "release/frontend" ||
            ServiceName != "DleOsDevelopmentFrontend" ||
            !ServiceIdentity.Equals(@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND",
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "The runtime build identity is outside the approved DEV service boundary.");
    }

    public DevRuntimeInfoResponse ToSafeResponse()
    {
        Validate();
        return new(
            Environment, ReleaseId, BuiltAtUtc, GitHead, SourceDirty,
            SourceDigestSha256.ToUpperInvariant(), SourceFileCount,
            FrontendManifestSha256.ToUpperInvariant(), FrontendFileCount,
            FrontendContentRootIdentity,
            ServiceName, ServiceIdentity);
    }
}

public sealed record DevRuntimeInfoResponse(
    string Environment,
    string ReleaseId,
    DateTimeOffset BuiltAtUtc,
    string GitHead,
    bool SourceDirty,
    string SourceDigestSha256,
    int SourceFileCount,
    string FrontendManifestSha256,
    int FrontendFileCount,
    string FrontendContentRootIdentity,
    string ServiceName,
    string ServiceIdentity);
