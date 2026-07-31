using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace DleOs.CustomerFilesControl;

public interface ICustomerFileSystem
{
    bool DirectoryExists(string path);
    FileAttributes GetAttributes(string path);
    IReadOnlyList<string> GetDirectoryNames(string root);
    void CreateDirectory(string path);
}

public sealed class SystemCustomerFileSystem : ICustomerFileSystem
{
    public bool DirectoryExists(string path)
    {
        try
        {
            return (File.GetAttributes(path) & FileAttributes.Directory) != 0;
        }
        catch (DirectoryNotFoundException)
        {
            return false;
        }
        catch (FileNotFoundException)
        {
            return false;
        }
    }
    public FileAttributes GetAttributes(string path) =>
        File.GetAttributes(path);
    public IReadOnlyList<string> GetDirectoryNames(string root) =>
        Directory.EnumerateDirectories(root)
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrEmpty(name))
            .Cast<string>()
            .ToArray();
    public void CreateDirectory(string path) =>
        Directory.CreateDirectory(path);
}

public sealed partial class CustomerFolderService
{
    public const string GovernedRoot =
        @"\\DeLeon-Server\Production\Customer Files";
    private readonly string _root;
    private readonly ICustomerDirectory _directory;
    private readonly ICustomerFileSystem _fileSystem;
    private readonly ILogger<CustomerFolderService> _logger;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _createGates =
        new(StringComparer.Ordinal);

    public CustomerFolderService(
        string root,
        ICustomerDirectory directory,
        ICustomerFileSystem fileSystem,
        ILogger<CustomerFolderService> logger)
    {
        _root = Path.GetFullPath(root).TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        _directory = directory;
        _fileSystem = fileSystem;
        _logger = logger;
    }

    public async Task<CustomerFolderStatus> VerifyAsync(
        string customerNumber,
        CancellationToken cancellationToken)
    {
        var requestedNumber = customerNumber ?? "";
        if (!ValidCustomerNumber().IsMatch(requestedNumber))
            return Invalid(
                requestedNumber,
                "A canonical six-digit Customer Number is required.");

        CanonicalCustomer? customer;
        try
        {
            customer = await _directory.FindAsync(
                requestedNumber,
                cancellationToken);
        }
        catch (UnauthorizedAccessException)
        {
            return State(
                requestedNumber,
                null,
                CustomerFolderState.ACCESS_DENIED,
                "The canonical Customer Directory denied access.");
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Customer folder verification failed during canonical lookup for {CustomerNumber}.",
                requestedNumber);
            return State(
                requestedNumber,
                null,
                CustomerFolderState.ERROR,
                "Canonical customer resolution failed.");
        }

