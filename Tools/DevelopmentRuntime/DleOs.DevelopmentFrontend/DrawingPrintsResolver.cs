using System.Text;
using System.Text.RegularExpressions;

internal interface IDrawingPrintsFileSystem
{
    bool DirectoryExists(string path);
    FileAttributes GetAttributes(string path);
    IReadOnlyList<string> GetDirectories(string path);
}

internal sealed class SystemDrawingPrintsFileSystem : IDrawingPrintsFileSystem
{
    public bool DirectoryExists(string path) => Directory.Exists(path);
    public FileAttributes GetAttributes(string path) => File.GetAttributes(path);
    public IReadOnlyList<string> GetDirectories(string path) =>
        Directory.EnumerateDirectories(path).ToArray();
}

internal sealed partial class DrawingPrintsResolver
{
    internal const string GovernedRoot = @"\\DeLeon-Server\Production\Drawing-Prints";
    private readonly string root;
    private readonly IDrawingPrintsFileSystem fileSystem;
    private readonly Action<DrawingPrintsDiagnostic>? diagnosticSink;

    internal DrawingPrintsResolver(
        string root,
        IDrawingPrintsFileSystem fileSystem,
        Action<DrawingPrintsDiagnostic>? diagnosticSink = null)
    {
        this.root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        this.fileSystem = fileSystem;
        this.diagnosticSink = diagnosticSink;
    }

    internal DrawingPrintsResolution Resolve(
        string? customerName,
        string? assemblyNumber,
        string? revision,
        string? correlationId = null)
    {
        var diagnosticCorrelationId = CleanCorrelationId(correlationId);
        var customer = CleanIdentity(customerName, 160);
        var assembly = CleanIdentity(assemblyNumber, 80);
        var requestedRevision = CleanRevision(revision);
        if (customer is null || assembly is null)
            return Unresolved("A governed Customer and Assembly are required.");

        try
        {
            if (!IsSafeDirectory(root, allowRoot: true, "root.attributes"))
                return Unresolved("Assembly Drawing folders are currently unavailable.");

            var customerMatches = MatchCustomerDirectories(customer);
            if (customerMatches.Count != 1)
                return Unresolved(customerMatches.Count == 0
                    ? "The customer Drawing-Prints folder was not resolved."
                    : "More than one customer Drawing-Prints folder matches this Work Order.");

            var customerPath = customerMatches[0];
            var customerDisplay = Path.GetFileName(customerPath);
            var assemblyMatches = MatchAssemblyDirectories(customerPath, assembly, requestedRevision);
            if (assemblyMatches.ExactRevisionMatch is not null)
            {
                var exact = assemblyMatches.ExactRevisionMatch;
                return new(
                    "RESOLVED",
                    customer,
                    assembly,
                    requestedRevision,
                    customerDisplay,
                    exact.AssemblyDisplay,
                    exact.RevisionDisplay,
                    OpenUri(exact.Path),
                    OpenUri(exact.Path),
                    Array.Empty<DrawingPrintsChoice>(),
                    "Assembly Drawing folder resolved.");
            }

            if (assemblyMatches.Ambiguous.Count > 1)
                return new(
                    "ASSEMBLY_SELECTION_REQUIRED",
                    customer,
                    assembly,
                    requestedRevision,
                    customerDisplay,
                    null,
                    null,
                    null,
                    OpenUri(customerPath),
                    assemblyMatches.Ambiguous.Select(path =>
                        new DrawingPrintsChoice(
                            "assembly",
                            Path.GetFileName(path),
                            OpenUri(path))).ToArray(),
                    "Select the applicable existing assembly folder.");

            var assemblyPath = assemblyMatches.AssemblyPath;
            if (assemblyPath is null)
                return new(
                    "CUSTOMER_ONLY",
                    customer,
                    assembly,
                    requestedRevision,
                    customerDisplay,
                    null,
                    null,
                    null,
                    OpenUri(customerPath),
                    Array.Empty<DrawingPrintsChoice>(),
                    "The assembly folder was not resolved. The confirmed customer folder can be opened.");

            var assemblyDisplay = Path.GetFileName(assemblyPath);
            var revisionChoices = GetRevisionChoices(assemblyPath);
            if (requestedRevision is not null)
            {
                var revisionMatches = revisionChoices
                    .Where(choice => string.Equals(
                        choice.Revision,
                        requestedRevision,
                        StringComparison.OrdinalIgnoreCase))
                    .ToArray();
                if (revisionMatches.Length == 1)
                {
                    var match = revisionMatches[0];
                    return new(
                        "RESOLVED",
                        customer,
                        assembly,
                        requestedRevision,
                        customerDisplay,
                        assemblyDisplay,
                        match.DisplayLabel,
                        match.OpenUri,
                        match.OpenUri,
                        Array.Empty<DrawingPrintsChoice>(),
                        "Assembly Drawing folder resolved.");
                }
            }

            if (revisionChoices.Count > 0)
                return new(
                    "REVISION_SELECTION_REQUIRED",
                    customer,
                    assembly,
                    requestedRevision,
                    customerDisplay,
                    assemblyDisplay,
                    null,
                    null,
                    OpenUri(assemblyPath),
                    revisionChoices.Select(choice =>
                        new DrawingPrintsChoice(
                            "revision",
                            choice.DisplayLabel,
                            choice.OpenUri)).ToArray(),
                    requestedRevision is null
                        ? "Select an existing revision folder."
                        : $"Revision {requestedRevision} was not found. Select an available revision.");

            return new(
                requestedRevision is null ? "ASSEMBLY_RESOLVED" : "REVISION_NOT_FOUND",
                customer,
                assembly,
                requestedRevision,
                customerDisplay,
                assemblyDisplay,
                null,
                requestedRevision is null ? OpenUri(assemblyPath) : null,
                OpenUri(assemblyPath),
                Array.Empty<DrawingPrintsChoice>(),
                requestedRevision is null
                    ? "Assembly Drawing folder resolved."
                    : $"Revision {requestedRevision} was not found. The confirmed assembly folder can be opened.");
        }
        catch (DrawingPrintsAccessException exception)
        {
            diagnosticSink?.Invoke(new DrawingPrintsDiagnostic(
                diagnosticCorrelationId,
                exception.Stage,
                exception.Category,
                exception.NativeHResult));
            return Unresolved("Assembly Drawing folders are currently unavailable.");
        }
    }

