using System.Text;
using System.Text.RegularExpressions;

namespace DleOs.CustomerFilesControl;

public sealed record SanitizedCustomerName(string Value, bool WasChanged);

public static partial class CustomerNameSanitizer
{
    public const int MaximumDisplayLength = 120;
    private static readonly HashSet<char> InvalidCharacters =
        new("\\/:*?\"<>|".ToCharArray());
    private static readonly HashSet<string> ReservedNames =
        new(
            new[]
            {
                "CON", "PRN", "AUX", "NUL",
                "COM1", "COM2", "COM3", "COM4", "COM5",
                "COM6", "COM7", "COM8", "COM9",
                "LPT1", "LPT2", "LPT3", "LPT4", "LPT5",
                "LPT6", "LPT7", "LPT8", "LPT9"
            },
            StringComparer.OrdinalIgnoreCase);

    public static SanitizedCustomerName Sanitize(string canonicalName)
    {
        var original = canonicalName ?? "";
        var trimmed = original.Trim();
        var builder = new StringBuilder(trimmed.Length);
        foreach (var character in trimmed)
        {
            builder.Append(
                char.IsControl(character) || InvalidCharacters.Contains(character)
                    ? '_'
                    : character);
        }

        var value = RepeatedWhitespace().Replace(builder.ToString(), " ")
            .TrimEnd(' ', '.');
        if (value.Length == 0)
            value = "CUSTOMER";

        var deviceStem = value.Split('.')[0];
        if (ReservedNames.Contains(deviceStem))
            value = "_" + value;

        if (value.Length > MaximumDisplayLength)
            value = value[..MaximumDisplayLength].TrimEnd(' ', '.');
        if (value.Length == 0)
            value = "CUSTOMER";

        return new SanitizedCustomerName(
            value,
            !string.Equals(original, value, StringComparison.Ordinal));
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex RepeatedWhitespace();
}
