using System.Globalization;
using System.Text.RegularExpressions;

internal sealed record SimReviewField(string Label, string Value);
internal sealed record SimReviewSection(string Title, string EditStep, SimReviewField[] Fields);
internal sealed record SimReviewFile(string Name, string Type, string? Url);
internal sealed record SimContractReviewProjection(string Title, string Status, string IntakeId, int PackageRevision,
    string Notice, SimReviewSection[] Sections, SimReviewFile[] PoDocuments, SimReviewFile[] TechnicalDocuments,
    string[] Attention, bool Acknowledged, string Reviewer, string ReviewedDate, SimCustomerSupplyProjection? CustomerSupply = null);

internal sealed partial class SimRfqIntakeStore
{
    // Read-only preview of current form values. Never calls SaveOrder or records review events.
    internal async Task<SimContractReviewProjection> PreviewContractReview(SimOrderSaveRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            ValidateOrderFacts(request.Facts, false);
            var record = request.IntakeId is null ? null : (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == request.IntakeId && r.IntakeType == "NEW_ORDER");
            if (request.IntakeId is not null && (record is null || record.OrderIntake?.Revision != request.ExpectedRevision || record.RequestCorrelationId != request.CorrelationId || record.OrderIntake.ReviewStatus != "DRAFT"))
                throw SimRfqIntakeProblem.Conflict("ORDER_STALE", "The saved package changed. Reopen the draft before previewing.");
            var preview = await OrderPreview(new(request.Customer, request.Facts, request.PreviouslyQuoted, request.Quote));
            var baseline = preview.TechnicalBaseline;
            if (baseline is null && record?.OrderIntake?.TechnicalSource?.Baseline is {} retained && retained.Quote == preview.Baseline?.Reference && retained.SourceToken == preview.Baseline.Approval.SourceToken) baseline = retained;
            var po = new List<SimReviewFile>();
            foreach (var doc in request.Documents ?? []) {
                await documents.Verify(request.CorrelationId, doc, record?.OrderIntake?.PoEvidence.FirstOrDefault(e => e.Document.DocumentId == doc.DocumentId)?.AddedBy ?? persona.DisplayName);
                // Existing intake retrieval is only valid for a document already attached to it.
                var attached = record?.OrderIntake?.PoEvidence.Any(e => e.Document.DocumentId == doc.DocumentId) == true;
                po.Add(new(doc.Name, "Customer PO", attached ? $"/api/sim/new-orders/{Uri.EscapeDataString(record!.IntakeId)}/documents/{Uri.EscapeDataString(doc.DocumentId!)}" : null));
            }
            var technical = (baseline?.Definition.Manufacturing.Package.Documents ?? []).OrderBy(d => d.Name).Select(d => new SimReviewFile(d.Name,
                d.IdentityReview?.Type == "BOM_ONLY" || d.DocumentType == "BOM" ? "BOM" : d.IdentityReview?.Type == "DRAWING" || d.DocumentType.Contains("DRAWING") ? "Technical Drawing" : "Supporting Document",
                $"/api/sim/rfq-intakes/{Uri.EscapeDataString(baseline!.Quote.IntakeId)}/documents/{Uri.EscapeDataString(d.DocumentId)}")).ToList();
            foreach (var doc in request.IncomingTechnicalDocuments ?? []) {
                await documents.Verify(request.CorrelationId, doc, record?.OrderIntake?.TechnicalSource?.Documents.FirstOrDefault(e => e.Document.DocumentId == doc.DocumentId)?.AddedBy ?? persona.DisplayName);
                var attached = record?.OrderIntake?.TechnicalSource?.Documents.Any(e => e.Document.DocumentId == doc.DocumentId) == true;
                technical.Add(new(doc.Name, "Incoming Technical Document", attached ? $"/api/sim/new-orders/{Uri.EscapeDataString(record!.IntakeId)}/documents/{Uri.EscapeDataString(doc.DocumentId!)}" : null));
            }
            return BuildContractReview(request, preview with {TechnicalBaseline=baseline}, po.ToArray(), technical.ToArray(), persona, DateTimeOffset.Now);
        } finally { gate.Release(); }
    }

    internal static SimContractReviewProjection BuildContractReview(SimOrderSaveRequest r, SimOrderPreview preview,
        SimReviewFile[] po, SimReviewFile[] docs, SimPersona persona, DateTimeOffset now)
    {
        var q = r.Questionnaire; var line = r.Facts.Lines.FirstOrDefault();
        string Value(string? s) => string.IsNullOrWhiteSpace(s) ? "Not entered" : s;
        string Yes(bool? b) => b is null ? "Not reviewed" : b.Value ? "Yes" : "No";
        string Date(string? s) => DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date.ToString("MM/dd/yyyy", CultureInfo.InvariantCulture) : "Not entered";
        var sections = new List<SimReviewSection>(); var attention = new List<string>();
        void Section(string title, string step, params SimReviewField[] fields) => sections.Add(new(title, step, fields));
        var classification = q?.OrderClassification switch { "NEW_ASSEMBLY" => "New Assembly", "NEW_REVISION" => "New Revision", "REPEAT_ORDER" => "Repeat Order", _ => "Not reviewed" };
        Section("Order", "order-facts", new("Customer", r.Customer.CustomerName), new("PO Number", r.PoNumber), new("PO Date", Date(r.Facts.PoDate)),
            new("Quote", preview.Baseline?.Reference.QuoteNumber ?? "Not selected"), new("Assembly / Rev", Value(line?.Assembly) + " / " + Value(line?.Revision)),
            new("Quantity", line?.Quantity?.ToString() ?? "Not entered"), new("Classification", classification));
        string Result(string s) => s switch { "MATCH" => "MATCH", "DIFFERENCE" => "Difference", "MISSING" => "Missing information", "NOT_APPLICABLE" => "Not applicable", _ => "Manual review" };
        string Money(string? s, string? currency) => decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) ? (currency == "USD" ? "$" : Value(currency) + " ") + amount.ToString("N2", CultureInfo.InvariantCulture) : "Not entered";
        var pricing = preview.Comparison.Where(c => c.Field is "Unit price" or "Order total").Select(c => new SimReviewField(c.Field, "PO " + Money(c.Actual, line?.Currency) + " | Quote " + Money(c.Quoted, preview.Comparison.FirstOrDefault(f => f.Field == "Currency")?.Quoted) + " | " + Result(c.Result))).ToList();
        var core = preview.Comparison.Where(c => c.Field is not ("Delivery" or "Payment terms" or "Shipping terms" or "Scope" or "Quotation availability")).ToArray();
        pricing.Add(new("Core quote comparison", r.PreviouslyQuoted == false ? "Not applicable" : core.Length > 0 && core.All(c => c.Result == "MATCH") ? "MATCH" : "Review required"));
        Section("PO / Quote Review", "order-comparison", pricing.ToArray());
        foreach (var c in preview.Comparison.Where(c => c.Result is "DIFFERENCE" or "MISSING")) attention.Add(c.Field + ": " + Result(c.Result) + ".");
        var shipping = q?.ShippingMethod switch { "WILL_CALL" => "Will Call", "DLE_DELIVERY" => "DLE Delivery", "UPS_CHARGE" => "UPS (Charge)", "UPS_COLLECT" => "UPS Collect", _ => "Not reviewed" };
        var terms = new List<SimReviewField> { new("Payment terms match customer terms", Yes(q?.PaymentTermsMatch) + " (manual review)"), new("Bill To matches Ship To", Yes(q?.BillingMatchesShipTo)), new("Shipping method", shipping) };
        foreach (var f in new[]{new SimReviewField("Payment follow-up",q?.PaymentTermsActionNote ?? ""),new("Shipping follow-up",q?.ShippingActionNote ?? ""),new("UPS account",q?.UpsAccountNumber ?? "")}) if(!string.IsNullOrWhiteSpace(f.Value)) terms.Add(f);
        terms.Add(new("Quote terms", "Payment/shipping terms are not automatically comparable."));
        Section("Payment / Shipping", "payment-terms", terms.ToArray());
        if(q?.PaymentTermsMatch is null) attention.Add("Payment terms have not been reviewed.");
        if(q?.PaymentTermsMatch == false) attention.Add("Payment terms require follow-up: " + Value(q.PaymentTermsActionNote));
        if(q?.BillingMatchesShipTo is null || q?.ShippingMethod is null) attention.Add("Complete shipping review.");
        var lead = preview.Baseline?.Approval.Answers.Delivery;
        var reference = "Unavailable";
        var match = Regex.Match(lead ?? "", @"^(\d+)\s+(Days?|Weeks?)$", RegexOptions.IgnoreCase);
        if (DateOnly.TryParseExact(r.Facts.PoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var poDate) && match.Success && int.TryParse(match.Groups[1].Value, out var count)) {
            var days = (long)count * (match.Groups[2].Value.StartsWith("Week", StringComparison.OrdinalIgnoreCase) ? 7 : 1);
            if(days <= 36600 && poDate.DayNumber + days <= DateOnly.MaxValue.DayNumber) reference = poDate.AddDays((int)days).ToString("MM/dd/yyyy", CultureInfo.InvariantCulture);
        }
        var disposition = r.DueDateDecision?.Disposition switch { "ACCEPT" => "Accepted", "CLARIFICATION" => "Needs Customer Clarification", "CANNOT_MEET" => "Cannot Meet - Follow-Up Required", _ => "Not reviewed" };
        var delivery = new List<SimReviewField> { new("PO Date",Date(r.Facts.PoDate)), new("Customer Due Date",Date(line?.CustomerDueDate)), new("Quoted Lead Time",Value(lead)), new("Quoted Lead-Time Date",reference + " (PO Date + calendar lead; reference only)"),new("Due-Date Disposition",disposition) };
        if(!string.IsNullOrWhiteSpace(r.DueDateDecision?.Note)) delivery.Add(new("Due-date action", r.DueDateDecision.Note));
        Section("Delivery", "delivery-date", delivery.ToArray());
        if(!r.PoDateVerified) attention.Add("Verify the PO Date against the customer PO.");
        if(r.DueDateDecision?.Disposition != "ACCEPT") attention.Add("Customer due date: " + disposition + ". " + (r.DueDateDecision?.Note ?? ""));
        if(string.IsNullOrWhiteSpace(line?.CustomerDueDate)) attention.Add("Customer Due Date is not specified.");
        // A direct contradiction warrants attention; relative lead-time wording alone does not.
        if(r.DueDateDecision?.Disposition != "ACCEPT" && !string.IsNullOrWhiteSpace(line?.CustomerDueDate) && Regex.IsMatch(r.Facts.RequestedDelivery ?? "", @"no\s+fixed\s+(calendar\s+)?(delivery\s+)?date", RegexOptions.IgnoreCase))
            attention.Add("Saved delivery instructions say no fixed date; reconcile them with the reviewed Customer Due Date. No date was changed by this preview.");
        Section("Technical Source", "technical-source", new SimReviewField("Source", r.TechnicalSourceChoice == "QUOTED_DEFINITION" ? "Quoted Job" : r.TechnicalSourceChoice == "NEW_DOCUMENTS" ? "Incoming documents; quoted package retained as baseline" : "Not selected"));
        if(r.TechnicalSourceChoice == "NEW_DOCUMENTS") attention.Add("Incoming technical documents require comparison with the quoted baseline.");
        if(r.TechnicalSourceChoice is null || docs.Length == 0) attention.Add("Verify the technical document source.");
        if(po.Length == 0) attention.Add("Customer PO evidence is not attached.");
        bool Has(string s) => (q?.TraceabilityDeliverables ?? []).Contains(s) || (q?.AerospaceRequirements ?? []).Contains(s);
        string Selection(string s) => q is null ? "Not reviewed" : Yes(Has(s));
        Section("Contract / Quality Requirements", "aerospace-requirements", new("Traceability",Yes(q?.TraceabilityRequired)),new("Traveler",Selection("TRAVELER")),new("Material Certs",Selection("MATERIAL_CERTS")),new("CoC",Selection("CERTIFICATE_OF_CONFORMANCE")),new("FAIR",Selection("FAIR")),new("ITAR",Selection("ITAR")),new("DPAS Rated",Selection("DPAS_RATED")));
        var notes = new List<SimReviewField>();
        foreach(var f in new[]{new SimReviewField("Other Customer Requirements",q?.OtherCustomerRequirements ?? q?.SpecialRequirements ?? ""),new("Legacy PO flowdowns",q?.PoFlowdowns ?? ""),new("Legacy additional quality requirements",q?.AdditionalContractQualityRequirements ?? ""),new("Legacy special requirements",q?.OtherCustomerRequirements is not null ? q?.SpecialRequirements ?? "" : "")}) if(!string.IsNullOrWhiteSpace(f.Value)) notes.Add(f);
        if(notes.Count > 0) Section("Other Customer Requirements", "additional-requirements",notes.ToArray());
        var supply=SimCustomerSupply.Project(preview.TechnicalBaseline,r.Facts,r.PoNumber.Trim(),r.Documents,r.CustomerSupplyReview);
        Section(SimCustomerSupply.Label,"review",supply.Lines.Where(l=>l.QuotedCustomerSupplied || supply.PoRowIds.Contains(l.SourceRowId)).Select(l=>new SimReviewField("Find "+l.FindNumber,SimCustomerSupply.Description(l))).Append(new SimReviewField("Responsibility review",supply.Acknowledged?"Acknowledged against current sources":"Not acknowledged / requires review")).Append(new SimReviewField("Review note",supply.Note)).ToArray());
        attention.AddRange(supply.Issues);
        var acknowledged = q?.RequirementsIdentifiedOnAttachedDocument == true;
        return new("NEW ORDER FINAL REVIEW - DRAFT", "Draft / Not Yet Submitted for Contract Review",r.IntakeId ?? "Unsaved intake",r.ExpectedRevision,
            "Preview of current form values. Not contract acceptance or authorization for Order Entry.",sections.ToArray(),po,docs,attention.ToArray(),acknowledged,acknowledged ? persona.DisplayName : "Not acknowledged",acknowledged ? now.ToString("MM/dd/yyyy",CultureInfo.InvariantCulture) + " (preview; not recorded)" : "Not recorded",supply);
    }
}
