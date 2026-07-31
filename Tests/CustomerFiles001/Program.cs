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

Console.WriteLine(
    $"CUSTOMER-FILES-001 core qualification: {passed} passed, {failed} failed.");
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
    public HashSet<string> Names { get; } =
        new(StringComparer.OrdinalIgnoreCase);
    public bool RootExists { get; set; } = true;
    public bool DenyEnumeration { get; set; }
    public int CreateCount { get; private set; }

    public FakeFileSystem(params string[] names)
    {
        foreach (var name in names)
            Names.Add(name);
    }

    public bool DirectoryExists(string path) => RootExists;
    public FileAttributes GetAttributes(string path) =>
        FileAttributes.Directory;
    public IReadOnlyList<string> GetDirectoryNames(string root)
    {
        if (DenyEnumeration)
            throw new UnauthorizedAccessException("Test denial.");
        return Names.ToArray();
    }

    public void CreateDirectory(string path)
    {
        if (Names.Add(Path.GetFileName(path)))
            CreateCount++;
    }
}
