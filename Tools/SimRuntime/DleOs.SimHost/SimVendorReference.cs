using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

// Read-only reference for the Vendors workspace. This is a retained July 2026
// canonical snapshot, not an ERP connection or a supplier approval list.
internal sealed class SimVendorReference
{
    internal const string FileName = "vendors-2026-07-29.json";
    internal const string SnapshotSha256 = "97BA0468094CCFDE968EE2FE5F512F5AA0BEC6B6CF1C2CC85866C45E98F5F557";
    internal const string RelativeDirectory = "vendor-reference-v1";
    private const int MaximumFileBytes = 2 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private readonly string directory;
    private readonly string path;
    private readonly string expectedHash;
    private readonly int expectedCount;

    internal SimVendorReference(string stateRoot, string expectedHash = SnapshotSha256, int expectedCount = 805)
    {
        directory = Path.Combine(stateRoot, RelativeDirectory);
        path = Path.Combine(directory, FileName);
        this.expectedHash = expectedHash;
        this.expectedCount = expectedCount;
    }

    internal static bool CanRead(SimPersona actor) => actor.IsActive && actor.IsSuperAdmin;

    internal async Task<VendorReferencePage> Read(SimPersona actor, string? query, string? pageText,
        string? pageSizeText, CancellationToken cancellationToken = default)
    {
        // Check permission before any file read, including missing/corrupt storage.
        if (!CanRead(actor)) throw new VendorReferenceProblem(403, "vendors_forbidden", "Vendors is available to SIM administrators.");
        var page = ParsePositive(pageText, 1, 1000000, "page");
        var pageSize = ParsePositive(pageSizeText, 20, 50, "pageSize");
        var q = (query ?? "").Trim();
        if (q.Length > 120 || q.Any(char.IsControl))
            throw new VendorReferenceProblem(400, "vendors_query", "Use a name or vendor number up to 120 characters.");

        var snapshot = await Load(cancellationToken);
        var matches = snapshot.Vendors.Where(v => q.Length == 0 ||
            v.VendorNumber.Contains(q, StringComparison.OrdinalIgnoreCase) ||
            v.VendorMasterId.Contains(q, StringComparison.OrdinalIgnoreCase) ||
            (v.VendorName?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false))
            .OrderBy(v => v.VendorNumber, StringComparer.Ordinal)
            .ThenBy(v => v.FirmId, StringComparer.Ordinal).ToArray();
        var totalPages = (matches.Length + pageSize - 1) / pageSize;
        if (page > Math.Max(totalPages, 1))
            throw new VendorReferenceProblem(400, "vendors_page", "That page is not available. Return to the first page.");
        return new(matches.Skip((page - 1) * pageSize).Take(pageSize).ToArray(), page, pageSize,
            matches.Length, totalPages, new(snapshot.Provenance.Source, snapshot.Provenance.AsOfUtc,
                snapshot.Provenance.VendorCount));
    }

