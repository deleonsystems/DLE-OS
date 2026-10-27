using System.Text.Json;

internal sealed partial class SimRfqIntakeStore
{
    internal SimCustomerReferences CustomerReferences => new(Path.GetDirectoryName(Path.GetDirectoryName(dataPath)!)!);
}
internal static partial class SimRfqIntakeEndpoints
{
    private static IResult SearchCustomerReferences(HttpContext context, SimRfqIntakeStore store)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        var query = context.Request.Query["q"].ToString().Trim();
        var pageText = context.Request.Query["page"].ToString();
        var sizeText = context.Request.Query["pageSize"].ToString();
        var page = pageText.Length == 0 ? 1 : int.TryParse(pageText, out var p) ? p : 0;
        var size = sizeText.Length == 0 ? 25 : int.TryParse(sizeText, out var s) ? s : 0;
        if (query.Length > 100 || query.Any(char.IsControl) || page < 1 || size is < 1 or > 50)
            return Results.BadRequest(new { message = "Invalid customer search or page." });
        try {
            var references = store.CustomerReferences;
            var version = references.CurrentVersion(); var snapshot = references.Read(version);
            var rows = Customers.Select(c => JsonSerializer.SerializeToElement(c)).ToList();
            foreach (var c in snapshot.Customers) {
                var manifest = snapshot.Packages[c.SourcePackageId].Manifest;
                rows.Add(JsonSerializer.SerializeToElement(new {
                    customerId = c.ReferenceId, customerNumber = c.CustomerNumber, customerName = c.DisplayName,
                    aliases = c.Aliases, sources = c.SourceLabels, synthetic = false,
                    referenceVersion = version, sourcePackageId = c.SourcePackageId,
                    capturedAtUtc = manifest.GetProperty("captureCompletedAtUtc"),
                    freshness = manifest.GetProperty("freshness")
                }));
            }
            bool Match(JsonElement row) => query.Length == 0 ||
                row.GetProperty("customerNumber").GetString()!.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                row.GetProperty("customerName").GetString()!.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                row.GetProperty("aliases").EnumerateArray().Any(a => a.GetString()!.Contains(query, StringComparison.OrdinalIgnoreCase));
            var matched = rows.Where(Match).OrderBy(c => c.GetProperty("customerName").GetString(), StringComparer.OrdinalIgnoreCase)
                .ThenBy(c => c.GetProperty("customerNumber").GetString(), StringComparer.Ordinal).ToArray();
            var items = matched.Skip((int)Math.Min((long)(page - 1) * size, int.MaxValue)).Take(size).ToArray();
            return Results.Json(new { query, items, returnedCount = items.Length, totalItems = matched.Length,
                page, pageSize = size, totalPages = (int)Math.Ceiling((double)matched.Length / size),
                hasMore = (long)page * size < matched.Length, environment = "SIM",
                synthetic = snapshot.Customers.Length == 0, referenceVersion = version, referenceCount = snapshot.Customers.Length });
        } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException) {
            return Results.Json(new { message = "Local customer references are unavailable. Restore a verified reference version; no upstream lookup was attempted." }, statusCode: 503);
        }
    }
}
