using System.Collections;
using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

internal sealed record SimRuntimeOptions(
    string RepositoryRoot,
    string StateRoot,
    int Port,
    bool LanMode,
    IPAddress BindAddress,
    string? LanHostName,
    string? CertificateThumbprint,
    string? AccessCode)
{
    internal const int DefaultPort = 5177;
    internal const string EnvironmentMarker = "SIMULATION";
    internal const string EnvironmentLabel = "DLE-OS SIM — SYNTHETIC DATA";

    private static readonly HashSet<int> GovernedPorts = [5051, 5052, 5053, 5054, 5055, 5056, 5057];

    private static readonly string[] ProhibitedEnvironmentVariables =
    [
        "ASPNETCORE_URLS",
        "DOTNET_URLS",
        "DLE_OS_ENVIRONMENT",
        "DLE_OS_REPOSITORY_ROOT",
        "DLE_OS_CANONICAL_API_BASE_URL",
        "DLE_OS_OPERATIONAL_API_BASE_URL",
        "DLE_OS_SYNC_OPERATIONS_API_BASE_URL",
        "DLE_OS_GOVERNED_REFRESH_API_BASE_URL",
        "DLE_OS_CUSTOMER_FILES_API_BASE_URL",
        "DLE_OS_SECURITY_DATABASE",
        "DLE_OS_SECURITY_CONNECTION_STRING",
        "DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH",
        "DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH",
        "DLE_OS_OIDC_CLIENT_SECRET",
        "DLE_OS_KEYCLOAK_PROVISIONING_CLIENT_SECRET",
        "DLE_OS_REQUIRED_RUNTIME_IDENTITY",
        "DLE_OS_SYNC_OPERATIONS_EXECUTION_MODE",
        "DLE_OS_INVOICE_HISTORY_EXECUTION_MODE"
    ];

    internal static SimRuntimeOptions Create(string[] args, IDictionary environment, string currentDirectory)
    {
        if (args.Length != 0)
            throw new InvalidOperationException(
                "DLE-OS SIM Phase 2 does not accept command-line hosting or downstream configuration.");

        foreach (var name in ProhibitedEnvironmentVariables)
        {
            if (!string.IsNullOrWhiteSpace(Convert.ToString(environment[name])))
                throw new InvalidOperationException(
                    $"DLE-OS SIM rejected prohibited runtime configuration {name}.");
        }

        var portText = Convert.ToString(environment["DLE_OS_SIM_PORT"]);
        var port = string.IsNullOrWhiteSpace(portText)
            ? DefaultPort
            : int.TryParse(portText, out var parsed) && parsed is >= 1024 and <= 65535
                ? parsed
                : throw new InvalidOperationException(
                    "DLE_OS_SIM_PORT must be an integer from 1024 through 65535.");
        if (GovernedPorts.Contains(port))
            throw new InvalidOperationException(
                $"DLE-OS SIM may not bind governed DLE-OS port {port}.");

        var lanMode = ParseBoolean(environment, "DLE_OS_SIM_LAN_MODE");
        var lanAddressText = Convert.ToString(environment["DLE_OS_SIM_LAN_ADDRESS"]);
        var lanHostName = Convert.ToString(environment["DLE_OS_SIM_LAN_HOSTNAME"]);
        var certificateThumbprint = Convert.ToString(environment["DLE_OS_SIM_CERTIFICATE_THUMBPRINT"]);
        var accessCode = Convert.ToString(environment["DLE_OS_SIM_ACCESS_CODE"]);
        var bindAddress = IPAddress.Loopback;

        if (lanMode)
        {
            if (!IPAddress.TryParse(lanAddressText, out bindAddress) ||
                bindAddress.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                throw new InvalidOperationException(
                    "LAN mode requires an explicit IPv4 DLE_OS_SIM_LAN_ADDRESS.");
            if (!IsPrivateIpv4(bindAddress) || IPAddress.IsLoopback(bindAddress))
                throw new InvalidOperationException(
                    "LAN mode rejects loopback, public, unspecified, multicast, and non-private addresses.");
            if (!IsAssignedLocalAddress(bindAddress))
                throw new InvalidOperationException(
                    $"LAN address {bindAddress} is not assigned to an active local interface.");
            if (string.IsNullOrWhiteSpace(lanHostName) ||
                !Uri.CheckHostName(lanHostName).Equals(UriHostNameType.Dns))
                throw new InvalidOperationException(
                    "LAN mode requires an explicit DNS hostname in DLE_OS_SIM_LAN_HOSTNAME.");
            lanHostName = lanHostName.Trim().TrimEnd('.').ToLowerInvariant();
            if (IPAddress.TryParse(lanHostName, out _) || lanHostName is "localhost")
                throw new InvalidOperationException("LAN mode requires a non-IP, non-localhost DNS hostname.");
            certificateThumbprint = NormalizeThumbprint(certificateThumbprint);
            if (string.IsNullOrWhiteSpace(accessCode) || accessCode.Length is < 5 or > 64 ||
                accessCode.Any(char.IsWhiteSpace))
                throw new InvalidOperationException(
                    "LAN mode requires a 5-64 character, whitespace-free access code.");
        }
        else if (!string.IsNullOrWhiteSpace(lanAddressText) ||
                 !string.IsNullOrWhiteSpace(lanHostName) ||
                 !string.IsNullOrWhiteSpace(certificateThumbprint) ||
                 !string.IsNullOrWhiteSpace(accessCode))
        {
            throw new InvalidOperationException(
                "LAN settings are rejected unless DLE_OS_SIM_LAN_MODE is explicitly enabled.");
        }

        var repositoryRoot = FindRepositoryRoot(currentDirectory);
        if (IsNetworkPath(repositoryRoot))
            throw new InvalidOperationException(
                "DLE-OS SIM must not run from a UNC or network repository path.");
        var stateRoot = Path.GetFullPath(Path.Combine(repositoryRoot, ".sim-state"));
        EnsureDescendant(repositoryRoot, stateRoot);

        return new(repositoryRoot, stateRoot, port, lanMode, bindAddress,
            lanHostName, certificateThumbprint, accessCode);
    }

    internal string ApplicationOrigin => LanMode
        ? $"https://{LanHostName}:{Port}"
        : $"http://127.0.0.1:{Port}";

    internal X509Certificate2 LoadLanCertificate()
    {
        if (!LanMode || string.IsNullOrWhiteSpace(CertificateThumbprint) ||
            string.IsNullOrWhiteSpace(LanHostName))
            throw new InvalidOperationException("A LAN certificate is not configured.");

        var matches = new List<X509Certificate2>();
        foreach (var location in new[] { StoreLocation.LocalMachine, StoreLocation.CurrentUser })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
            matches.AddRange(store.Certificates.Find(
                X509FindType.FindByThumbprint, CertificateThumbprint, validOnly: false));
        }
        if (matches.Count != 1)
            throw new InvalidOperationException(
                "The configured LAN certificate was not found uniquely in LocalMachine\\My or CurrentUser\\My.");
        var certificate = matches[0];
        var now = DateTimeOffset.UtcNow;
        if (!certificate.HasPrivateKey || now < certificate.NotBefore || now >= certificate.NotAfter)
            throw new InvalidOperationException(
                "The configured LAN certificate must be current and have an accessible private key.");
        if (!certificate.MatchesHostname(LanHostName, allowWildcards: false, allowCommonName: false))
            throw new InvalidOperationException(
                $"The configured LAN certificate SAN does not contain {LanHostName}.");
        EnsurePrivateKeyAccessible(certificate);
        return certificate;
    }

    private static void EnsurePrivateKeyAccessible(X509Certificate2 certificate)
    {
        try
        {
            var digest = SHA256.HashData("DLE-OS SIM LAN certificate access check"u8);
            using var rsa = certificate.GetRSAPrivateKey();
            if (rsa is not null)
            {
                _ = rsa.SignHash(digest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                return;
            }
            using var ecdsa = certificate.GetECDsaPrivateKey();
            if (ecdsa is not null)
            {
                _ = ecdsa.SignHash(digest);
                return;
            }
            throw new CryptographicException("The certificate key algorithm is unsupported.");
        }
        catch (CryptographicException exception)
        {
            throw new InvalidOperationException(
                "The configured LAN certificate private key is not readable by this developer account.",
                exception);
        }
    }

    private static bool ParseBoolean(IDictionary environment, string name)
    {
        var value = Convert.ToString(environment[name]);
        if (string.IsNullOrWhiteSpace(value)) return false;
        return bool.TryParse(value, out var parsed) && parsed
            ? true
            : throw new InvalidOperationException($"{name} must be true when supplied.");
    }

    private static string NormalizeThumbprint(string? value)
    {
        var normalized = (value ?? string.Empty).Replace(" ", string.Empty).ToUpperInvariant();
        if (normalized.Length is < 40 or > 128 || normalized.Any(character => !Uri.IsHexDigit(character)))
            throw new InvalidOperationException(
                "LAN mode requires a valid certificate thumbprint in DLE_OS_SIM_CERTIFICATE_THUMBPRINT.");
        return normalized;
    }

    internal static bool IsPrivateIpv4(IPAddress address)
    {
        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
        var bytes = address.GetAddressBytes();
        return bytes[0] == 10 ||
               bytes[0] == 172 && bytes[1] is >= 16 and <= 31 ||
               bytes[0] == 192 && bytes[1] == 168;
    }

    private static bool IsAssignedLocalAddress(IPAddress address) =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(network => network.OperationalStatus == OperationalStatus.Up)
            .SelectMany(network => network.GetIPProperties().UnicastAddresses)
            .Any(unicast => unicast.Address.Equals(address));

    internal static void EnsureDescendant(string root, string candidate)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        var normalizedCandidate = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        if (!normalizedCandidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("DLE-OS SIM state escaped the repository-local state root.");
    }

    internal static string ResolveStatePath(string stateRoot, params string[] segments)
    {
        var candidate = Path.GetFullPath(Path.Combine([stateRoot, .. segments]));
        EnsureDescendant(stateRoot, candidate);
        if (IsNetworkPath(candidate))
            throw new InvalidOperationException("DLE-OS SIM state must not use a UNC or network path.");
        return candidate;
    }

    internal static bool IsNetworkPath(string path) =>
        path.StartsWith(@"\\", StringComparison.Ordinal) ||
        Uri.TryCreate(Path.GetFullPath(path), UriKind.Absolute, out var uri) && uri.IsUnc;

    private static string FindRepositoryRoot(string start)
    {
        var directory = new DirectoryInfo(Path.GetFullPath(start));
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "DLE_Work_Center_v4.0.0.html")) &&
                Directory.Exists(Path.Combine(directory.FullName, "SRC")))
                return directory.FullName;
            directory = directory.Parent;
        }

        throw new InvalidOperationException(
            "DLE-OS SIM must start from within a DLE-OS repository clone.");
    }
}
