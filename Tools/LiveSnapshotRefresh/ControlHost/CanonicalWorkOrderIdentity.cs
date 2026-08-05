using System.Text.RegularExpressions;

internal static class CanonicalWorkOrderIdentity
{
    internal static bool TryValidateSubmitted(string? value, out string submitted)
    {
        submitted = (value ?? "").Trim();
        return Regex.IsMatch(submitted, "^[0-9]{1,7}$");
    }

    internal static string? NormalizeCanonical(string? value)
    {
        var candidate = (value ?? "").Trim();
        return Regex.IsMatch(candidate, "^[0-9]{1,7}$") ? candidate.PadLeft(7, '0') : null;
    }

    internal static IReadOnlyList<string> GetLookupAliases(string submitted)
    {
        if (!TryValidateSubmitted(submitted, out var validated))
            throw new ArgumentException("A digits-only Work Order identity is required.", nameof(submitted));
        var canonical = validated.PadLeft(7, '0');
        var trimmed = canonical.TrimStart('0');
        if (trimmed.Length == 0) trimmed = "0";
        return new[] { validated, canonical, trimmed }.Distinct(StringComparer.Ordinal).ToArray();
    }
}
