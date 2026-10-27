internal static partial class SimRfqIntakeEndpoints
{
    internal static void MapAssemblyLibrary(WebApplication app, SimStateStore state, SimPersonaSessionStore personas, string repositoryRoot, Func<SimAssemblyHeader[]>? headers = null)
    {
        app.MapGet("/api/sim/assembly-library/preliminary", (HttpContext context) => {
            context.Response.Headers.CacheControl = "private, no-store";
            var denied = DeniedTechnicalReview(context, state, personas, "assembly_library.view");
            if (denied is not null) return denied;
            try {
                var rows = headers?.Invoke() ?? SimAssemblyLibrarySnapshot.Read(Path.Combine(repositoryRoot, "Tools", "SimRuntime", "ReferenceSnapshots",
                    "AssemblyLibrary_Preliminary_2026-07-29", "BillOfMaterial.csv"));
                return Results.Json(new { environment = "SIM", preliminary = true, snapshotDate = "2026-07-29",
                    runId = SimAssemblyLibrarySnapshot.RunId, sourceSha256 = SimAssemblyLibrarySnapshot.CsvHash,
                    estimateHistoryContractVersion = 1, totalHeaders = rows.Length, blankDrawingCount = rows.Count(r=>string.IsNullOrWhiteSpace(r.DrawingNumber)), items = rows });
            } catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or Microsoft.VisualBasic.FileIO.MalformedLineException) {
                return Results.Json(new { message = "The verified preliminary snapshot is unavailable. No source refresh was attempted." }, statusCode: 503);
            }
        });
    }
}
