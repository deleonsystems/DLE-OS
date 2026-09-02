using Microsoft.Data.SqlClient;
using System.Security.Principal;

internal static class ControlHostRuntimeConfiguration
{
    private const string RequiredEnvironment = "Development";
    private const string RequiredPrefix = "http://dle-os-host:5056";
    private const string RequiredSecurityDatabase = "DLE_OS_SECURITY_DEV";
    private const string RequiredRuntimeIdentity = @"DLE-OS-HOST\DLE-OS";

    internal static bool IsIsolatedDevelopment => true;

    internal static string ControlPrefix =>
        Environment.GetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_CONTROL_PREFIX")?.TrimEnd('/') ??
        RequiredPrefix;

    internal static string IdentityAssertionPublicKeyPath => Required(
        "DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH");

    internal static string SecurityConnectionString => Required(
        "DLE_OS_SECURITY_CONNECTION_STRING");

    internal static string SecurityDatabaseName =>
        new SqlConnectionStringBuilder(SecurityConnectionString).InitialCatalog;

    internal static string ReleaseId => Required("DLE_OS_RELEASE_ID");

    internal static bool ExecutionEnabled => string.Equals(
        Environment.GetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_EXECUTION_MODE"),
        "APPROVED_LIVE_RUN", StringComparison.Ordinal);

    internal static bool RunWorkerPreflight => string.Equals(
        Environment.GetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_RUN_WORKER_PREFLIGHT"),
        "true", StringComparison.OrdinalIgnoreCase);

    internal static string WorkerPreflightEvidencePath =>
        Environment.GetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_WORKER_PREFLIGHT_EVIDENCE") ??
        @"C:\ProgramData\DLE-OS\SyncOperationsControl\Qualification\worker-identity.json";

    internal static void ValidateBoundary()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("DLE_OS_ENVIRONMENT"),
                RequiredEnvironment, StringComparison.Ordinal))
            throw new InvalidOperationException(
                "The dedicated Sync Operations host requires DLE_OS_ENVIRONMENT=Development.");

        if (!string.Equals(ControlPrefix, RequiredPrefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"The dedicated Sync Operations host must bind only {RequiredPrefix}.");

        var security = new SqlConnectionStringBuilder(SecurityConnectionString);
        if (!string.Equals(security.InitialCatalog, RequiredSecurityDatabase,
                StringComparison.Ordinal) ||
            security.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "The dedicated Sync Operations security boundary must be DLE_OS_SECURITY_DEV.");

        var identity = WindowsIdentity.GetCurrent().Name;
        if (!string.Equals(identity, RequiredRuntimeIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"The dedicated Sync Operations host requires {RequiredRuntimeIdentity}; actual identity is {identity}.");

        if (!File.Exists(IdentityAssertionPublicKeyPath))
            throw new InvalidOperationException(
                "The trusted DEV assertion public key is unavailable.");
    }

    private static string Required(string name)
    {
        var value = Environment.GetEnvironmentVariable(name)?.Trim();
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required runtime setting {name} is absent.")
            : value;
    }
}
