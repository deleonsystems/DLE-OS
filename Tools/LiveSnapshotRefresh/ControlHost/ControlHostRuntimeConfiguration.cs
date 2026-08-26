using Microsoft.Data.SqlClient;

internal static class ControlHostRuntimeConfiguration
{
    private const string ProductionOperationalConnection =
        @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;";

    internal static bool IsIsolatedDevelopment => string.Equals(
        Environment.GetEnvironmentVariable("DLE_OS_ISOLATED_DEVELOPMENT"),
        "true", StringComparison.OrdinalIgnoreCase);

    internal static string OperationalConnectionString =>
        Environment.GetEnvironmentVariable("DLE_OS_OPERATIONAL_CONNECTION_STRING") ??
        Environment.GetEnvironmentVariable("DLE_OS_WORK_ORDER_APPROVAL_CONNECTION_STRING") ??
        ProductionOperationalConnection;

    internal static string CanonicalApiBaseUrl =>
        Environment.GetEnvironmentVariable("DLE_OS_CANONICAL_API_BASE_URL") ??
        "http://DLE-OS-HOST:5042";

    internal static string ControlPrefix =>
        Environment.GetEnvironmentVariable("DLE_OS_CONTROL_PREFIX") ??
        "http://dle-os-host:5043";

    internal static string IdentityAssertionPublicKeyPath =>
        Environment.GetEnvironmentVariable("DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH") ??
        throw new InvalidOperationException(
            "The development identity assertion verification key is not configured.");

    internal static string SecurityConnectionString =>
        Environment.GetEnvironmentVariable("DLE_OS_SECURITY_CONNECTION_STRING") ??
        throw new InvalidOperationException(
            "The development security database is not configured.");

    internal static string SecurityDatabaseName =>
        new SqlConnectionStringBuilder(SecurityConnectionString).InitialCatalog;

    internal static string OperationalDatabaseName =>
        new SqlConnectionStringBuilder(OperationalConnectionString).InitialCatalog;

    internal static string KitShortageRoot =>
        Environment.GetEnvironmentVariable("DLE_OS_KIT_SHORTAGE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";

    internal static string KitCompleteRoot =>
        Environment.GetEnvironmentVariable("DLE_OS_KIT_COMPLETE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-COMPLETE";

    internal static string ShipmentStagingPath =>
        Environment.GetEnvironmentVariable("DLE_OS_SHIPMENT_STAGING_PATH") ??
        @"C:\DLE-OS\Repositories\DLE-OS\DATA\shipment-staging\shipment-staging.json";

    internal static string DevDataRoot =>
        Environment.GetEnvironmentVariable("DLE_OS_DEV_OPERATIONAL_DATA_ROOT") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "DLE-OS", "DevelopmentOperationalControl", "Data");
}
