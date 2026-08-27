internal interface IGovernedDesktopFileSystem
{
    bool DirectoryExists(string path);
    FileAttributes GetAttributes(string path);
}

internal sealed class GovernedDesktopFileSystem : IGovernedDesktopFileSystem
{
    public bool DirectoryExists(string path) => Directory.Exists(path);
    public FileAttributes GetAttributes(string path) => File.GetAttributes(path);
}

internal sealed class GovernedDrawingFolder
{
    internal const string ApprovedRoot = @"\\DeLeon-Server\Production\Drawing-Prints";
    private readonly string root;
    private readonly IGovernedDesktopFileSystem fileSystem;

    internal GovernedDrawingFolder(string root, IGovernedDesktopFileSystem fileSystem)
    {
        this.root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        this.fileSystem = fileSystem;
    }

    internal bool TryResolve(string? relativePath, out string? target, out string failureCategory)
    {
        target = null;
        failureCategory = "InvalidGovernedPath";
        if (!TryGetSegments(relativePath, out var segments)) return false;
        try
        {
            if (!IsSafeDirectory(root))
            {
                failureCategory = "GovernedRootUnavailable";
                return false;
            }
            var candidate = Path.GetFullPath(Path.Combine(root, relativePath!)).TrimEnd(Path.DirectorySeparatorChar);
            if (!candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return false;

            var cursor = root;
            foreach (var segment in segments)
            {
                cursor = Path.Combine(cursor, segment);
                if (!IsSafeDirectory(cursor))
                {
                    failureCategory = "GovernedFolderUnavailable";
                    return false;
                }
            }
            if (!string.Equals(Path.GetFullPath(cursor).TrimEnd(Path.DirectorySeparatorChar), candidate,
                    StringComparison.OrdinalIgnoreCase))
                return false;
            target = candidate;
            failureCategory = "None";
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            failureCategory = "GovernedFolderUnavailable";
            return false;
        }
    }

    private bool IsSafeDirectory(string path) =>
        fileSystem.DirectoryExists(path) &&
        (fileSystem.GetAttributes(path) & FileAttributes.ReparsePoint) == 0;

    private static bool TryGetSegments(string? value, out string[] segments)
    {
        segments = [];
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1024 || Path.IsPathRooted(value) ||
            value.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
            return false;
        segments = value.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries);
        return segments.Length > 0 && segments.All(segment => segment is not "." and not "..");
    }
}
