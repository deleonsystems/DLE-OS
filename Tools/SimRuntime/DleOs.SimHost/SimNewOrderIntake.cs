using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimOrderQuoteRef(string IntakeId, string QuoteNumber, string ApprovalId, int ApprovalVersion);
internal sealed record SimOrderQuoteBaseline(SimOrderQuoteRef Reference, SimRfqIntakeCustomer Customer,
    SimFinalApproval Approval, string Bucket, string CommercialStatus, DateTimeOffset? SubmittedAt,
    DateTimeOffset? ExpiresAt, string SourceScope, SimCustomerRequestDocument[] CustomerRequestDocuments);
internal sealed record SimOrderLine(string Assembly, string Revision, int? Quantity, string Currency,
    decimal? UnitPrice, decimal? ExtendedValue,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? CustomerDueDate = null);
internal sealed record SimOrderFacts(string? PoDate, SimOrderLine[] Lines, string? RequestedDelivery,
    decimal? Nre, decimal? SeparateCharges);
internal sealed record SimOrderComparison(string Field, string? Actual, string? Quoted, string Result, string Note = "");
internal sealed record SimOrderEvidence(SimRfqIntakeDocument Document, string Sha256, string AddedBy,
    string Owner = "INTAKE", string Type = "CUSTOMER_PO");
internal sealed record SimOrderEvent(string RequestId, string Action, int Revision, string ActorId,
    string Actor, DateTimeOffset At, string ContentHash);
internal sealed record SimOrderTechnicalBaseline(SimOrderQuoteRef Quote, string SourceToken,
    SimQuotationInputs Definition, SimMaterialSnapshot Materials, SimLaborSnapshot Labor);
internal sealed record SimOrderTechnicalSource(string Choice, string Status, SimOrderTechnicalBaseline? Baseline,
    SimOrderEvidence[] Documents, string[] ReviewReasons, string ReviewTarget = "Contract Review");
internal sealed record SimNewOrderPackage(string PoNumber, SimOrderFacts Facts, bool? PreviouslyQuoted,
    SimOrderQuoteBaseline? Quote, SimOrderComparison[] Comparison, SimOrderComparison[] Discrepancies,
    SimContractReviewRequest? Questionnaire, SimOrderEvidence[] PoEvidence, string ReviewStatus,
    int Revision, int WizardStep, SimOrderEvent[] History,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimOrderTechnicalSource? TechnicalSource = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? WizardStepKey = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimPoFactReview[]? PoFactReviews = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] bool? PoFactsConfirmed = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? FlowVersion = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimOrderContractDates? ContractDates = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? PendingDueDateNote = null);
internal sealed record SimOrderPreviewRequest(SimRfqIntakeCustomer Customer, SimOrderFacts Facts,
    bool? PreviouslyQuoted, SimOrderQuoteRef? Quote);
internal sealed record SimOrderPreview(SimOrderQuoteBaseline? Baseline, SimOrderComparison[] Comparison,
    SimOrderTechnicalBaseline? TechnicalBaseline = null, int TechnicalSourceContractVersion = 1, int RequirementsUiVersion = 3, int ManualDateVersion = 1);
internal sealed record SimOrderSaveRequest(string RequestId, string CorrelationId, string? IntakeId,
    int ExpectedRevision, SimRfqIntakeCustomer Customer, string PoNumber, SimOrderFacts Facts,
    bool? PreviouslyQuoted, SimOrderQuoteRef? Quote, SimContractReviewRequest? Questionnaire,
    SimRfqIntakeDocument[] Documents, int WizardStep, bool Submit = false,
    string? TechnicalSourceChoice = null, SimRfqIntakeDocument[]? IncomingTechnicalDocuments = null, string? WizardStepKey = null,
    bool PoFactsConfirmed = false, int? FlowVersion = null, bool PoDateVerified = false, SimOrderDateDecision? DueDateDecision = null, string? DueDateNote = null);
internal sealed record SimOrderSaveResult(bool Resumed, SimRfqIntakeRecord Record);

