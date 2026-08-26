using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record Dev5054WindowsServiceBootstrapResult(
    bool IsWindowsService,
    string[] ApplicationArguments,
    string ServiceName);

internal sealed class Dev5054WindowsServiceConfiguration
{
    public string Environment { get; init; } = "";
    public string RuntimeMode { get; init; } = "";
    public string ReleaseId { get; init; } = "";
    public string SourceIdentity { get; init; } = "";
    public string RequiredRuntimeIdentity { get; init; } = "";
    public string ControlPrefix { get; init; } = "";
    public string OperationalDatabase { get; init; } = "";
    public string SecurityDatabase { get; init; } = "";
    public string CanonicalApiBaseUrl { get; init; } = "";
    public string DevDataRoot { get; init; } = "";
    public string IdentitySigningPublicKeyPath { get; init; } = "";
    public string DevLogRoot { get; init; } = "";
}

internal static class Dev5054WindowsServiceBootstrap
{
    internal const string ServiceName = "DleOsDevelopmentOperationalControl5054";
    internal const string ServiceIdentity = @"DLE-OS-HOST\DLE-OS-DEV-CONTROL";
    internal const string ServiceSwitch = "--dle-os-windows-service";
    internal const string ConfigurationSwitch = "--service-config";
    private const string ExpectedControlPrefix = "http://dle-os-host:5054";
    private const string ExpectedOperationalDatabase = "DLE_OS_OPERATIONAL_DEV";
    private const string ExpectedSecurityDatabase = "DLE_OS_SECURITY_DEV";
    private const string ExpectedCanonicalApiBaseUrl = "http://DLE-OS-HOST:5052";
    private const string ExpectedDataRoot = @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data";
    private const string ExpectedPublicKey = @"C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem";
    private const string ExpectedLogRoot = @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs";
    private static readonly Regex ReleasePattern = new(
        "^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex SourcePattern = new(
        "^[0-9a-f]{40}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    internal static Dev5054WindowsServiceBootstrapResult Apply(string[] arguments)
    {
        if (!arguments.Contains(ServiceSwitch, StringComparer.OrdinalIgnoreCase))
            return new(false, arguments, ServiceName);
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("DEV 5054 Windows Service hosting requires Windows.");

        var configIndex = Array.FindIndex(arguments,
            value => value.Equals(ConfigurationSwitch, StringComparison.OrdinalIgnoreCase));
        if (configIndex < 0 || configIndex + 1 >= arguments.Length ||
            string.IsNullOrWhiteSpace(arguments[configIndex + 1]))
            throw new InvalidOperationException("The Windows Service requires --service-config <absolute-path>.");

        var configPath = Path.GetFullPath(arguments[configIndex + 1]);
        if (!Path.IsPathFullyQualified(configPath) || !File.Exists(configPath))
            throw new InvalidOperationException("The governed DEV 5054 service configuration file is absent.");
        var configuration = JsonSerializer.Deserialize<Dev5054WindowsServiceConfiguration>(
            File.ReadAllText(configPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("The governed DEV 5054 service configuration is invalid.");
        Validate(configuration);

        var executionIdentity = WindowsIdentity.GetCurrent().Name;
        if (!executionIdentity.Equals(ServiceIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"DEV 5054 Windows Service must run as {ServiceIdentity}.");

        Set("DLE_OS_ENVIRONMENT", configuration.Environment);
        Set("DLE_OS_RUNTIME_MODE", configuration.RuntimeMode);
        Set("DLE_OS_RELEASE_ID", configuration.ReleaseId);
        Set("DLE_OS_SOURCE_IDENTITY", configuration.SourceIdentity);
        Set("DLE_OS_CONTROL_PREFIX", configuration.ControlPrefix);
        Set("DLE_OS_OPERATIONAL_DATABASE", configuration.OperationalDatabase);
        Set("DLE_OS_SECURITY_DATABASE", configuration.SecurityDatabase);
        Set("DLE_OS_CANONICAL_API_BASE_URL", configuration.CanonicalApiBaseUrl);
        Set("DLE_OS_DEV_DATA_ROOT", Path.GetFullPath(configuration.DevDataRoot));
        Set("DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH",
            Path.GetFullPath(configuration.IdentitySigningPublicKeyPath));
        Set("DLE_OS_DEV_LOG_ROOT", Path.GetFullPath(configuration.DevLogRoot));

        var applicationArguments = arguments.Where((_, index) =>
            index != configIndex && index != configIndex + 1 &&
            !arguments[index].Equals(ServiceSwitch, StringComparison.OrdinalIgnoreCase)).ToArray();
        return new(true, applicationArguments, ServiceName);
    }

    internal static void Validate(Dev5054WindowsServiceConfiguration configuration)
    {
        RequireExact(configuration.Environment, "Development", nameof(configuration.Environment));
        RequireExact(configuration.RuntimeMode, "DEV_OPERATIONAL_ONLY", nameof(configuration.RuntimeMode));
        RequireExact(configuration.RequiredRuntimeIdentity, ServiceIdentity,
            nameof(configuration.RequiredRuntimeIdentity), ignoreCase: true);
        RequireExact(configuration.ControlPrefix, ExpectedControlPrefix, nameof(configuration.ControlPrefix), true);
        RequireExact(configuration.OperationalDatabase, ExpectedOperationalDatabase,
            nameof(configuration.OperationalDatabase));
        RequireExact(configuration.SecurityDatabase, ExpectedSecurityDatabase, nameof(configuration.SecurityDatabase));
        RequireExact(configuration.CanonicalApiBaseUrl, ExpectedCanonicalApiBaseUrl,
            nameof(configuration.CanonicalApiBaseUrl), true);
        RequirePath(configuration.DevDataRoot, ExpectedDataRoot, nameof(configuration.DevDataRoot));
        RequirePath(configuration.IdentitySigningPublicKeyPath, ExpectedPublicKey,
            nameof(configuration.IdentitySigningPublicKeyPath));
        RequirePath(configuration.DevLogRoot, ExpectedLogRoot, nameof(configuration.DevLogRoot));
        if (!ReleasePattern.IsMatch(configuration.ReleaseId))
            throw new InvalidOperationException("The DEV 5054 service release identity is invalid.");
        if (!SourcePattern.IsMatch(configuration.SourceIdentity))
            throw new InvalidOperationException("The DEV 5054 service source identity is invalid.");
    }

    private static void RequireExact(string actual, string expected, string name, bool ignoreCase = false)
    {
        var comparison = ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!actual.Equals(expected, comparison))
            throw new InvalidOperationException($"The DEV 5054 service setting {name} is outside its boundary.");
    }

    private static void RequirePath(string actual, string expected, string name)
    {
        if (!Path.GetFullPath(actual).Equals(Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"The DEV 5054 service path {name} is outside its boundary.");
    }

    private static void Set(string name, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"The DEV 5054 service setting {name} is absent.");
        Environment.SetEnvironmentVariable(name, value, EnvironmentVariableTarget.Process);
    }
}
