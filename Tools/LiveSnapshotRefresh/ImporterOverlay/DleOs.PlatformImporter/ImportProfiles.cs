namespace DleOs.PlatformImporter;

public static class ImportProfiles
{
    public const string HistoricalTest = "HISTORICAL_TEST";
    public const string Live = "LIVE";

    private static readonly IReadOnlyDictionary<string, ImportProfile> Profiles =
        new Dictionary<string, ImportProfile>(StringComparer.Ordinal)
        {
            [HistoricalTest] = new(
                HistoricalTest,
                PlatformConstants.HistoricalMirrorPackagePath,
                PlatformConstants.HistoricalDatabaseName,
                Path.Combine(
                    Safety.RepositoryRoot,
                    "Artifacts",
                    "Platform001"),
                PackageFormat.HistoricalMirror),
            [Live] = new(
                Live,
                PlatformConstants.LiveMirrorPackagePath,
                PlatformConstants.LiveDatabaseName,
                Path.Combine(
                    Safety.RepositoryRoot,
                    "Artifacts",
                    "LiveSql001",
                    "Runs"),
                PackageFormat.LiveCanonical)
        };

    public static ImportProfile Resolve(string name)
    {
        if (!Profiles.TryGetValue(name, out var profile))
        {
            throw new PlatformImportException(
                "PROFILE_NOT_APPROVED",
                "Only the named profiles HISTORICAL_TEST and LIVE are approved.");
        }

        return profile;
    }

    public static IReadOnlyCollection<string> Names => Profiles.Keys.ToArray();
}

public static class ImportDecision
{
    public static ImportDisposition Decide(
        string? currentPackageHash,
        bool targetWasPreviouslyCommitted,
        string targetPackageHash,
        bool requalifyCurrentPackage = false,
        string? currentMirrorRunId = null,
        string? targetMirrorRunId = null)
    {
        if (requalifyCurrentPackage)
        {
            if (!string.Equals(
                    currentPackageHash,
                    targetPackageHash,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new PlatformImportException(
                    "REFRESH_PACKAGE_HASH_CHANGED",
                    "Identical-content refresh requires the freshly " +
                    "extracted package hash to match the current snapshot.");
            }
            if (string.IsNullOrWhiteSpace(currentMirrorRunId) ||
                string.IsNullOrWhiteSpace(targetMirrorRunId) ||
                string.Equals(
                    currentMirrorRunId,
                    targetMirrorRunId,
                    StringComparison.Ordinal))
            {
                throw new PlatformImportException(
                    "REFRESH_MIRROR_RUN_NOT_NEW",
                    "Identical-content refresh requires a new, nonblank " +
                    "qualified mirror run ID.");
            }
            return ImportDisposition.Import;
        }

        if (string.Equals(
            currentPackageHash,
            targetPackageHash,
            StringComparison.OrdinalIgnoreCase))
        {
            return ImportDisposition.NoOp;
        }

        return targetWasPreviouslyCommitted
            ? ImportDisposition.Restore
            : ImportDisposition.Import;
    }
}