    private IReadOnlyList<string> MatchCustomerDirectories(string customer)
    {
        var requested = Normalize(customer);
        var candidates = SafeChildren(root, "root.enumerate", "customer.attributes");
        var exact = candidates.Where(path => Normalize(Path.GetFileName(path)) == requested).ToArray();
        if (exact.Length > 0) return exact;
        if (requested.Length < 5) return Array.Empty<string>();
        return candidates.Where(path =>
        {
            var candidate = Normalize(Path.GetFileName(path));
            return candidate.Length >= 5 &&
                (candidate.StartsWith(requested, StringComparison.Ordinal) ||
                 requested.StartsWith(candidate, StringComparison.Ordinal));
        }).ToArray();
    }

    private AssemblyMatches MatchAssemblyDirectories(
        string customerPath,
        string assembly,
        string? revision)
    {
        var requested = Normalize(assembly);
        var candidates = SafeChildren(customerPath, "customer.enumerate", "assembly.attributes");
        var exact = candidates.Where(path => Normalize(Path.GetFileName(path)) == requested).ToArray();
        if (exact.Length == 1)
            return new(exact[0], Array.Empty<string>(), null);
        if (exact.Length > 1)
            return new(null, exact, null);

        var strong = candidates.Where(path => StrongAssemblyPrefix(Path.GetFileName(path), requested)).ToArray();
        if (revision is not null)
        {
            var combined = strong.Where(path =>
                CombinedAssemblyRevisionMatch(Path.GetFileName(path), requested, revision)).ToArray();
            if (combined.Length == 1)
                return new(null, Array.Empty<string>(), new(
                    combined[0],
                    Path.GetFileName(combined[0]),
                    "Rev " + revision));
        }
        return strong.Length == 1
            ? new(strong[0], Array.Empty<string>(), null)
            : new(null, strong, null);
    }

