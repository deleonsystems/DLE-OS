using Microsoft.Data.SqlClient;
using System.Security.Principal;

internal static class ControlHostRuntimeConfiguration
{
    private const string RequiredPrefix = "http://dle-os-host:5057";
    private const string RequiredIdentity = @"DLE-OS-HOST\DLE-OS";

    internal static string ControlPrefix =>
        Environment.GetEnvironmentVariable("DLE_OS_GOVERNED_REFRESH_CONTROL_PREFIX")?.TrimEnd('/') ?? RequiredPrefix;
    internal static string ReleaseId => Required("DLE_OS_RELEASE_ID");
    internal static string IdentityAssertionPublicKeyPath => Required("DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH");
    internal static string SecurityConnectionString => Required("DLE_OS_SECURITY_CONNECTION_STRING");
    internal static string ExecutionMode =>
        Environment.GetEnvironmentVariable("DLE_OS_INVOICE_HISTORY_EXECUTION_MODE") ??
        "DISABLED_FOR_STANDALONE_QUALIFICATION";
    internal static bool FailureQualificationEnabled => string.Equals(
        ExecutionMode, "APPROVED_FAILURE_PRESERVATION_QUALIFICATION", StringComparison.Ordinal);
    internal static bool LiveApprovalQualificationEnabled => string.Equals(
        ExecutionMode, "APPROVED_ONE_RUN_GATE_QUALIFICATION", StringComparison.Ordinal);
    internal static bool RunWorkerPreflight => string.Equals(
        Environment.GetEnvironmentVariable("DLE_OS_INVOICE_HISTORY_RUN_WORKER_PREFLIGHT"),
        "true", StringComparison.OrdinalIgnoreCase);
    internal static string WorkerPreflightEvidencePath =>
        Environment.GetEnvironmentVariable("DLE_OS_INVOICE_HISTORY_WORKER_PREFLIGHT_EVIDENCE") ??
        @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\worker-identity.json";

    internal static void ValidateBoundary()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("DLE_OS_ENVIRONMENT"),
                "Development", StringComparison.Ordinal))
            throw new InvalidOperationException("The governed refresh host requires DLE_OS_ENVIRONMENT=Development.");
        if (!string.Equals(ControlPrefix, RequiredPrefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"The governed refresh host must bind only {RequiredPrefix}.");
        var security = new SqlConnectionStringBuilder(SecurityConnectionString);
        if (!string.Equals(security.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
            security.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(security.ApplicationIntent.ToString(), "ReadOnly", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The governed refresh security boundary must be read-only DLE_OS_SECURITY_DEV.");
        var identity = WindowsIdentity.GetCurrent().Name;
        if (!string.Equals(identity, RequiredIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"The governed refresh host requires {RequiredIdentity}; actual identity is {identity}.");
        if (!File.Exists(IdentityAssertionPublicKeyPath))
            throw new InvalidOperationException("The trusted DEV assertion public key is unavailable.");
        if (ExecutionMode is not "DISABLED_FOR_STANDALONE_QUALIFICATION" and
            not "APPROVED_FAILURE_PRESERVATION_QUALIFICATION" and
            not "APPROVED_ONE_RUN_GATE_QUALIFICATION")
            throw new InvalidOperationException("The governed refresh execution mode was rejected.");
    }

    private static string Required(string name)
    {
        var value = Environment.GetEnvironmentVariable(name)?.Trim();
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required runtime setting {name} is absent.") : value;
    }
}
