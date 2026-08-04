namespace DleOs.CustomerFilesControl;

public enum CustomerFolderState
{
    VERIFIED,
    MISSING,
    NAME_MISMATCH,
    DUPLICATE,
    ROOT_UNAVAILABLE,
    ACCESS_DENIED,
    INVALID_CUSTOMER_IDENTITY,
    ERROR
}

public enum RequirementsComplianceState
{
    NOT_CREATED,
    AVAILABLE,
    CUSTOMER_FOLDER_NOT_VERIFIED,
    ACCESS_DENIED,
    ERROR
}

public sealed record CanonicalCustomer(
    string CustomerNumber,
    string CustomerName);

public sealed record CustomerFolderStatus(
    string CustomerNumber,
    string? CanonicalCustomerName,
    string? FolderDisplayName,
    string? ExpectedFolderName,
    CustomerFolderState FolderState,
    string? FolderPath,
    int MatchedFolderCount,
    IReadOnlyList<string> MatchedFolderNames,
    bool CanCreate,
    string Message,
    bool NameWasSanitized = false);

public sealed record RequirementsComplianceStatus(
    string CustomerNumber,
    CustomerFolderState CustomerFolderState,
    RequirementsComplianceState RequirementsComplianceState,
    string FolderName,
    string? FolderPath,
    bool CanCreate,
    bool CanOpen,
    string Message);

public sealed record CustomerFolderManifestItem(
    string CustomerNumber,
    string CanonicalCustomerName,
    string FolderDisplayName,
    string ExpectedFolderName,
    string ExpectedFullPath,
    CustomerFolderState CurrentState,
    IReadOnlyList<string> ExistingMatches,
    string ProposedAction,
    string? Warning);

public sealed record CustomerFolderManifest(
    DateTimeOffset GeneratedAtUtc,
    string Root,
    int CanonicalCustomerCount,
    IReadOnlyDictionary<string, int> Counts,
    IReadOnlyList<CustomerFolderManifestItem> Items);

internal sealed class CustomerDirectoryResponse
{
    public IReadOnlyList<CustomerDirectoryItem> Items { get; init; } =
        Array.Empty<CustomerDirectoryItem>();
    public long TotalItems { get; init; }
    public long TotalPages { get; init; }
}

internal sealed class CustomerDirectoryItem
{
    public string CustomerNumber { get; init; } = "";
    public string CustomerName { get; init; } = "";
}
