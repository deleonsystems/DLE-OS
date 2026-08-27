using Microsoft.AspNetCore.Http;
using System.Net;
using System.Text.Json;

var clock = new AdjustableTimeProvider(new DateTimeOffset(2026, 8, 26, 20, 0, 0, TimeSpan.Zero));
var broker = new GovernedDesktopCapabilityBroker(clock);
var openUri = "dle-drawing-prints://open/" + Base64Url(@"Meggitt\6834-03\REV J");
var resolution = new DrawingPrintsResolution(
    "RESOLVED", "Meggitt", "6834-03", "J", "Meggitt", "6834-03", "REV J",
    openUri, openUri, [], "Assembly Drawing folder resolved.");

Check("opaque capability issue and one-time redemption", () =>
{
    var attached = broker.Attach(resolution, "correlation-1");
    True(attached.DesktopCapability?.StartsWith("dlecap1_", StringComparison.Ordinal) == true);
    True(attached.DesktopCapability?.Contains("Meggitt", StringComparison.OrdinalIgnoreCase) == false);
    var request = new DesktopCapabilityRedeemRequest(1, "open-drawing-folder",
        attached.DesktopCapability, attached.CapabilityCorrelationId);
    True(broker.TryRedeem(request, out var redeemed, out var failure));
    Equal("None", failure);
    Equal(@"Meggitt\6834-03\REV J", redeemed?.RelativePath);
    True(!broker.TryRedeem(request, out _, out failure));
    Equal("UnknownOrReplayedCapability", failure);
});

Check("modified capability fails closed", () =>
{
    var attached = broker.Attach(resolution, "correlation-2");
    var token = attached.DesktopCapability!;
    var modified = token[..^1] + (token[^1] == 'A' ? 'B' : 'A');
    True(!broker.TryRedeem(new(1, "open-drawing-folder", modified, "correlation-2"), out _, out var failure));
    Equal("UnknownOrReplayedCapability", failure);
});

Check("wrong operation and schema fail closed", () =>
{
    var attached = broker.Attach(resolution, "correlation-3");
    True(!broker.TryRedeem(new(1, "run-command", attached.DesktopCapability, "correlation-3"), out _, out _));
    True(!broker.TryRedeem(new(2, "open-drawing-folder", attached.DesktopCapability, "correlation-3"), out _, out _));
});

Check("expired capability fails closed", () =>
{
    var attached = broker.Attach(resolution, "correlation-4");
    clock.Advance(TimeSpan.FromMinutes(3));
    True(!broker.TryRedeem(new(1, "open-drawing-folder", attached.DesktopCapability, "correlation-4"), out _, out var failure));
    Equal("ExpiredCapability", failure);
});

Check("redemption endpoint is same-host only", () =>
{
    var local = new DefaultHttpContext();
    local.Connection.RemoteIpAddress = IPAddress.Parse("192.168.0.105");
    local.Connection.LocalIpAddress = IPAddress.Parse("192.168.0.105");
    True(GovernedDesktopCapabilityBroker.IsSameHostRequest(local));
    var remote = new DefaultHttpContext();
    remote.Connection.RemoteIpAddress = IPAddress.Parse("192.168.0.44");
    remote.Connection.LocalIpAddress = IPAddress.Parse("192.168.0.105");
    True(!GovernedDesktopCapabilityBroker.IsSameHostRequest(remote));
});

Check("native host message contract is exact", () =>
{
    var capability = "dlecap1_" + new string('A', 43);
    var valid = JsonSerializer.Serialize(new
    {
        version = 1,
        operation = "open-drawing-folder",
        capability,
        correlationId = "correlation-native"
    });
    True(NativeHostContract.TryParse(valid, out var request, out _));
    Equal(capability, request?.Capability);
    True(!NativeHostContract.TryParse(valid[..^1] + ",\"path\":\"C:\\\\Windows\"}", out _, out _));
    True(!NativeHostContract.TryParse(valid.Replace("open-drawing-folder", "run-command"), out _, out _));
    True(NativeHostContract.IsApprovedBrowserOrigin(
        "chrome-extension://gappmnmcjliadjleocigmndgalflgffd/"));
    True(!NativeHostContract.IsApprovedBrowserOrigin(
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
});

Check("governed folder validation rejects unsafe paths", () =>
{
    var root = Path.GetFullPath(@"C:\DrawingPrintsQualification");
    var fileSystem = new FakeDesktopFileSystem(root);
    fileSystem.Add(@"Meggitt\6834-03\REV J");
    var validator = new GovernedDrawingFolder(root, fileSystem);
    True(validator.TryResolve(@"Meggitt\6834-03\REV J", out var target, out _));
    True(target?.EndsWith(@"Meggitt\6834-03\REV J", StringComparison.OrdinalIgnoreCase) == true);
    True(!validator.TryResolve(@"..\Accounting", out _, out _));
    True(!validator.TryResolve(@"C:\Windows", out _, out _));
    True(!validator.TryResolve(@"\\other-server\share", out _, out _));
    fileSystem.MarkReparse(@"Meggitt\6834-03");
    True(!validator.TryResolve(@"Meggitt\6834-03\REV J", out _, out var failure));
    Equal("GovernedFolderUnavailable", failure);
});

Console.WriteLine("Governed desktop capability broker/native-host security contracts: PASS");

static string Base64Url(string value) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(value))
    .TrimEnd('=').Replace('+', '-').Replace('/', '_');

static void Check(string name, Action action)
{
    try { action(); }
    catch (Exception exception) { throw new InvalidOperationException(name + " failed", exception); }
}

static void True(bool value)
{
    if (!value) throw new InvalidOperationException("Expected true.");
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"Expected {expected}; actual {actual}.");
}

sealed class AdjustableTimeProvider(DateTimeOffset value) : TimeProvider
{
    private DateTimeOffset value = value;
    public override DateTimeOffset GetUtcNow() => value;
    internal void Advance(TimeSpan elapsed) => value += elapsed;
}

sealed class FakeDesktopFileSystem : IGovernedDesktopFileSystem
{
    private readonly HashSet<string> directories = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> reparsePoints = new(StringComparer.OrdinalIgnoreCase);
    private readonly string root;

    internal FakeDesktopFileSystem(string root)
    {
        this.root = Path.GetFullPath(root);
        directories.Add(this.root);
    }

    internal void Add(string relative)
    {
        var cursor = root;
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar))
        {
            cursor = Path.GetFullPath(Path.Combine(cursor, segment));
            directories.Add(cursor);
        }
    }

    internal void MarkReparse(string relative) =>
        reparsePoints.Add(Path.GetFullPath(Path.Combine(root, relative)));

    public bool DirectoryExists(string path) => directories.Contains(Path.GetFullPath(path));
    public FileAttributes GetAttributes(string path) => FileAttributes.Directory |
        (reparsePoints.Contains(Path.GetFullPath(path)) ? FileAttributes.ReparsePoint : 0);
}
