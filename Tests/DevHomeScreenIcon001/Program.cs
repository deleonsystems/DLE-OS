using System.Buffers.Binary;
using System.Text.Json;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var shell = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
var shared = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "SharedDeviceWelcomeUi.cs"));
var program = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "Program.cs"));
var deployment = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DevFrontendDeployment.Common.ps1"));
var iconRoot = Path.Combine(repository, "ASSETS", "ICONS");

Check(shell.Contains("rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\"") &&
      shell.Contains("rel=\"manifest\" href=\"/site.webmanifest\"") &&
      shell.Contains("rel=\"icon\" type=\"image/png\" sizes=\"32x32\""),
    "authenticated shell exposes touch-icon, manifest, and favicon metadata");
Check(shared.Contains("rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\"") &&
      shared.Contains("rel=\"manifest\" href=\"/site.webmanifest\""),
    "shared-device entry exposes the same install metadata");

CheckPng("apple-touch-icon.png", 180);
CheckPng("dle-os-icon-192.png", 192);
CheckPng("dle-os-icon-512.png", 512);
CheckPng("favicon-32x32.png", 32);

using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(iconRoot, "site.webmanifest")));
var root = manifest.RootElement;
Check(root.GetProperty("short_name").GetString() == "DLE-OS DEV" &&
      root.GetProperty("id").GetString() == "/" &&
      root.GetProperty("start_url").GetString() == "/" &&
      root.GetProperty("scope").GetString() == "/" &&
      root.GetProperty("display").GetString() == "standalone",
    "manifest is explicitly DEV-scoped and launches the authenticated root");
var icons = root.GetProperty("icons").EnumerateArray().ToArray();
Check(icons.Length == 2 &&
      icons.Any(icon => icon.GetProperty("src").GetString() == "/dle-os-icon-192.png" &&
                        icon.GetProperty("sizes").GetString() == "192x192") &&
      icons.Any(icon => icon.GetProperty("src").GetString() == "/dle-os-icon-512.png" &&
                        icon.GetProperty("sizes").GetString() == "512x512"),
    "manifest references both required PWA icon sizes");
Check(!File.ReadAllText(Path.Combine(iconRoot, "site.webmanifest")).Contains("secret", StringComparison.OrdinalIgnoreCase) &&
      !File.ReadAllText(Path.Combine(iconRoot, "site.webmanifest")).Contains("connection", StringComparison.OrdinalIgnoreCase),
    "manifest exposes no configuration or secret material");

var anonymousPaths = new[]
{
    "/apple-touch-icon.png", "/favicon-32x32.png", "/dle-os-icon-192.png",
    "/dle-os-icon-512.png", "/site.webmanifest"
};
Check(anonymousPaths.All(path => program.Contains($"app.MapGet(\"{path}\"")) &&
      Count(program, ").AllowAnonymous();") >= anonymousPaths.Length + 2,
    "frontend maps every branding resource as an explicit anonymous endpoint");
Check(program.Contains("IsBrandingAssetPath(context.Request.Path)") &&
      anonymousPaths.All(path => program.Contains($"path.Equals(\"{path}\"")) &&
      !program.Contains("Path.StartsWithSegments(\"/ASSETS\"") &&
      !program.Contains("Path.StartsWithSegments(\"/assets\""),
    "authentication exemption is an exact allowlist rather than a static-directory bypass");
Check(deployment.Contains("'ASSETS/ICONS'"),
    "runtime source identity includes install metadata and icon assets");

Console.WriteLine($"PASS: {checks.Count} DEV home-screen icon checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void CheckPng(string fileName, int expectedSize)
{
    var bytes = File.ReadAllBytes(Path.Combine(iconRoot, fileName));
    Check(bytes.Length > 24 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) &&
          BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4)) == expectedSize &&
          BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4)) == expectedSize,
        $"{fileName} is a valid {expectedSize}x{expectedSize} PNG");
}

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

static int Count(string source, string value)
{
    var count = 0;
    for (var index = 0; (index = source.IndexOf(value, index, StringComparison.Ordinal)) >= 0;
         index += value.Length) count++;
    return count;
}