    private IReadOnlyList<RevisionChoice> GetRevisionChoices(string assemblyPath) =>
        SafeChildren(assemblyPath, "assembly.enumerate", "revision.attributes")
            .Select(path => (Path: path, Revision: ParseRevision(Path.GetFileName(path))))
            .Where(item => item.Revision is not null)
            .Select(item => new RevisionChoice(
                item.Revision!,
                Path.GetFileName(item.Path),
                OpenUri(item.Path)))
            .OrderBy(item => item.DisplayLabel, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private IReadOnlyList<string> SafeChildren(
        string path,
        string enumerationStage,
        string childAttributesStage) =>
        ExecuteFileSystemOperation(enumerationStage, () => fileSystem.GetDirectories(path))
            .Select(Path.GetFullPath)
            .Where(candidate => IsSafeDirectory(candidate, allowRoot: false, childAttributesStage))
            .OrderBy(candidate => Path.GetFileName(candidate), StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private bool IsSafeDirectory(string candidate, bool allowRoot, string attributesStage)
    {
        var full = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar);
        if (!(allowRoot && string.Equals(full, root, StringComparison.OrdinalIgnoreCase)) &&
            !full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return false;
        if (!fileSystem.DirectoryExists(full))
        {
            try
            {
                _ = ExecuteFileSystemOperation(attributesStage, () => fileSystem.GetAttributes(full));
            }
            catch (DrawingPrintsAccessException)
            {
                throw;
            }
            throw new DrawingPrintsAccessException(attributesStage, "DirectoryUnavailable", 0);
        }
        var attributes = ExecuteFileSystemOperation(attributesStage, () => fileSystem.GetAttributes(full));
        return (attributes & FileAttributes.ReparsePoint) == 0;
    }

    private static T ExecuteFileSystemOperation<T>(string stage, Func<T> operation)
    {
        try
        {
            return operation();
        }
        catch (UnauthorizedAccessException exception)
        {
            throw new DrawingPrintsAccessException(stage, "AccessDenied", exception.HResult);
        }
        catch (DirectoryNotFoundException exception)
        {
            throw new DrawingPrintsAccessException(stage, "DirectoryNotFound", exception.HResult);
        }
        catch (FileNotFoundException exception)
        {
            throw new DrawingPrintsAccessException(stage, "DirectoryNotFound", exception.HResult);
        }
        catch (IOException exception)
        {
            throw new DrawingPrintsAccessException(stage, "IoFailure", exception.HResult);
        }
    }

    private string OpenUri(string path)
    {
        var relative = Path.GetRelativePath(root, path);
        if (Path.IsPathRooted(relative) || relative.Split(Path.DirectorySeparatorChar).Any(part => part is "." or ".."))
            throw new InvalidOperationException("Resolved Drawing-Prints path escaped the governed root.");
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(relative))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return "dle-drawing-prints://open/" + token;
    }

    private static bool StrongAssemblyPrefix(string name, string requested)
    {
        var candidate = Normalize(name);
        if (!candidate.StartsWith(requested, StringComparison.Ordinal) || candidate.Length == requested.Length)
            return false;
        var remainder = candidate[requested.Length..];
        return !(char.IsDigit(requested[^1]) && char.IsDigit(remainder[0]));
    }

    private static bool CombinedAssemblyRevisionMatch(string name, string assembly, string revision)
    {
        var normalized = Normalize(name);
        var requestedRevision = Normalize(revision);
        var remainder = normalized[assembly.Length..];
        return remainder == requestedRevision || remainder == "REV" + requestedRevision ||
            remainder == "REVISION" + requestedRevision;
    }

    private static string? ParseRevision(string name)
    {
        var match = RevisionFolder().Match(name.Trim());
        if (match.Success) return match.Groups["revision"].Value.ToUpperInvariant();
        return SimpleRevision().IsMatch(name.Trim()) ? name.Trim().ToUpperInvariant() : null;
    }

    private static string? CleanIdentity(string? value, int maximumLength)
    {
        var clean = (value ?? "").Trim();
        if (clean.Length == 0 || clean.Length > maximumLength || clean.Any(char.IsControl)) return null;
        return clean;
    }

    private static string? CleanRevision(string? value)
    {
        var clean = (value ?? "").Trim();
        return clean.Length == 0 ? null : ValidRevision().IsMatch(clean) ? clean.ToUpperInvariant() : null;
    }

    private static string Normalize(string value) =>
        new(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    private static string CleanCorrelationId(string? value)
    {
        var clean = (value ?? "").Trim();
        return clean.Length is > 0 and <= 128 && clean.All(character => !char.IsControl(character))
            ? clean
            : "not-provided";
    }

    private static DrawingPrintsResolution Unresolved(string message) => new(
        "UNRESOLVED", null, null, null, null, null, null, null, null,
        Array.Empty<DrawingPrintsChoice>(), message);

    [GeneratedRegex(@"^REV(?:ISION)?[\s._-]*(?<revision>[A-Z0-9]+)(?:\b|[\s_(-])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex RevisionFolder();

    [GeneratedRegex(@"^[A-Z0-9]{1,4}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SimpleRevision();

    [GeneratedRegex(@"^[A-Z0-9][A-Z0-9._-]{0,15}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ValidRevision();

    private sealed record AssemblyMatches(
        string? AssemblyPath,
        IReadOnlyList<string> Ambiguous,
        ExactRevision? ExactRevisionMatch);

    private sealed record ExactRevision(string Path, string AssemblyDisplay, string RevisionDisplay);
    private sealed record RevisionChoice(string Revision, string DisplayLabel, string OpenUri);
    private sealed class DrawingPrintsAccessException(
        string stage,
        string category,
        int nativeHResult) : Exception
    {
        internal string Stage { get; } = stage;
        internal string Category { get; } = category;
        internal int NativeHResult { get; } = nativeHResult;
    }
}

internal sealed record DrawingPrintsDiagnostic(
    string CorrelationId,
    string Stage,
    string Category,
    int HResult);

internal sealed record DrawingPrintsChoice(string Kind, string DisplayLabel, string OpenUri);

internal sealed record DrawingPrintsResolution(
    string Status,
    string? CustomerName,
    string? AssemblyNumber,
    string? Revision,
    string? ResolvedCustomerName,
    string? ResolvedAssemblyName,
    string? ResolvedRevisionName,
    string? OpenUri,
    string? DeepestOpenUri,
    IReadOnlyList<DrawingPrintsChoice> Choices,
    string Message);
