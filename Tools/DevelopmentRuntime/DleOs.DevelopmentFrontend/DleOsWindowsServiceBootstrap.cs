using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

internal sealed record DleOsWindowsServiceBootstrapResult(
    bool IsWindowsService,
    string[] ApplicationArguments);

internal sealed class DleOsWindowsServiceConfiguration
{
    public string Environment { get; init; } = "";
    public string RuntimeMarker { get; init; } = "";
    public string EnvironmentLabel { get; init; } = "";
    public string ApplicationOrigin { get; init; } = "";
    public string OidcClientId { get; init; } = "";
    public string AuthenticationStateRoot { get; init; } = "";
    public string CanonicalApiBaseUrl { get; init; } = "";
    public string OperationalApiBaseUrl { get; init; } = "";
    public string SyncOperationsApiBaseUrl { get; init; } = "";
    public string GovernedRefreshApiBaseUrl { get; init; } = "";
    public string CustomerFilesApiBaseUrl { get; init; } = "";
    public string SecurityDatabase { get; init; } = "";
    public bool EnableUserProvisioning { get; init; }
    public string[] FrontendPrefixes { get; init; } = [];
    public string FrontendContentRoot { get; init; } = "";
    public string RequiredRuntimeIdentity { get; init; } = "";
    public string IdentitySigningPrivateKeyPath { get; init; } = "";
    public string OidcClientSecretPath { get; init; } = "";
    public string ProvisioningClientSecretPath { get; init; } = "";
}

internal static class DleOsWindowsServiceBootstrap
{
    internal const string ServiceName = "DleOsDevelopmentFrontend";
    internal const string ServiceIdentity = @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";
    internal const string AuthenticationStateRoot = @"C:\ProgramData\DLE-OS\DevelopmentFrontend\AuthState";
    private const string KittingShortageRoot = @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
    private const string KittingCompleteRoot = @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
    private const string ServiceSwitch = "--dle-os-windows-service";
    private const string ConfigurationSwitch = "--service-config";
    private const string OidcEntropy = "DLE-OS|Keycloak|OIDC-Client|v1";
    private const string ProvisioningEntropy = "DLE-OS|Keycloak|Provisioning-Client|v1";
    private static readonly string[] DevelopmentFrontendPrefixes =
    [
        "http://dle-os-host:5051",
        "http://192.168.0.105:5051",
        "https://dev.dle-os.internal.dlemfg.com:443",
        "https://auth.internal.dlemfg.com:443"
    ];

