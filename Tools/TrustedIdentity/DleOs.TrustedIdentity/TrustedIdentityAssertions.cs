using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DleOs.TrustedIdentity;

public static class TrustedIdentityContract
{
    public const string HeaderName = "X-DLE-OS-Identity-Assertion";
    public const string Issuer = "dle-os-development-frontend";
    public const string OperationalAudience = "dle-os-development-operational-api";
    public const string DevelopmentEnvironment = "DEVELOPMENT";
    public const string Algorithm = "ES256";
    public const string Type = "DLE-OS+JWT";
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan MaximumLifetime = TimeSpan.FromMinutes(5);
}

public sealed record TrustedDleOsUserContext(
    Guid UserId,
    string UserName,
    string DisplayName,
    IReadOnlyList<string> Roles,
    bool IsSuperAdmin,
    string Environment,
    Guid AssertionId,
    string CorrelationId,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt);

public sealed record IdentityAssertionIssueRequest(
    Guid UserId,
    string UserName,
    string DisplayName,
    IReadOnlyList<string> Roles,
    bool IsSuperAdmin,
    string Audience,
    string Environment,
    string CorrelationId);

public sealed record IdentityAssertionValidationResult(
    bool IsValid,
    string Code,
    TrustedDleOsUserContext? User)
{
    public static IdentityAssertionValidationResult Success(TrustedDleOsUserContext user) =>
        new(true, "OK", user);

    public static IdentityAssertionValidationResult Failure(string code) =>
        new(false, code, null);
}

public interface IIdentityAssertionIssuer
{
    string Issue(IdentityAssertionIssueRequest request, DateTimeOffset? now = null);
}

public interface IIdentityAssertionValidator
{
    IdentityAssertionValidationResult Validate(
        string? assertion,
        string expectedAudience,
        string expectedEnvironment,
        DateTimeOffset? now = null);
}

public sealed class Es256IdentityAssertionIssuer : IIdentityAssertionIssuer, IDisposable
{
    private readonly ECDsa key;
    private readonly string issuer;
    private readonly TimeSpan lifetime;
    private readonly string keyId;
    private readonly object signingGate = new();

    public Es256IdentityAssertionIssuer(
        ECDsa key,
        string issuer = TrustedIdentityContract.Issuer,
        TimeSpan? lifetime = null,
        string keyId = "development-v1")
    {
        this.key = key;
        this.issuer = RequireText(issuer, nameof(issuer));
        this.lifetime = lifetime ?? TrustedIdentityContract.DefaultLifetime;
        this.keyId = RequireText(keyId, nameof(keyId));
        if (this.lifetime <= TimeSpan.Zero || this.lifetime > TrustedIdentityContract.MaximumLifetime)
            throw new ArgumentOutOfRangeException(nameof(lifetime));
    }

