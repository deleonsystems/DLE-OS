// DLE-owned policy. A missing policy version retains historical V1/V2 selection semantics.
internal static class SimAnalysisSourceSelection
{
    private static bool Reviewed(SimTechnicalPackage package, SimPackageDocument doc) =>
        doc.IdentityReview is { } identity ? identity.Decision is "CONFIRMED" or "CORRECTED" :
        !string.IsNullOrWhiteSpace(package.ReviewedBy); // Historical package-level review.

    internal static string? Purpose(SimTechnicalPackage package, SimPackageDocument doc)
    {
        if (!package.Documents.Contains(doc) || doc.RowAssociation is not null) return null;
        if (doc.DocumentId == package.GoverningBomDocumentId) return "GOVERNING_BOM";
        if (!Reviewed(package, doc) || doc.DocumentType is not
            ("BOM" or "ASSEMBLY_DRAWING" or "SUBASSEMBLY_BOM" or "SUPPORTING_DOCUMENT" or "ALTERNATE_PART_APPROVAL") ||
            doc.Role is not ("SUPPORTING" or "REFERENCED" or "UNRESOLVED")) return null;

        var manufacturer = doc.PartNumberReview?.ProvidesManufacturerPartNumbers == true;
        // SUPPORTING_REFERENCE is also the inventory default: it does not establish assembly scope.
        if (doc.Applicability is not ("PARENT_ASSEMBLY" or "SUBASSEMBLY"))
        {
            if (manufacturer)
                throw SimRfqIntakeProblem.Conflict("ANALYSIS_ENRICHMENT_SCOPE_REQUIRED",
                    $"Review Applies to for manufacturer-information document {doc.DocumentId}. Supporting / Reference does not establish assembly scope.");
            return null;
        }
        var governing = package.Documents.SingleOrDefault(d => d.DocumentId == package.GoverningBomDocumentId);
        if (governing is null || doc.Applicability != governing.Applicability) return null;
        if (doc.Applicability == "SUBASSEMBLY")
        {
            if (string.IsNullOrWhiteSpace(doc.SubassemblyPartNumber) || doc.SubassemblyPartNumber != governing.SubassemblyPartNumber) return null;
        }
        else if (!string.IsNullOrWhiteSpace(doc.SubassemblyPartNumber)) return null;

        if (manufacturer) return "MANUFACTURER_ENRICHMENT";
        if (doc.BomUse == "NO_BOM_ROLE" && SimTechnicalPackageProvider.BomBearing(doc)) return null;
        return doc.Role is "SUPPORTING" or "REFERENCED" ? "REFERENCE" : null;
    }

    internal static SimPackageDocument[] Select(SimTechnicalPackage package, string? version)
    {
        if (version is not null && version != DleAnalysisContract.SourceSelectionVersion)
            throw new InvalidDataException("Unsupported analysis source-selection policy.");
        var selected = package.Documents.Where(d => d.RowAssociation is null).Where(d => version is null
            ? d.DocumentId == package.GoverningBomDocumentId || d.Role == "SUPPORTING"
            : Purpose(package, d) is not null).ToArray();
        if (selected.Length is < 1 or > 4)
            throw SimRfqIntakeProblem.Conflict("ANALYSIS_SOURCE_LIMIT", "This pilot supports up to four approved sources.");
        return selected;
    }
}
