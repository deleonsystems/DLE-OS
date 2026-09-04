using System.Text.Json;
using System.Security.Cryptography;

var checks = new List<string>();
var build = new DevRuntimeBuildInfo(
    2,
    "Development",
    "20260811T145704Z",
    DateTimeOffset.Parse("2026-08-11T14:57:04Z"),
    "9fd3ddd00a9a3fad6c1ca19202af166a696df098",
    false,
    "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
    94,
    "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
    73,
    "release/frontend",
    "DleOsDevelopmentFrontend",
    @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND");

build.Validate();
Check(true, "valid isolated DEV runtime metadata passes its fail-closed contract");
var response = build.ToSafeResponse();
var responseJson = JsonSerializer.Serialize(response,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
Check(responseJson.Contains("\"environment\":\"Development\"") &&
      responseJson.Contains("\"releaseId\":\"20260811T145704Z\"") &&
      responseJson.Contains("\"sourceDirty\":false") &&
      responseJson.Contains("\"sourceDigestSha256\":") &&
      responseJson.Contains("\"frontendManifestSha256\":") &&
      responseJson.Contains("\"frontendFileCount\":73") &&
      responseJson.Contains("\"frontendContentRootIdentity\":\"release/frontend\""),
    "safe runtime response exposes release, Git, and immutable frontend identities");
Check(!new[] { "repositoryRoot", "releasePath", "connectionString", "password", "secret",
               "token", "privateKey", "C:\\", "ProgramData" }
        .Any(value => responseJson.Contains(value, StringComparison.OrdinalIgnoreCase)),
    "safe runtime response contains no secret or filesystem-sensitive configuration");

var shell = "<html><head></head><body><header><div class=\"top-pills\">" +
    "<aside id=\"dle-auth-identity\"></aside></div></header></body></html>";
var injected = RuntimeIdentityUi.Inject(shell, build);
Check(injected.Contains("id=\"dle-dev-build\"") &&
      injected.Contains("DEV <span aria-hidden=\"true\">•</span> 20260811T145704Z") &&
      injected.Contains("data-source-dirty=\"false\"") &&
      injected.Contains(build.SourceDigestSha256),
    "authenticated header indicator carries the exact release and source identity");
Check(injected.Contains("position:static") && injected.Contains("flex:0 0 auto") &&
      !injected.Contains("#dle-dev-build{position:fixed") &&
      !injected.Contains("#dle-dev-build{position:absolute"),
    "DEV indicator remains compact in normal header flow");

ExpectInvalid(build with { Environment = "Production" },
    "production metadata cannot activate the DEV runtime surface");
ExpectInvalid(build with { SourceDigestSha256 = "not-a-digest" },
    "malformed source digest fails closed");
ExpectInvalid(build with { SourceDirty = true },
    "dirty source metadata cannot activate a governed immutable release");
ExpectInvalid(build with { FrontendManifestSha256 = "not-a-digest" },
    "malformed frontend manifest digest fails closed");
ExpectInvalid(build with { FrontendContentRootIdentity = "repository" },
    "mutable frontend content identity fails closed");
ExpectInvalid(build with { ServiceName = "OtherService" },
    "unexpected service metadata fails closed");

var releaseFixture = Path.Combine(Directory.GetCurrentDirectory(), ".tmp",
    "runtime-build-identity", "frontend-release-" + Guid.NewGuid());
try
{
    var frontendRoot = Path.Combine(releaseFixture, "frontend");
    Directory.CreateDirectory(Path.Combine(frontendRoot, "SRC"));
    Directory.CreateDirectory(Path.Combine(frontendRoot, "ASSETS"));
    await File.WriteAllTextAsync(Path.Combine(frontendRoot, "DLE_Work_Center_v4.0.0.html"), "<html>fixture</html>");
    await File.WriteAllTextAsync(Path.Combine(frontendRoot, "SRC", "fixture.js"), "export const fixture=true;");
    await File.WriteAllTextAsync(Path.Combine(frontendRoot, "ASSETS", "fixture.txt"), "fixture");
    var manifestPath = Path.Combine(releaseFixture, "frontend-manifest.json");
    var entries = Directory.EnumerateFiles(frontendRoot, "*", SearchOption.AllDirectories)
        .Select(path => new
        {
            relativePath = Path.GetRelativePath(frontendRoot, path).Replace('\\', '/'),
            length = new FileInfo(path).Length,
            sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)))
        }).OrderBy(value => value.relativePath, StringComparer.Ordinal).ToArray();
    await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(new
    {
        schemaVersion = 1,
        releaseId = build.ReleaseId,
        gitHead = build.GitHead,
        fileCount = entries.Length,
        files = entries
    }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
    var manifestHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath)));
    var releaseBuild = build with
    {
        FrontendManifestSha256 = manifestHash,
        FrontendFileCount = entries.Length
    };
    var validated = FrontendReleaseManifestValidator.Validate(frontendRoot, manifestPath, releaseBuild);
    Check(validated.ManifestSha256 == manifestHash && validated.FileCount == entries.Length,
        "runtime validates every immutable frontend manifest entry");

    await File.AppendAllTextAsync(Path.Combine(frontendRoot, "SRC", "fixture.js"), "tampered");
    ExpectManifestInvalid(() => FrontendReleaseManifestValidator.Validate(
        frontendRoot, manifestPath, releaseBuild),
        "runtime rejects a changed frontend release byte");
    await File.WriteAllTextAsync(Path.Combine(frontendRoot, "SRC", "fixture.js"), "export const fixture=true;");
    await File.WriteAllTextAsync(Path.Combine(frontendRoot, "SRC", "unmanifested.js"), "extra");
    ExpectManifestInvalid(() => FrontendReleaseManifestValidator.Validate(
        frontendRoot, manifestPath, releaseBuild),
        "runtime rejects an unmanifested frontend release file");

    File.Delete(Path.Combine(frontendRoot, "SRC", "unmanifested.js"));
    var unsafeEntries = entries.Select((entry, index) => new
    {
        relativePath = index == 0 ? "../escape" : entry.relativePath,
        entry.length,
        entry.sha256
    }).ToArray();
    await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(new
    {
        schemaVersion = 1,
        releaseId = build.ReleaseId,
        gitHead = build.GitHead,
        fileCount = unsafeEntries.Length,
        files = unsafeEntries
    }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
    var unsafeBuild = releaseBuild with
    {
        FrontendManifestSha256 = Convert.ToHexString(
            SHA256.HashData(await File.ReadAllBytesAsync(manifestPath)))
    };
    ExpectManifestInvalid(() => FrontendReleaseManifestValidator.Validate(
        frontendRoot, manifestPath, unsafeBuild),
        "runtime rejects a manifest traversal entry even when its manifest hash matches");
}
finally
{
    if (Directory.Exists(releaseFixture)) Directory.Delete(releaseFixture, true);
}

var evidenceDirectory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", "runtime-build-identity");
Directory.CreateDirectory(evidenceDirectory);
var metadataPath = Path.Combine(evidenceDirectory, "runtime-build-info.fixture.json");
await File.WriteAllTextAsync(metadataPath, JsonSerializer.Serialize(build,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
var loaded = DevRuntimeBuildInfo.Load(metadataPath);
Check(loaded == build, "runtime metadata file round-trips through the production loader");

Console.WriteLine($"PASS: {checks.Count} runtime build identity application checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}
void ExpectInvalid(DevRuntimeBuildInfo value, string name)
{
    try
    {
        value.Validate();
        throw new Exception("FAILED: " + name);
    }
    catch (InvalidOperationException)
    {
        checks.Add(name);
    }
}
void ExpectManifestInvalid(Action action, string name)
{
    try
    {
        action();
        throw new Exception("FAILED: " + name);
    }
    catch (InvalidOperationException)
    {
        checks.Add(name);
    }
}