internal sealed partial class SimRfqIntakeStore
{
    internal async Task<object[]> ListOrderDrafts()
    {
        await gate.WaitAsync();
        try {
            return (await ReadDatasetAsync()).Records.Where(r => r.Environment == "SIM" && r.IntakeType == "NEW_ORDER" && r.OrderIntake?.ReviewStatus == "DRAFT")
                .OrderByDescending(r => r.OrderIntake!.History.LastOrDefault()?.At ?? DateTimeOffset.MinValue)
                .Select(r => { var p = r.OrderIntake!; var line = p.Facts.Lines.FirstOrDefault(); return (object)new {
                    r.IntakeId, r.Customer, p.PoNumber, QuoteNumber = p.Quote?.Reference.QuoteNumber,
                    Assembly = line?.Assembly, Revision = line?.Revision, LastSavedAt = p.History.LastOrDefault()?.At,
                    p.WizardStep, p.WizardStepKey, p.FlowVersion, DraftRevision = p.Revision, PoAttached = p.PoEvidence.Length > 0
                }; }).ToArray();
        } finally { gate.Release(); }
    }
    // Called under the intake gate. Search is a projection of retained approvals and submission history.
    private async Task<SimOrderQuoteBaseline[]> OrderQuotes(DateTimeOffset now)
    {
        var lanes = await ReadRfqLanes(); var result = new List<SimOrderQuoteBaseline>();
        foreach (var r in (await ReadDatasetAsync()).Records.Where(r => r.Environment == "SIM" && r.IntakeType == "NEW_QUOTE_REQUEST")) {
            if (!lanes.TryGetValue(r.IntakeId, out var lane) || lane.Commercial is not {} c) continue;
            foreach (var approval in lane.FinalReviews ?? []) {
                var submission = (c.History ?? []).LastOrDefault(e => e.Action == "SUBMIT" && e.ApprovalId == approval.Id && e.ApprovalVersion == approval.Version);
                var governing = c.ApprovalId == approval.Id && c.ApprovalVersion == approval.Version;
                if (submission is null && !(governing && c.SubmittedAt is not null)) continue;
                var status = governing ? SimRfqCommercialClock.EffectiveStatus(c, now) : "SUPERSEDED";
                result.Add(new(new(r.IntakeId, SimQuotationPdf.QuoteNumber(approval), approval.Id, approval.Version),
                    r.Customer with { CustomerName = approval.Summary.Customer }, approval,
                    status == "SUBMITTED" ? "SUBMITTED" : "HISTORY", status,
                    submission?.SubmittedAt ?? c.SubmittedAt, submission?.ExpiresAt ?? c.ExpiresAt,
                    r.DeLeonScope, r.CustomerRequestDocuments ?? []));
            }
        }
        return result.ToArray();
    }
    internal async Task<SimOrderQuoteBaseline[]> SearchOrderQuotes(string? customerId, string? query, string bucket)
    {
        if (bucket is not ("SUBMITTED" or "HISTORY")) throw SimRfqIntakeProblem.BadRequest("ORDER_BUCKET", "Search Submitted or History.");
        await gate.WaitAsync();
        try {
            var words = (query ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return (await OrderQuotes(DateTimeOffset.UtcNow)).Where(q => q.Bucket == bucket &&
                (string.IsNullOrEmpty(customerId) || q.Customer.CustomerId == customerId) &&
                words.All(w => string.Join(" ", q.Reference.QuoteNumber, q.Customer.CustomerName, q.Customer.CustomerNumber,
                    q.Approval.Summary.Assembly, q.Approval.Summary.Revision).Contains(w, StringComparison.OrdinalIgnoreCase)))
                .OrderByDescending(q => q.SubmittedAt).ToArray();
        } finally { gate.Release(); }
    }
    private async Task<SimOrderPreview> OrderPreview(SimOrderPreviewRequest request)
    {
        if (request.Customer is null || string.IsNullOrWhiteSpace(request.Customer.CustomerId))
            throw SimRfqIntakeProblem.BadRequest("ORDER_CUSTOMER", "Select a customer before comparing the order.");
        SimOrderQuoteBaseline? quote = null;
        if (request.PreviouslyQuoted == true && request.Quote is not null)
            quote = (await OrderQuotes(DateTimeOffset.UtcNow)).SingleOrDefault(q => q.Reference == request.Quote)
                ?? throw SimRfqIntakeProblem.Conflict("ORDER_QUOTE", "The exact submitted quotation version was not found. Search again.");
        if (request.PreviouslyQuoted != true && request.Quote is not null)
            throw SimRfqIntakeProblem.BadRequest("ORDER_QUOTE", "Choose Previously quoted before selecting a quotation.");
        return new(quote, CompareOrder(request.Customer, request.Facts, request.PreviouslyQuoted, quote), await OrderTechnicalBaseline(quote));
    }
    private async Task<SimOrderTechnicalBaseline?> OrderTechnicalBaseline(SimOrderQuoteBaseline? quote)
    {
        if (quote is null) return null;
        var source = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == quote.Reference.IntakeId);
        var lanes = await ReadRfqLanes();
        if (source?.TechnicalReview?.Workflow?.Outputs is not {} definition || !lanes.TryGetValue(source.IntakeId, out var lane) ||
            FinalSourceToken(source, lane) != quote.Approval.SourceToken) return null;
        var summary = quote.Approval.Summary;
        var materials = lane.MaterialsQuote?.Versions.SingleOrDefault(v => v.Version == summary.MaterialsVersion);
        var labor = lane.LaborQuote?.Versions.SingleOrDefault(v => v.Version == summary.LaborVersion);
        if (!summary.TechnicalComplete || !summary.MaterialsComplete || !summary.LaborComplete ||
            materials is null || labor is null || definition.Manufacturing.Id != summary.ManufacturingDefinitionId ||
            labor.DefinitionId != definition.Manufacturing.Id || materials.CandidateId != definition.Materials.Candidate.Id ||
            materials.BomVersion != definition.Materials.Version) return null;
        return new(quote.Reference, quote.Approval.SourceToken, definition, materials, labor);
    }
    internal async Task<SimOrderPreview> PreviewOrder(SimOrderPreviewRequest request)
    {
        await gate.WaitAsync(); try { ValidateOrderFacts(request.Facts, false); return await OrderPreview(request); }
        finally { gate.Release(); }
    }
    internal static SimOrderComparison[] CompareOrder(SimRfqIntakeCustomer customer, SimOrderFacts facts, bool? quoted, SimOrderQuoteBaseline? baseline)
    {
        var result = new List<SimOrderComparison>(); var line = facts.Lines.FirstOrDefault(); var s = baseline?.Approval.Summary;
        string? Value(object? v) => v is IFormattable f ? f.ToString(null, CultureInfo.InvariantCulture) : v?.ToString();
        void Field(string name, object? actual, object? expected) {
            var a = Value(actual); var b = Value(expected);
            var state = quoted == false ? "NOT_APPLICABLE" : string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b) ? "MISSING" :
                actual is decimal ad && expected is decimal bd ? ad == bd ? "MATCH" : "DIFFERENCE" :
                string.Equals(a?.Trim(), b?.Trim(), StringComparison.Ordinal) ? "MATCH" : "DIFFERENCE";
            result.Add(new(name, a, b, state));
        }
        Field("Customer", customer.CustomerId, baseline?.Customer.CustomerId);
        result[0] = result[0] with { Actual=customer.CustomerName, Quoted=baseline?.Customer.CustomerName };
        Field("Assembly", line?.Assembly, s?.Assembly); Field("Revision", line?.Revision, s?.Revision);
        Field("Quantity", line?.Quantity, s?.Quantity); Field("Currency", line?.Currency, s?.Currency);
        Field("Unit price", line?.UnitPrice, s?.CombinedUnitPrice); Field("Extended value", line?.ExtendedValue, s?.Total);
        Field("NRE", facts.Nre, s is null ? null : s.NreTotal + (s.MaterialSupplemental?.MaterialNre ?? 0));
        Field("Separate charges", facts.SeparateCharges, s is null ? null : s.MaterialSupplemental?.SeparateCharges ?? 0);
        Field("Order total", line?.ExtendedValue + facts.Nre + facts.SeparateCharges, s?.QuoteTotal);
        result.Add(new("Line arithmetic", Value(line?.ExtendedValue), Value(line?.UnitPrice * line?.Quantity),
            line?.ExtendedValue is null || line.UnitPrice is null || line.Quantity is null ? "MISSING" :
            line.ExtendedValue == decimal.Round(line.UnitPrice.Value * line.Quantity.Value, 2, MidpointRounding.AwayFromZero) ? "MATCH" : "DIFFERENCE",
            "Extended value must agree with quantity × unit price rounded to cents."));
        foreach (var field in new[] { "Delivery", "Payment terms", "Shipping terms", "Scope" })
            result.Add(new(field, field == "Delivery" ? facts.RequestedDelivery : null,
                field == "Delivery" ? baseline?.Approval.Answers.Delivery : null,
                quoted == false ? "NOT_APPLICABLE" : "NOT_COMPARABLE",
                field == "Delivery" ? "A lead time is not a promised calendar date. Review requested delivery and feasibility." :
                "Manual Contract Review required; no structured frozen quotation term is available."));
        if (baseline?.Bucket == "HISTORY") result.Add(new("Quotation availability", baseline.CommercialStatus, "SUBMITTED", "DIFFERENCE", "Historical quotation requires explicit Contract Review; selection does not reactivate or award it."));
        return result.ToArray();
    }
    private static void ValidateOrderFacts(SimOrderFacts? facts, bool submit)
    {
        if (facts?.Lines is null || facts.Lines.Length > 1 || facts.Lines.Any(l => l is null)) throw SimRfqIntakeProblem.BadRequest("ORDER_FACTS", "This foundation supports one order line.");
        if (facts.PoDate is {Length: > 0} && !DateOnly.TryParseExact(facts.PoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw SimRfqIntakeProblem.BadRequest("ORDER_DATE", "Enter a valid PO date.");
        if (facts.Lines.Any(l => l.CustomerDueDate is not null && !ValidContractDate(l.CustomerDueDate))) throw SimRfqIntakeProblem.BadRequest("ORDER_DUE_DATE", "Enter a valid customer due date.");
        if (facts.Nre < 0 || facts.SeparateCharges < 0 || facts.Lines.Any(l => l.Quantity < 1 || l.UnitPrice < 0 || l.ExtendedValue < 0)) throw SimRfqIntakeProblem.BadRequest("ORDER_FACTS", "Quantities must be positive and prices cannot be negative.");
        if (submit && (string.IsNullOrWhiteSpace(facts.PoDate) || string.IsNullOrWhiteSpace(facts.RequestedDelivery) || facts.Nre is null || facts.SeparateCharges is null || facts.Lines.Length != 1 ||
            facts.Lines.Any(l => string.IsNullOrWhiteSpace(l.Assembly) || string.IsNullOrWhiteSpace(l.Revision) || l.Quantity is null || l.Currency?.Length != 3 || !l.Currency.All(c => c is >= 'A' and <= 'Z') || l.UnitPrice is null || l.ExtendedValue is null)))
            throw SimRfqIntakeProblem.BadRequest("ORDER_FACTS", "Complete the PO date, line, currency, amounts, charges (zero if none) and requested delivery.");
    }
    internal async Task<SimRfqIntakeRecord[]> FindOrders(string customerId, string? po, string? approvalId)
    {
        await gate.WaitAsync(); try { return (await ReadDatasetAsync()).Records.Where(r => r.Environment == "SIM" && r.IntakeType == "NEW_ORDER" && r.Customer.CustomerId == customerId &&
            (string.IsNullOrWhiteSpace(po) || string.Equals(r.OrderIntake?.PoNumber ?? r.ContractReview?.CustomerPoNumber, po.Trim(), StringComparison.OrdinalIgnoreCase)) &&
            (string.IsNullOrWhiteSpace(approvalId) || r.OrderIntake?.Quote?.Reference.ApprovalId == approvalId)).ToArray(); }
        finally { gate.Release(); }
    }
    internal async Task<SimOrderSaveResult> SaveOrder(SimOrderSaveRequest request, SimPersona persona, SimStateMetadata metadata)
    {
        if (!Guid.TryParse(request.RequestId, out _) || !Guid.TryParse(request.CorrelationId, out _) || string.IsNullOrWhiteSpace(request.PoNumber) || request.PoNumber.Length > 200 ||
            request.Customer is null || string.IsNullOrWhiteSpace(request.Customer.CustomerId) || request.Customer.ResolutionSource != "sim-canonical-customer-directory")
            throw SimRfqIntakeProblem.BadRequest("ORDER_IDENTITY", "Select a customer and enter the customer PO number with valid request identities.");
        ValidateOrderFacts(request.Facts, request.Submit);
        await gate.WaitAsync();
        try {
            var dataset = await ReadDatasetAsync();
            var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request, jsonOptions)));
            var retry = dataset.Records.FirstOrDefault(r => r.OrderIntake?.History.Any(e => e.RequestId == request.RequestId) == true);
            if (retry is not null) {
                if (retry.OrderIntake!.History.Single(e => e.RequestId == request.RequestId).ContentHash != hash) throw SimRfqIntakeProblem.Conflict("ORDER_REQUEST_REUSED", "Request identity was already used for different content.");
                return new(true, retry);
            }
            var record = request.IntakeId is null ? null : dataset.Records.SingleOrDefault(r => r.IntakeId == request.IntakeId && r.Environment == "SIM" && r.OrderIntake is not null)
                ?? throw SimRfqIntakeProblem.NotFound("ORDER_NOT_FOUND", "Order draft not found.");
            var duplicate = dataset.Records.FirstOrDefault(r => r.Environment == "SIM" && r.IntakeType == "NEW_ORDER" && r.IntakeId != record?.IntakeId &&
                (r.RequestCorrelationId == request.CorrelationId || (r.Customer.CustomerId == request.Customer.CustomerId &&
                string.Equals(r.OrderIntake?.PoNumber ?? r.ContractReview?.CustomerPoNumber, request.PoNumber.Trim(), StringComparison.OrdinalIgnoreCase))));
            if (duplicate is not null) return new(true, duplicate);
            if (record is not null && (record.OrderIntake!.ReviewStatus != "DRAFT" || record.OrderIntake.Revision != request.ExpectedRevision || record.RequestCorrelationId != request.CorrelationId))
                throw SimRfqIntakeProblem.Conflict("ORDER_STALE", "Order changed or was submitted. Reopen the existing intake.");
            if (record is null && request.ExpectedRevision != 0) throw SimRfqIntakeProblem.Conflict("ORDER_STALE", "Start or reopen the order draft.");
            var preview = await OrderPreview(new(request.Customer, request.Facts, request.PreviouslyQuoted, request.Quote));
            // A previously verified frozen baseline remains valid evidence even if the source RFQ later changes.
            if (preview.TechnicalBaseline is null && record?.OrderIntake?.TechnicalSource?.Baseline is {} retained &&
                retained.Quote == preview.Baseline?.Reference && retained.SourceToken == preview.Baseline.Approval.SourceToken)
                preview = preview with { TechnicalBaseline = retained };
            if (request.Submit && (request.PreviouslyQuoted is null || (request.PreviouslyQuoted == true && preview.Baseline is null))) throw SimRfqIntakeProblem.BadRequest("ORDER_QUOTE", "Answer Previously quoted and select the exact quotation when applicable.");
            var contractDates = ReviewContractDates(request,record?.OrderIntake,persona);
            if (request.Submit) {
                var questionnaire = request.Questionnaire ?? throw SimRfqIntakeProblem.BadRequest("ORDER_QUESTIONNAIRE", "Complete the order questionnaire.");
                // Reuse the established questionnaire validation, excluding the obsolete manual price assertion.
                ValidateContractReview(new("NEW_ORDER", request.Customer, 0, [], "", true, [], [], null, request.CorrelationId,
                    questionnaire with { CustomerPoNumber = request.PoNumber, PriceMatchesQuote = true,
                        DeliveryDateAchievable = contractDates.DueDateReview?.Disposition == "ACCEPT",
                        DeliveryDateActionNote = contractDates.DueDateReview?.Note ?? "" }));
                if (!questionnaire.RequirementsIdentifiedOnAttachedDocument) throw SimRfqIntakeProblem.BadRequest("ORDER_EVIDENCE", "Confirm the requirements against the attached PO evidence.");
            }
            var evidence = new List<SimOrderEvidence>();
            foreach (var doc in request.Documents ?? []) {
                if (doc.DocumentId is null) throw SimRfqIntakeProblem.BadRequest("ORDER_EVIDENCE", "Upload and verify every PO attachment.");
                var previous = record?.OrderIntake?.PoEvidence.SingleOrDefault(e => e.Document.DocumentId == doc.DocumentId);
                var verified = await documents.Verify(request.CorrelationId, doc, previous?.AddedBy ?? persona.DisplayName);
                evidence.Add(new(verified, Convert.ToHexString(SHA256.HashData(await documents.Bytes(request.CorrelationId, doc.DocumentId))), previous?.AddedBy ?? persona.DisplayName));
            }
            if (evidence.Select(e => e.Document.DocumentId).Distinct().Count() != evidence.Count || (request.Submit && evidence.Count == 0)) throw SimRfqIntakeProblem.BadRequest("ORDER_EVIDENCE", "Attach verified PO evidence once per document.");
            if (request.Submit && !request.PoFactsConfirmed) throw SimRfqIntakeProblem.BadRequest("ORDER_PO_CONFIRM", "Review and confirm the actual PO details before submission.");
            var factReviews = record?.OrderIntake?.PoFactReviews ?? [];
            if (request.PoFactsConfirmed) {
                ValidateOrderFacts(request.Facts,true);
                if (evidence.Count==0 || evidence.Count>10) throw SimRfqIntakeProblem.BadRequest("ORDER_EVIDENCE", "Attach verified PO evidence before confirming details.");
                var decisionHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new {request.Facts,request.PoNumber,CustomerId=request.Customer.CustomerId,Token=PoDocumentToken(evidence)},jsonOptions)));
                if (factReviews.LastOrDefault()?.DecisionHash != decisionHash) {
                    var extraction = await ParseOrderPo(request.CorrelationId,evidence.ToArray());
                    bool Different(string? actual,string? extracted) => actual!=extracted && !(decimal.TryParse(actual,NumberStyles.Number,CultureInfo.InvariantCulture,out var a) && decimal.TryParse(extracted,NumberStyles.Number,CultureInfo.InvariantCulture,out var b) && a==b);
                    var corrections = PoFactValues(request.Facts).Where(p=>Different(p.Value,extraction.Fields.GetValueOrDefault(p.Key)?.Value)).Select(p=>p.Key).ToList();
                    if (extraction.Fields.GetValueOrDefault("poNumber")?.Value != request.PoNumber) corrections.Add("poNumber");
                    factReviews = factReviews.Append(new SimPoFactReview(extraction,request.Facts,request.PoNumber,request.Customer.CustomerId,corrections.ToArray(),persona.Id,persona.DisplayName,DateTimeOffset.UtcNow,decisionHash)).ToArray();
                }
            }
            if (request.TechnicalSourceChoice is not (null or "QUOTED_DEFINITION" or "NEW_DOCUMENTS"))
                throw SimRfqIntakeProblem.BadRequest("ORDER_TECHNICAL_SOURCE", "Choose the technical document source.");
            var incoming = new List<SimOrderEvidence>();
            foreach (var doc in request.IncomingTechnicalDocuments ?? []) {
                if (doc.DocumentId is null || evidence.Any(e => e.Document.DocumentId == doc.DocumentId) || incoming.Any(e => e.Document.DocumentId == doc.DocumentId))
                    throw SimRfqIntakeProblem.BadRequest("ORDER_TECHNICAL_EVIDENCE", "Attach each incoming technical file separately from PO evidence.");
                var previous = record?.OrderIntake?.TechnicalSource?.Documents.SingleOrDefault(e => e.Document.DocumentId == doc.DocumentId);
                var uploader = previous?.AddedBy ?? persona.DisplayName;
                var verified = await documents.Verify(request.CorrelationId, doc, uploader);
                incoming.Add(new(verified, Convert.ToHexString(SHA256.HashData(await documents.Bytes(request.CorrelationId, doc.DocumentId))), uploader, Type: "INCOMING_ORDER_TECHNICAL"));
            }
            if (request.TechnicalSourceChoice != "NEW_DOCUMENTS" && incoming.Count > 0)
                throw SimRfqIntakeProblem.BadRequest("ORDER_TECHNICAL_SOURCE", "Review or remove the incoming technical documents before using only quoted documents.");
            if (request.Submit && (request.TechnicalSourceChoice is null ||
                request.TechnicalSourceChoice == "QUOTED_DEFINITION" && (preview.TechnicalBaseline is null || preview.Baseline?.Customer.CustomerId != request.Customer.CustomerId) ||
                request.TechnicalSourceChoice == "NEW_DOCUMENTS" && incoming.Count == 0))
                throw SimRfqIntakeProblem.BadRequest("ORDER_TECHNICAL_SOURCE", "Select a verified quoted technical definition or attach new technical documents for review. An authoritative definition is required.");
            var reasons = preview.Comparison.Where(c => c.Field is "Customer" or "Assembly" or "Revision").Where(c => c.Result is "DIFFERENCE" or "MISSING").Select(c => c.Field + ": " + c.Result).ToList();
            if (request.TechnicalSourceChoice == "NEW_DOCUMENTS") reasons.Add("Compare incoming documents with the quoted baseline; reviewer must identify affected scope before technical acceptance.");
            var technical = request.TechnicalSourceChoice is null ? null : new SimOrderTechnicalSource(request.TechnicalSourceChoice,
                request.TechnicalSourceChoice == "NEW_DOCUMENTS" || reasons.Count > 0 ? "TECHNICAL_REVIEW_REQUIRED" : preview.TechnicalBaseline is null ? "MISSING_DEFINITION" : "QUOTED_DEFINITION_LINKED",
                preview.TechnicalBaseline, incoming.ToArray(), reasons.ToArray(), request.TechnicalSourceChoice == "NEW_DOCUMENTS" || reasons.Count > 0 ? "Contract Review / Technical Review scope triage" : "Contract Review");
            var now = DateTimeOffset.UtcNow; var revision = (record?.OrderIntake?.Revision ?? 0) + 1;
            var status = request.Submit ? "READY_FOR_CONTRACT_REVIEW" : "DRAFT";
            var package = new SimNewOrderPackage(request.PoNumber.Trim(), request.Facts, request.PreviouslyQuoted,
                preview.Baseline, preview.Comparison, preview.Comparison.Where(c => c.Result is "DIFFERENCE" or "MISSING" or "NOT_COMPARABLE").ToArray(),
                request.Questionnaire is null ? null : request.Questionnaire with { CustomerPoNumber = request.PoNumber.Trim(), PriceMatchesQuote = null, PriceActionNote = null,
                    DeliveryDateAchievable = contractDates.DueDateReview is null ? null : contractDates.DueDateReview.Disposition == "ACCEPT",
                    DeliveryDateActionNote = contractDates.DueDateReview?.Note ?? "" },
                evidence.ToArray(), status, revision, Math.Clamp(request.WizardStep, 0, 100),
                (record?.OrderIntake?.History ?? []).Append(new(request.RequestId, request.Submit ? "SUBMIT_FOR_CONTRACT_REVIEW" : "SAVE_DRAFT", revision, persona.Id, persona.DisplayName, now, hash)).ToArray(), technical, request.WizardStepKey,
                factReviews.Length>0 ? factReviews : null, request.PoFactsConfirmed, request.FlowVersion, contractDates, request.DueDateNote);
            if (record is null) {
                var id = $"RFQI-SIM-{++dataset.LastIntakeSequence:0000}";
                record = new(id, request.CorrelationId, "DLE_RFQ_INTAKE_V1", "Contract Review", status, "NEW_ORDER", request.Customer,
                    0, [], "", false, [], "NOT_PROVIDED", [], persona.DisplayName, now, metadata.ScenarioId, metadata.Generation, "SIM");
                dataset.Records.Add(record);
            }
            var updated = record with { Customer = request.Customer, Status = status, HandoffTarget = "Contract Review", OrderIntake = package,
                DocumentPreservationState = evidence.Count > 0 ? "BINARIES_VERIFIED_SIM" : "NOT_PROVIDED" };
            dataset.Records[dataset.Records.IndexOf(record)] = updated; dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset); return new(false, updated);
        } finally { gate.Release(); }
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapNewOrders(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/new-orders/contract-review-preview", async Task<IResult>(HttpContext c, SimOrderSaveRequest request) => {
            var denied = Denied(c,state,personas,false); if(denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            try { return Results.Json(await store.PreviewContractReview(request,personas.Resolve(c))); }
            catch(SimRfqIntakeProblem p) { return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode); }
        });
        app.MapPost("/api/sim/new-orders/contract-review-preview/pdf", async Task<IResult>(HttpContext c, SimOrderSaveRequest request) => {
            var denied = Denied(c,state,personas,false); if(denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            c.Response.Headers["X-Content-Type-Options"] = "nosniff";
            try {
                var projection = await store.PreviewContractReview(request,personas.Resolve(c));
                return Results.File(await SimQuotationPdf.RenderDocument(projection,"sim_contract_review_pdf.py"),"application/pdf");
            } catch(SimRfqIntakeProblem p) { return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode); }
            catch(IOException) { return Results.Json(new {message="Contract Review PDF preview could not be rendered."},statusCode:503); }
        });
        app.MapPost("/api/sim/new-orders/po-extraction", async Task<IResult>(HttpContext c, SimPoExtractRequest request) => {
            var denied = Denied(c,state,personas,false); if(denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            try { return Results.Json(await store.ExtractOrderPo(request,personas.Resolve(c))); }
            catch(SimRfqIntakeProblem p) { return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode); }
        });
        app.MapGet("/api/sim/new-orders/drafts", async Task<IResult>(HttpContext c) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { items = await store.ListOrderDrafts() });
        });
        app.MapGet("/api/sim/new-orders/drafts/{id}", async Task<IResult>(HttpContext c, string id) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            if (await store.ReadAsync(id) is not SimRfqIntakeRecord { Environment: "SIM", IntakeType: "NEW_ORDER", OrderIntake.ReviewStatus: "DRAFT" } record)
                return Results.Json(new { message = "This order is no longer an editable draft. Refresh the draft list." }, statusCode: 409);
            return Results.Json(new { record });
        });
        app.MapGet("/api/sim/new-orders/{id}/documents/{documentId}", async Task<IResult>(HttpContext c, string id, string documentId) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            c.Response.Headers["X-Content-Type-Options"] = "nosniff";
            try {
                if (await store.ReadAsync(id) is not SimRfqIntakeRecord { OrderIntake: not null } record ||
                    !record.OrderIntake.PoEvidence.Concat(record.OrderIntake.TechnicalSource?.Documents ?? []).Any(e => e.Document.DocumentId == documentId)) return Results.NotFound();
                var file = await store.OpenDocument(id, documentId);
                return Results.File(file.Bytes, file.Document.Type, file.Document.Name);
            } catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
        });
        app.MapGet("/api/sim/new-orders/quotes", async Task<IResult>(HttpContext c, string? customerId, string? query, string? bucket) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            try { return Results.Json(new { items = await store.SearchOrderQuotes(customerId, query, bucket ?? "SUBMITTED") }); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
        });
        app.MapPost("/api/sim/new-orders/preview", async Task<IResult>(HttpContext c, SimOrderPreviewRequest request) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            try { return Results.Json(await store.PreviewOrder(request)); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
        });
        app.MapGet("/api/sim/new-orders", async Task<IResult>(HttpContext c, string customerId, string? po, string? approvalId) => {
            var denied = Denied(c, state, personas, false); if (denied is not null) return denied;
            c.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { items = await store.FindOrders(customerId, po, approvalId) });
        });
        app.MapPost("/api/sim/new-orders", async Task<IResult>(HttpContext c, SimOrderSaveRequest request) => {
            var denied = Denied(c, state, personas, true); if (denied is not null) return denied;
            try { return Results.Json(await store.SaveOrder(request, personas.Resolve(c), state.Current.Metadata!)); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "Order save could not be verified. Retry the same request." }, statusCode: 503); }
        });
    }
}
