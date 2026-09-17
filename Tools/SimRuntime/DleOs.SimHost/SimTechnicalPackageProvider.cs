internal sealed record SimDocumentIdentityReview(string Type, string? OtherDescription = null, string? Decision = null, string? ReviewedBy = null, DateTimeOffset? ReviewedAtUtc = null);
internal sealed record SimPartNumberReview(string? Basis = null, bool? ProvidesManufacturerPartNumbers = null, string? ReviewedBy = null, DateTimeOffset? ReviewedAtUtc = null);
internal sealed record SimPackageDocument(string DocumentId, string Name, string DocumentType, string Role, string Applicability, string? SubassemblyPartNumber, bool EmbeddedBom = false,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimDocumentIdentityReview? IdentityReview = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimPartNumberReview? PartNumberReview = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ProposedSubassemblyIdentity = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimRowDocumentContext? RowAssociation = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ProductionUse = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? BomUse = null);
internal sealed record SimPackageRequest(SimPackageDocument[]? Documents, string? GoverningBomDocumentId);
internal sealed record SimTechnicalPackage(SimPackageDocument[] Documents, string? GoverningBomDocumentId, string Source, bool Synthetic, string ReviewedBy, DateTimeOffset ReviewedAtUtc, string? GoverningBomSourceKind = null);
internal sealed record SimSubassemblyCoverage(string PartNumber, decimal QuantityPerAssembly, string? KnownReference, string[] CustomerDocumentIds, string CoverageState);

internal static class SimTechnicalPackageProvider
{
    internal static bool IsBomSource(SimPackageDocument doc) => doc.RowAssociation is null && (doc.DocumentType == "BOM" || (doc.DocumentType == "ASSEMBLY_DRAWING" && doc.EmbeddedBom));
    internal static bool BomBearing(SimPackageDocument doc) => IsBomSource(doc) || doc.DocumentType == "SUBASSEMBLY_BOM";
    internal static void RequirePartNumberReview(SimPackageDocument[] docs)
    {
        var bom = docs.Where(d => d.RowAssociation is null && BomBearing(d)).ToArray();
        if (bom.Any(d => string.IsNullOrEmpty(d.PartNumberReview?.Basis)))
            throw SimRfqIntakeProblem.BadRequest("SIM_PN_BASIS_REQUIRED", "Review the part-number basis for each BOM-bearing document before continuing.");
        if (bom.Any(d => d.PartNumberReview?.Basis == "UNKNOWN"))
            throw SimRfqIntakeProblem.BadRequest("SIM_PN_BASIS_UNKNOWN", "Resolve the unknown part-number basis before continuing, or place the package On Hold.");
        if (bom.Any(d => d.PartNumberReview?.Basis is "CUSTOMER_INTERNAL" or "MIXED") &&
            !docs.Any(d => d.IdentityReview is not null && d.PartNumberReview?.ProvidesManufacturerPartNumbers == true))
            throw SimRfqIntakeProblem.BadRequest("SIM_MANUFACTURER_SOURCE_REQUIRED", "This BOM uses customer/internal or mixed part numbers. Identify a reviewed document that provides manufacturer part numbers before continuing.");
    }
    internal static string SourceKind(SimPackageDocument doc) => doc.DocumentType == "ASSEMBLY_DRAWING" ? "EMBEDDED_IN_ASSEMBLY_DRAWING" : "STANDALONE_BOM";

    internal static SimTechnicalPackage Inventory(SimRfqIntakeRecord record) => new(
        record.TechnicalFiles.Select((file, index) => new SimPackageDocument(file.DocumentId ?? $"DOC-{index + 1:D3}", file.Name, "UNKNOWN", "UNRESOLVED", "SUPPORTING_REFERENCE", null)).ToArray(),
        null, "SIM_RECEIVED_PACKAGE_METADATA_V1", true, "", default);

