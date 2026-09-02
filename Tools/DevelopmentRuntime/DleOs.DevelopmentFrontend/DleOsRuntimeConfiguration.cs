public sealed record DleOsRuntimeConfiguration(
    string Environment, string RuntimeMarker, string DisplayLabel,
    string ApplicationOrigin, string OidcClientId, string AuthenticationStateRoot,
    string CanonicalApiBaseUrl, string OperationalApiBaseUrl,
    string SyncOperationsApiBaseUrl,
    string GovernedRefreshApiBaseUrl,
    string CustomerFilesApiBaseUrl, string SecurityDatabase,
    bool EnableUserProvisioning, string[] FrontendPrefixes)
{
    public static DleOsRuntimeConfiguration Load()
    {
        static string Required(string name)
        {
            var value = System.Environment.GetEnvironmentVariable(name)?.Trim();
            return string.IsNullOrWhiteSpace(value)
                ? throw new InvalidOperationException($"Required explicit runtime setting {name} is absent.")
                : value;
        }

        var environment = Required("DLE_OS_ENVIRONMENT");
        if (environment is not ("Development" or "Production" or "Staging"))
            throw new InvalidOperationException("DLE_OS_ENVIRONMENT must be Development, Production, or Staging.");
        var canonical = Required("DLE_OS_CANONICAL_API_BASE_URL");
        var operational = Required("DLE_OS_OPERATIONAL_API_BASE_URL");
        var syncOperations = environment == "Development"
            ? Required("DLE_OS_SYNC_OPERATIONS_API_BASE_URL")
            : operational;
        var governedRefresh = environment == "Development"
            ? Required("DLE_OS_GOVERNED_REFRESH_API_BASE_URL")
            : operational;
        var securityDatabase = Required("DLE_OS_SECURITY_DATABASE");
        var enableUserProvisioning =
            bool.TryParse(System.Environment.GetEnvironmentVariable("DLE_OS_ENABLE_USER_PROVISIONING"),
                out var enabled) && enabled;
        if (enableUserProvisioning && environment != "Development")
            throw new InvalidOperationException(
                "DLE-OS user provisioning can be enabled only in the Development environment.");
        var prefixes = Required("DLE_OS_FRONTEND_PREFIXES")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (prefixes.Distinct(StringComparer.OrdinalIgnoreCase).Count() != prefixes.Length)
            throw new InvalidOperationException("DLE_OS_FRONTEND_PREFIXES contains a duplicate HTTP.sys prefix.");

        if (environment == "Development" &&
            (!canonical.EndsWith(":5052", StringComparison.OrdinalIgnoreCase) ||
             !operational.EndsWith(":5054", StringComparison.OrdinalIgnoreCase) ||
             !syncOperations.EndsWith(":5056", StringComparison.OrdinalIgnoreCase) ||
             !governedRefresh.EndsWith(":5057", StringComparison.OrdinalIgnoreCase) ||
             canonical.Contains(":5042", StringComparison.OrdinalIgnoreCase) ||
             operational.Contains(":5043", StringComparison.OrdinalIgnoreCase) ||
             syncOperations.Contains(":5054", StringComparison.OrdinalIgnoreCase) ||
             governedRefresh.Contains(":5054", StringComparison.OrdinalIgnoreCase) ||
             governedRefresh.Contains(":5056", StringComparison.OrdinalIgnoreCase) ||
             securityDatabase.Contains("LIVE", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException(
                "Development isolation requires 5052, protected 5054, dedicated Sync Operations 5056, governed refresh 5057, and a non-LIVE security database.");
        var authenticationStateRoot = Path.GetFullPath(Required("DLE_OS_AUTHENTICATION_STATE_ROOT"));
        if (environment == "Development" &&
            !authenticationStateRoot.Equals(DleOsWindowsServiceBootstrap.AuthenticationStateRoot,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Development authentication state must use the isolated DEV storage root.");
        if (environment == "Production" &&
            (!canonical.EndsWith(":5042", StringComparison.OrdinalIgnoreCase) ||
             !operational.EndsWith(":5043", StringComparison.OrdinalIgnoreCase) ||
             canonical.Contains(":5052", StringComparison.OrdinalIgnoreCase) ||
             operational.Contains(":5054", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Production isolation requires 5042 and 5043.");

        return new(environment, Required("DLE_OS_RUNTIME_MARKER"),
            Required("DLE_OS_ENVIRONMENT_LABEL"), Required("DLE_OS_APPLICATION_ORIGIN").TrimEnd('/'),
            Required("DLE_OS_OIDC_CLIENT_ID"), authenticationStateRoot,
            canonical.TrimEnd('/'), operational.TrimEnd('/'), syncOperations.TrimEnd('/'),
            governedRefresh.TrimEnd('/'),
            Required("DLE_OS_CUSTOMER_FILES_API_BASE_URL").TrimEnd('/'), securityDatabase,
            enableUserProvisioning,
            prefixes);
    }
}
