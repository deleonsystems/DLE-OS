using Microsoft.Data.SqlClient;

internal static class ControlHostRuntimeConfiguration
{
    private const string OperationalDatabase = "DLE_OS_OPERATIONAL_DEV";
    private const string SecurityDatabase = "DLE_OS_SECURITY_DEV";
    private const string CanonicalEndpoint = "http://DLE-OS-HOST:5052";

    internal static bool IsIsolatedDevelopment => true;
    internal const string ControlPrefix = "http://dle-os-host:5054";
    internal const string CanonicalApiBaseUrl = CanonicalEndpoint;

    internal static string OperationalConnectionString =>
        @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_OPERATIONAL_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;";

    internal static string SecurityConnectionString =>
        @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadOnly;";

    internal static string IdentityAssertionPublicKeyPath =>
        @"C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem";

    internal static string OperationalDatabaseName => OperationalDatabase;
    internal static string SecurityDatabaseName => SecurityDatabase;

    internal static string DevDataRoot =>
        @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data";

    internal static string KitShortageRoot =>
        Path.Combine(DevDataRoot, "Kitting", "KIT-SHORTAGES");

    internal static string KitCompleteRoot =>
        Path.Combine(DevDataRoot, "Kitting", "KIT-COMPLETE");

    internal static string ShipmentStagingPath =>
        Path.Combine(DevDataRoot, "ShipmentStaging", "shipment-staging.json");

    internal static void ValidateBoundary()
    {
        ValidateDatabase(OperationalConnectionString, OperationalDatabase, readOnly: false);
        ValidateDatabase(SecurityConnectionString, SecurityDatabase, readOnly: true);

        if (!Uri.TryCreate(CanonicalApiBaseUrl, UriKind.Absolute, out var canonical) ||
            !string.Equals(canonical.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(canonical.Host, "DLE-OS-HOST", StringComparison.OrdinalIgnoreCase) ||
            canonical.Port != 5052 || canonical.AbsolutePath != "/")
            throw new InvalidOperationException("The DEV canonical dependency must be exactly DLE-OS-HOST:5052.");

        var fullDataRoot = Path.GetFullPath(DevDataRoot) + Path.DirectorySeparatorChar;
        foreach (var path in new[] { KitShortageRoot, KitCompleteRoot, ShipmentStagingPath })
            if (!Path.GetFullPath(path).StartsWith(fullDataRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("A DEV operational file target escaped its governed data root.");
    }

    private static void ValidateDatabase(string connectionString, string expectedDatabase, bool readOnly)
    {
        var value = new SqlConnectionStringBuilder(connectionString);
        if (!string.Equals(value.DataSource, @"lpc:.\SQLEXPRESS", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(value.InitialCatalog, expectedDatabase, StringComparison.Ordinal) ||
            !value.IntegratedSecurity || value.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase) ||
            (readOnly && value.ApplicationIntent != ApplicationIntent.ReadOnly))
            throw new InvalidOperationException($"The {expectedDatabase} boundary is invalid.");
    }
}