    internal static SimTechnicalPackage Validate(SimRfqIntakeRecord record, SimPackageRequest request, SimPersona persona, bool allowIncomplete = false)
    {
        var received = Inventory(record).Documents;
        var docs = request.Documents ?? [];
        if (docs.Length != received.Length || docs.Any(doc => doc is null) || docs.Select(doc => doc.DocumentId).Distinct().Count() != received.Length ||
            received.Any(file => !docs.Any(doc => doc.DocumentId == file.DocumentId && doc.Name == file.Name)))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_PACKAGE_INVENTORY_INVALID", "Account for every received file exactly once; received identities and names cannot be changed.");
        foreach (var doc in docs)
        {
            if ((doc.ProductionUse is not null && !new[] { "PRIMARY_DRAWING", "SUPPORTING_PRODUCTION", "NOT_FOR_PRODUCTION" }.Contains(doc.ProductionUse)) ||
                (doc.BomUse is not null && !new[] { "GOVERNING_BOM", "SUPPORTING_BOM", "NO_BOM_ROLE" }.Contains(doc.BomUse)))
                throw SimRfqIntakeProblem.BadRequest("SIM_PACKAGE_USE", "Choose supported Production and BOM uses.");
            var association = record.TechnicalFiles.FirstOrDefault(f => f.DocumentId == doc.DocumentId)?.ReviewOrigin?.RowContext;
            if (System.Text.Json.JsonSerializer.Serialize(doc.RowAssociation) != System.Text.Json.JsonSerializer.Serialize(association) ||
                (association is not null && (doc.Applicability != (association.ComponentType == "SUBASSEMBLY" ? "SUBASSEMBLY" : "SUPPORTING_REFERENCE") || doc.SubassemblyPartNumber != (association.ComponentType == "SUBASSEMBLY" ? association.CustomerBomPartNumber : null) || doc.ProposedSubassemblyIdentity != (association.ProposedSubassemblyIdentities.Length == 1 ? association.ProposedSubassemblyIdentities[0] : null))))
                throw SimRfqIntakeProblem.BadRequest("SIM_ROW_DOCUMENT_CONTEXT", "Row document context is preserved from the originating BOM row and cannot be reassigned.");
            if (doc.PartNumberReview is { } pn && ((pn.Basis is not null && !new[] { "MANUFACTURER", "CUSTOMER_INTERNAL", "MIXED", "UNKNOWN" }.Contains(pn.Basis)) || (!BomBearing(doc) && pn.Basis is not null)))
                throw SimRfqIntakeProblem.BadRequest("SIM_PN_BASIS_INVALID", "Choose a supported part-number basis for BOM-bearing documents only.");
            if (doc.IdentityReview is { } identity &&
                (!new[] { "DRAWING", "DRAWING_AND_BOM", "BOM_ONLY", "GERBER_FILES", "DATASHEET", "SPECIFICATION", "UNKNOWN", "OTHER" }.Contains(identity.Type) ||
                 (identity.OtherDescription?.Length ?? 0) > 500 ||
                 (identity.Type == "DRAWING" && (doc.DocumentType != "ASSEMBLY_DRAWING" || doc.EmbeddedBom)) ||
                 (identity.Type == "DRAWING_AND_BOM" && (doc.DocumentType != "ASSEMBLY_DRAWING" || !doc.EmbeddedBom)) ||
                 (identity.Type == "BOM_ONLY" && doc.DocumentType is not ("BOM" or "SUBASSEMBLY_BOM")) ||
                 (identity.Type == "UNKNOWN" && doc.DocumentType != "UNKNOWN") ||
                 (identity.Type is "DATASHEET" or "SPECIFICATION" && doc.DocumentType != "SUPPORTING_DOCUMENT") ||
                 (identity.Type == "GERBER_FILES" && doc.DocumentType != "GERBER") ||
                 (identity.Type == "OTHER" && doc.DocumentType is not ("SUPPORTING_DOCUMENT" or "GERBER" or "ALTERNATE_PART_APPROVAL"))))
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_IDENTITY_REVIEW_INVALID", "Choose a document identity consistent with its technical classification.");
            if (!new[] { "BOM", "ASSEMBLY_DRAWING", "SUBASSEMBLY_BOM", "ALTERNATE_PART_APPROVAL", "GERBER", "SUPPORTING_DOCUMENT", "UNKNOWN" }.Contains(doc.DocumentType) ||
                !new[] { "GOVERNING", "REFERENCED", "SUPPORTING", "UNRESOLVED" }.Contains(doc.Role) ||
                !new[] { "PARENT_ASSEMBLY", "SUBASSEMBLY", "SUPPORTING_REFERENCE" }.Contains(doc.Applicability) ||
                (doc.SubassemblyPartNumber?.Length ?? 0) > 120 || (doc.ProposedSubassemblyIdentity?.Length ?? 0) > 120 ||
                (record.TechnicalFiles.Any(f => f.DocumentId == doc.DocumentId && f.ReviewOrigin is not null) && doc.Applicability == "SUBASSEMBLY" && string.IsNullOrWhiteSpace(doc.SubassemblyPartNumber)) ||
                (doc.EmbeddedBom && doc.DocumentType != "ASSEMBLY_DRAWING"))
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_PACKAGE_CLASSIFICATION_INVALID", "Choose a supported document type, role and applicability.");
        }
        // Historical callers without identity-review metadata retain their existing contract.
        // Current reviews cannot strip the metadata to bypass the package gate.
        if (!allowIncomplete && (docs.Any(d => d.IdentityReview is not null || d.PartNumberReview is not null) || record.TechnicalReview?.TechnicalPackage?.Documents.Any(d => d.IdentityReview is not null) == true))
            RequirePartNumberReview(docs);
        var governing = string.IsNullOrWhiteSpace(request.GoverningBomDocumentId) ? null : request.GoverningBomDocumentId;
        var parentGoverning = docs.Where(doc => doc.Role == "GOVERNING" && doc.Applicability == "PARENT_ASSEMBLY" && new[] { "BOM", "SUBASSEMBLY_BOM" }.Contains(doc.DocumentType)).ToArray();
        var selected = docs.SingleOrDefault(doc => doc.DocumentId == governing);
        if (governing is null ? parentGoverning.Length != 0 : selected is null || !IsBomSource(selected) || selected.Applicability != "PARENT_ASSEMBLY" ||
            (selected.DocumentType == "BOM" ? parentGoverning.Length != 1 || parentGoverning[0].DocumentId != governing : parentGoverning.Length != 0))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_GOVERNING_BOM_INVALID", "Explicitly select one parent BOM as governing, or leave the parent BOM unresolved.");
        return new(docs.Select(doc => {
            var identity = doc.IdentityReview;
            if (identity is not null) {
                var initial = record.TechnicalFiles.FirstOrDefault(f => f.DocumentId == doc.DocumentId)?.InitialIdentification;
                var prior = record.TechnicalReview?.TechnicalPackage?.Documents.FirstOrDefault(d => d.DocumentId == doc.DocumentId)?.IdentityReview;
                var other = identity.Type == "OTHER" ? identity.OtherDescription?.Trim() : null;
                identity = prior is not null && prior.Type == identity.Type && prior.OtherDescription == other ? prior :
                    new(identity.Type, other, initial?.Type == identity.Type && (identity.Type != "OTHER" || initial.OtherDescription == other) ? "CONFIRMED" : "CORRECTED", persona.DisplayName, DateTimeOffset.UtcNow);
            }
            var pn = doc.PartNumberReview;
            if (pn is not null) {
                var prior = record.TechnicalReview?.TechnicalPackage?.Documents.FirstOrDefault(d => d.DocumentId == doc.DocumentId)?.PartNumberReview;
                pn = prior is not null && prior.Basis == pn.Basis && prior.ProvidesManufacturerPartNumbers == pn.ProvidesManufacturerPartNumbers ? prior :
                    new(pn.Basis, pn.ProvidesManufacturerPartNumbers, persona.DisplayName, DateTimeOffset.UtcNow);
            }
            return doc with { SubassemblyPartNumber = doc.Applicability == "SUBASSEMBLY" ? doc.SubassemblyPartNumber?.Trim() : null,
                ProposedSubassemblyIdentity = doc.Applicability == "SUBASSEMBLY" ? doc.ProposedSubassemblyIdentity?.Trim() : null, IdentityReview = identity, PartNumberReview = pn };
        }).ToArray(), governing,
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
