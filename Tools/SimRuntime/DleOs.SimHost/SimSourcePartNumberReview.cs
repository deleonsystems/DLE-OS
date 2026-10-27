internal sealed record SimSourcePartNumberChange(string Basis, string ExpectedToken);
internal sealed record SimSourcePartNumberDecision(string Basis, string SourcePartNumber, string GoverningDocumentId,
    string GoverningSha256, string RowReference, string InheritedBasis, string Origin, string Reviewer,
    DateTimeOffset AtUtc, string? IdentityReference, string Status, string? Reason = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimCandidatePrimaryIdentity? PreviousPrimaryIdentity = null);
internal sealed record SimSourcePartNumberReview(SimSourcePartNumberDecision Current, SimSourcePartNumberDecision[] History);

internal static partial class SimCandidateBomProvider
{
    internal static string SourceBasisDefault(string? basis) => basis switch {
        "MANUFACTURER" => "MFG", "CUSTOMER_INTERNAL" => "CUSTOMER", _ => "UNRESOLVED"
    };

    private static SimCandidateBom ReviewSourcePartNumber(SimCandidateBom bom, int index, SimSourcePartNumberChange change, SimPersona persona, string? documentBasis)
    {
        var row = bom.Rows[index];
        if (change.ExpectedToken != row.ReviewState.Token)
            throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_PN_STALE", "This row changed. Reopen before confirming P/N identity.");
        if (row.ComponentType == "DNP" || change.Basis is not ("MFG" or "CUSTOMER" or "ASSEMBLY" or "UNRESOLVED"))
            throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_PN_INVALID", "Choose MFG, CUSTOMER, ASSEMBLY or UNRESOLVED for a populated row.");
        var number = row.Values.GetValueOrDefault("partNumber")?.Trim();
        if (string.IsNullOrWhiteSpace(number) || number.Length > 200)
            throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_PN_INVALID", "A source P/N of at most 200 characters is required.");
        if (row.WorkingState is { ManualPartNumber.Length: > 0 } or { AssemblyPartNumber.Length: > 0 })
            throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_PN_DRAFT", "Resolve saved manual identity edits before confirming the source P/N.");
        var inherited = SourceBasisDefault(bom.Analysis?.SourceSnapshot.Sources.FirstOrDefault(s => s.DocumentId == bom.GoverningDocumentId)?.Profile?.PartNumberContext.Basis ?? documentBasis);
        var manual=bom.ManualDraft is not null;
        var now = DateTimeOffset.UtcNow;
        var updated = row.SourcePartNumberReview?.Current.Basis == change.Basis && SourceIdentityMatches(row)
            ? row : InvalidateSourceReview(row, persona, "Source basis was explicitly changed.");
        string? reference = null;
        if (change.Basis == "MFG") {
            var identity = updated.ManufacturerIdentity ?? new([], "Source BOM identity", []);
            var active = identity.Proposals.Where(p => identity.Decision(p.Id) is not ("REJECTED" or "NOT_SELECTED" or "SUPERSEDED")).ToArray();
            if (active.Any(p => p.PartNumber.Trim() != number || p.Conflicts.Length > 0) || active.Select(p => p.ManufacturerName).Distinct().Count() > 1)
                throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_PN_CONFLICT", "Resolve competing or conflicting manufacturer proposals in Approved P/Ns before confirming the source MPN.");
            var evidence = manual ? new DleAnalysisEvidence("",null,null,"DLE-authored BOM row "+row.Values.GetValueOrDefault("lineNumber")+"; reviewer-declared entered P/N; no document extraction claimed")
                : row.AnalysisFields?.GetValueOrDefault("partNumber")?.Evidence ?? new(bom.GoverningDocumentId, bom.Page, null, "BOM row " + row.Values.GetValueOrDefault("lineNumber"));
            var proposal = active.FirstOrDefault() ?? new DleManufacturerProposal("source-" + Guid.NewGuid().ToString("N"), null, number,
                evidence, evidence, evidence, manual ? "DLE-authored BOM — reviewer-declared MPN" : "Governing BOM — reviewer-confirmed supplied MPN", [manual ? "Explicit reviewer classification of entered P/N" : "Explicit source P/N review"], [],
                new() { ["partNumber"] = row.Values["partNumber"] }, "HUMAN_REVIEWED", manual ? "Reviewer-declared identity; no document extraction, catalog or manufacturer-name verification claimed." : "Source identifier confirmed; no catalog or manufacturer-name verification claimed.");
            var proposals = identity.Proposals.Any(p => p.Id == proposal.Id) ? identity.Proposals : identity.Proposals.Append(proposal).ToArray();
            updated = updated with { ManufacturerIdentity = identity with { Proposals = proposals, Stale = false, Revision = identity.Revision + 1,
                History = identity.History.Append(new(proposal.Id, "CONFIRMED", persona.DisplayName, now)).ToArray() },
                PrimaryIdentity = new("MANUFACTURER_PN", null, null, persona.DisplayName, now) };
            reference = "manufacturer:" + proposal.Id;
        } else if (change.Basis == "CUSTOMER") {
            updated = updated with { PrimaryIdentity = new("CUSTOMER_PN", number, row.Values["partNumber"], persona.DisplayName, now) };
            reference = "primaryIdentity:CUSTOMER_PN";
        } else if (change.Basis == "ASSEMBLY") {
            var assembly = new SimAssemblyPartIdentity(number, persona.DisplayName, now);
            updated = updated with { AssemblyIdentity = assembly, AssemblyIdentityHistory = (updated.AssemblyIdentityHistory ?? []).Append(assembly).ToArray() };
            reference = "assemblyIdentity";
        }
        var decision = new SimSourcePartNumberDecision(change.Basis, row.Values["partNumber"], bom.GoverningDocumentId, bom.GoverningSha256,
            row.RowId ?? row.Index.ToString(System.Globalization.CultureInfo.InvariantCulture), inherited,
            manual ? "DLE_AUTHORED_REVIEWER_DECLARATION" : change.Basis == inherited ? "DOCUMENT_DEFAULT_CONFIRMED" : "ROW_OVERRIDE", persona.DisplayName, now, reference,
            change.Basis == "UNRESOLVED" ? "UNRESOLVED" : "CONFIRMED", PreviousPrimaryIdentity: row.PrimaryIdentity != updated.PrimaryIdentity ? row.PrimaryIdentity : null);
        updated = updated with { SourcePartNumberReview = new(decision, (updated.SourcePartNumberReview?.History ?? []).Append(decision).ToArray()),
            Confirmed = false, Reviewer = null, ReviewedAtUtc = null, WorkingState = manual ? row.WorkingState : null };
        var rows = bom.Rows.ToArray(); rows[index] = updated;
        return bom with { Rows = rows };
    }

