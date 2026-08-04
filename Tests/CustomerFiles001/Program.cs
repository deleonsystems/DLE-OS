using DleOs.CustomerFilesControl;
using Microsoft.Extensions.Logging.Abstractions;

var passed = 0;
var failed = 0;

async Task Test(string name, Func<Task> action)
{
    try
    {
        await action();
        Console.WriteLine($"PASS {name}");
        passed++;
    }
    catch (Exception exception)
    {
        Console.WriteLine($"FAIL {name}: {exception.Message}");
        failed++;
    }
}

static void Equal<T>(T expected, T actual, string? message = null)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException(
            message ?? $"Expected {expected}; received {actual}.");
}

static void True(bool value, string message)
{
    if (!value)
        throw new InvalidOperationException(message);
}

CustomerFolderService Service(
    FakeFileSystem fileSystem,
    params CanonicalCustomer[] customers) =>
    new(
        @"C:\CustomerFilesTest",
        new FakeDirectory(customers),
        fileSystem,
        NullLogger<CustomerFolderService>.Instance);

await Test("01_verified_customer_folder", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS");
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.VERIFIED, result.FolderState);
    Equal(1, result.MatchedFolderCount);
});

await Test("02_missing_customer_folder", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.MISSING, result.FolderState);
    True(result.CanCreate, "Missing folder must be creatable.");
});

await Test("03_create_valid_customer_folder", async () =>
{
    var fs = new FakeFileSystem();
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .CreateAsync("001148", default);
    Equal(CustomerFolderState.VERIFIED, result.FolderState);
    Equal(1, fs.CreateCount);
});

await Test("04_repeated_creation_is_idempotent", async () =>
{
    var fs = new FakeFileSystem();
    var service = Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"));
    await Task.WhenAll(
        service.CreateAsync("001148", default),
        service.CreateAsync("001148", default));
    Equal(1, fs.CreateCount);
    Equal(1, fs.Names.Count);
});

await Test("05_name_mismatch", async () =>
{
    var result = await Service(
        new FakeFileSystem("001148 - OLD NAME"),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.NAME_MISMATCH, result.FolderState);
    True(!result.CanCreate, "Name mismatch must not allow creation.");
});

await Test("06_duplicate_number_prefix", async () =>
{
    var result = await Service(
        new FakeFileSystem(
            "001148 - HUGHEY & PHILLIPS",
            "001148 - OLD NAME"),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.DUPLICATE, result.FolderState);
    Equal(2, result.MatchedFolderCount);
});

await Test("07_root_unavailable", async () =>
{
    var fs = new FakeFileSystem { RootExists = false };
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.ROOT_UNAVAILABLE, result.FolderState);
});

await Test("08_access_denied", async () =>
{
    var fs = new FakeFileSystem { DenyEnumeration = true };
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.ACCESS_DENIED, result.FolderState);
});

await Test("09_invalid_customer_number", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("../001148", default);
    Equal(CustomerFolderState.INVALID_CUSTOMER_IDENTITY, result.FolderState);
});

await Test("10_customer_not_found", async () =>
{
    var result = await Service(new FakeFileSystem())
        .VerifyAsync("001148", default);
    Equal(CustomerFolderState.INVALID_CUSTOMER_IDENTITY, result.FolderState);
});

await Test("11_leading_zero_preservation", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal(
        "001148 - HUGHEY & PHILLIPS",
        result.ExpectedFolderName);
});

await Test("12_windows_filename_sanitization", () =>
{
    Equal("A_B_C_D_E_F_G_H_I", CustomerNameSanitizer
        .Sanitize("A\\B/C:D*E?F\"G<H>I. ").Value);
    Equal("_CON", CustomerNameSanitizer.Sanitize("CON").Value);
    Equal("CUSTOMER", CustomerNameSanitizer.Sanitize("...").Value);
    Equal(
        CustomerNameSanitizer.MaximumDisplayLength,
        CustomerNameSanitizer.Sanitize(new string('X', 300)).Value.Length);
    return Task.CompletedTask;
});

