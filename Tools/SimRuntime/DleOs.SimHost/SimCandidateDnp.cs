internal static partial class SimCandidateBomProvider
{
    // DNP is an intentional empty position, not a material or identity.
    internal static bool ValidQuantity(string? text, bool dnp) =>
        dnp && string.IsNullOrWhiteSpace(text) ||
        decimal.TryParse(text, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var quantity) &&
        (dnp ? quantity >= 0 : quantity > 0);
}
