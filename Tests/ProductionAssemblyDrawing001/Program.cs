using System.Reflection;

var root = Path.GetFullPath(@"C:\DrawingPrintsQualification");
var fileSystem = new FakeDrawingPrintsFileSystem(root);
var diagnostics = new List<DrawingPrintsDiagnostic>();
var resolver = new DrawingPrintsResolver(root, fileSystem, diagnostics.Add);

fileSystem.Add(@"Meggitt\H24589-SFM\REV H");
fileSystem.Add(@"Meggitt\H24589-SFM\REV J");
fileSystem.Add(@"Meggitt\H24589-SFM\REV K");
fileSystem.Add(@"Acme\H24589 REV J");
fileSystem.Add(@"Beta\H24589-REV-J");
fileSystem.Add(@"Gamma\H24589_J");
fileSystem.Add(@"Delta\H24589 RevJ");
fileSystem.Add(@"Ambiguous\H24589-SFM");
fileSystem.Add(@"Ambiguous\H24589-ALT");
fileSystem.Add(@"Customer Only\Different Assembly");
fileSystem.Add(@"No Revisions\H24589");

Check("exact revision resolution", () =>
{
    var result = resolver.Resolve("Meggitt", "H24589", "J");
    Equal("RESOLVED", result.Status);
    Equal("REV J", result.ResolvedRevisionName);
    True(ApprovedUri(result.OpenUri));
});

foreach (var customer in new[] { "Acme", "Beta", "Gamma", "Delta" })
{
    Check($"legacy naming variation {customer}", () =>
    {
        var result = resolver.Resolve(customer, "H24589", "J");
        Equal("RESOLVED", result.Status);
        True(ApprovedUri(result.OpenUri));
    });
}

Check("missing requested revision is never substituted", () =>
{
    var result = resolver.Resolve("Meggitt", "H24589", "I");
    Equal("REVISION_SELECTION_REQUIRED", result.Status);
    Equal(3, result.Choices.Count);
    True(result.Choices.Any(choice => choice.DisplayLabel == "REV J"));
    True(result.OpenUri is null);
    True(result.ResolvedRevisionName is null);
    True(ApprovedUri(result.DeepestOpenUri));
});

Check("unresolved revision exposes available choices", () =>
{
    var result = resolver.Resolve("Meggitt", "H24589", null);
    Equal("REVISION_SELECTION_REQUIRED", result.Status);
    Equal(3, result.Choices.Count);
    True(result.Choices.Any(choice => choice.DisplayLabel == "REV H"));
    True(result.Choices.Any(choice => choice.DisplayLabel == "REV J"));
    True(result.Choices.Any(choice => choice.DisplayLabel == "REV K"));
    True(ApprovedUri(result.DeepestOpenUri));
});

Check("requested revision absent without revision folders retains assembly only", () =>
{
    var result = resolver.Resolve("No Revisions", "H24589", "J");
    Equal("REVISION_NOT_FOUND", result.Status);
    True(result.OpenUri is null);
    True(ApprovedUri(result.DeepestOpenUri));
    Equal(0, result.Choices.Count);
});

Check("ambiguous assembly is not silently selected", () =>
{
    var result = resolver.Resolve("Ambiguous", "H24589", "J");
    Equal("ASSEMBLY_SELECTION_REQUIRED", result.Status);
    Equal(2, result.Choices.Count);
    True(result.OpenUri is null);
});

Check("customer-only fallback retains deepest confirmation", () =>
{
    var result = resolver.Resolve("Customer Only", "H24589", "J");
    Equal("CUSTOMER_ONLY", result.Status);
    True(result.OpenUri is null);
    True(ApprovedUri(result.DeepestOpenUri));
});

Check("outside-root enumeration is rejected", () =>
{
    fileSystem.AddRaw(root, @"C:\Accounting");
    var result = resolver.Resolve("Accounting", "H24589", "J");
    Equal("UNRESOLVED", result.Status);
    True(result.OpenUri is null && result.DeepestOpenUri is null);
});

Check("Drawing-Prints file interface is read-only", () =>
{
    var operations = typeof(IDrawingPrintsFileSystem).GetMethods()
        .Select(method => method.Name)
        .OrderBy(name => name)
        .ToArray();
    True(operations.SequenceEqual(new[] { "DirectoryExists", "GetAttributes", "GetDirectories" }));
    True(!operations.Any(name => name.Contains("Create") || name.Contains("Delete") ||
        name.Contains("Move") || name.Contains("Write")));
});

Check("access failures identify the exact governed stage without paths", () =>
{
    diagnostics.Clear();
    fileSystem.GetDirectoriesFailure = new UnauthorizedAccessException("sensitive path omitted");
    var result = resolver.Resolve("Meggitt", "H24589", "J", "correlation-5051");
    fileSystem.GetDirectoriesFailure = null;
    Equal("UNRESOLVED", result.Status);
    Equal(1, diagnostics.Count);
    Equal("correlation-5051", diagnostics[0].CorrelationId);
    Equal("root.enumerate", diagnostics[0].Stage);
    Equal("AccessDenied", diagnostics[0].Category);
    True(!diagnostics[0].ToString().Contains(root, StringComparison.OrdinalIgnoreCase));
});

Console.WriteLine("Production Assembly Drawing resolver qualification: PASS");

static bool ApprovedUri(string? value) =>
    value?.StartsWith("dle-drawing-prints://open/", StringComparison.Ordinal) == true;

static void Check(string name, Action action)
{
    try { action(); }
    catch (Exception exception) { throw new InvalidOperationException(name + " failed", exception); }
}

static void True(bool value)
{
    if (!value) throw new InvalidOperationException("Expected true.");
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"Expected {expected}; actual {actual}.");
}

sealed class FakeDrawingPrintsFileSystem : IDrawingPrintsFileSystem
{
    private readonly Dictionary<string, List<string>> children = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> directories = new(StringComparer.OrdinalIgnoreCase);
    private readonly string root;
    internal Exception? GetDirectoriesFailure { get; set; }

    internal FakeDrawingPrintsFileSystem(string root)
    {
        this.root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        directories.Add(this.root);
        children[this.root] = [];
    }

    internal void Add(string relativePath)
    {
        var parent = root;
        foreach (var segment in relativePath.Split(Path.DirectorySeparatorChar))
        {
            var child = Path.GetFullPath(Path.Combine(parent, segment));
            if (directories.Add(child))
            {
                children.GetValueOrDefault(parent)?.Add(child);
                children[child] = [];
            }
            parent = child;
        }
    }

    internal void AddRaw(string parent, string child)
    {
        children.GetValueOrDefault(Path.GetFullPath(parent))?.Add(Path.GetFullPath(child));
        directories.Add(Path.GetFullPath(child));
        children[Path.GetFullPath(child)] = [];
    }

    public bool DirectoryExists(string path) => directories.Contains(Path.GetFullPath(path));
    public FileAttributes GetAttributes(string path) => FileAttributes.Directory;
    public IReadOnlyList<string> GetDirectories(string path)
    {
        if (GetDirectoriesFailure is not null) throw GetDirectoriesFailure;
        return children.GetValueOrDefault(Path.GetFullPath(path))?.ToArray() ?? [];
    }
}
