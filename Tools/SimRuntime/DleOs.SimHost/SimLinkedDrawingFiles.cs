using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimLinkedSource(string RootId, string RelativePath, string FolderAssociationId, int LineNumber,
    string CustomerId, string AssemblyNumber, string Revision, string Role, long Size, DateTimeOffset LastWriteUtc,
    DateTimeOffset CreatedUtc, string Sha256, string SourceToken, string SelectionId);
internal sealed record SimLinkedFileRequest(int LineNumber, string ExpectedFolderToken, string RelativePath,
    string Role, string SourceToken, string SelectionId, string Type);
internal sealed record SimLinkedFileRead(string Name, byte[] Bytes, SimLinkedSource Source);

internal sealed partial class SimDrawingFolders
{
    internal async Task<SimLinkedFileRead> ReadFile(SimDrawingFolderAssociation link, string relative, string role)
    {
        relative = Normalize(relative);
        if (role is not ("DRAWING_REFERENCE" or "BOM_REFERENCE" or "LIBRARY_DOCUMENT"))
            throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_ROLE", "Choose Drawing / Reference or BOM reference.");
        if (relative.Length == 0 || (link.RelativePath.Length > 0 && !relative.StartsWith(link.RelativePath + "/", StringComparison.OrdinalIgnoreCase)))
            throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_SCOPE", "Select a file within this assembly's linked folder.");
        var slash = relative.LastIndexOf('/');
        var directory = slash < 0 ? "" : relative[..slash]; var name = relative[(slash + 1)..];
        var extension = Path.GetExtension(name).ToLowerInvariant();
        if (!(role == "LIBRARY_DOCUMENT" ? new[]{".pdf", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp"} : role == "DRAWING_REFERENCE" ? new[]{".pdf", ".docx"} : new[]{".pdf", ".docx", ".xls", ".xlsx", ".csv", ".txt"}).Contains(extension))
            throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_FORMAT", "Choose PDF, DOCX, XLS, XLSX, CSV or TXT for the supported reference role. Library documents also support PNG, JPG, JPEG, GIF and WebP. Other files remain browse-only.");
        var selected = Resolve(link.RootId, directory); var path = Path.Combine(selected.Path, name);
        void CheckFile() { if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
            throw SimRfqIntakeProblem.Conflict("SIM_LINKED_FILE_LINK", "Select a regular file; linked files and reparse points are not supported."); }
        CheckFile();
        var info = new FileInfo(path); var length = info.Length; var modified = info.LastWriteTimeUtc; var created = info.CreationTimeUtc;
        if (length <= 0 || length > 20 * 1024 * 1024) throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_SIZE", "Choose a nonempty file up to 20 MB.");
        // Deny concurrent writes/deletion while reading. Revalidate the directory chain and identity after the bounded read.
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.Asynchronous);
        using var memory = new MemoryStream(); var buffer = new byte[81920]; int count;
        while ((count = await file.ReadAsync(buffer)) > 0) { if (memory.Length + count > 20 * 1024 * 1024) throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_SIZE", "Choose a file up to 20 MB."); memory.Write(buffer, 0, count); }
        Resolve(link.RootId, directory); CheckFile(); info.Refresh();
        if (info.Length != length || memory.Length != length || info.LastWriteTimeUtc != modified || info.CreationTimeUtc != created)
            throw SimRfqIntakeProblem.Conflict("SIM_LINKED_STALE", "The source changed. Select it again before saving a copy.");
        var bytes = memory.ToArray(); var sha = Convert.ToHexString(SHA256.HashData(bytes));
        var source = new SimLinkedSource(link.RootId, relative, link.Id, link.LineNumber, link.CustomerId, link.AssemblyNumber,
            link.Revision, role, length, modified, created, sha, "", "");
        var token = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(source))));
        return new(name, bytes, source with { SourceToken = token });
    }
}
internal sealed partial class SimRfqIntakeStore
{
    private static SimDrawingFolderAssociation LinkedFileAssociation(SimRfqIntakeRecord r, int line)
    {
        var a = DrawingAssembly(r, line);
        var link = r.DrawingFolders?.SingleOrDefault(f => f.LineNumber == line) ?? throw SimRfqIntakeProblem.Conflict("SIM_LINKED_FOLDER_REQUIRED", "Link a drawing folder for this assembly first.");
        if (link.CustomerId != r.Customer.CustomerId || link.AssemblyNumber != a.AssemblyNumber || link.Revision != a.Revision)
            throw SimRfqIntakeProblem.Conflict("SIM_LINKED_CONTEXT", "The assembly context changed. Review and save its folder link again.");
        return link;
    }
    internal async Task<object> DescribeLinkedDrawingFile(string id, int line, string relative, string role, SimDrawingFolders sources)
    {
        var r = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && IsTechnicalReviewRecord(r)) ?? throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review not found.");
        var read = await sources.ReadFile(LinkedFileAssociation(r, line), relative, role);
        return new { read.Name, source = read.Source, folderToken = DrawingFolderToken(r, DrawingAssembly(r, line)) };
    }
    private async Task<SimLinkedFileRead> ValidateLinkedDrawingFile(SimRfqIntakeRecord r, SimLinkedFileRequest request, SimDrawingFolders sources)
    {
        if (!CanLinkDrawingFolder(r) || DrawingFolderToken(r, DrawingAssembly(r, request.LineNumber)) != request.ExpectedFolderToken)
            throw SimRfqIntakeProblem.Conflict("SIM_LINKED_FOLDER_STALE", "The review or linked folder changed. Reopen the selector.");
        if (!Guid.TryParseExact(request.SelectionId, "D", out _) || request.Role is not ("DRAWING_REFERENCE" or "BOM_REFERENCE") ||
            !(request.Role == "DRAWING_REFERENCE" ? new[]{"DRAWING", "DRAWING_AND_BOM"} : new[]{"BOM_ONLY", "DRAWING_AND_BOM", "VPRO5_BOM_EXPORT"}).Contains(request.Type))
            throw SimRfqIntakeProblem.BadRequest("SIM_LINKED_SELECTION", "Choose the reference role and document type before saving one copy.");
        var read = await sources.ReadFile(LinkedFileAssociation(r, request.LineNumber), request.RelativePath, request.Role);
        if (read.Source.SourceToken != request.SourceToken) throw SimRfqIntakeProblem.Conflict("SIM_LINKED_STALE", "The source file changed since selection. Select it again; no copy was saved.");
        return read with { Source = read.Source with { SelectionId = request.SelectionId } };
    }
}