await Test("13_path_traversal_is_sanitized_and_bounded", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", @"..\..\outside"))
        .VerifyAsync("001148", default);
    True(
        result.FolderPath!.StartsWith(
            @"C:\CustomerFilesTest\",
            StringComparison.OrdinalIgnoreCase),
        "Generated path escaped the test root.");
    True(
        !result.ExpectedFolderName!.Contains('\\'),
        "Generated folder retained a path separator.");
});

await Test("14_manifest_is_dry_run", async () =>
{
    var fs = new FakeFileSystem();
    var manifest = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .BuildManifestAsync(default);
    Equal(1, manifest.CanonicalCustomerCount);
    Equal(0, fs.CreateCount);
    Equal("CREATE", manifest.Items[0].ProposedAction);
});

await Test("15_caller_name_cannot_override_canonical", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyAsync("001148", default);
    Equal("HUGHEY & PHILLIPS", result.CanonicalCustomerName);
    True(
        !typeof(CustomerFolderService).GetMethods()
            .Where(method => method.Name is "VerifyAsync" or "CreateAsync")
            .SelectMany(method => method.GetParameters())
            .Any(parameter => string.Equals(
                parameter.Name,
                "customerName",
                StringComparison.OrdinalIgnoreCase)),
        "A public operation accepts caller-supplied customerName.");
});

await Test("16_isolated_temporary_root_creation", async () =>
{
    var temporaryBase = Path.GetFullPath(Path.GetTempPath())
        .TrimEnd(Path.DirectorySeparatorChar) +
        Path.DirectorySeparatorChar;
    var root = Path.GetFullPath(Path.Combine(
        temporaryBase,
        "DleOsCustomerFiles001-" + Guid.NewGuid().ToString("N")));
    True(
        root.StartsWith(
            temporaryBase,
            StringComparison.OrdinalIgnoreCase),
        "Temporary test root escaped the OS temporary directory.");
    Directory.CreateDirectory(root);
    try
    {
        var service = new CustomerFolderService(
            root,
            new FakeDirectory(
                new[]
                {
                    new CanonicalCustomer(
                        "001148",
                        "HUGHEY & PHILLIPS")
                }),
            new SystemCustomerFileSystem(),
            NullLogger<CustomerFolderService>.Instance);
        var first = await service.CreateAsync("001148", default);
        var second = await service.CreateAsync("001148", default);
        Equal(CustomerFolderState.VERIFIED, first.FolderState);
        Equal(CustomerFolderState.VERIFIED, second.FolderState);
        Equal(
            1,
            Directory.EnumerateDirectories(root).Count(),
            "Temporary-root creation was not idempotent.");
    }
    finally
    {
        if (
            Directory.Exists(root) &&
            root.StartsWith(
                temporaryBase,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            Directory.Delete(root, recursive: true);
        }
    }
});

await Test("17_requirements_missing_when_main_verified", async () =>
{
    var result = await Service(
        new FakeFileSystem("001148 - HUGHEY & PHILLIPS"),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.NOT_CREATED,
        result.RequirementsComplianceState);
    True(result.CanCreate, "Missing optional folder must be creatable.");
    True(!result.CanOpen, "Missing optional folder must not be openable.");
});

await Test("18_requirements_available", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS");
    fs.AddChild(
        "001148 - HUGHEY & PHILLIPS",
        CustomerFolderService.RequirementsComplianceFolderName);
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.AVAILABLE,
        result.RequirementsComplianceState);
    True(result.CanOpen, "Available optional folder must be openable.");
});

await Test("19_requirements_creation", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS");
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .CreateRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.AVAILABLE,
        result.RequirementsComplianceState);
    Equal(1, fs.CreateCount);
    Equal(
        CustomerFolderService.RequirementsComplianceFolderName,
        fs.GetChildNames("001148 - HUGHEY & PHILLIPS").Single());
});

await Test("20_requirements_repeated_creation_is_idempotent", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS");
    var service = Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"));
    await Task.WhenAll(
        service.CreateRequirementsComplianceAsync("001148", default),
        service.CreateRequirementsComplianceAsync("001148", default));
    Equal(1, fs.CreateCount);
    Equal(
        1,
        fs.GetChildNames("001148 - HUGHEY & PHILLIPS").Count);
});

