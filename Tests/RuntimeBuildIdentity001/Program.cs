using System.Text.Json;

var checks = new List<string>();
var build = new DevRuntimeBuildInfo(
    1,
    "Development",
    "20260811T145704Z",
    DateTimeOffset.Parse("2026-08-11T14:57:04Z"),
    "9fd3ddd00a9a3fad6c1ca19202af166a696df098",
    true,
    "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
    94,
    "DleOsDevelopmentFrontend",
    @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND");

build.Validate();
Check(true, "valid isolated DEV runtime metadata passes its fail-closed contract");
var response = build.ToSafeResponse();
var responseJson = JsonSerializer.Serialize(response,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
Check(responseJson.Contains("\"environment\":\"Development\"") &&
      responseJson.Contains("\"releaseId\":\"20260811T145704Z\"") &&
      responseJson.Contains("\"sourceDirty\":true") &&
      responseJson.Contains("\"sourceDigestSha256\":"),
    "safe runtime response exposes release, Git state, and source digest");
Check(!new[] { "repositoryRoot", "releasePath", "connectionString", "password", "secret",
               "token", "privateKey", "C:\\", "ProgramData" }
        .Any(value => responseJson.Contains(value, StringComparison.OrdinalIgnoreCase)),
    "safe runtime response contains no secret or filesystem-sensitive configuration");

var shell = "<html><head></head><body><header><div class=\"top-pills\">" +
    "<aside id=\"dle-auth-identity\"></aside></div></header></body></html>";
var injected = RuntimeIdentityUi.Inject(shell, build);
Check(injected.Contains("id=\"dle-dev-build\"") &&
      injected.Contains("DEV <span aria-hidden=\"true\">•</span> 20260811T145704Z") &&
      injected.Contains("data-source-dirty=\"true\"") &&
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
ExpectInvalid(build with { ServiceName = "OtherService" },
    "unexpected service metadata fails closed");

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