    public string Issue(IdentityAssertionIssueRequest request, DateTimeOffset? now = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.UserId == Guid.Empty) throw new ArgumentException("UserId is required.", nameof(request));
        var issuedAt = (now ?? DateTimeOffset.UtcNow).ToUniversalTime();
        var expiresAt = issuedAt.Add(lifetime);
        var assertionId = Guid.NewGuid();
        var header = JsonSerializer.SerializeToUtf8Bytes(new
        {
            alg = TrustedIdentityContract.Algorithm,
            typ = TrustedIdentityContract.Type,
            kid = keyId
        });
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            sub = request.UserId.ToString("D"),
            usr = RequireText(request.UserName, nameof(request.UserName)),
            name = RequireText(request.DisplayName, nameof(request.DisplayName)),
            roles = request.Roles.Where(role => !string.IsNullOrWhiteSpace(role)).Distinct(StringComparer.Ordinal).ToArray(),
            super_admin = request.IsSuperAdmin,
            iss = issuer,
            aud = RequireText(request.Audience, nameof(request.Audience)),
            env = RequireText(request.Environment, nameof(request.Environment)),
            iat = issuedAt.ToUnixTimeSeconds(),
            exp = expiresAt.ToUnixTimeSeconds(),
            jti = assertionId.ToString("D"),
            cid = RequireText(request.CorrelationId, nameof(request.CorrelationId))
        });
        var unsigned = Base64Url(header) + "." + Base64Url(payload);
        byte[] signature;
        lock (signingGate)
        {
            signature = key.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        return unsigned + "." + Base64Url(signature);
    }

    public void Dispose() => key.Dispose();

    private static string RequireText(string? value, string name) =>
        string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{name} is required.", name) : value.Trim();

    internal static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed class Es256IdentityAssertionValidator : IIdentityAssertionValidator, IDisposable
{
    private readonly ECDsa key;
    private readonly string issuer;
    private readonly object verificationGate = new();

    public Es256IdentityAssertionValidator(ECDsa key, string issuer = TrustedIdentityContract.Issuer)
    {
        this.key = key;
        this.issuer = string.IsNullOrWhiteSpace(issuer)
            ? throw new ArgumentException("Issuer is required.", nameof(issuer))
            : issuer.Trim();
    }

    public IdentityAssertionValidationResult Validate(
        string? assertion,
        string expectedAudience,
        string expectedEnvironment,
        DateTimeOffset? now = null)
    {
        if (string.IsNullOrWhiteSpace(assertion))
            return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_MISSING");
        if (string.IsNullOrWhiteSpace(expectedAudience) || string.IsNullOrWhiteSpace(expectedEnvironment))
            throw new ArgumentException("Expected audience and environment are required.");

        var parts = assertion.Split('.');
        if (parts.Length != 3)
            return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
        try
        {
            using var header = JsonDocument.Parse(Decode(parts[0]));
            if (ReadString(header.RootElement, "alg") != TrustedIdentityContract.Algorithm ||
                ReadString(header.RootElement, "typ") != TrustedIdentityContract.Type)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");

            var signature = Decode(parts[2]);
            bool signatureValid;
            lock (verificationGate)
            {
                signatureValid = key.VerifyData(Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]),
                    signature, HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
            }
            if (!signatureValid)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");

            using var payload = JsonDocument.Parse(Decode(parts[1]));
            var root = payload.RootElement;
            if (ReadString(root, "iss") != issuer)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_WRONG_ISSUER");
            if (ReadString(root, "aud") != expectedAudience)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_WRONG_AUDIENCE");
            if (ReadString(root, "env") != expectedEnvironment)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_WRONG_ENVIRONMENT");

            var instant = (now ?? DateTimeOffset.UtcNow).ToUniversalTime();
            var issuedAt = DateTimeOffset.FromUnixTimeSeconds(ReadInt64(root, "iat"));
            var expiresAt = DateTimeOffset.FromUnixTimeSeconds(ReadInt64(root, "exp"));
            if (expiresAt <= instant)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_EXPIRED");
            if (issuedAt > instant.AddSeconds(30) || expiresAt <= issuedAt ||
                expiresAt - issuedAt > TrustedIdentityContract.MaximumLifetime)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");

            if (!Guid.TryParse(ReadString(root, "sub"), out var userId) || userId == Guid.Empty ||
                !Guid.TryParse(ReadString(root, "jti"), out var assertionId) || assertionId == Guid.Empty)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
            var userName = ReadString(root, "usr");
            var displayName = ReadString(root, "name");
            var correlationId = ReadString(root, "cid");
            if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(displayName) ||
                string.IsNullOrWhiteSpace(correlationId))
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
            if (!root.TryGetProperty("super_admin", out var superAdminElement) ||
                superAdminElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
            if (!root.TryGetProperty("roles", out var rolesElement) || rolesElement.ValueKind != JsonValueKind.Array)
                return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
            var roles = rolesElement.EnumerateArray().Select(value => value.GetString())
                .Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!).ToArray();

            return IdentityAssertionValidationResult.Success(new TrustedDleOsUserContext(
                userId, userName, displayName, roles, superAdminElement.GetBoolean(),
                expectedEnvironment, assertionId, correlationId, issuedAt, expiresAt));
        }
        catch (Exception error) when (error is FormatException or JsonException or InvalidOperationException or ArgumentOutOfRangeException)
        {
            return IdentityAssertionValidationResult.Failure("DLE_OS_IDENTITY_ASSERTION_INVALID");
        }
    }

    public void Dispose() => key.Dispose();

    private static string ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? "" : "";

    private static long ReadInt64(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt64(out var number)
            ? number : throw new InvalidOperationException($"Claim {property} is invalid.");

    private static byte[] Decode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch
        {
            2 => "==", 3 => "=", 0 => "", _ => throw new FormatException()
        };
        return Convert.FromBase64String(normalized);
    }
}

public static class IdentityAssertionKeyLoader
{
    public static ECDsa LoadPrivateKey(string path)
    {
        var key = ECDsa.Create();
        key.ImportFromPem(File.ReadAllText(RequireFile(path)));
        return key;
    }

    public static ECDsa LoadPublicKey(string path)
    {
        var key = ECDsa.Create();
        key.ImportFromPem(File.ReadAllText(RequireFile(path)));
        return key;
    }

    private static string RequireFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw new InvalidOperationException("The trusted identity key file is unavailable.");
        return Path.GetFullPath(path);
    }
}
