using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record SimDrawingRoot(string Id, string Label, string Path);
internal sealed record SimDrawingFolderAssociation(string Id, int LineNumber, string RootId, string RelativePath,
    string FolderName, string CustomerId, string AssemblyNumber, string Revision, string LinkedBy, DateTimeOffset LinkedAtUtc);
internal sealed record SimDrawingFolderRequest(int LineNumber, string ExpectedToken, string RootId, string RelativePath);
internal sealed record SimDrawingFolderEntry(string Name, string RelativePath, bool IsDirectory);
internal sealed record SimDrawingFolderListing(string RootId, string RootLabel, string RelativePath,
    SimDrawingFolderEntry[] Entries, bool Truncated);

// Source roots are read-only external references, never SIM state locations. No defaults or discovery.
internal sealed partial class SimDrawingFolders
{
    private readonly SimDrawingRoot[] roots;
    internal SimDrawingFolders(string? configuration)
    {
        try
        {
            roots = string.IsNullOrWhiteSpace(configuration) ? [] :
                JsonSerializer.Deserialize<SimDrawingRoot[]>(configuration, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
            if (roots.Any(r => r is null) || roots.Length > 16 || roots.Select(r => r.Id).Distinct(StringComparer.Ordinal).Count() != roots.Length ||
                roots.Any(r => !Regex.IsMatch(r.Id ?? "", "^[a-z][a-z0-9-]{0,63}$") ||
                    string.IsNullOrWhiteSpace(r.Label) || r.Label.Length > 100 || r.Label.Any(char.IsControl) ||
                    string.IsNullOrWhiteSpace(r.Path) || !Path.IsPathFullyQualified(r.Path) ||
                    r.Path.StartsWith(@"\\?\") || r.Path.StartsWith(@"\\.\") || r.Path.Contains('/')))
                throw new ArgumentException();
        }
        catch (Exception e) when (e is JsonException or ArgumentException or NotSupportedException)
        { throw SimRfqIntakeProblem.Conflict("SIM_DRAWING_ROOT_CONFIG", "Drawing folder configuration is unavailable. Ask the SIM administrator to check it."); }
    }

    internal object[] Choices() => roots.Select(r => (object)new { r.Id, r.Label }).ToArray();
    internal static string Normalize(string? relative)
    {
        if (relative is null || relative.Length > 1000 || relative.Contains('\\') || relative.Any(char.IsControl)) throw InvalidPath();
        if (relative.Length == 0) return "";
        var parts = relative.Split('/');
        if (parts.Length > 32 || parts.Any(p => p.Length == 0 || p is "." or ".." || p.EndsWith('.') || p.EndsWith(' ') ||
            p.IndexOfAny([':', '*', '?', '"', '<', '>', '|']) >= 0 || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            Regex.IsMatch(p, "^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\\.|$)", RegexOptions.IgnoreCase))) throw InvalidPath();
        return string.Join('/', parts);
    }
    private static SimRfqIntakeProblem InvalidPath() => SimRfqIntakeProblem.BadRequest("SIM_DRAWING_FOLDER_PATH", "Choose a folder beneath a configured source root.");
    private static void CheckDirectoryChain(string path)
    {
        // Check every ancestor, including the configured root's ancestors (junctions are not roots).
        for (var current = new DirectoryInfo(path); current is not null; current = current.Parent)
        {
            if ((File.GetAttributes(current.FullName) & FileAttributes.ReparsePoint) != 0)
                throw SimRfqIntakeProblem.Conflict("SIM_DRAWING_FOLDER_LINK", "Linked folders and reparse points are not supported.");
        }
    }
    internal (SimDrawingRoot Root, string Path, string Relative) Resolve(string rootId, string relative)
    {
        var root = roots.SingleOrDefault(r => r.Id == rootId) ?? throw SimRfqIntakeProblem.BadRequest("SIM_DRAWING_ROOT_UNKNOWN", "Choose a configured drawing source.");
        relative = Normalize(relative);
        var basePath = Path.GetFullPath(root.Path);
        var path = Path.GetFullPath(Path.Combine(basePath, relative.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = Path.TrimEndingDirectorySeparator(basePath) + Path.DirectorySeparatorChar;
        if (!path.Equals(basePath, StringComparison.OrdinalIgnoreCase) && !path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw InvalidPath();
        CheckDirectoryChain(path);
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException();
        return (root, path, relative);
    }
    internal SimDrawingFolderListing Browse(string rootId, string relative)
    {
        var selected = Resolve(rootId, relative);
        var entries = new List<SimDrawingFolderEntry>();
        var scanned = 0;
        foreach (var path in Directory.EnumerateFileSystemEntries(selected.Path))
        {
            if (++scanned > 200) break;
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
            var name = Path.GetFileName(path);
            var child = selected.Relative.Length == 0 ? name : selected.Relative + "/" + name;
            try { Normalize(child); } catch (SimRfqIntakeProblem) { continue; }
            entries.Add(new(name, child, (attributes & FileAttributes.Directory) != 0));
        }
        Resolve(rootId, relative); // Fail closed if the directory chain changed during enumeration.
        return new(rootId, selected.Root.Label, selected.Relative,
            entries.OrderByDescending(e => e.IsDirectory).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToArray(), scanned > 200);
    }
}

internal sealed partial class SimRfqIntakeStore
{
    private static string DrawingFolderToken(SimRfqIntakeRecord r, SimRfqIntakeAssembly a) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { r.Customer.CustomerId, a, r.Status,
            association = r.DrawingFolders?.SingleOrDefault(f => f.LineNumber == a.LineNumber) }))));
    private static SimRfqIntakeAssembly DrawingAssembly(SimRfqIntakeRecord r, int line) =>
        r.Assemblies.SingleOrDefault(a => a.LineNumber == line) ?? throw SimRfqIntakeProblem.BadRequest("SIM_DRAWING_ASSEMBLY", "Choose an assembly in this review.");
    private static bool CanLinkDrawingFolder(SimRfqIntakeRecord r) => r.Environment == "SIM" &&
        r.Status is "READY_FOR_RFQ_QUALIFICATION" or "TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD" &&
        r.TechnicalReview is not null && r.TechnicalReview.Workflow?.Outputs is null && string.IsNullOrEmpty(r.TechnicalReview.DownstreamHandoffState);
    internal async Task<object> ReadDrawingFolder(string id, int line)
    {
        var r = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && IsTechnicalReviewRecord(r)) ??
            throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
        var a = DrawingAssembly(r, line);
        return new { token = DrawingFolderToken(r, a), canChange = CanLinkDrawingFolder(r),
            association = r.DrawingFolders?.SingleOrDefault(f => f.LineNumber == line) };
    }
    internal async Task<SimDrawingFolderAssociation> SaveDrawingFolder(string id, SimDrawingFolderRequest request, SimPersona actor, SimDrawingFolders sources)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == id && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var r = dataset.Records[index]; var a = DrawingAssembly(r, request.LineNumber);
            if (!CanLinkDrawingFolder(r)) throw SimRfqIntakeProblem.Conflict("SIM_DRAWING_FOLDER_READ_ONLY", "This review is no longer editable.");
            if (DrawingFolderToken(r, a) != request.ExpectedToken) throw SimRfqIntakeProblem.Conflict("SIM_DRAWING_FOLDER_STALE", "The assembly or folder link changed. Reopen the folder browser before saving.");
            var selected = sources.Resolve(request.RootId, request.RelativePath);
            var now = DateTimeOffset.UtcNow;
            var association = new SimDrawingFolderAssociation(Guid.NewGuid().ToString("D"), a.LineNumber, selected.Root.Id,
                selected.Relative, selected.Relative.Length == 0 ? selected.Root.Label : Path.GetFileName(selected.Path),
                r.Customer.CustomerId, a.AssemblyNumber, a.Revision, actor.DisplayName, now);
            dataset.Records[index] = r with { DrawingFolders = [.. (r.DrawingFolders ?? []).Where(f => f.LineNumber != a.LineNumber), association] };
            dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset);
            return association;
        }
        finally { gate.Release(); }
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapDrawingFolders(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        // Read once per host: migration is an explicit configuration/activation operation.
        var configuration = Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS");
        async Task<IResult> Guard(HttpContext c, bool write, Func<SimDrawingFolders, Task<object>> action)
        {
            var denied = DeniedTechnicalReview(c, state, personas, write ? "technical_review.disposition" : "technical_review.view");
            if (denied is not null) return denied;
            c.Response.Headers["Cache-Control"] = "private, no-store";
            try { return Results.Json(await action(new SimDrawingFolders(configuration))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode: p.StatusCode); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            { return Results.Json(new { code = "SIM_DRAWING_FOLDER_UNAVAILABLE", message = "Drawing folder access is unavailable. Check the source and runtime access; no files were imported. Reopen before retrying a save." }, statusCode: 503); }
        }
        app.MapGet("/api/sim/technical-reviews/{id}/drawing-folder", (string id, int line, HttpContext c) =>
            Guard(c, false, async sources => new { review = await store.ReadDrawingFolder(id, line), roots = sources.Choices() }));
        app.MapGet("/api/sim/technical-reviews/{id}/drawing-folder/contents", (string id, int line, string rootId, string relativePath, HttpContext c) =>
            Guard(c, false, async sources => { await store.ReadDrawingFolder(id, line); return sources.Browse(rootId, relativePath); }));
        app.MapGet("/api/sim/technical-reviews/{id}/drawing-folder/file", (string id, int line, string relativePath, string role, HttpContext c) =>
            Guard(c, false, async sources => await store.DescribeLinkedDrawingFile(id, line, relativePath, role, sources)));
        app.MapPost("/api/sim/technical-reviews/{id}/drawing-folder/file", (string id, SimLinkedFileRequest request, HttpContext c) =>
            Guard(c, true, async sources => await store.AddReviewDocument(id, "", 0, new(request.Type, "PARENT_ASSEMBLY"), Stream.Null, personas.Resolve(c), request, sources)));
        app.MapPut("/api/sim/technical-reviews/{id}/drawing-folder", (string id, SimDrawingFolderRequest request, HttpContext c) =>
            Guard(c, true, async sources => await store.SaveDrawingFolder(id, request, personas.Resolve(c), sources)));
    }
}