await Test("21_requirements_main_folder_not_verified", async () =>
{
    var result = await Service(
        new FakeFileSystem(),
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.CUSTOMER_FOLDER_NOT_VERIFIED,
        result.RequirementsComplianceState);
    Equal(CustomerFolderState.MISSING, result.CustomerFolderState);
});

await Test("22_requirements_access_denied", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS")
    {
        DenyCustomerEnumeration = true
    };
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.ACCESS_DENIED,
        result.RequirementsComplianceState);
});

await Test("23_requirements_unexpected_error", async () =>
{
    var fs = new FakeFileSystem("001148 - HUGHEY & PHILLIPS")
    {
        ThrowCustomerEnumeration = true
    };
    var result = await Service(
        fs,
        new CanonicalCustomer("001148", "HUGHEY & PHILLIPS"))
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.ERROR,
        result.RequirementsComplianceState);
});

await Test("24_requirements_invalid_customer_number", async () =>
{
    var result = await Service(new FakeFileSystem())
        .VerifyRequirementsComplianceAsync("../001148", default);
    Equal(
        RequirementsComplianceState.CUSTOMER_FOLDER_NOT_VERIFIED,
        result.RequirementsComplianceState);
    Equal(
        CustomerFolderState.INVALID_CUSTOMER_IDENTITY,
        result.CustomerFolderState);
});

await Test("25_requirements_customer_not_found", async () =>
{
    var result = await Service(new FakeFileSystem())
        .VerifyRequirementsComplianceAsync("001148", default);
    Equal(
        RequirementsComplianceState.CUSTOMER_FOLDER_NOT_VERIFIED,
        result.RequirementsComplianceState);
    Equal(
        CustomerFolderState.INVALID_CUSTOMER_IDENTITY,
        result.CustomerFolderState);
});

await Test("26_requirements_operation_accepts_no_path_or_name", () =>
{
    var operations = typeof(CustomerFolderService).GetMethods()
        .Where(method => method.Name is
            "VerifyRequirementsComplianceAsync" or
            "CreateRequirementsComplianceAsync")
        .ToArray();
    True(operations.Length == 2, "Optional-folder operations are missing.");
    True(
        !operations.SelectMany(method => method.GetParameters())
            .Any(parameter => parameter.Name is
                "path" or "folderName" or "subfolderName"),
        "An optional-folder operation accepts a caller path or folder name.");
    return Task.CompletedTask;
});

