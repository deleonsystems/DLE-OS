internal sealed record SimPackageDocument(string DocumentId, string Name, string DocumentType, string Role, string Applicability, string? SubassemblyPartNumber, bool EmbeddedBom = false);
internal sealed record SimPackageRequest(SimPackageDocument[]? Documents, string? GoverningBomDocumentId);
internal sealed record SimTechnicalPackage(SimPackageDocument[] Documents, string? GoverningBomDocumentId, string Source, bool Synthetic, string ReviewedBy, DateTimeOffset ReviewedAtUtc, string? GoverningBomSourceKind = null);
internal sealed record SimSubassemblyCoverage(string PartNumber, decimal QuantityPerAssembly, string? KnownReference, string[] CustomerDocumentIds, string CoverageState);

internal static class SimTechnicalPackageProvider
{
    internal static bool IsBomSource(SimPackageDocument doc) => doc.DocumentType == "BOM" || (doc.DocumentType == "ASSEMBLY_DRAWING" && doc.EmbeddedBom);
    internal static string SourceKind(SimPackageDocument doc) => doc.DocumentType == "ASSEMBLY_DRAWING" ? "EMBEDDED_IN_ASSEMBLY_DRAWING" : "STANDALONE_BOM";

    internal static SimTechnicalPackage Inventory(SimRfqIntakeRecord record) => new(
        record.TechnicalFiles.Select((file, index) => new SimPackageDocument(file.DocumentId ?? $"DOC-{index + 1:D3}", file.Name, "UNKNOWN", "UNRESOLVED", "SUPPORTING_REFERENCE", null)).ToArray(),
        null, "SIM_RECEIVED_PACKAGE_METADATA_V1", true, "", default);

    internal static SimTechnicalPackage Validate(SimRfqIntakeRecord record, SimPackageRequest request, SimPersona persona)
    {
        var received = Inventory(record).Documents;
        var docs = request.Documents ?? [];
        if (docs.Length != received.Length || docs.Any(doc => doc is null) || docs.Select(doc => doc.DocumentId).Distinct().Count() != received.Length ||
            received.Any(file => !docs.Any(doc => doc.DocumentId == file.DocumentId && doc.Name == file.Name)))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_PACKAGE_INVENTORY_INVALID", "Account for every received file exactly once; received identities and names cannot be changed.");
        foreach (var doc in docs)
        {
            if (!new[] { "BOM", "ASSEMBLY_DRAWING", "SUBASSEMBLY_BOM", "ALTERNATE_PART_APPROVAL", "GERBER", "SUPPORTING_DOCUMENT", "UNKNOWN" }.Contains(doc.DocumentType) ||
                !new[] { "GOVERNING", "REFERENCED", "SUPPORTING", "UNRESOLVED" }.Contains(doc.Role) ||
                !new[] { "PARENT_ASSEMBLY", "SUBASSEMBLY", "SUPPORTING_REFERENCE" }.Contains(doc.Applicability) ||
                (doc.SubassemblyPartNumber?.Length ?? 0) > 120 || (doc.EmbeddedBom && doc.DocumentType != "ASSEMBLY_DRAWING"))
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_PACKAGE_CLASSIFICATION_INVALID", "Choose a supported document type, role and applicability.");
        }
        var governing = string.IsNullOrWhiteSpace(request.GoverningBomDocumentId) ? null : request.GoverningBomDocumentId;
        var parentGoverning = docs.Where(doc => doc.Role == "GOVERNING" && doc.Applicability == "PARENT_ASSEMBLY" && new[] { "BOM", "SUBASSEMBLY_BOM" }.Contains(doc.DocumentType)).ToArray();
        var selected = docs.SingleOrDefault(doc => doc.DocumentId == governing);
        if (governing is null ? parentGoverning.Length != 0 : selected is null || !IsBomSource(selected) || selected.Applicability != "PARENT_ASSEMBLY" ||
            (selected.DocumentType == "BOM" ? parentGoverning.Length != 1 || parentGoverning[0].DocumentId != governing : parentGoverning.Length != 0))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_GOVERNING_BOM_INVALID", "Explicitly select one parent BOM as governing, or leave the parent BOM unresolved.");
        return new(docs.Select(doc => doc with { SubassemblyPartNumber = doc.Applicability == "SUBASSEMBLY" ? doc.SubassemblyPartNumber?.Trim() : null }).ToArray(), governing,
            "SIM_RECEIVED_PACKAGE_METADATA_V1", true, persona.DisplayName, DateTimeOffset.UtcNow, selected is null ? null : SourceKind(selected));
    }

    internal static SimSubassemblyCoverage[] Coverage(SimTechnicalPackage package, SimMaterialsDefinition result) => result.Subassemblies.Select(line =>
    {
        var documents = package.Documents.Where(doc => doc.Applicability == "SUBASSEMBLY" &&
            string.Equals(doc.SubassemblyPartNumber, line.PartNumber, StringComparison.OrdinalIgnoreCase) && doc.DocumentType != "UNKNOWN").Select(doc => doc.DocumentId).ToArray();
        return new SimSubassemblyCoverage(line.PartNumber, line.QuantityPerAssembly, line.TechnicalReference, documents,
            line.TechnicalReference is not null || package.Documents.Any(doc => documents.Contains(doc.DocumentId) && doc.Role != "UNRESOLVED" && new[] { "BOM", "SUBASSEMBLY_BOM", "ASSEMBLY_DRAWING", "SUPPORTING_DOCUMENT" }.Contains(doc.DocumentType)) ? "COVERED" : "UNRESOLVED");
    }).ToArray();
}
