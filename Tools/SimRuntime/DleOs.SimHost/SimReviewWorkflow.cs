using System.Text.Json;

internal sealed record SimReviewEvent(string Action, string? Detail, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimManufacturingDefinition(string Id, string GoverningDocumentId, string[] SupportingDocumentIds,
    string[] SubassemblyDocumentIds, string[] TechnicalDocumentIds, SimTechnicalPackage Package,
    bool NothingMissing, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimQuotationInputs(string Status, string MaterialsTarget, SimBomAcceptance Materials,
    string ManufacturingTarget, SimManufacturingDefinition Manufacturing, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimReviewWorkflow(string Version = "PACKAGE_REVIEW_V1", bool PackageConfirmed = false,
    bool Sufficient = false, bool HistoryReviewed = false, string? HoldReason = null,
    SimManufacturingDefinition? Manufacturing = null, SimQuotationInputs? Outputs = null,
    SimReviewEvent[]? Events = null);
internal sealed record SimWorkflowRequest(string Action, string? Needed = null, string? GoverningDocumentId = null,
    bool NothingMissing = false);

internal sealed partial class SimRfqIntakeStore
{
    private static object WorkflowEnvelope(SimRfqIntakeRecord record) => new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
    private static void RequireWorkflowMaterials(SimRfqIntakeRecord record)
    {
        if (record.TechnicalReview?.Workflow is { } w &&
            (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || !w.PackageConfirmed || !w.Sufficient || !w.HistoryReviewed || w.Manufacturing is null || w.HoldReason is not null || w.Outputs is not null))
            throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_GATE", "Complete package, sufficiency, history and Manufacturing Definition before materials work.");
    }
    internal async Task<object> WorkflowAsync(string intakeId, SimWorkflowRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && r.IntakeType == "NEW_QUOTE_REQUEST" && r.Environment == "SIM");
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "RFQ review not found.");
            var record = dataset.Records[index];
            var review = record.TechnicalReview ?? throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_MISSING", "Review state is unavailable.");
            var w = review.Workflow;
            var now = DateTimeOffset.UtcNow;
            if (record.Status is "NO_LONGER_REQUIRED" or "READY_FOR_RFQ_WORKING_QUEUE" || w?.Outputs is not null || !string.IsNullOrEmpty(review.DownstreamHandoffState))
                throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_CLOSED", "This historical or released review is read-only.");
            if (record.Status is not ("READY_FOR_RFQ_QUALIFICATION" or "TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD"))
                throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_STATE", "This record is outside the supported early review states.");
            if (request.Action == "START")
            {
                if (w is null && (review.BomAcceptances?.Length ?? 0) > 0)
                    throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_HISTORICAL", "Preserve this accepted historical review in its existing flow.");
                if (record.Status == "ON_HOLD") return WorkflowEnvelope(record);
                w ??= new();
                record = record with { Status = "TECHNICAL_REVIEW_IN_PROGRESS" };
                review = review with { Disposition = "START_TECHNICAL_REVIEW", ReviewStatus = record.Status };
            }
            else
            {
                if (w is null) throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_NOT_STARTED", "Start Technical Review first.");
                if (record.Status == "ON_HOLD" && request.Action != "RESUME")
                    throw SimRfqIntakeProblem.Conflict("SIM_REVIEW_ON_HOLD", "Resume the held package before continuing.");
                if (request.Action == "HOLD")
                {
                    if (string.IsNullOrWhiteSpace(request.Needed) || request.Needed.Length > 1000)
                        throw SimRfqIntakeProblem.BadRequest("SIM_HOLD_REASON", "Describe what is needed in 1–1000 characters.");
                    w = w with { HoldReason = request.Needed.Trim(), Sufficient = false };
                    record = record with { Status = "ON_HOLD" };
                }
                else if (request.Action == "RESUME")
                {
                    if (record.Status != "ON_HOLD") throw SimRfqIntakeProblem.Conflict("SIM_NOT_ON_HOLD", "This review is not on hold.");
                    record = record with { Status = "TECHNICAL_REVIEW_IN_PROGRESS" };
                    w = w with { HoldReason = null, Sufficient = false };
                }
                else if (request.Action == "SUFFICIENT")
                {
                    if (!w.PackageConfirmed || review.TechnicalPackage is null)
                        throw SimRfqIntakeProblem.Conflict("SIM_PACKAGE_REQUIRED", "Confirm the technical package first.");
                    w = w with { Sufficient = true };
                }
                else if (request.Action == "HISTORY")
                {
                    if (!w.Sufficient) throw SimRfqIntakeProblem.Conflict("SIM_SUFFICIENCY_REQUIRED", "Review package sufficiency first.");
                    var history = review.AssemblyHistory ?? SimAssemblyHistoryProvider.Lookup(record);
                    review = review with { AssemblyHistory = history with { AssemblyClassification = history.HistoryFound ? "EXISTING_ASSEMBLY" : "NEW_ASSEMBLY", ConfirmedBy = persona.DisplayName, ConfirmedAtUtc = now } };
                    w = w with { HistoryReviewed = true };
                }
                else if (request.Action == "MANUFACTURING")
                {
                    if (!w.Sufficient || !w.HistoryReviewed || review.TechnicalPackage is not { } pack)
                        throw SimRfqIntakeProblem.Conflict("SIM_CONTEXT_REQUIRED", "Review package and history context first.");
                    var drawing = pack.Documents.SingleOrDefault(d => d.DocumentId == request.GoverningDocumentId);
                    if (!request.NothingMissing || drawing is not { DocumentType: "ASSEMBLY_DRAWING", Role: "GOVERNING", Applicability: "PARENT_ASSEMBLY" })
                        throw SimRfqIntakeProblem.Conflict("SIM_MANUFACTURING_REQUIRED", "Select a governing parent assembly drawing and confirm nothing obvious remains missing, or place the review On Hold.");
                    foreach (var doc in pack.Documents.Where(d => d.DocumentType != "UNKNOWN"))
                    {
                        var file = record.TechnicalFiles.SingleOrDefault(f => f.DocumentId == doc.DocumentId && f.BinaryStatus == "VERIFIED")
                            ?? throw SimRfqIntakeProblem.Conflict("SIM_MANUFACTURING_BINARY", "Manufacturing references require verified staged files.");
                        await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
                    }
                    w = w with { Manufacturing = new(Guid.NewGuid().ToString("D"), drawing.DocumentId,
                        pack.Documents.Where(d => d.Role is "SUPPORTING" or "REFERENCED").Select(d => d.DocumentId).ToArray(),
                        pack.Documents.Where(d => d.Applicability == "SUBASSEMBLY" && d.DocumentType == "ASSEMBLY_DRAWING").Select(d => d.DocumentId).ToArray(),
                        pack.Documents.Where(d => d.DocumentType is "GERBER" or "SUPPORTING_DOCUMENT").Select(d => d.DocumentId).ToArray(),
                        pack, true, persona.DisplayName, now) };
                }
                else if (request.Action == "COMPLETE")
                {
                    RequireWorkflowMaterials(record);
                    if (dataset.AnalysisJobs.Any(j => j.Input.IntakeId == intakeId && DleAnalysisContract.Active(j.Status)))
                        throw SimRfqIntakeProblem.Conflict("SIM_ANALYSIS_ACTIVE", "Wait for analysis before release.");
                    var accepted = review.BomAcceptances?.LastOrDefault(a => a.Candidate.Id == review.CandidateBom?.Id);
                    if (review.MaterialsReviewStatus != "QUALIFIED" || accepted is null ||
                        JsonSerializer.Serialize(accepted.Package.Documents, jsonOptions) != JsonSerializer.Serialize(review.TechnicalPackage?.Documents, jsonOptions) ||
                        accepted.Package.GoverningBomDocumentId != review.TechnicalPackage?.GoverningBomDocumentId)
                        throw SimRfqIntakeProblem.Conflict("SIM_DEFINITIONS_REQUIRED", "Complete both definitions using the current package before releasing Technical Review.");
                    await AnalysisDocuments(record);
                    w = w with { Outputs = new("READY", "QUOTATION_MATERIALS", accepted, "QUOTATION_LABOR", w.Manufacturing!, persona.DisplayName, now) };
                    record = record with { Status = "READY_FOR_RFQ_WORKING_QUEUE" };
                    review = review with { Disposition = "TECHNICAL_REVIEW_COMPLETE", DownstreamHandoffTarget = "QUOTATION_INPUTS", DownstreamHandoffState = "READY" };
                }
                else throw SimRfqIntakeProblem.BadRequest("SIM_WORKFLOW_ACTION", "Unsupported review action.");
            }
            w = w! with { Events = (w!.Events ?? []).Append(new(request.Action, request.Action == "HOLD" ? request.Needed?.Trim() : null, persona.DisplayName, now)).ToArray() };
            review = review with { Workflow = w, ReviewStatus = record.Status, ReviewedBy = persona.DisplayName, ReviewedAtUtc = now,
                ReviewPhaseOrder = ["MANUFACTURING_DEFINITION", "MATERIAL_BOM_DEFINITION"],
                ManufacturingReviewStatus = w.Manufacturing is null ? "IN_PROGRESS" : "COMPLETE" };
            record = record with { TechnicalReview = review };
            dataset.Records[index] = record; dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset);
            return WorkflowEnvelope(record);
        }
        finally { gate.Release(); }
    }
}
