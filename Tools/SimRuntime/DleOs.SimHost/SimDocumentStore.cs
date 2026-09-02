using System.Security.Cryptography;

internal sealed record SimKittingDocument(
    string WorkOrderNumber,
    string DocumentType,
    string FileName,
    string Folder,
    string FullPath,
    string Sha256);

internal sealed class SimDocumentStore
{
    internal const string SupportedWorkOrder = "9700001";
    internal const string SupportedDocumentType = "complete";
    internal const string SourceFileName = "sim-wo-9700001-kit-summary.pdf";
    internal const string RuntimeFileName = "9700001.pdf";

    private readonly string repositoryRoot;
    private readonly string stateRoot;
    private readonly string sourcePath;
    private readonly string documentDirectory;
    private readonly string documentPath;

    internal SimDocumentStore(string repositoryRoot, string stateRoot)
    {
        this.repositoryRoot = Path.GetFullPath(repositoryRoot);
        this.stateRoot = Path.GetFullPath(stateRoot);
        sourcePath = Path.GetFullPath(Path.Combine(this.repositoryRoot,
            "Tools", "SimRuntime", "Scenarios", SourceFileName));
        documentDirectory = SimRuntimeOptions.ResolveStatePath(this.stateRoot,
            "documents", "KIT-COMPLETE");
        documentPath = SimRuntimeOptions.ResolveStatePath(this.stateRoot,
            "documents", "KIT-COMPLETE", RuntimeFileName);
        SimRuntimeOptions.EnsureDescendant(this.repositoryRoot, sourcePath);
    }

    internal async Task InitializeAsync()
    {
        if (!File.Exists(sourcePath))
            throw new InvalidOperationException("The tracked SIM document fixture is missing.");
        Directory.CreateDirectory(documentDirectory);
        await CopyFixtureAsync();
    }

    internal Task RebuildAsync() => InitializeAsync();

    internal SimKittingDocument? Get(string workOrderNumber, string documentType = SupportedDocumentType)
    {
        var normalizedWorkOrder = NormalizeWorkOrder(workOrderNumber);
        var normalizedType = NormalizeDocumentType(documentType);
        if (normalizedWorkOrder != SupportedWorkOrder || normalizedType != SupportedDocumentType ||
            !File.Exists(documentPath)) return null;
        var bytes = File.ReadAllBytes(documentPath);
        return new(normalizedWorkOrder, normalizedType, RuntimeFileName,
            "SIM-LOCAL/KIT-COMPLETE", documentPath,
            Convert.ToHexString(SHA256.HashData(bytes)));
    }

    internal static string NormalizeWorkOrder(string? value)
    {
        var workOrder = (value ?? string.Empty).Trim();
        if (workOrder.Length is < 1 or > 20 || workOrder.Any(character => !char.IsAsciiDigit(character)))
            throw new ArgumentException("Work Order must contain digits only.");
        return workOrder.PadLeft(7, '0');
    }

    internal static string NormalizeDocumentType(string? value)
    {
        var documentType = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (documentType is not ("complete" or "shortage"))
            throw new ArgumentException("Document type must be complete or shortage.");
        return documentType;
    }

    private async Task CopyFixtureAsync()
    {
        SimRuntimeOptions.EnsureDescendant(stateRoot, documentPath);
        var tempPath = documentPath + ".tmp-" + Guid.NewGuid().ToString("N");
        SimRuntimeOptions.EnsureDescendant(stateRoot, tempPath);
        try
        {
            await using (var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read,
                FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
            await using (var target = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
                await source.CopyToAsync(target);
            File.Move(tempPath, documentPath, true);
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }
}
