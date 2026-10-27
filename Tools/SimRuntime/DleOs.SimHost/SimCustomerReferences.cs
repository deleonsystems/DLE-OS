using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

// SIM-local reference snapshots. No network client, upstream credential or business-state writer.
internal sealed record SimReferenceCustomer(string ReferenceId, string CustomerNumber, string DisplayName,
    string[] Aliases, string[] SourceLabels, string SourcePackageId = "");
internal sealed record SimReferencePackage(string LedgerSha256, JsonElement Manifest);
internal sealed record SimReferenceSnapshot(int ContractVersion, SimReferenceCustomer[] Customers,
    Dictionary<string, SimReferencePackage> Packages, string LatestPackageId);
internal sealed record SimReferencePreview(string ExpectedVersion, string PackageId, string LedgerSha256,
    int IncomingCount, int Added, int Updated, int Retained, int NameCollisionGroups, bool AlreadyImported);

internal sealed class SimCustomerReferences
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) {
        WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static readonly string[] Labels = ["Customer Master", "Open Orders", "Sales Orders", "Invoice History"];
    private readonly string root;
    internal SimCustomerReferences(string stateRoot)
    {
        var local = Path.GetFullPath(stateRoot);
        if (local.StartsWith(@"\\", StringComparison.Ordinal)) throw new IOException("Reference store must be local.");
        root = Path.Combine(local, "reference", "customer-directory");
        Safe(root);
    }
    private static void Safe(string path)
    {
        for (var p = Path.GetFullPath(path); !string.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
            if ((File.Exists(p) || Directory.Exists(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Reference paths must not traverse reparse points.");
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static bool Version(string value) => Regex.IsMatch(value, "^[A-F0-9]{64}$");
    internal string CurrentVersion()
    {
        Safe(root);
        var path = Path.Combine(root, "current.json"); Safe(path);
        if (!File.Exists(path)) return "none";
        var value = JsonSerializer.Deserialize<string>(File.ReadAllBytes(path), Json) ?? "";
        if (value != "none" && !Version(value)) throw new IOException("Invalid reference version.");
        return value;
    }
    internal SimReferenceSnapshot Read(string? version = null)
    {
        version ??= CurrentVersion();
        if (version == "none") return new(1, [], new(StringComparer.Ordinal), "");
        if (!Version(version)) throw new IOException("Invalid reference version.");
        var path = Path.Combine(root, "versions", version + ".json"); Safe(path);
        var bytes = File.ReadAllBytes(path);
        if (Hash(bytes) != version) throw new IOException("Reference snapshot hash mismatch.");
        var snapshot = JsonSerializer.Deserialize<SimReferenceSnapshot>(bytes, Json) ?? throw new IOException("Invalid snapshot.");
        if (snapshot.ContractVersion != 1) throw new IOException("Unsupported reference contract.");
        ValidateRows(snapshot.Customers);
        foreach (var row in snapshot.Customers)
            if (!snapshot.Packages.ContainsKey(row.SourcePackageId)) throw new IOException("Missing reference provenance.");
        return snapshot;
    }
    private static void ValidateRows(SimReferenceCustomer[] rows)
    {
        if (rows.Length > 100000) throw new IOException("Reference directory exceeds supported size.");
        var numbers = new HashSet<string>(StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in rows) {
            if (string.IsNullOrWhiteSpace(c.CustomerNumber) || c.CustomerNumber.Length > 64 ||
                c.CustomerNumber != c.CustomerNumber.Trim() || c.CustomerNumber.Any(char.IsControl) ||
                c.ReferenceId != "dle-customer:" + c.CustomerNumber ||
                c.CustomerNumber is "990100" or "990901" ||
                !numbers.Add(c.CustomerNumber) || !ids.Add(c.ReferenceId) ||
                string.IsNullOrWhiteSpace(c.DisplayName) || c.DisplayName.Length > 500 ||
                c.DisplayName.Any(char.IsControl) || c.Aliases is null || c.SourceLabels is null ||
                c.Aliases.Any(a => string.IsNullOrWhiteSpace(a) || a.Length > 500 || a.Any(char.IsControl)) ||
                c.SourceLabels.Any(s => !Labels.Contains(s)))
                throw new IOException("Invalid, duplicate or fixture-conflicting customer identity.");
        }
    }
    private static byte[] BoundedRead(string path, long maximum)
    {
        Safe(path);
        using var input = File.OpenRead(path);
        if (input.Length > maximum) throw new IOException("Reference file exceeds supported size.");
        using var buffer = new MemoryStream();
        input.CopyTo(buffer);
        if (buffer.Length > maximum) throw new IOException("Reference file changed size.");
        return buffer.ToArray();
    }
    private static (string Id, string Hash, JsonElement Manifest, SimReferenceCustomer[] Rows) Package(string directory)
    {
        directory = Path.GetFullPath(directory); Safe(directory);
        var ledgerBytes = BoundedRead(Path.Combine(directory, "hashes.json"), 2_000_000);
        using var ledger = JsonDocument.Parse(ledgerBytes);
        var contents = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var entry in ledger.RootElement.EnumerateArray()) {
            var relative = entry.GetProperty("path").GetString() ?? "";
            if (relative.Length == 0 || relative.Contains('\\') || relative.Contains(':') ||
                relative.StartsWith('/') || relative.Split('/').Any(s => s is "" or "." or "..") ||
                contents.ContainsKey(relative) || contents.Count >= 1000)
                throw new IOException("Unsafe or duplicate package path.");
            var bytes = BoundedRead(Path.Combine(directory, relative), 32_000_000);
            total += bytes.Length;
            if (total > 100_000_000 || entry.GetProperty("bytes").GetInt64() != bytes.Length ||
                !Hash(bytes).Equals(entry.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
                throw new IOException("Package hash/size verification failed.");
            contents.Add(relative, bytes);
        }
        if (!contents.TryGetValue("manifest.json", out var manifestBytes) ||
            !contents.TryGetValue("sim-customer-reference.json", out var data) ||
            !contents.ContainsKey("schema/sim-customer-reference.schema.json"))
            throw new IOException("Package is missing required verified files.");
        using var parsed = JsonDocument.Parse(manifestBytes);
        var manifest = parsed.RootElement.Clone();
        var id = manifest.GetProperty("packageId").GetString() ?? "";
        if (!Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,160}$") ||
            manifest.GetProperty("schemaVersion").GetString() != "DLE_SIM_CUSTOMER_REFERENCE_PACKAGE_V1" ||
            manifest.GetProperty("status").GetString() != "PASS_OPTIMISTIC_VERSION_BRACKETED" ||
            !DateTimeOffset.TryParse(manifest.GetProperty("captureCompletedAtUtc").GetString(), out _))
            throw new IOException("Unsupported package manifest.");
        // Validate our fixed v1 contract, never execute or relax validation based on a supplied schema.
        using var inputRows = JsonDocument.Parse(data);
        string[] required = ["referenceId", "customerNumber", "displayName", "aliases", "sourceLabels"];
        foreach (var row in inputRows.RootElement.EnumerateArray()) {
            var fields = row.EnumerateObject().Select(p => p.Name).ToArray();
            if (fields.Length != 5 || !required.All(fields.Contains)) throw new IOException("Invalid v1 customer fields.");
        }
        var rows = JsonSerializer.Deserialize<SimReferenceCustomer[]>(data, Json) ?? throw new IOException("Invalid customers.");
        ValidateRows(rows);
        if (rows.Length == 0 || manifest.GetProperty("customerCount").GetInt32() != rows.Length)
            throw new IOException("Package count mismatch.");
        return (id, Hash(ledgerBytes), manifest, rows.Select(r => r with { SourcePackageId = id }).ToArray());
    }
    private (SimReferencePreview Preview, SimReferenceSnapshot Snapshot) Prepare(string package)
    {
        var version = CurrentVersion(); var current = Read(version); var incoming = Package(package);
        if (current.Packages.TryGetValue(incoming.Id, out var known) && known.LedgerSha256 != incoming.Hash)
            throw new IOException("An existing package ID has different content.");
        var merged = current.Customers.ToDictionary(c => c.CustomerNumber, StringComparer.Ordinal);
        int added = 0, updated = 0;
        foreach (var row in incoming.Rows) {
            if (!merged.TryGetValue(row.CustomerNumber, out var old)) added++;
            else if (old.ReferenceId != row.ReferenceId) throw new IOException("Customer ID conflict.");
            else if (JsonSerializer.Serialize(old with { SourcePackageId = incoming.Id }, Json) != JsonSerializer.Serialize(row, Json)) updated++;
            merged[row.CustomerNumber] = row;
        }
        var groups = merged.Values.SelectMany(c => c.Aliases.Append(c.DisplayName).Select(n => (Name:n.Trim().ToUpperInvariant(), c.CustomerNumber)))
            .GroupBy(x => x.Name).Count(g => g.Select(x => x.CustomerNumber).Distinct().Count() > 1);
        var packages = new Dictionary<string, SimReferencePackage>(current.Packages, StringComparer.Ordinal);
        packages[incoming.Id] = new(incoming.Hash, incoming.Manifest);
        return (new(version, incoming.Id, incoming.Hash, incoming.Rows.Length, added, updated,
            current.Customers.Count(c => !incoming.Rows.Any(n => n.CustomerNumber == c.CustomerNumber)), groups, known is not null),
            new(1, merged.Values.OrderBy(c => c.CustomerNumber, StringComparer.Ordinal).ToArray(), packages, incoming.Id));
    }
    internal SimReferencePreview Preview(string package) => Prepare(package).Preview;
    internal string Import(string package, string expected)
    {
        Directory.CreateDirectory(root); Safe(root);
        using var gate = new FileStream(Path.Combine(root, "import.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var prepared = Prepare(package);
        if (prepared.Preview.ExpectedVersion != expected) throw new IOException("Reference version changed; preview again.");
        if (prepared.Preview.AlreadyImported) return expected;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(prepared.Snapshot, Json); var version = Hash(bytes);
        var versions = Path.Combine(root, "versions"); Safe(versions); Directory.CreateDirectory(versions);
        var path = Path.Combine(versions, version + ".json");
        if (!File.Exists(path)) Atomic(path, bytes);
        _ = Read(version); // Verify staged version before activation.
        Atomic(Path.Combine(root, "current.json"), JsonSerializer.SerializeToUtf8Bytes(version, Json));
        return version;
    }
    internal void Activate(string version, string expected)
    {
        Directory.CreateDirectory(root); Safe(root);
        using var gate = new FileStream(Path.Combine(root, "import.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (CurrentVersion() != expected) throw new IOException("Reference version changed; inspect again.");
        _ = Read(version);
        Atomic(Path.Combine(root, "current.json"), JsonSerializer.SerializeToUtf8Bytes(version, Json));
    }
    private static void Atomic(string path, byte[] bytes)
    {
        Safe(path); var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(bytes); stream.Flush(true);
            }
            File.Move(temporary, path, true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
