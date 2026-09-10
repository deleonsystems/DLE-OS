using System.Security.Cryptography;
using System.Text.Json;

internal sealed class SimIntakeDocuments(string stateRoot)
{
    private readonly string root = SimRuntimeOptions.ResolveStatePath(stateRoot, "intake-documents");
    private readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web);
    private sealed record Manifest(string Owner, SimRfqIntakeDocument Document, string Sha256);
    private string Folder(string draft)
    {
        if (!Guid.TryParseExact(draft, "D", out var id)) throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_ID_INVALID", "Invalid SIM document identity.");
        return Path.Combine(root, id.ToString("D"));
    }
    private string FilePath(string draft, string document, string suffix)
    {
        if (!Guid.TryParseExact(document, "D", out var id)) throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_ID_INVALID", "Invalid SIM document identity.");
        var folder = Folder(draft);
        foreach (var path in new[] { stateRoot, root, folder })
            if (Directory.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_BOUNDARY_INVALID", "SIM document storage boundary is unavailable.");
        var result = Path.Combine(folder, id.ToString("D") + suffix);
        if (File.Exists(result) && (File.GetAttributes(result) & FileAttributes.ReparsePoint) != 0)
            throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_BOUNDARY_INVALID", "SIM document storage boundary is unavailable.");
        return result;
    }
    internal async Task<SimRfqIntakeDocument> Stage(string draft, string name, long lastModified, Stream input, string owner)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 240 || name.Any(char.IsControl) || name.IndexOfAny(['/', '\\', ':', '\r', '\n', '\0']) >= 0 || name is "." or "..")
            throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_NAME_INVALID", "Provide an original filename without a path.");
        var id = Guid.NewGuid().ToString("D");
        var path = FilePath(draft, id, ".bin");
        Directory.CreateDirectory(Folder(draft));
        try
        {
            using var memory = new MemoryStream();
            var buffer = new byte[81920];
            int read;
            while ((read = await input.ReadAsync(buffer)) > 0)
            {
                if (memory.Length + read > 20 * 1024 * 1024) throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_TOO_LARGE", "SIM supports files up to 20 MB each.");
                memory.Write(buffer, 0, read);
            }
            var bytes = memory.ToArray();
            if (bytes.Length == 0) throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_EMPTY", "The selected file is empty.");
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            await File.WriteAllBytesAsync(path, bytes);
            if (Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))) != hash) throw new IOException("SIM document verification failed.");
            var extension = Path.GetExtension(name).ToLowerInvariant();
            var type = extension == ".pdf" && bytes.AsSpan().StartsWith("%PDF-"u8) ? "application/pdf" : extension == ".xls" ? "application/vnd.ms-excel" : "application/octet-stream";
            var doc = new SimRfqIntakeDocument(name, bytes.Length, type, lastModified, id, "VERIFIED", $"sim-document:{draft}:{id}", DateTimeOffset.UtcNow);
            var manifestPath = FilePath(draft, id, ".json");
            var manifest = new Manifest(owner, doc, hash);
            await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, json));
            if (JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(manifestPath), json) != manifest) throw new IOException("SIM document reference verification failed.");
            return doc;
        }
        catch { if (File.Exists(path)) File.Delete(path); var metadata = FilePath(draft,id,".json"); if(File.Exists(metadata)) File.Delete(metadata); throw; }
    }
    internal async Task<SimRfqIntakeDocument> Verify(string draft, SimRfqIntakeDocument requested, string owner)
    {
        var manifest = await ReadManifest(draft, requested.DocumentId!);
        if (manifest.Owner != owner || manifest.Document.Name != requested.Name || manifest.Document.Size != requested.Size)
            throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_REFERENCE_INVALID", "The staged document does not belong to this intake submission.");
        await Bytes(draft, manifest.Document.DocumentId!);
        return manifest.Document;
    }
    private async Task<Manifest> ReadManifest(string draft, string id)
    {
        var path = FilePath(draft,id,".json");
        if (!File.Exists(path)) throw SimRfqIntakeProblem.NotFound("SIM_DOCUMENT_NOT_FOUND", "The staged SIM document was not found.");
        return JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(path), json) ?? throw new IOException("Invalid SIM document metadata.");
    }
    internal async Task<byte[]> Bytes(string draft, string id)
    {
        var manifest = await ReadManifest(draft,id);
        var path = FilePath(draft,id,".bin");
        if (!File.Exists(path)) throw SimRfqIntakeProblem.NotFound("SIM_DOCUMENT_NOT_FOUND", "The staged SIM document was not found.");
        var bytes = await File.ReadAllBytesAsync(path);
        if (bytes.LongLength != manifest.Document.Size || Convert.ToHexString(SHA256.HashData(bytes)) != manifest.Sha256)
            throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_VERIFICATION_FAILED", "The staged document failed verification. Nothing was opened.");
        return bytes;
    }
    internal async Task Remove(string draft, string id, string owner)
    {
        var manifest = await ReadManifest(draft,id);
        if (manifest.Owner != owner) throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_REFERENCE_INVALID", "The staged document belongs to another SIM intake user.");
        File.Delete(FilePath(draft,id,".bin")); File.Delete(FilePath(draft,id,".json"));
    }
}
