var failures = new List<string>();
void Pass(string name, Action action) { try { action(); Console.WriteLine("PASS " + name); } catch (Exception e) { failures.Add(name + ": " + e.Message); } }
void Reject(string name, string code, Action action) => Pass(name, () => { try { action(); throw new Exception("accepted unexpectedly"); } catch (KittingDispositionRuleException e) when (e.Code == code) { } });
var prior = Guid.NewGuid();

Pass("trimmed Work Order aliases", () =>
{
    var aliases = CanonicalWorkOrderIdentity.GetLookupAliases("115611");
    if (!aliases.SequenceEqual(new[] { "115611", "0115611" })) throw new Exception(string.Join(",", aliases));
});
Pass("canonical Work Order aliases", () =>
{
    var aliases = CanonicalWorkOrderIdentity.GetLookupAliases("0115611");
    if (!aliases.SequenceEqual(new[] { "0115611", "115611" })) throw new Exception(string.Join(",", aliases));
});
Pass("canonical identity normalization", () =>
{
    if (CanonicalWorkOrderIdentity.NormalizeCanonical("115611") != "0115611" ||
        CanonicalWorkOrderIdentity.NormalizeCanonical("0115611") != "0115611") throw new Exception("identity mismatch");
});
Pass("malformed Work Order rejected", () =>
{
    if (CanonicalWorkOrderIdentity.TryValidateSubmitted("../115611", out _) ||
        CanonicalWorkOrderIdentity.TryValidateSubmitted("", out _)) throw new Exception("malformed identity accepted");
});

Pass("NOT_DISPOSITIONED to KIT_COMPLETE", () => KittingDispositionRules.Validate("KIT_COMPLETE", null, null, null, null, null));
Pass("NOT_DISPOSITIONED to NEEDS_KITTING", () => KittingDispositionRules.Validate("NEEDS_KITTING", null, "Ready for kitting", null, null, null));
Pass("manual KIT_SHORT", () => KittingDispositionRules.Validate("KIT_SHORT", "MATERIAL_UNAVAILABLE", null, null, null, null));
Reject("KIT_SHORT reason required", "kit_short_reason_required", () => KittingDispositionRules.Validate("KIT_SHORT", null, null, null, null, null));
Reject("OTHER note required", "other_note_required", () => KittingDispositionRules.Validate("KIT_SHORT", "OTHER", null, null, null, null));
Pass("OTHER with note", () => KittingDispositionRules.Validate("KIT_SHORT", "OTHER", "Supplier confirmed delay", null, null, null));
Pass("KIT_SHORT to KIT_COMPLETE", () => KittingDispositionRules.Validate("KIT_COMPLETE", "SHORTAGE_RESOLVED", null, prior, prior, "KIT_SHORT"));
Pass("KIT_COMPLETE to KIT_SHORT", () => KittingDispositionRules.Validate("KIT_SHORT", "COMPLETION_REVERSED", null, prior, prior, "KIT_COMPLETE"));
Pass("NEEDS_KITTING to KIT_SHORT", () => KittingDispositionRules.Validate("KIT_SHORT", "MATERIAL_UNAVAILABLE", null, prior, prior, "NEEDS_KITTING"));
Pass("NEEDS_KITTING to KIT_COMPLETE", () => KittingDispositionRules.Validate("KIT_COMPLETE", "SHORTAGE_RESOLVED", null, prior, prior, "NEEDS_KITTING"));
Pass("KIT_SHORT to NEEDS_KITTING", () => KittingDispositionRules.Validate("NEEDS_KITTING", "SHORTAGE_RETURNED_TO_KITTING", null, prior, prior, "KIT_SHORT"));
Pass("KIT_COMPLETE to NEEDS_KITTING", () => KittingDispositionRules.Validate("NEEDS_KITTING", "ORDER_REQUIRES_REKIT", null, prior, prior, "KIT_COMPLETE"));
Pass("change to NEEDS_KITTING with note", () => KittingDispositionRules.Validate("NEEDS_KITTING", null, "Returned for rekit", prior, prior, "KIT_COMPLETE"));
Reject("change reason required", "change_reason_required", () => KittingDispositionRules.Validate("KIT_COMPLETE", null, null, prior, prior, "KIT_SHORT"));
Reject("change to NEEDS_KITTING explanation required", "change_reason_required", () => KittingDispositionRules.Validate("NEEDS_KITTING", null, null, prior, prior, "KIT_SHORT"));
Reject("same status rejected", "disposition_must_change", () => KittingDispositionRules.Validate("KIT_SHORT", "STATUS_ENTERED_IN_ERROR", null, prior, prior, "KIT_SHORT"));
Reject("same NEEDS_KITTING rejected", "disposition_must_change", () => KittingDispositionRules.Validate("NEEDS_KITTING", "ORDER_MODIFIED", null, prior, prior, "NEEDS_KITTING"));
Reject("stale current event", "current_disposition_changed", () => KittingDispositionRules.Validate("KIT_COMPLETE", "SHORTAGE_RESOLVED", null, Guid.NewGuid(), prior, "KIT_SHORT"));
if (failures.Count > 0) { foreach (var f in failures) Console.Error.WriteLine("FAIL " + f); return 1; }
Console.WriteLine("KITTING-001C1 rules: PASS"); return 0;
