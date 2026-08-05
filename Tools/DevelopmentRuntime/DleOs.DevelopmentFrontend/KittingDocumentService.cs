using System.Text.RegularExpressions;

internal sealed class KittingDocumentService
{
    internal const string ShortageFolderLabel = "KIT-SHORTAGES";
    internal const string CompleteFolderLabel = "KIT-COMPLETE";
    private static readonly Regex WorkOrderPattern = new("^[0-9]{1,20}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly string shortageRoot;
    private readonly string completeRoot;

    internal KittingDocumentService(string shortageRoot, string completeRoot)
    {
        this.shortageRoot = NormalizeApprovedRoot(shortageRoot);
        this.completeRoot = NormalizeApprovedRoot(completeRoot);
    }

    internal KittingEvidence GetEvidence(string workOrderNumber)
    {
        var normalized = NormalizeWorkOrder(workOrderNumber);
        var shortage = FindDocument(normalized, KittingDocumentKind.Shortage);
        var complete = FindDocument(normalized, KittingDocumentKind.Complete);

        if (complete is not null && shortage is not null)
            return new(
                normalized.Canonical,
                normalized.Aliases,
                "KIT_COMPLETE_WITH_PRIOR_SHORTAGE_EVIDENCE",
                "Kit Complete — Prior Shortage",
                complete,
                shortage,
                true);
        if (complete is not null)
            return new(
                normalized.Canonical,
                normalized.Aliases,
                "KIT_COMPLETE_EVIDENCE",
                "Kit Complete",
                complete,
                null,
                false);
        if (shortage is not null)
            return new(
                normalized.Canonical,
                normalized.Aliases,
                "KIT_SHORT_EVIDENCE",
                "Kit Short",
                shortage,
                null,
                false);
        return new(
            normalized.Canonical,
            normalized.Aliases,
            "NO_KITTED_BOM_EVIDENCE",
            "No Kitted BOM Found",
            null,
            null,
            false);
    }

    internal string? ResolveDocumentPath(string workOrderNumber, string documentType)
    {
        if (!TryParseDocumentKind(documentType, out var kind))
            throw new KittingDocumentValidationException("Document type must be complete or shortage.");
        return FindDocument(NormalizeWorkOrder(workOrderNumber), kind)?.FullPath;
    }

    internal static NormalizedWorkOrder NormalizeWorkOrder(string? workOrderNumber)
    {
        var canonical = (workOrderNumber ?? string.Empty).Trim();
        if (!WorkOrderPattern.IsMatch(canonical))
            throw new KittingDocumentValidationException("Work Order must contain digits only.");

        var trimmed = canonical.TrimStart('0');
        if (trimmed.Length == 0) trimmed = "0";
        IReadOnlyList<string> aliases = trimmed == canonical
            ? new[] { canonical }
            : new[] { canonical, trimmed };
        return new(canonical, aliases);
    }

    internal static bool TryParseDocumentKind(string? value, out KittingDocumentKind kind)
    {
        if (string.Equals(value, "complete", StringComparison.OrdinalIgnoreCase))
        {
            kind = KittingDocumentKind.Complete;
            return true;
        }
        if (string.Equals(value, "shortage", StringComparison.OrdinalIgnoreCase))
        {
            kind = KittingDocumentKind.Shortage;
            return true;
        }
        kind = default;
        return false;
    }

    private KittingDocumentMatch? FindDocument(NormalizedWorkOrder workOrder, KittingDocumentKind kind)
    {
        var root = kind == KittingDocumentKind.Complete ? completeRoot : shortageRoot;
        var folderLabel = kind == KittingDocumentKind.Complete ? CompleteFolderLabel : ShortageFolderLabel;
        foreach (var alias in workOrder.Aliases)
        {
            var fileName = alias + ".pdf";
            var candidate = Path.GetFullPath(Path.Combine(root, fileName));
            EnsureApprovedCandidate(root, candidate);
            if (File.Exists(candidate))
                return new(kind, fileName, folderLabel, candidate);
        }
        return null;
    }

    private static string NormalizeApprovedRoot(string root)
    {
        if (string.IsNullOrWhiteSpace(root))
            throw new ArgumentException("An approved Kitting document root is required.", nameof(root));
        return Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    }

    private static void EnsureApprovedCandidate(string root, string candidate)
    {
        var approvedPrefix = root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(approvedPrefix, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetExtension(candidate), ".pdf", StringComparison.OrdinalIgnoreCase))
            throw new KittingDocumentValidationException("The resolved document is outside the approved PDF boundary.");
    }
}

internal enum KittingDocumentKind
{
    Complete,
    Shortage
}

internal sealed record NormalizedWorkOrder(string Canonical, IReadOnlyList<string> Aliases);

internal sealed record KittingDocumentMatch(
    KittingDocumentKind Kind,
    string FileName,
    string FolderLabel,
    string FullPath);

internal sealed record KittingEvidence(
    string WorkOrderNumber,
    IReadOnlyList<string> Aliases,
    string EvidenceStatus,
    string DisplayLabel,
    KittingDocumentMatch? Primary,
    KittingDocumentMatch? SecondaryPriorShortage,
    bool PriorShortageEvidenceExists);

internal sealed class KittingDocumentValidationException(string message) : Exception(message);
