using System.Text.Json;

internal sealed record SimUnifiedPackageRequest(string Version, string ExpectedReviewToken,
    SimPackageDocument[] Documents, string? GoverningBomDocumentId, bool Complete,
    bool HistoryAcknowledged = false, string? Missing = null, string? AcceptDocumentId = null);

internal sealed partial class SimRfqIntakeStore
{
    internal const string UnifiedPackageVersion = "UNIFIED_PACKAGE_REVIEW_V2";
    internal static string? EffectiveAssemblyClassification(SimRfqIntakeRecord record) =>
        record.TechnicalReview?.AssemblyHistory?.AssemblyClassification ??
        (record.TechnicalReview?.Workflow?.Version == UnifiedPackageVersion
            ? (record.TechnicalReview.AssemblyHistory ?? SimAssemblyHistoryProvider.Lookup(record)).HistoryFound ? "EXISTING_ASSEMBLY" : "NEW_ASSEMBLY"
            : null);
    internal static string PackageReviewToken(SimRfqIntakeRecord record) => DleAnalysisContract.Hash(
        JsonSerializer.SerializeToUtf8Bytes(new { record.Status, record.TechnicalFiles, record.TechnicalReview }, DleAnalysisContract.Json));

    // Compatibility projections do not rewrite historical snapshots or infer new authority.
    internal static string ProductionUse(SimPackageDocument doc, SimManufacturingDefinition? manufacturing) => doc.ProductionUse ??
        (manufacturing?.GoverningDocumentId == doc.DocumentId ? "PRIMARY_DRAWING" :
         manufacturing?.SupportingDocumentIds.Contains(doc.DocumentId) == true ||
         manufacturing?.SubassemblyDocumentIds.Contains(doc.DocumentId) == true ||
         manufacturing?.TechnicalDocumentIds.Contains(doc.DocumentId) == true ? "SUPPORTING_PRODUCTION" : "NOT_FOR_PRODUCTION");
    internal static string BomUse(SimTechnicalPackage package, SimPackageDocument doc) => doc.BomUse ??
        (package.GoverningBomDocumentId == doc.DocumentId ? "GOVERNING_BOM" :
         SimTechnicalPackageProvider.BomBearing(doc) && doc.Role is "SUPPORTING" or "REFERENCED" ? "SUPPORTING_BOM" : "NO_BOM_ROLE");

    private static string MaterialPackageSignature(SimTechnicalPackage? package)
    {
        if (package is null) return "";
        SimPackageDocument[] sources;
        try { sources = SimAnalysisSourceSelection.Select(package, DleAnalysisContract.SourceSelectionVersion); }
        catch (SimRfqIntakeProblem) { sources = package.Documents; } // Incomplete held packages still have a stable change signature.
        return JsonSerializer.Serialize(new { package.GoverningBomDocumentId,
            sources = sources.OrderBy(d => d.DocumentId).Select(d => new { d.DocumentId, d.Name, d.DocumentType,
                d.Role, d.Applicability, d.SubassemblyPartNumber, d.EmbeddedBom, d.IdentityReview, d.PartNumberReview,
                d.RowAssociation, d.ProposedSubassemblyIdentity, bomUse = BomUse(package, d) }) }, DleAnalysisContract.Json);
    }
    internal static bool SameMaterialPackage(SimTechnicalPackage? left, SimTechnicalPackage? right) =>
        MaterialPackageSignature(left) == MaterialPackageSignature(right);

    private static string ProductionPackageSignature(SimTechnicalPackage package, SimManufacturingDefinition? manufacturing) =>
        JsonSerializer.Serialize(package.Documents.Where(d => ProductionUse(d, manufacturing) != "NOT_FOR_PRODUCTION")
            .OrderBy(d => d.DocumentId).Select(d => new { d.DocumentId, d.Name, d.DocumentType, d.Applicability,
                d.SubassemblyPartNumber, d.ProposedSubassemblyIdentity, use = ProductionUse(d, manufacturing) }), DleAnalysisContract.Json);

