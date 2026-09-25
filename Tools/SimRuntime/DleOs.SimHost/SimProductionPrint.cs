using System.Text.Json;

// Reference output only. The caller supplies one read projection; rendering never saves
// a document, approves a Traveler, or creates an execution/signoff event.
internal static class SimProductionPrint
{
    internal static Task<byte[]> Create(JsonElement projection, string kind, SimPersona actor, DateTimeOffset generatedAt)
    {
        if (kind is not ("traveler" or "bom")) throw new ArgumentOutOfRangeException(nameof(kind));
        if (projection.ValueKind != JsonValueKind.Object) throw new ArgumentException("A Production package is required.", nameof(projection));
        return SimQuotationPdf.RenderDocument(new
        {
            kind,
            package = projection,
            generatedBy = actor.DisplayName,
            generatedAt = generatedAt.ToUniversalTime().ToString("O"),
            rendererVersion = "DLE_PRODUCTION_REFERENCE_V1"
        }, "sim_production_pdf.py");
    }
}
