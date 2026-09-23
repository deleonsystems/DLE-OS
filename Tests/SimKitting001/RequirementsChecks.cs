using System.Globalization;
using System.Text.Json;

internal static class SimKittingRequirementChecks
{
    internal static int Run(SimCandidateRow acceptedManufacturerRow)
    {
        var count = 0;
        void Check(bool pass, string name)
        {
            if (!pass) throw new Exception(name);
            count++; Console.WriteLine("PASS " + name);
        }
        JsonElement Group(SimCandidateRow row, decimal build = 10m) => JsonSerializer.SerializeToElement(
            SimKittingRequirementsProvider.ProjectGroup(row, build, "EA"), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        SimCandidateRow Quantity(string text) => acceptedManufacturerRow with
        { Values = new(acceptedManufacturerRow.Values, StringComparer.Ordinal) { ["quantity"] = text } };
        void Invalid(string text, decimal build = 10m)
        {
            try { Group(Quantity(text), build); }
            catch (SimRfqIntakeProblem e) when (e.Code == "SIM_KITTING_REQUIREMENTS_QUANTITY")
            { Check(true, "invalid or overflowing requirement quantity blocked: " + text); return; }
            throw new Exception("Quantity was silently accepted: " + text);
        }

        var fractional = Group(Quantity("0.0001"));
        Check(fractional.GetProperty("requiredEach").GetDecimal() == 0.0001m &&
            fractional.GetProperty("requiredQuantity").GetDecimal() == 0.001m &&
            fractional.GetProperty("classification").GetString() == "FRACTIONAL" &&
            fractional.GetProperty("actionable").GetBoolean(), "fractional requirements retain decimal precision");
        var mixed = Group(Quantity("1.25"));
        Check(mixed.GetProperty("requiredEach").GetDecimal() == 1.25m && mixed.GetProperty("requiredQuantity").GetDecimal() == 12.5m,
            "non-integral quantities greater than one retain precision");
        var dnp = Group(Quantity("2") with { ComponentType = "DNP" });
        Check(dnp.GetProperty("classification").GetString() == "DNP" && !dnp.GetProperty("actionable").GetBoolean() &&
            dnp.GetProperty("requiredEach").GetDecimal() == 2m && dnp.GetProperty("requiredQuantity").GetDecimal() == 0m &&
            dnp.GetProperty("eligibleParts").GetArrayLength() == 0,
            "explicit DNP preserves source quantity without inventing active material demand");
        Check(Group(Quantity("0") with { ComponentType = "DNP" }).GetProperty("requiredQuantity").GetDecimal() == 0,
            "accepted zero-quantity DNP is retained");
        var primary = Group(acceptedManufacturerRow).GetProperty("partNumber").GetString()!;
        var alternatives = new[]
        {
            new SimCandidateAlternate("a-approved", null, primary + "-APPROVED", "MANUAL", "APPROVED", "", null, null, null, null, []),
            new SimCandidateAlternate("a-proposed", null, primary + "-PROPOSED", "ANALYSIS", "PROPOSED", "", null, null, null, null, []),
            new SimCandidateAlternate("a-confirmed", null, primary + "-CONFIRMED", "MANUAL", "CONFIRMED", "", null, null, null, null, []),
            new SimCandidateAlternate("a-removed", null, primary + "-REMOVED", "MANUAL", "APPROVED", "", null, null, null, null, [], DateTimeOffset.UnixEpoch)
        };
        var explicitParts = Group(acceptedManufacturerRow with { Alternates = alternatives }).GetProperty("eligibleParts")
            .EnumerateArray().Select(x => x.GetString()).ToArray();
        Check(explicitParts.SequenceEqual(new[] { primary, primary + "-APPROVED" }),
            "only explicit approved alternates are eligible; proposed, confirmed-only and removed alternatives excluded");
        var plain = Group(acceptedManufacturerRow);
        Check(plain.GetProperty("relatedParts").GetArrayLength() == 0 && plain.GetProperty("eligibleParts").GetArrayLength() == 1,
            "source names and descriptions do not fabricate related parts");
        var refs = Group(acceptedManufacturerRow with { Values = new(acceptedManufacturerRow.Values) { ["designators"] = "TP1 TP2, TP3;TP4" } })
            .GetProperty("references").EnumerateArray().Select(x => x.GetString()).ToArray();
        Check(refs.SequenceEqual(new[] { "TP1", "TP2", "TP3", "TP4" }), "accepted reference designators map directly to structured references");
        Check(plain.GetProperty("entry").ValueKind == JsonValueKind.Null && plain.GetProperty("rowState").GetString() == "EDITING" &&
            plain.GetProperty("revisionNumber").GetInt32() == 0, "requirements projection creates no execution evidence");
        foreach (var invalid in new[] { "", "garbage", "-1", "0", "1/2", "NaN", "1,2" }) Invalid(invalid);
        Invalid(decimal.MaxValue.ToString(CultureInfo.InvariantCulture), 2m);
        return count;
    }
}
