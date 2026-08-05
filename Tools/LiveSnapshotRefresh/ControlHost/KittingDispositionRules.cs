internal static class KittingDispositionRules
{
    internal static readonly HashSet<string> ShortReasonCodes = new(StringComparer.Ordinal)
    { "MATERIAL_UNAVAILABLE", "INSUFFICIENT_QUANTITY", "WRONG_MATERIAL", "MATERIAL_ON_ORDER", "BOM_DISCREPANCY", "DOCUMENTATION_ISSUE", "OTHER" };
    internal static readonly HashSet<string> ChangeReasonCodes = new(StringComparer.Ordinal)
    {
        "SHORTAGE_RESOLVED", "SHORTAGE_RETURNED_TO_KITTING", "COMPLETION_REVERSED",
        "ORDER_REQUIRES_REKIT", "ORDER_MODIFIED", "DOCUMENT_CORRECTION",
        "STATUS_ENTERED_IN_ERROR", "MATERIAL_UNAVAILABLE", "INSUFFICIENT_QUANTITY",
        "WRONG_MATERIAL", "MATERIAL_ON_ORDER", "BOM_DISCREPANCY", "DOCUMENTATION_ISSUE", "OTHER"
    };

    internal static KittingDispositionRuleResult Validate(string? dispositionValue, string? reasonValue,
        string? noteValue, Guid? expectedCurrentEventId, Guid? currentEventId, string? currentDisposition)
    {
        var disposition = (dispositionValue ?? "").Trim().ToUpperInvariant();
        if (disposition is not ("NEEDS_KITTING" or "KIT_SHORT" or "KIT_COMPLETE"))
            throw new KittingDispositionRuleException("unsupported_disposition", "Disposition must be NEEDS_KITTING, KIT_SHORT, or KIT_COMPLETE.");
        if (expectedCurrentEventId != currentEventId)
            throw new KittingDispositionRuleException("current_disposition_changed", "The current kitting disposition changed.");
        var reason = NullIfEmpty(reasonValue)?.ToUpperInvariant();
        var note = NullIfEmpty(noteValue);
        if (note?.Length > 500) throw new KittingDispositionRuleException("note_too_long", "The disposition note cannot exceed 500 characters.");
        if (currentEventId is null && disposition == "KIT_SHORT" && (reason is null || !ShortReasonCodes.Contains(reason)))
            throw new KittingDispositionRuleException("kit_short_reason_required", "Select a controlled Kit Short reason.");
        if (currentEventId is null && disposition is ("NEEDS_KITTING" or "KIT_COMPLETE") && reason is not null)
            throw new KittingDispositionRuleException("initial_reason_not_supported", "An initial Needs Kitting or Kit Complete disposition does not use a reason code.");
        if (currentEventId is not null)
        {
            if (currentDisposition == disposition) throw new KittingDispositionRuleException("disposition_must_change", "Select a different disposition.");
            var noteOnlyNeedsKitting = disposition == "NEEDS_KITTING" && reason is null && note is not null;
            if (!noteOnlyNeedsKitting && (reason is null || !ChangeReasonCodes.Contains(reason)))
                throw new KittingDispositionRuleException("change_reason_required", "Select a controlled disposition-change reason.");
        }
        if (reason == "OTHER" && note is null) throw new KittingDispositionRuleException("other_note_required", "A note is required when Other is selected.");
        return new(disposition, reason, note);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

internal sealed record KittingDispositionRuleResult(string ResultingDisposition, string? ReasonCode, string? Note);
internal sealed class KittingDispositionRuleException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
