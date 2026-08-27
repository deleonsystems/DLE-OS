using System.Text.Json;
using System.Text.RegularExpressions;

internal static partial class NativeHostContract
{
    internal const int Version = 1;
    internal const string Operation = "open-drawing-folder";
    internal const string ApprovedExtensionOrigin =
        "chrome-extension://gappmnmcjliadjleocigmndgalflgffd/";

    internal static bool TryParse(
        string json,
        out NativeHostRequest? request,
        out string failureCategory)
    {
        request = null;
        failureCategory = "InvalidMessage";
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8
            });
            if (document.RootElement.ValueKind != JsonValueKind.Object) return false;
            var properties = document.RootElement.EnumerateObject().ToArray();
            if (properties.Length != 4 || properties.Select(property => property.Name).ToHashSet(StringComparer.Ordinal)
                .SetEquals(["version", "operation", "capability", "correlationId"]) is false)
                return false;

            var root = document.RootElement;
            if (!root.TryGetProperty("version", out var versionElement) ||
                !versionElement.TryGetInt32(out var version) || version != Version ||
                !root.TryGetProperty("operation", out var operationElement) ||
                operationElement.ValueKind != JsonValueKind.String ||
                !string.Equals(operationElement.GetString(), Operation, StringComparison.Ordinal) ||
                !root.TryGetProperty("capability", out var capabilityElement) ||
                capabilityElement.ValueKind != JsonValueKind.String ||
                !root.TryGetProperty("correlationId", out var correlationElement) ||
                correlationElement.ValueKind != JsonValueKind.String)
                return false;

            var capability = capabilityElement.GetString() ?? "";
            var correlationId = correlationElement.GetString() ?? "";
            if (!CapabilityToken().IsMatch(capability) || !IsSafeCorrelationId(correlationId)) return false;
            request = new(version, Operation, capability, correlationId);
            failureCategory = "None";
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    internal static bool IsApprovedBrowserOrigin(string? value) =>
        string.Equals(value, ApprovedExtensionOrigin, StringComparison.Ordinal);

    private static bool IsSafeCorrelationId(string value) =>
        value.Length is > 0 and <= 128 && value.All(character => !char.IsControl(character));

    [GeneratedRegex("^dlecap1_[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex CapabilityToken();
}

internal sealed record NativeHostRequest(
    int Version,
    string Operation,
    string Capability,
    string CorrelationId);

internal sealed record NativeHostResponse(
    int Version,
    string Operation,
    string CorrelationId,
    bool Success,
    string Category,
    string Message);
