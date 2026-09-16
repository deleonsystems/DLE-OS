internal sealed record SimLaborCharge(string Id, string Kind, string Label, decimal? Amount);

internal sealed partial class SimRfqIntakeStore
{
    private static SimLaborCharge[]? ValidateLaborCharges(SimLaborPlan plan, SimLaborRequest request)
    {
        var charges = request.Charges ?? [];
        if ((plan.Charges?.Length > 0 || charges.Length > 0) && request.ChargeContractVersion != 1)
            throw SimRfqIntakeProblem.Conflict("LABOR_CHARGE_CONTRACT", "Reload Labor before saving supplemental costs.");
        if (charges.Length > 100 || charges.Any(c => c is null || !Guid.TryParseExact(c.Id, "D", out _) ||
            c.Kind is not ("RECURRING" or "NRE") || (c.Label?.Length ?? 0) > 120 ||
            c.Amount is < 0 or > 1000000 || c.Amount is not null && decimal.Round(c.Amount.Value, 6) != c.Amount) ||
            charges.Select(c => c.Id).Distinct().Count() != charges.Length)
            throw SimRfqIntakeProblem.BadRequest("LABOR_CHARGE_VALUES", "Use up to 100 unique recurring/NRE charges, labels up to 120 characters, and nonnegative amounts up to 1000000 with six decimal places.");
        if (request.Complete && charges.Any(c => string.IsNullOrWhiteSpace(c.Label) || c.Amount is null))
            throw SimRfqIntakeProblem.Conflict("LABOR_CHARGE_INCOMPLETE", "Enter a label and amount for every supplemental charge before completing Labor.");
        return charges.Length == 0 ? null : charges.Select(c => c with { Label = (c.Label ?? "").Trim() }).ToArray();
    }
}
