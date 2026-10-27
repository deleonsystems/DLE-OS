using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record SimPreparationPiece(string RowId, string Method, int? Positions = null, string IdentifierBasis = "INTERNAL_UNKNOWN");
internal sealed record SimPreparationGroup(string Id, string ParentRowId, string CustomerFind,
    string StockIdentityBasis, SimPreparationPiece[] Pieces, string InstructionReference,
    string DocumentId, string SourceHash, string RowFingerprint, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimPreparationAudit(string Action, SimPreparationGroup Group, string Reviewer, DateTimeOffset AtUtc);
internal sealed record SimPreparationChange(string ExpectedToken, string? GroupId, string ParentRowId,
    string CustomerFind, string StockIdentityBasis, SimPreparationPiece[] Pieces, string InstructionReference);
internal sealed record SimPreparationDemand(string RowId, string Kind, string? Quantity, string? Unit, string Status);

// Draft relationship only. No purchasing, cutting yield or production release is inferred.
internal static class SimPreparation
{
    internal const string Pending = "Preparation details pending. Stock consumption and downstream procurement/kitting/production integration are not qualified; this BOM cannot be accepted or released yet.";
    internal static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    internal static string Token(SimCandidateBom bom) => Hash(new { bom.Id, bom.GoverningDocumentId, bom.GoverningSha256,
        Rows = bom.Rows.Select(r => new { r.RowId, r.ReviewState.Token }), bom.PreparationGroups, bom.PreparationHistory });
    internal static bool LiteralFind(SimCandidateRow row, string? value)
    {
        if (value is null || value.Length > 40) return false;
        if (Regex.IsMatch(value, @"^[1-9]\d{0,8}$")) return true;
        // Decimal/NOB labels are admitted only as the exact supported imported source label.
        return row.RowId?.StartsWith("vpro-", StringComparison.Ordinal) == true &&
            value == row.Extracted.GetValueOrDefault("lineNumber") &&
            (value == "NOB" || Regex.IsMatch(value, @"^[1-9]\d{0,8}\.\d{1,9}$"));
    }
    internal static string Fingerprint(SimCandidateBom bom, IEnumerable<string> ids) => Hash(ids.Select(id => {
        var row = bom.Rows.SingleOrDefault(r => r.RowId == id);
        return new { Id = id, row?.Values, row?.ComponentType, row?.PrimaryIdentity, row?.SelectedApprovedAlternate, row?.Alternates };
    }));
    internal static bool Current(SimCandidateBom bom, SimPreparationGroup group) =>
        group.DocumentId == bom.GoverningDocumentId && group.SourceHash == bom.GoverningSha256 &&
        group.RowFingerprint == Fingerprint(bom, new[] { group.ParentRowId }.Concat(group.Pieces.Select(p => p.RowId)));
    internal static void RequireDownstream(SimCandidateBom? bom)
    {
        if (bom?.PreparationGroups?.Length > 0) throw SimRfqIntakeProblem.Conflict("SIM_PREPARATION_PENDING", Pending);
    }
    internal static SimPreparationDemand[] Demand(SimCandidateBom bom) => (bom.PreparationGroups ?? []).SelectMany(g => {
        if (!Current(bom, g)) return new[] { new SimPreparationDemand(g.ParentRowId, "BLOCKED", null, null, "Source or rows changed; review grouping again.") };
        var demand = new List<SimPreparationDemand>();
        if (g.Pieces.Any(p => p.Method == "MAKE_FROM_STOCK")) demand.Add(new(g.ParentRowId, "STOCK", null, null, "Stock consumption pending; source quantity is not an approved yield."));
        foreach (var piece in g.Pieces) {
            var row = bom.Rows.Single(r => r.RowId == piece.RowId);
            if (piece.Method == "BUY_PRECUT") demand.Add(new(piece.RowId, "PRECUT", row.Values.GetValueOrDefault("quantity"), row.Values.GetValueOrDefault("unit"), "Draft only; current precut identity and availability require review."));
        }
        return demand.ToArray();
    }).ToArray();
    internal static SimCandidateBom Apply(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona actor)
    {
        if (!actor.Can("technical_review.disposition")) throw SimRfqIntakeProblem.Conflict("SIM_PREPARATION_PERMISSION", "Technical Review disposition permission is required.");
        var c = request.PreparationChange!;
        if (request.CandidateId != bom.Id || c.ExpectedToken != Token(bom)) throw SimRfqIntakeProblem.Conflict("SIM_PREPARATION_STALE", "The candidate changed. Reopen preparation before saving.");
        if (request.Values is not null || request.AlternateChange is not null || request.ApprovedAlternateSelection is not null || request.ComponentChange is not null || request.ManufacturerChange is not null || request.PrimarySelection is not null || request.WorksheetAcceptance is not null || request.WholeRowApproval is not null || request.ProgressRows is not null || request.ApprovedPartChange is not null || request.IdentityBasisChange is not null || request.SourcePartNumberChange is not null || request.BulkReview is not null)
            throw SimRfqIntakeProblem.BadRequest("SIM_PREPARATION_SEPARATE", "Save preparation separately from row or identity decisions.");
        var groups = bom.PreparationGroups ?? [];
        var previous = c.GroupId is null ? null : groups.SingleOrDefault(g => g.Id == c.GroupId) ?? throw SimRfqIntakeProblem.Conflict("SIM_PREPARATION_MISSING", "The preparation group changed.");
        if (c.Pieces is null || c.Pieces.Length is < 1 or > 100 || c.Pieces.Any(p=>p is null) || string.IsNullOrWhiteSpace(c.CustomerFind) || !Regex.IsMatch(c.CustomerFind, @"^[1-9]\d{0,8}$") || c.StockIdentityBasis is not ("CUSTOMER" or "INTERNAL_UNKNOWN") || c.InstructionReference is null || c.InstructionReference.Length > 2000)
            throw SimRfqIntakeProblem.BadRequest("SIM_PREPARATION_INVALID", "Choose a customer Find, stock identity basis and at least one piece. Instructions may remain pending.");
        var ids = new[] { c.ParentRowId }.Concat(c.Pieces.Select(p => p.RowId)).ToArray();
        if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Length || ids.Any(id => bom.Rows.Count(r => r.RowId == id) != 1) || c.Pieces.Any(p => p.IdentifierBasis != "INTERNAL_UNKNOWN" || p.Method is not ("MAKE_FROM_STOCK" or "BUY_PRECUT") || p.Positions is < 1 or > 10000))
            throw SimRfqIntakeProblem.BadRequest("SIM_PREPARATION_ROWS", "Choose distinct existing stock/piece rows and one sourcing method per piece. Position counts may remain pending.");
        if (ids.Any(id => bom.Rows.Single(r => r.RowId == id).ComponentType is "DNP" or "SUBASSEMBLY" or "REFERENCE_ONLY") || groups.Where(g => g.Id != previous?.Id).Any(g => ids.Contains(g.ParentRowId) || g.Pieces.Any(p => ids.Contains(p.RowId))))
            throw SimRfqIntakeProblem.Conflict("SIM_PREPARATION_OVERLAP", "These rows are in another group or have an incompatible component type.");
        var now = DateTimeOffset.UtcNow;
        var group = new SimPreparationGroup(previous?.Id ?? Guid.NewGuid().ToString(), c.ParentRowId, c.CustomerFind,
            c.StockIdentityBasis, c.Pieces.ToArray(), c.InstructionReference.Trim(), bom.GoverningDocumentId,
            bom.GoverningSha256, Fingerprint(bom, ids), actor.DisplayName, now);
        // Existing row identities, acceptance evidence and historical precut choices remain untouched.
        return bom with { PreparationGroups = groups.Where(g => g.Id != group.Id).Append(group).ToArray(),
            PreparationHistory = (bom.PreparationHistory ?? []).Append(new(previous is null ? "GROUPED" : "UPDATED", group, actor.DisplayName, now)).ToArray() };
    }
}