        if (
            customer is null ||
            string.IsNullOrWhiteSpace(customer.CustomerName) ||
            !ValidCustomerNumber().IsMatch(customer.CustomerNumber)
        )
        {
            return Invalid(
                requestedNumber,
                "The customer was not found with a valid canonical identity.");
        }
        return VerifyResolved(customer);
    }

    public async Task<CustomerFolderStatus> CreateAsync(
        string customerNumber,
        CancellationToken cancellationToken)
    {
        var requestedNumber = customerNumber ?? "";
        var gate = _createGates.GetOrAdd(
            requestedNumber,
            _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var status = await VerifyAsync(requestedNumber, cancellationToken);
            if (status.FolderState != CustomerFolderState.MISSING)
                return status;

            var expectedPath = EnsureGovernedPath(
                status.ExpectedFolderName
                ?? throw new InvalidOperationException(
                    "The expected folder name was not generated."));
            try
            {
                _fileSystem.CreateDirectory(expectedPath);
                _logger.LogInformation(
                    "Created governed customer folder for {CustomerNumber}: {FolderName}",
                    requestedNumber,
                    status.ExpectedFolderName);
            }
            catch (UnauthorizedAccessException)
            {
                return status with
                {
                    FolderState = CustomerFolderState.ACCESS_DENIED,
                    CanCreate = false,
                    Message =
                        "The Customer Files identity cannot create this folder."
                };
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Customer folder creation failed for {CustomerNumber}.",
                    requestedNumber);
                return status with
                {
                    FolderState = CustomerFolderState.ERROR,
                    CanCreate = false,
                    Message = "The governed customer folder could not be created."
                };
            }

            return await VerifyAsync(requestedNumber, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<CustomerFolderManifest> BuildManifestAsync(
        CancellationToken cancellationToken)
    {
        var customers = await _directory.GetAllAsync(cancellationToken);
        var items = new List<CustomerFolderManifestItem>(customers.Count);
        foreach (var customer in customers.OrderBy(
            item => item.CustomerNumber,
            StringComparer.Ordinal))
        {
            var status = VerifyResolved(customer);
            items.Add(new CustomerFolderManifestItem(
                status.CustomerNumber,
                status.CanonicalCustomerName ?? "",
                status.FolderDisplayName ?? "",
                status.ExpectedFolderName ?? "",
                EnsureGovernedPath(status.ExpectedFolderName ?? ""),
                status.FolderState,
                status.MatchedFolderNames,
                ProposedAction(status.FolderState),
                ManifestWarning(status)));
        }

        var counts = Enum.GetValues<CustomerFolderState>()
            .ToDictionary(
                state => state.ToString(),
                state => items.Count(item => item.CurrentState == state),
                StringComparer.Ordinal);
        return new CustomerFolderManifest(
            DateTimeOffset.UtcNow,
            _root,
            customers.Count,
            counts,
            items);
    }

    private CustomerFolderStatus VerifyResolved(CanonicalCustomer customer)
    {
        var sanitized = CustomerNameSanitizer.Sanitize(customer.CustomerName);
        var expectedName =
            customer.CustomerNumber + " - " + sanitized.Value;
        var expectedPath = EnsureGovernedPath(expectedName);
        try
        {
            if (!_fileSystem.DirectoryExists(_root))
                return Build(
                    customer,
                    sanitized,
                    expectedName,
                    expectedPath,
                    CustomerFolderState.ROOT_UNAVAILABLE,
                    Array.Empty<string>(),
                    "The governed Customer Files root is unavailable.");
            if (
                (_fileSystem.GetAttributes(_root) & FileAttributes.ReparsePoint)
                != 0
            )
            {
                return Build(
                    customer,
                    sanitized,
                    expectedName,
                    expectedPath,
                    CustomerFolderState.ERROR,
                    Array.Empty<string>(),
                    "The governed Customer Files root is unexpectedly redirected.");
            }

            var prefix = customer.CustomerNumber + " - ";
            var matches = _fileSystem.GetDirectoryNames(_root)
                .Where(name => name.StartsWith(
                    prefix,
                    StringComparison.OrdinalIgnoreCase))
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var state = matches.Length switch
            {
                0 => CustomerFolderState.MISSING,
                > 1 => CustomerFolderState.DUPLICATE,
                _ when string.Equals(
                    matches[0],
                    expectedName,
                    StringComparison.OrdinalIgnoreCase) =>
                    CustomerFolderState.VERIFIED,
                _ => CustomerFolderState.NAME_MISMATCH
            };
            var path = matches.Length == 1
                ? EnsureGovernedPath(matches[0])
                : expectedPath;
            var result = Build(
                customer,
                sanitized,
                expectedName,
                path,
                state,
                matches,
                Message(state));
            _logger.LogInformation(
                "Verified customer folder for {CustomerNumber}: {FolderState}, matches={MatchedFolderCount}",
                customer.CustomerNumber,
                state,
                matches.Length);
            return result;
        }
        catch (UnauthorizedAccessException)
        {
            return Build(
                customer,
                sanitized,
                expectedName,
                expectedPath,
                CustomerFolderState.ACCESS_DENIED,
                Array.Empty<string>(),
                "The Customer Files identity cannot inspect the governed root.");
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Unexpected folder verification failure for {CustomerNumber}.",
                customer.CustomerNumber);
            return Build(
                customer,
                sanitized,
                expectedName,
                expectedPath,
                CustomerFolderState.ERROR,
                Array.Empty<string>(),
                "An unexpected controlled folder-verification failure occurred.");
        }
    }

    private CustomerFolderStatus Build(
        CanonicalCustomer customer,
        SanitizedCustomerName sanitized,
        string expectedName,
        string path,
        CustomerFolderState state,
        IReadOnlyList<string> matches,
        string message) =>
        new(
            customer.CustomerNumber,
            customer.CustomerName,
            sanitized.Value,
            expectedName,
            state,
            path,
            matches.Count,
            matches,
            state == CustomerFolderState.MISSING,
            message,
            sanitized.WasChanged);

    private CustomerFolderStatus Invalid(string number, string message) =>
        State(
            number,
            null,
            CustomerFolderState.INVALID_CUSTOMER_IDENTITY,
            message);

    private CustomerFolderStatus State(
        string number,
        string? name,
        CustomerFolderState state,
        string message) =>
        new(
            number,
            name,
            null,
            null,
            state,
            null,
            0,
            Array.Empty<string>(),
            false,
            message);

    private string EnsureGovernedPath(string folderName)
    {
        if (
            string.IsNullOrWhiteSpace(folderName) ||
            folderName.IndexOfAny(
                new[]
                {
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar
                }) >= 0
        )
            throw new InvalidOperationException("An invalid folder name was generated.");
        var fullPath = Path.GetFullPath(Path.Combine(_root, folderName));
        var expectedParent = _root + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(
            expectedParent,
            StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "The generated folder path escaped the governed root.");
        return fullPath;
    }

    private static string Message(CustomerFolderState state) => state switch
    {
        CustomerFolderState.VERIFIED =>
            "The governed customer folder is verified.",
        CustomerFolderState.MISSING =>
            "No governed folder exists for this canonical Customer Number.",
        CustomerFolderState.NAME_MISMATCH =>
            "The Customer Number folder exists, but its display name differs from the current canonical name.",
        CustomerFolderState.DUPLICATE =>
            "Multiple folders exist for this Customer Number. Manual resolution is required.",
        _ => "Customer folder verification did not complete."
    };

    private static string ProposedAction(CustomerFolderState state) =>
        state switch
        {
            CustomerFolderState.MISSING => "CREATE",
            CustomerFolderState.VERIFIED => "NONE",
            CustomerFolderState.NAME_MISMATCH => "REVIEW_RENAME",
            CustomerFolderState.DUPLICATE => "MANUAL_RESOLUTION",
            _ => "INVESTIGATE"
        };

    private static string? ManifestWarning(CustomerFolderStatus status)
    {
        if (status.NameWasSanitized)
            return "The folder display name was sanitized from the canonical customer name.";
        return status.FolderState switch
        {
            CustomerFolderState.NAME_MISMATCH => status.Message,
            CustomerFolderState.DUPLICATE => status.Message,
            CustomerFolderState.INVALID_CUSTOMER_IDENTITY => status.Message,
            CustomerFolderState.ERROR => status.Message,
            _ => null
        };
    }

    [GeneratedRegex(@"^\d{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex ValidCustomerNumber();
}