    // Materials has its own existing RFQ permission boundary; this does not grant Vendors-module access.
    internal sealed record MaterialSearch(VendorReferenceItem[] Items, string SnapshotSha256, string AsOfUtc, int MaximumResults = 8);
    private static string SearchName(string value) => new(value.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
    private static readonly Dictionary<string,string[]> MaterialAliases = new(StringComparer.Ordinal) {
        ["01586250"] = ["MOUSER"], ["01000049"] = ["PHOTO FAB"], ["01000155"] = ["BLAKE WIRE"]
    };
    internal async Task<MaterialSearch> SearchMaterials(string? query, CancellationToken cancellationToken = default)
    {
        var q=(query ?? "").Trim();
        if(q.Length>120 || q.Any(char.IsControl)) throw new VendorReferenceProblem(400,"vendors_query","Use a name or number up to 120 characters.");
        var snapshot=await Load(cancellationToken);
        if(q.Length==0)return new([],expectedHash,snapshot.Provenance.AsOfUtc);
        var key=SearchName(q);
        int Rank(VendorReferenceItem v) {
            if(v.VendorNumber==q || v.VendorMasterId==q)return 0;
            var names=new[]{v.VendorName ?? ""}.Concat(MaterialAliases.GetValueOrDefault(v.VendorMasterId) ?? []).Select(SearchName).Where(n=>n.Length>0).ToArray();
            if(key.Length==0)return 99;
            if(names.Any(n=>n==key))return 1;
            if(names.Any(n=>n.StartsWith(key,StringComparison.Ordinal)))return 2;
            if(v.VendorNumber.StartsWith(q,StringComparison.Ordinal))return 3;
            if(names.Any(n=>n.Contains(key,StringComparison.Ordinal)))return 4;
            return 99;
        }
        var items=snapshot.Vendors.Select(v=>(Vendor:v,Rank:Rank(v))).Where(x=>x.Rank<99).OrderBy(x=>x.Rank)
            .ThenBy(x=>x.Vendor.VendorName ?? "",StringComparer.OrdinalIgnoreCase).ThenBy(x=>x.Vendor.VendorMasterId,StringComparer.Ordinal)
            .Take(8).Select(x=>x.Vendor).ToArray();
        return new(items,expectedHash,snapshot.Provenance.AsOfUtc);
    }
    internal async Task<VendorReferenceItem> RequireMaterialVendor(string? firmId,string? vendorNumber,string? snapshotHash)
    {
        if(firmId is null || firmId.Length!=2 || vendorNumber is null || vendorNumber.Length!=6 || snapshotHash!=expectedHash)
            throw new VendorReferenceProblem(409,"materials_vendor_identity","Vendor reference changed. Select the vendor again.");
        var snapshot=await Load(default);
        return snapshot.Vendors.SingleOrDefault(v=>v.FirmId==firmId && v.VendorNumber==vendorNumber)
            ?? throw new VendorReferenceProblem(409,"materials_vendor_identity","Vendor is not in this reference.");
    }

    private async Task<ReferenceFile> Load(CancellationToken cancellationToken)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 ||
            (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Vendor reference storage must be a regular local file.");
        if (new FileInfo(path).Length > MaximumFileBytes)
            throw new InvalidDataException("Vendor reference size is invalid.");
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        if (bytes.Length > MaximumFileBytes || !Convert.ToHexString(SHA256.HashData(bytes)).Equals(expectedHash, StringComparison.Ordinal))
            throw new InvalidDataException("Vendor reference hash is invalid.");
        var snapshot = JsonSerializer.Deserialize<ReferenceFile>(bytes, Json)
            ?? throw new InvalidDataException("Vendor reference is missing.");
        if (snapshot.Schema != "dle-os-sim-vendor-reference-v1" || snapshot.Provenance is null ||
            snapshot.Provenance.Source != "VPRO5 canonical snapshot" ||
            !DateTimeOffset.TryParse(snapshot.Provenance.AsOfUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _) ||
            snapshot.Provenance.SourceContractVersion != "VENDOR_MASTER_1.0" ||
            snapshot.Provenance.VendorCount != expectedCount || snapshot.Vendors is null ||
            snapshot.Vendors.Length != expectedCount ||
            snapshot.Vendors.Any(v => v is null || v.FirmId is null || v.FirmId.Length != 2 ||
                v.VendorNumber is null || v.VendorNumber.Length != 6 ||
                v.VendorMasterId != v.FirmId + v.VendorNumber || v.VendorMasterId.Any(char.IsControl) ||
                (v.VendorName?.Length ?? 0) > 30 || (v.VendorName?.Any(char.IsControl) ?? false)) ||
            snapshot.Vendors.Select(v => v.VendorMasterId).Distinct(StringComparer.Ordinal).Count() != expectedCount)
            throw new InvalidDataException("Vendor reference identity or provenance is invalid.");
        return snapshot;
    }

    private static int ParsePositive(string? value, int fallback, int maximum, string field)
    {
        if (value is null) return fallback;
        if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var result) || result < 1 || result > maximum)
            throw new VendorReferenceProblem(400, "vendors_paging", $"{field} must be between 1 and {maximum}.");
        return result;
    }

    internal sealed record VendorReferenceItem(string VendorMasterId, string FirmId, string VendorNumber, string? VendorName);
    internal sealed record VendorReferenceSnapshot(string Source, string AsOfUtc, int VendorCount);
    internal sealed record VendorReferencePage(VendorReferenceItem[] Items, int Page, int PageSize, int TotalItems,
        int TotalPages, VendorReferenceSnapshot Snapshot);
    private sealed record SourcePage(string Name, string Sha256, int Page, int RowCount);
    private sealed record Provenance(string Source, string AsOfUtc, int VendorCount, string VendorMasterImportRunId,
        string SourceQualificationRunId, string ReportedSourcePackageSha256, string SourceContractVersion,
        string RetrievalFinalizedAtUtc, string MetadataEvidence, string Limits, SourcePage[] Pages);
    private sealed record ReferenceFile(string Schema, Provenance Provenance, VendorReferenceItem[] Vendors);
}

internal sealed class VendorReferenceProblem(int status, string code, string message) : Exception(message)
{
    internal int Status { get; } = status;
    internal string Code { get; } = code;
}

internal static class SimVendorReferenceEndpoints
{
    internal static void Map(WebApplication app, SimStateStore state, SimPersonaSessionStore personas, string stateRoot)
    {
        var reference = new SimVendorReference(stateRoot);
        app.MapGet("/api/sim/vendors", async Task<IResult> (HttpContext context) =>
            await Read(context, reference, personas.Resolve(context), state.Current.IsHealthy));
    }

    internal static async Task<IResult> Read(HttpContext context, SimVendorReference reference, SimPersona actor, bool healthy)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        try
        {
            if (!SimVendorReference.CanRead(actor))
                throw new VendorReferenceProblem(403, "vendors_forbidden", "Vendors is available to SIM administrators.");
            if (!healthy)
                return Results.Json(new { code = "vendors_unavailable", message = "SIM is not ready. Try again when it is available." }, statusCode: 503);
            string? Single(string key)
            {
                var value = context.Request.Query[key];
                if (value.Count > 1) throw new VendorReferenceProblem(400, "vendors_query", "Use one value for each search option.");
                return value.Count == 0 ? null : value.ToString();
            }
            var result = await reference.Read(actor, Single("q"), Single("page"), Single("pageSize"), context.RequestAborted);
            return Results.Json(result);
        }
        catch (VendorReferenceProblem e)
        {
            return Results.Json(new { code = e.Code, message = e.Message }, statusCode: e.Status);
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or System.Security.SecurityException or JsonException)
        {
            return Results.Json(new { code = "vendors_unavailable", message = "The saved vendor list is unavailable. No live lookup was attempted." }, statusCode: 503);
        }
    }
}