await Test("27_requirements_isolated_temporary_root", async () =>
{
    var temporaryBase = Path.GetFullPath(Path.GetTempPath())
        .TrimEnd(Path.DirectorySeparatorChar) +
        Path.DirectorySeparatorChar;
    var root = Path.GetFullPath(Path.Combine(
        temporaryBase,
        "DleOsCustomerFiles002-" + Guid.NewGuid().ToString("N")));
    var mainFolder = Path.Combine(root, "001148 - HUGHEY & PHILLIPS");
    Directory.CreateDirectory(mainFolder);
    try
    {
        var service = new CustomerFolderService(
            root,
            new FakeDirectory(
                new[]
                {
                    new CanonicalCustomer(
                        "001148",
                        "HUGHEY & PHILLIPS")
                }),
            new SystemCustomerFileSystem(),
            NullLogger<CustomerFolderService>.Instance);
        var first = await service.CreateRequirementsComplianceAsync(
            "001148",
            default);
        var second = await service.CreateRequirementsComplianceAsync(
            "001148",
            default);
        Equal(
            RequirementsComplianceState.AVAILABLE,
            first.RequirementsComplianceState);
        Equal(
            RequirementsComplianceState.AVAILABLE,
            second.RequirementsComplianceState);
        Equal(
            1,
            Directory.EnumerateDirectories(mainFolder).Count(),
            "Optional-folder creation was not idempotent.");
        Equal(
            CustomerFolderService.RequirementsComplianceFolderName,
            Path.GetFileName(Directory.EnumerateDirectories(
                mainFolder).Single()));
    }
    finally
    {
        if (
            Directory.Exists(root) &&
            root.StartsWith(
                temporaryBase,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            Directory.Delete(root, recursive: true);
        }
    }
});

Console.WriteLine(
    $"Customer Files core qualification: {passed} passed, {failed} failed.");
return failed == 0 ? 0 : 1;

sealed class FakeDirectory : ICustomerDirectory
{
    private readonly IReadOnlyList<CanonicalCustomer> _customers;

    public FakeDirectory(IReadOnlyList<CanonicalCustomer> customers)
    {
        _customers = customers;
    }

    public Task<CanonicalCustomer?> FindAsync(
        string customerNumber,
        CancellationToken cancellationToken) =>
        Task.FromResult(_customers.SingleOrDefault(customer =>
            customer.CustomerNumber == customerNumber));

    public Task<IReadOnlyList<CanonicalCustomer>> GetAllAsync(
        CancellationToken cancellationToken) =>
        Task.FromResult(_customers);
}

sealed class FakeFileSystem : ICustomerFileSystem
{
    private const string Root = @"C:\CustomerFilesTest";
    private readonly Dictionary<string, HashSet<string>> _children =
        new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> Names { get; } =
        new(StringComparer.OrdinalIgnoreCase);
    public bool RootExists { get; set; } = true;
    public bool DenyEnumeration { get; set; }
    public bool DenyCustomerEnumeration { get; set; }
    public bool ThrowCustomerEnumeration { get; set; }
    public int CreateCount { get; private set; }

    public FakeFileSystem(params string[] names)
    {
        foreach (var name in names)
            Names.Add(name);
    }

    public void AddChild(string parentName, string childName)
    {
        var parentPath = Path.Combine(Root, parentName);
        if (!_children.TryGetValue(parentPath, out var names))
        {
            names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            _children[parentPath] = names;
        }
        names.Add(childName);
    }

    public IReadOnlyList<string> GetChildNames(string parentName)
    {
        var parentPath = Path.Combine(Root, parentName);
        return _children.TryGetValue(parentPath, out var names)
            ? names.ToArray()
            : Array.Empty<string>();
    }

    public bool DirectoryExists(string path)
    {
        var normalized = Path.GetFullPath(path).TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        if (string.Equals(
            normalized,
            Root,
            StringComparison.OrdinalIgnoreCase))
            return RootExists;
        var parent = Path.GetDirectoryName(normalized);
        var name = Path.GetFileName(normalized);
        if (string.Equals(parent, Root, StringComparison.OrdinalIgnoreCase))
            return RootExists && Names.Contains(name);
        return parent is not null &&
            _children.TryGetValue(parent, out var names) &&
            names.Contains(name);
    }

    public FileAttributes GetAttributes(string path)
    {
        if (!DirectoryExists(path))
            throw new DirectoryNotFoundException(path);
        return FileAttributes.Directory;
    }

    public IReadOnlyList<string> GetDirectoryNames(string root)
    {
        var normalized = Path.GetFullPath(root).TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        if (
            DenyEnumeration &&
            string.Equals(
                normalized,
                Root,
                StringComparison.OrdinalIgnoreCase)
        )
            throw new UnauthorizedAccessException("Test denial.");
        if (
            !string.Equals(
                normalized,
                Root,
                StringComparison.OrdinalIgnoreCase) &&
            DenyCustomerEnumeration
        )
            throw new UnauthorizedAccessException("Test customer denial.");
        if (
            !string.Equals(
                normalized,
                Root,
                StringComparison.OrdinalIgnoreCase) &&
            ThrowCustomerEnumeration
        )
            throw new IOException("Test customer failure.");
        if (string.Equals(
            normalized,
            Root,
            StringComparison.OrdinalIgnoreCase))
            return Names.ToArray();
        return _children.TryGetValue(normalized, out var names)
            ? names.ToArray()
            : Array.Empty<string>();
    }

    public void CreateDirectory(string path)
    {
        var normalized = Path.GetFullPath(path).TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        var parent = Path.GetDirectoryName(normalized)
            ?? throw new InvalidOperationException("Test path has no parent.");
        var name = Path.GetFileName(normalized);
        bool added;
        if (string.Equals(parent, Root, StringComparison.OrdinalIgnoreCase))
        {
            added = Names.Add(name);
        }
        else
        {
            if (!_children.TryGetValue(parent, out var names))
            {
                names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                _children[parent] = names;
            }
            added = names.Add(name);
        }
        if (added)
            CreateCount++;
    }
}