    internal async Task<object> SaveUnifiedPackage(string intakeId, SimUnifiedPackageRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && r.Environment == "SIM" && r.IntakeType == "NEW_QUOTE_REQUEST");
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "RFQ review not found.");
            var record = dataset.Records[index];
            var review = record.TechnicalReview;
            if (review?.Workflow is not { } workflow || workflow.Outputs is not null ||
                !string.IsNullOrEmpty(review.DownstreamHandoffState) || record.Status is not ("TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD"))
                throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_STATE", "Start an active Technical Review. Historical and released reviews are read-only.");
            if (request.Version != UnifiedPackageVersion)
                throw SimRfqIntakeProblem.BadRequest("SIM_PACKAGE_VERSION", "Unsupported package review version.");
            if (request.ExpectedReviewToken != PackageReviewToken(record))
                throw SimRfqIntakeProblem.Conflict("SIM_PACKAGE_CHANGED", "The review changed. Reopen the latest package before saving.");
            var rowAccept = request.AcceptDocumentId is not null;
            if (rowAccept)
            {
                var target = request.Documents?.SingleOrDefault(d => d.DocumentId == request.AcceptDocumentId)
                    ?? throw SimRfqIntakeProblem.BadRequest("SIM_ROW_REVIEW", "Select one received document to accept.");
                if (target.DocumentType == "UNKNOWN" || target.IdentityReview is null ||
                    target.PartNumberReview?.ProvidesManufacturerPartNumbers is null ||
                    (SimTechnicalPackageProvider.BomBearing(target) && target.PartNumberReview?.Basis is not ("MANUFACTURER" or "CUSTOMER_INTERNAL" or "MIXED")) ||
                    (target.Applicability == "SUBASSEMBLY" && string.IsNullOrWhiteSpace(target.SubassemblyPartNumber)))
                    throw SimRfqIntakeProblem.BadRequest("SIM_ROW_REVIEW", "Resolve the document identity, BOM P/N Type, MFG P/N Source and scope before accepting.");
                var priorPackage = review.TechnicalPackage ?? SimTechnicalPackageProvider.Inventory(record);
                if (!priorPackage.Documents.Any(d => d.DocumentId == target.DocumentId))
                    throw SimRfqIntakeProblem.BadRequest("SIM_ROW_REVIEW", "Select a received document.");
                // Only the selected row is accepted. Other client drafts cannot leak into this save.
                var merged = priorPackage.Documents.Select(d => d.DocumentId == target.DocumentId ? target : d with {
                    ProductionUse = target.ProductionUse == "PRIMARY_DRAWING" && ProductionUse(d, workflow.Manufacturing) == "PRIMARY_DRAWING" ? "NOT_FOR_PRODUCTION" : ProductionUse(d, workflow.Manufacturing),
                    BomUse = target.BomUse == "GOVERNING_BOM" && BomUse(priorPackage,d) == "GOVERNING_BOM" ? "NO_BOM_ROLE" : BomUse(priorPackage,d) }).ToArray();
                request = request with { Documents = merged, Complete = false,
                    GoverningBomDocumentId = merged.SingleOrDefault(d => d.BomUse == "GOVERNING_BOM")?.DocumentId };
            }
            if (request.Documents is null || request.Documents.Any(d => d is null || d.ProductionUse is null || d.BomUse is null))
                throw SimRfqIntakeProblem.BadRequest("SIM_PACKAGE_USE", "Review Production and BOM use for every document.");
            var normalized = request.Documents.Select(d => d with { Role = d.BomUse == "GOVERNING_BOM" ? "GOVERNING" :
                d.BomUse == "SUPPORTING_BOM" ? "SUPPORTING" : d.Role == "GOVERNING" ? "UNRESOLVED" : d.Role }).ToArray();
            var package = SimTechnicalPackageProvider.Validate(record, new(normalized, request.GoverningBomDocumentId), persona, allowIncomplete: !request.Complete);
            if (request.Complete && package.Documents.Any(d => d.Applicability == "SUBASSEMBLY" && string.IsNullOrWhiteSpace(d.SubassemblyPartNumber)))
                throw SimRfqIntakeProblem.BadRequest("SIM_SUBASSEMBLY_SCOPE", "Identify the customer / BOM P/N for each subassembly document.");
            var primary = package.Documents.Where(d => d.ProductionUse == "PRIMARY_DRAWING").ToArray();
            var governing = package.Documents.Where(d => d.BomUse == "GOVERNING_BOM").ToArray();
            if (primary.Length > 1 || primary.Any(d => d.RowAssociation is not null || d.DocumentType != "ASSEMBLY_DRAWING" || d.Applicability != "PARENT_ASSEMBLY"))
                throw SimRfqIntakeProblem.BadRequest("SIM_PRIMARY_DRAWING", "Select one eligible parent assembly drawing for Production.");
            if (governing.Length > 1 || governing.Any(d => !SimTechnicalPackageProvider.IsBomSource(d) || d.Applicability != "PARENT_ASSEMBLY") ||
                governing.SingleOrDefault()?.DocumentId != package.GoverningBomDocumentId ||
                package.Documents.Any(d => d.BomUse == "SUPPORTING_BOM" && !SimTechnicalPackageProvider.BomBearing(d)))
                throw SimRfqIntakeProblem.BadRequest("SIM_BOM_USE", "Select one eligible parent Governing BOM; Supporting BOM requires a BOM-bearing document.");
            if (request.Complete)
            {
                if (primary.Length != 1 || governing.Length != 1)
                    throw SimRfqIntakeProblem.BadRequest("SIM_PACKAGE_AUTHORITY", "Select a Primary Production Drawing and a Governing BOM.");
                if (package.Documents.Any(d => d.RowAssociation is null && (d.DocumentType == "UNKNOWN" ||
                    (d.IdentityReview is null && review.TechnicalPackage?.Documents.Any(old => old.DocumentId == d.DocumentId && old.DocumentType != "UNKNOWN") != true))))
                    throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_REQUIRED", "Review each received document identity before proceeding.");
                SimTechnicalPackageProvider.RequirePartNumberReview(package.Documents);
                // Validate enrichment scope and the existing source-count limit before committing.
                var sources = SimAnalysisSourceSelection.Select(package, DleAnalysisContract.SourceSelectionVersion);
                if (package.Documents.Any(d => d.RowAssociation is null && SimTechnicalPackageProvider.BomBearing(d) && d.PartNumberReview?.Basis is "CUSTOMER_INTERNAL" or "MIXED") &&
                    !sources.Any(d => d.PartNumberReview?.ProvidesManufacturerPartNumbers == true))
                    throw SimRfqIntakeProblem.BadRequest("SIM_MANUFACTURER_SOURCE_SCOPE", "Identify manufacturer P/N evidence in the governing BOM's assembly scope.");
                foreach (var doc in package.Documents.Where(d => d.DocumentType != "UNKNOWN"))
                {
                    var file = record.TechnicalFiles.SingleOrDefault(f => f.DocumentId == doc.DocumentId && f.BinaryStatus == "VERIFIED")
                        ?? throw SimRfqIntakeProblem.Conflict("SIM_MANUFACTURING_BINARY", "Package references require verified staged files.");
                    await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
                }
            }
            else if (!rowAccept && (string.IsNullOrWhiteSpace(request.Missing) || request.Missing.Length > 1000))
                throw SimRfqIntakeProblem.BadRequest("SIM_HOLD_REASON", "Describe what is missing in 1–1000 characters.");

            var now = DateTimeOffset.UtcNow;
            var sameMaterials = SameMaterialPackage(review.TechnicalPackage, package);
            // Package evidence participates in analysis fingerprints; do not restamp it for Production-only edits.
            if (sameMaterials && review.TechnicalPackage is { } prior)
                package = package with { ReviewedBy = prior.ReviewedBy, ReviewedAtUtc = prior.ReviewedAtUtc };
            var manufacturing = workflow.Manufacturing;
            var sameProduction = manufacturing is not null &&
                ProductionPackageSignature(manufacturing.Package, manufacturing) == ProductionPackageSignature(package, manufacturing);
            if (!sameProduction) manufacturing = request.Complete ? new(Guid.NewGuid().ToString("D"), primary.Single().DocumentId,
                package.Documents.Where(d => d.ProductionUse == "SUPPORTING_PRODUCTION").Select(d => d.DocumentId).ToArray(),
                package.Documents.Where(d => d.ProductionUse != "NOT_FOR_PRODUCTION" && d.Applicability == "SUBASSEMBLY" && d.DocumentType == "ASSEMBLY_DRAWING").Select(d => d.DocumentId).ToArray(),
                package.Documents.Where(d => d.ProductionUse != "NOT_FOR_PRODUCTION" && d.DocumentType is "GERBER" or "SUPPORTING_DOCUMENT").Select(d => d.DocumentId).ToArray(),
                package, true, persona.DisplayName, now) : null;
            // History is future context, not reviewer evidence. Never rewrite an existing snapshot.
            var history = review.AssemblyHistory;
            if (history is null)
            {
                var context = SimAssemblyHistoryProvider.Lookup(record);
                history = context with { AssemblyClassification = context.HistoryFound ? "EXISTING_ASSEMBLY" : "NEW_ASSEMBLY" };
            }
            if (rowAccept)
            {
                var file = record.TechnicalFiles.SingleOrDefault(f => f.DocumentId == request.AcceptDocumentId && f.BinaryStatus == "VERIFIED")
                    ?? throw SimRfqIntakeProblem.Conflict("SIM_MANUFACTURING_BINARY", "The document requires a verified staged file.");
                await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
                // Validate and preserve unchanged evidence; acceptance never queues analysis.
                var samePackage = JsonSerializer.Serialize(package, jsonOptions) == JsonSerializer.Serialize(review.TechnicalPackage, jsonOptions);
                if (samePackage) return WorkflowEnvelope(record);
                var rowWorkflow = workflow with {
                    PackageConfirmed = sameMaterials && sameProduction && workflow.PackageConfirmed,
                    Sufficient = sameMaterials && sameProduction && workflow.Sufficient,
                    Manufacturing = sameProduction ? workflow.Manufacturing : null,
                    Events = (workflow.Events ?? []).Append(new("DOCUMENT_ACCEPTED", request.AcceptDocumentId!, persona.DisplayName, now)).ToArray() };
                var rowReview = review with { TechnicalPackage = package, Workflow = rowWorkflow,
                    ReviewedBy = persona.DisplayName, ReviewedAtUtc = now,
                    ManufacturingReviewStatus = sameProduction ? review.ManufacturingReviewStatus : "IN_PROGRESS",
                    CandidateBom = sameMaterials ? review.CandidateBom : null,
                    CandidateBomVersions = !sameMaterials && review.CandidateBom is not null ? (review.CandidateBomVersions ?? []).Append(review.CandidateBom).ToArray() : review.CandidateBomVersions,
                    MaterialsDefinition = sameMaterials ? review.MaterialsDefinition : null,
                    SubassemblyCoverage = sameMaterials ? review.SubassemblyCoverage : null,
                    MaterialsReviewStatus = sameMaterials ? review.MaterialsReviewStatus : null,
                    NextReviewPhase = sameMaterials ? review.NextReviewPhase : null };
                record = record with { TechnicalReview = rowReview };
                dataset.Records[index] = record; dataset.UpdatedAtUtc = now;
                await WriteVerifiedAsync(dataset);
                return WorkflowEnvelope(record);
            }
            var updatedWorkflow = workflow with { Version = UnifiedPackageVersion, PackageConfirmed = request.Complete,
                Sufficient = request.Complete, HistoryReviewed = workflow.HistoryReviewed,
                HoldReason = request.Complete ? null : request.Missing!.Trim(), Manufacturing = manufacturing,
                ManufacturingDrawingId = primary.SingleOrDefault()?.DocumentId };
            var status = request.Complete ? "TECHNICAL_REVIEW_IN_PROGRESS" : "ON_HOLD";
            if (record.Status == status && JsonSerializer.Serialize(updatedWorkflow, jsonOptions) == JsonSerializer.Serialize(workflow, jsonOptions) &&
                JsonSerializer.Serialize(package, jsonOptions) == JsonSerializer.Serialize(review.TechnicalPackage, jsonOptions))
                return WorkflowEnvelope(record);
            updatedWorkflow = updatedWorkflow with { Events = (workflow.Events ?? []).Append(new(
                request.Complete ? "PACKAGE_CONFIRMED" : "PACKAGE_HELD", request.Complete ? "Production, BOM and completeness reviewed" : request.Missing!.Trim(), persona.DisplayName, now)).ToArray() };
            review = review with { Workflow = updatedWorkflow, TechnicalPackage = package, AssemblyHistory = history,
                ReviewStatus = status, ReviewedBy = persona.DisplayName, ReviewedAtUtc = now,
                ManufacturingReviewStatus = manufacturing is null ? "IN_PROGRESS" : "COMPLETE",
                MaterialsDefinition = sameMaterials ? review.MaterialsDefinition : null,
                SubassemblyCoverage = sameMaterials ? review.SubassemblyCoverage : null,
                MaterialsReviewStatus = sameMaterials ? review.MaterialsReviewStatus : null,
                NextReviewPhase = sameMaterials ? review.NextReviewPhase : null,
                CandidateBom = sameMaterials ? review.CandidateBom : null,
                CandidateBomVersions = !sameMaterials && review.CandidateBom is not null ?
                    (review.CandidateBomVersions ?? []).Append(review.CandidateBom).ToArray() : review.CandidateBomVersions };
            record = record with { Status = status, TechnicalReview = review };
            dataset.Records[index] = record; dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset);
            return WorkflowEnvelope(record);
        }
        finally { gate.Release(); }
    }
}
