using System.Security.Cryptography;

internal sealed record SimReviewDocumentOrigin(string SourceStage, string AddedBy, DateTimeOffset AddedAtUtc,
    string OriginalFilename, string DocumentId, string Sha256, string? Note, SimRowDocumentContext? RowContext = null);
internal sealed record SimRowDocumentTarget(string CandidateId, string RowId, int RowIndex, string ExpectedToken);
internal sealed record SimRowDocumentContext(string CandidateId, string RowId, int RowIndex, string ParentAssembly, string ParentRevision,
    string CustomerBomPartNumber, string ComponentType, string[] ProposedSubassemblyIdentities);
internal sealed record SimReviewDocumentRequest(string Type, string Applicability,
    string? SubassemblyPartNumber = null, string? ProposedSubassemblyIdentity = null, string? Note = null, SimRowDocumentTarget? RowTarget = null);

internal sealed partial class SimRfqIntakeStore
{
    internal async Task<object> AddReviewDocument(string intakeId, string name, long modified,
        SimReviewDocumentRequest request, Stream stream, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var record = dataset.Records[index];
            if (record.Status is not ("TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD") || record.TechnicalReview is null || record.TechnicalReview.Workflow?.Outputs is not null)
                throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_DOCUMENT_READ_ONLY", "Start an open Technical Review before adding documents. Completed or closed reviews cannot be changed.");
            SimRowDocumentContext? association = null;
            if (request.RowTarget is { } target)
            {
                var candidate = record.TechnicalReview.CandidateBom;
                if (candidate is null || candidate.Id != target.CandidateId || target.RowIndex < 0 || target.RowIndex >= candidate.Rows.Length)
                    throw SimRfqIntakeProblem.Conflict("SIM_ROW_DOCUMENT_STALE", "This candidate or row changed. Reopen its details before attaching files.");
                var row = candidate.Rows[target.RowIndex];
                var rowId = row.RowId ?? $"{candidate.Id}:row:{row.Index}";
                if (target.RowId != rowId || row.ReviewState.Token != target.ExpectedToken)
                    throw SimRfqIntakeProblem.Conflict("SIM_ROW_DOCUMENT_STALE", "This row changed. Reopen its details before attaching files.");
                var parent = record.Assemblies.OrderBy(a => a.LineNumber).First();
                // Preserve the existing manual row identities as proposals, never as customer P/N replacements.
                var proposed = row.ComponentType == "SUBASSEMBLY" && row.AssemblyIdentity is {} assemblyIdentity ? new[]{assemblyIdentity.PartNumber} : row.ComponentType == "SUBASSEMBLY" ? (row.Alternates ?? []).Where(a => a.RemovedAtUtc is null && a.Origin == "MANUAL" && a.ReviewStatus == "CONFIRMED").Select(a => a.PartNumber).Distinct().ToArray() : [];
                association = new(candidate.Id, rowId, row.Index, parent.AssemblyNumber, parent.Revision, row.Values.GetValueOrDefault("partNumber", ""), row.ComponentType, proposed);
                request = request with { Applicability = row.ComponentType == "SUBASSEMBLY" ? "SUBASSEMBLY" : "SUPPORTING_REFERENCE",
                    SubassemblyPartNumber = association.CustomerBomPartNumber, ProposedSubassemblyIdentity = proposed.Length == 1 ? proposed[0] : null };
            }
            else if (request.Applicability != "PARENT_ASSEMBLY" || !string.IsNullOrWhiteSpace(request.SubassemblyPartNumber) || !string.IsNullOrWhiteSpace(request.ProposedSubassemblyIdentity))
                throw SimRfqIntakeProblem.BadRequest("SIM_PACKAGE_DOCUMENT_SCOPE", "Add component or subassembly files from Candidate BOM row Technical Files. This uploader accepts package-level files only.");
            if (!new[] { "DRAWING", "DRAWING_AND_BOM", "BOM_ONLY", "GERBER_FILES", "DATASHEET", "SPECIFICATION", "UNKNOWN", "OTHER" }.Contains(request.Type) ||
                request.Applicability is not ("PARENT_ASSEMBLY" or "SUBASSEMBLY" or "SUPPORTING_REFERENCE") ||
                (request.Applicability == "SUBASSEMBLY" && string.IsNullOrWhiteSpace(request.SubassemblyPartNumber)) ||
                (request.SubassemblyPartNumber?.Length ?? 0) > 120 || (request.ProposedSubassemblyIdentity?.Length ?? 0) > 120 || (request.Note?.Length ?? 0) > 500)
                throw SimRfqIntakeProblem.BadRequest("SIM_REVIEW_DOCUMENT_METADATA", "Choose a document type and applies-to scope. Subassembly files require the customer/BOM part number. Identities allow 120 characters and the optional note allows 500.");

            var staged = await documents.Stage(record.RequestCorrelationId, name, modified, stream, persona.DisplayName);
            try
            {
                var bytes = await documents.Bytes(record.RequestCorrelationId, staged.DocumentId!);
                var at = DateTimeOffset.UtcNow;
                var file = staged with { ReviewOrigin = new("Technical Review", persona.DisplayName, at, staged.Name,
                    staged.DocumentId!, Convert.ToHexString(SHA256.HashData(bytes)), request.Note?.Trim(), association) };
                var type = request.Type switch { "DRAWING" or "DRAWING_AND_BOM" => "ASSEMBLY_DRAWING", "BOM_ONLY" => "BOM", "GERBER_FILES" => "GERBER", "OTHER" or "DATASHEET" or "SPECIFICATION" => "SUPPORTING_DOCUMENT", _ => "UNKNOWN" };
                var doc = new SimPackageDocument(staged.DocumentId!, staged.Name, type, "UNRESOLVED", request.Applicability,
                    request.Applicability == "SUBASSEMBLY" ? request.SubassemblyPartNumber!.Trim() : null,
                    request.Type == "DRAWING_AND_BOM", new(request.Type, request.Type == "OTHER" ? request.Note?.Trim() : null, "CONFIRMED", persona.DisplayName, at),
                    ProposedSubassemblyIdentity: request.Applicability == "SUBASSEMBLY" ? request.ProposedSubassemblyIdentity?.Trim() : null, RowAssociation: association);
                var package = record.TechnicalReview.TechnicalPackage ?? SimTechnicalPackageProvider.Inventory(record);
                // Attachment does not rerun package qualification, replace candidates or change reviewer decisions.
                // Existing authority/source selection still governs any later, explicitly requested analysis.
                record = record with { TechnicalFilesProvided = true, TechnicalFiles = [..record.TechnicalFiles, file],
                    DocumentPreservationState = record.TechnicalFiles.All(f => f.BinaryStatus == "VERIFIED") ? "BINARIES_VERIFIED_SIM" : "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED",
                    TechnicalReview = record.TechnicalReview with { TechnicalPackage = package with { Documents = [..package.Documents, doc] } } };
                dataset.Records[index] = record;
                dataset.UpdatedAtUtc = at;
                await WriteVerifiedAsync(dataset);
            }
            catch
            {
                // Do not remove a binary if a storage error has an uncertain commit outcome.
                var committed = (await ReadDatasetAsync()).Records.Any(r => r.TechnicalFiles.Any(f => f.DocumentId == staged.DocumentId));
                if (!committed) await documents.Remove(record.RequestCorrelationId, staged.DocumentId!, persona.DisplayName);
                throw;
            }
            return new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
        }
        finally { gate.Release(); }
    }
}