    internal static DleOsWindowsServiceBootstrapResult Apply(string[] arguments)
    {
        if (!arguments.Contains(ServiceSwitch, StringComparer.OrdinalIgnoreCase))
            return new(false, arguments);
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("DLE-OS Windows Service hosting requires Windows.");

        var configIndex = Array.FindIndex(arguments,
            value => value.Equals(ConfigurationSwitch, StringComparison.OrdinalIgnoreCase));
        if (configIndex < 0 || configIndex + 1 >= arguments.Length ||
            string.IsNullOrWhiteSpace(arguments[configIndex + 1]))
            throw new InvalidOperationException("The Windows Service requires --service-config <absolute-path>.");
        var configPath = Path.GetFullPath(arguments[configIndex + 1]);
        if (!Path.IsPathFullyQualified(configPath) || !File.Exists(configPath))
            throw new InvalidOperationException("The Windows Service configuration file is absent.");

        var configuration = JsonSerializer.Deserialize<DleOsWindowsServiceConfiguration>(
            File.ReadAllText(configPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("The Windows Service configuration is invalid.");
        if (!configuration.Environment.Equals("Development", StringComparison.Ordinal) ||
            !configuration.RequiredRuntimeIdentity.Equals(ServiceIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The Windows Service configuration is not the isolated DEV identity boundary.");
        if (!configuration.SyncOperationsApiBaseUrl.Equals(
                "http://DLE-OS-HOST:5056", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "The Windows Service Sync Operations boundary must be dedicated DEV port 5056.");
        if (!configuration.GovernedRefreshApiBaseUrl.Equals(
                "http://DLE-OS-HOST:5057", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "The Windows Service governed refresh boundary must be dedicated DEV port 5057.");
        if (!Path.GetFullPath(configuration.AuthenticationStateRoot)
                .Equals(AuthenticationStateRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The Windows Service authentication state root is not the isolated DEV boundary.");
        if (configuration.FrontendPrefixes.Length != DevelopmentFrontendPrefixes.Length ||
            configuration.FrontendPrefixes.Distinct(StringComparer.OrdinalIgnoreCase).Count() !=
                configuration.FrontendPrefixes.Length ||
            !configuration.FrontendPrefixes.ToHashSet(StringComparer.OrdinalIgnoreCase)
                .SetEquals(DevelopmentFrontendPrefixes))
            throw new InvalidOperationException("The Windows Service configuration does not contain the exact DEV HTTP.sys boundary.");
        if (!WindowsIdentity.GetCurrent().Name.Equals(ServiceIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"The Windows Service must run as {ServiceIdentity}.");

        var frontendContentRoot = Path.GetFullPath(configuration.FrontendContentRoot);
        var expectedFrontendContentRoot = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "frontend"));
        if (!frontendContentRoot.Equals(expectedFrontendContentRoot,
                StringComparison.OrdinalIgnoreCase) || !Directory.Exists(frontendContentRoot))
            throw new InvalidOperationException(
                "The Windows Service frontend content root must be the current immutable release snapshot.");

        EnsureDirectoryReadable(KittingShortageRoot);
        EnsureDirectoryReadable(KittingCompleteRoot);

        Set("DLE_OS_ENVIRONMENT", configuration.Environment);
        Set("DLE_OS_RUNTIME_MARKER", configuration.RuntimeMarker);
        Set("DLE_OS_ENVIRONMENT_LABEL", configuration.EnvironmentLabel);
        Set("DLE_OS_APPLICATION_ORIGIN", configuration.ApplicationOrigin);
        Set("DLE_OS_OIDC_CLIENT_ID", configuration.OidcClientId);
        Set("DLE_OS_AUTHENTICATION_STATE_ROOT", Path.GetFullPath(configuration.AuthenticationStateRoot));
        Set("DLE_OS_CANONICAL_API_BASE_URL", configuration.CanonicalApiBaseUrl);
        Set("DLE_OS_OPERATIONAL_API_BASE_URL", configuration.OperationalApiBaseUrl);
        Set("DLE_OS_SYNC_OPERATIONS_API_BASE_URL", configuration.SyncOperationsApiBaseUrl);
        Set("DLE_OS_GOVERNED_REFRESH_API_BASE_URL", configuration.GovernedRefreshApiBaseUrl);
        Set("DLE_OS_CUSTOMER_FILES_API_BASE_URL", configuration.CustomerFilesApiBaseUrl);
        Set("DLE_OS_SECURITY_DATABASE", configuration.SecurityDatabase);
        Set("DLE_OS_ENABLE_USER_PROVISIONING", configuration.EnableUserProvisioning.ToString());
        Set("DLE_OS_FRONTEND_PREFIXES", string.Join(';', configuration.FrontendPrefixes));
        Set("DLE_OS_FRONTEND_CONTENT_ROOT", frontendContentRoot);
        Set("DLE_OS_REQUIRED_RUNTIME_IDENTITY", configuration.RequiredRuntimeIdentity);
        Set("DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH",
            Path.GetFullPath(configuration.IdentitySigningPrivateKeyPath));
        Set("DLE_OS_OIDC_CLIENT_SECRET", Unprotect(configuration.OidcClientSecretPath, OidcEntropy));
        Set("DLE_OS_KEYCLOAK_PROVISIONING_CLIENT_SECRET",
            Unprotect(configuration.ProvisioningClientSecretPath, ProvisioningEntropy));

        var applicationArguments = arguments.Where((_, index) =>
            index != configIndex && index != configIndex + 1 &&
            !arguments[index].Equals(ServiceSwitch, StringComparison.OrdinalIgnoreCase)).ToArray();
        return new(true, applicationArguments);
    }

    private static void Set(string name, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Windows Service setting {name} is absent.");
        Environment.SetEnvironmentVariable(name, value, EnvironmentVariableTarget.Process);
    }

    private static void EnsureDirectoryReadable(string path)
    {
        if (!Directory.Exists(path))
            throw new InvalidOperationException($"The Windows Service cannot access required Kitting root {path}.");
        try
        {
            using var entries = Directory.EnumerateFileSystemEntries(path).GetEnumerator();
            _ = entries.MoveNext();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException(
                $"The Windows Service cannot enumerate required Kitting root {path}.", exception);
        }
    }

    private static string Unprotect(string path, string entropyText)
    {
        var protectedBytes = File.ReadAllBytes(Path.GetFullPath(path));
        var entropy = Encoding.UTF8.GetBytes(entropyText);
        byte[]? plain = null;
        try
        {
            plain = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.LocalMachine);
            var value = Encoding.UTF8.GetString(plain);
            if (value.Length < 32)
                throw new InvalidOperationException("A protected Windows Service secret is invalid.");
            return value;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(protectedBytes);
            CryptographicOperations.ZeroMemory(entropy);
            if (plain is not null) CryptographicOperations.ZeroMemory(plain);
        }
    }
}