    internal static bool SourceIdentityMatches(SimCandidateRow row)
    {
        var decision = row.SourcePartNumberReview?.Current;
        if (decision is null || decision.Status != "CONFIRMED" || decision.SourcePartNumber != row.Values.GetValueOrDefault("partNumber")) return false;
        var number = decision.SourcePartNumber.Trim();
        return decision.Basis switch {
            "MFG" => row.ManufacturerIdentity is { Stale: false } identity && identity.Proposals.Any(p => "manufacturer:" + p.Id == decision.IdentityReference && p.PartNumber == number && identity.Decision(p.Id) == "CONFIRMED"),
            "CUSTOMER" => row.PrimaryIdentity is { Basis: "CUSTOMER_PN" } primary && primary.PartNumber == number && primary.CustomerBomPartNumber == decision.SourcePartNumber,
            "ASSEMBLY" => row.AssemblyIdentity?.PartNumber == number,
            _ => false
        };
    }

    private static SimCandidateRow InvalidateSourceReview(SimCandidateRow row, SimPersona persona, string reason, string status = "INVALIDATED")
    {
        if (row.SourcePartNumberReview is not { Current.Status: "CONFIRMED" } review) return row;
        var now = DateTimeOffset.UtcNow;
        var decision = review.Current with { Status = status, Reviewer = persona.DisplayName, AtUtc = now, Reason = reason };
        var identity = row.ManufacturerIdentity;
        if (review.Current.Basis == "MFG" && identity is not null) {
            var id = review.Current.IdentityReference?["manufacturer:".Length..];
            if (id is not null && identity.Decision(id) == "CONFIRMED" && identity.Proposals.Any(p => p.Id == id && p.PartNumber == review.Current.SourcePartNumber.Trim()))
                identity = identity with { History = identity.History.Append(new(id, "REJECTED", persona.DisplayName, now)).ToArray(), Revision = identity.Revision + 1 };
        }
        return row with { SourcePartNumberReview = new(decision, review.History.Append(decision).ToArray()), ManufacturerIdentity = identity,
            PrimaryIdentity = review.Current.Basis == "CUSTOMER" && row.PrimaryIdentity?.PartNumber == review.Current.SourcePartNumber.Trim() ? null : row.PrimaryIdentity,
            AssemblyIdentity = review.Current.Basis == "ASSEMBLY" && row.AssemblyIdentity?.PartNumber == review.Current.SourcePartNumber.Trim() ? null : row.AssemblyIdentity,
            Confirmed = false, Reviewer = null, ReviewedAtUtc = null };
    }

    private static SimCandidateBom ReconcileSourceReviews(SimCandidateBom before, SimCandidateBom after, SimPersona persona)
    {
        var rows = after.Rows.ToArray();
        for (var i = 0; i < rows.Length; i++) {
            if (ReferenceEquals(before.Rows[i], rows[i])) continue;
            if (rows[i].SourcePartNumberReview?.Current.Status == "CONFIRMED" && !SourceIdentityMatches(rows[i]))
                rows[i] = InvalidateSourceReview(rows[i], persona, "Source P/N or approved identity changed; review identity again.",
                    rows[i].SourcePartNumberReview!.Current.SourcePartNumber != rows[i].Values.GetValueOrDefault("partNumber") ? "INVALIDATED" : "OVERRIDDEN");
        }
        return after with { Rows = rows };
    }
}
