using System.Text.Json;

var valid = new Dev5054WindowsServiceConfiguration
{
    Environment = "Development",
    RuntimeMode = "DEV_OPERATIONAL_ONLY",
    ReleaseId = "dev5054-20260826T120000Z-0123456789ab",
    SourceIdentity = "0123456789abcdef0123456789abcdef01234567",
    RequiredRuntimeIdentity = @"DLE-OS-HOST\DLE-OS-DEV-CONTROL",
    ControlPrefix = "http://dle-os-host:5054",
    OperationalDatabase = "DLE_OS_OPERATIONAL_DEV",
    SecurityDatabase = "DLE_OS_SECURITY_DEV",
    CanonicalApiBaseUrl = "http://DLE-OS-HOST:5052",
    DevDataRoot = @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data",
    IdentitySigningPublicKeyPath =
        @"C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem",
    DevLogRoot = @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs"
};

Dev5054WindowsServiceBootstrap.Validate(valid);
var cases = new Dictionary<string, Dev5054WindowsServiceConfiguration>
{
    ["LIVE operational database"] = Copy(valid, operationalDatabase: "DLE_OS_OPERATIONAL_LIVE"),
    ["LIVE security database"] = Copy(valid, securityDatabase: "DLE_OS_SECURITY_LIVE"),
    ["direct canonical database-shaped endpoint"] = Copy(valid, canonicalApiBaseUrl: "lpc:.\\SQLEXPRESS"),
    ["production share"] = Copy(valid, devDataRoot: @"\\deleon-server\Production\KITTING"),
    ["wrong runtime identity"] = Copy(valid, requiredRuntimeIdentity: @"DLE-OS-HOST\Miguel"),
    ["wrong listener"] = Copy(valid, controlPrefix: "http://dle-os-host:5043"),
    ["invalid release"] = Copy(valid, releaseId: "latest"),
    ["invalid source identity"] = Copy(valid, sourceIdentity: "dirty")
};

foreach (var item in cases)
{
    try
    {
        Dev5054WindowsServiceBootstrap.Validate(item.Value);
        throw new InvalidOperationException($"Boundary test unexpectedly accepted {item.Key}.");
    }
    catch (InvalidOperationException exception) when
        (exception.Message.StartsWith("The DEV 5054 service", StringComparison.Ordinal))
    {
    }
}

var json = JsonSerializer.Serialize(valid);
foreach (var forbidden in new[] { "password", "passwd", "token", "secret", "credential", "privateKey" })
    if (json.Contains(forbidden, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException($"Service configuration contains prohibited secret field {forbidden}.");

Console.WriteLine(JsonSerializer.Serialize(new
{
    Verdict = "PASS",
    ValidBoundaryAccepted = true,
    RejectedBoundaryCases = cases.Count,
    ConfigurationContainsSecrets = false,
    ServiceName = Dev5054WindowsServiceBootstrap.ServiceName,
    ServiceIdentity = Dev5054WindowsServiceBootstrap.ServiceIdentity
}));

static Dev5054WindowsServiceConfiguration Copy(
    Dev5054WindowsServiceConfiguration source,
    string? operationalDatabase = null,
    string? securityDatabase = null,
    string? canonicalApiBaseUrl = null,
    string? devDataRoot = null,
    string? requiredRuntimeIdentity = null,
    string? controlPrefix = null,
    string? releaseId = null,
    string? sourceIdentity = null) => new()
{
    Environment = source.Environment,
    RuntimeMode = source.RuntimeMode,
    ReleaseId = releaseId ?? source.ReleaseId,
    SourceIdentity = sourceIdentity ?? source.SourceIdentity,
    RequiredRuntimeIdentity = requiredRuntimeIdentity ?? source.RequiredRuntimeIdentity,
    ControlPrefix = controlPrefix ?? source.ControlPrefix,
    OperationalDatabase = operationalDatabase ?? source.OperationalDatabase,
    SecurityDatabase = securityDatabase ?? source.SecurityDatabase,
    CanonicalApiBaseUrl = canonicalApiBaseUrl ?? source.CanonicalApiBaseUrl,
    DevDataRoot = devDataRoot ?? source.DevDataRoot,
    IdentitySigningPublicKeyPath = source.IdentitySigningPublicKeyPath,
    DevLogRoot = source.DevLogRoot
};
