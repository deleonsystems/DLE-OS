using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DleOs.TrustedIdentity;

var checks = new List<string>();
void Check(bool condition, string label)
{
    if (!condition) throw new InvalidOperationException("FAIL: " + label);
    checks.Add(label);
}

var now = new DateTimeOffset(2026, 8, 6, 22, 0, 0, TimeSpan.Zero);
var userId = Guid.Parse("7cceaf7a-191a-452a-95ff-f9ab636ec5c4");
using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using var verificationKey = ECDsa.Create(signingKey.ExportParameters(false));
using var issuer = new Es256IdentityAssertionIssuer(signingKey, lifetime: TimeSpan.FromMinutes(2));
using var validator = new Es256IdentityAssertionValidator(verificationKey);
var request = new IdentityAssertionIssueRequest(userId, "Miguel", "Miguel De Leon",
    ["SUPER_ADMIN"], true, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, "phase4-correlation");
var token = issuer.Issue(request, now);
var valid = validator.Validate(token, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now.AddSeconds(10));

Check(valid.IsValid && valid.User is not null, "valid Miguel assertion passes");
Check(valid.User!.UserId == userId, "immutable UserId is the downstream subject");
Check(valid.User.UserName == "Miguel" && valid.User.DisplayName == "Miguel De Leon",
    "trusted downstream actor is Miguel");
Check(valid.User.IsSuperAdmin && valid.User.Roles.SequenceEqual(["SUPER_ADMIN"]),
    "signed SUPER_ADMIN fact and role are preserved");
Check(valid.User.Environment == "DEVELOPMENT", "DEVELOPMENT environment is preserved");
Check(valid.User.CorrelationId == "phase4-correlation", "correlation is bound to the assertion");
Check(valid.User.ExpiresAt - valid.User.IssuedAt == TimeSpan.FromMinutes(2),
    "assertion lifetime is two minutes");
Check(valid.User.AssertionId != Guid.Empty, "assertion has a unique JTI");
var second = validator.Validate(issuer.Issue(request, now), TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now);
Check(second.User!.AssertionId != valid.User.AssertionId, "each downstream call receives a fresh JTI");
Check(!token.Contains("DLE-OS-HOST", StringComparison.OrdinalIgnoreCase),
    "assertion excludes Windows identity and groups");

Check(validator.Validate(null, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code ==
    "DLE_OS_IDENTITY_ASSERTION_MISSING", "missing assertion is denied distinctly");
Check(validator.Validate("not-a-token", TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code ==
    "DLE_OS_IDENTITY_ASSERTION_INVALID", "malformed assertion is denied");

var parts = token.Split('.');
var payload = JsonDocument.Parse(Decode(parts[1])).RootElement;
var modifiedPayload = JsonSerializer.SerializeToUtf8Bytes(new
{
    sub = payload.GetProperty("sub").GetString(), usr = "Other", name = "Other User",
    roles = new[] { "SUPER_ADMIN" }, super_admin = true,
    iss = payload.GetProperty("iss").GetString(), aud = payload.GetProperty("aud").GetString(),
    env = payload.GetProperty("env").GetString(), iat = payload.GetProperty("iat").GetInt64(),
    exp = payload.GetProperty("exp").GetInt64(), jti = payload.GetProperty("jti").GetString(),
    cid = payload.GetProperty("cid").GetString()
});
var modified = parts[0] + "." + Encode(modifiedPayload) + "." + parts[2];
Check(validator.Validate(modified, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code ==
    "DLE_OS_IDENTITY_ASSERTION_INVALID", "modified payload is denied by signature validation");

var forgedParts = token.Split('.');
forgedParts[2] = Encode(RandomNumberGenerator.GetBytes(64));
Check(validator.Validate(string.Join('.', forgedParts), TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code ==
    "DLE_OS_IDENTITY_ASSERTION_INVALID", "forged signature is denied");
Check(validator.Validate(token, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now.AddMinutes(3)).Code ==
    "DLE_OS_IDENTITY_ASSERTION_EXPIRED", "expired assertion is denied");
Check(validator.Validate(token, "another-audience", TrustedIdentityContract.DevelopmentEnvironment,
    now).Code == "DLE_OS_IDENTITY_WRONG_AUDIENCE", "wrong audience is denied");
Check(validator.Validate(token, TrustedIdentityContract.OperationalAudience, "PRODUCTION", now).Code ==
    "DLE_OS_IDENTITY_WRONG_ENVIRONMENT", "wrong environment is denied");

using var otherIssuerKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using var otherIssuer = new Es256IdentityAssertionIssuer(otherIssuerKey, "not-the-development-issuer");
using var otherIssuerPublic = ECDsa.Create(otherIssuerKey.ExportParameters(false));
using var otherIssuerValidator = new Es256IdentityAssertionValidator(otherIssuerPublic);
var wrongIssuerToken = otherIssuer.Issue(request, now);
Check(otherIssuerValidator.Validate(wrongIssuerToken, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code == "DLE_OS_IDENTITY_WRONG_ISSUER",
    "wrong issuer is denied");

using var unrelatedKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using var unrelatedValidator = new Es256IdentityAssertionValidator(unrelatedKey);
Check(unrelatedValidator.Validate(token, TrustedIdentityContract.OperationalAudience,
    TrustedIdentityContract.DevelopmentEnvironment, now).Code ==
    "DLE_OS_IDENTITY_ASSERTION_INVALID", "token signed by an untrusted key is denied");

var lifetimeRejected = false;
try { using var invalidIssuer = new Es256IdentityAssertionIssuer(
    ECDsa.Create(ECCurve.NamedCurves.nistP256), lifetime: TimeSpan.FromMinutes(6)); }
catch (ArgumentOutOfRangeException) { lifetimeRejected = true; }
Check(lifetimeRejected, "issuer rejects assertions longer than five minutes");

var repository = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
    "..", "..", "..", "..", ".."));
var proxySource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DevelopmentCompatibilityProxy.cs"));
var downstreamSource = File.ReadAllText(Path.Combine(repository, "Tools", "LiveSnapshotRefresh",
    "ControlHost", "TrustedDevelopmentIdentity.cs"));
var controlHostProgram = File.ReadAllText(Path.Combine(repository, "Tools", "LiveSnapshotRefresh",
    "ControlHost", "Program.cs"));
Check(proxySource.Contains("current.User.UserId") && proxySource.Contains("current.User.IsSuperAdmin"),
    "5051 assertion facts originate in the resolved Phase 2 user");
Check(proxySource.Contains("TrustedIdentityContract.DevelopmentEnvironment") &&
      !proxySource.Contains("runtime.RuntimeMarker,\n                correlationId"),
    "5051 signs the canonical DEVELOPMENT environment rather than the display runtime marker");
Check(!proxySource.Contains("context.Request.Headers[TrustedIdentityContract.HeaderName]"),
    "5051 never accepts a browser assertion as its issuing source");
Check(downstreamSource.Contains("DLE_OS_IDENTITY_CALLER_NOT_TRUSTED") &&
      downstreamSource.Contains("ServiceIdentity") &&
      downstreamSource.Contains(@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND") &&
      !downstreamSource.Contains(
          "private const string ServiceIdentity = @\"DLE-OS-HOST\\DLE-OS\""),
    "downstream requires the approved OS service caller separately");
Check(controlHostProgram.Contains("authorizedServiceCallers.Contains") &&
      controlHostProgram.Contains(@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND") &&
      controlHostProgram.Contains("authorizedOperator"),
    "outer policy admits only the governed control and DEV frontend service callers");
Check(downstreamSource.Contains("DLE_OS_IDENTITY_ASSERTION_REPLAYED") &&
      downstreamSource.Contains("TryConsume"), "controlled writes have one-time JTI replay defense");
Check(downstreamSource.Contains("actorUserId") && downstreamSource.Contains("executionIdentity"),
    "audit fixture separates application actor from execution identity");

var output = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    count = checks.Count,
    checks
};
var outputPath = Path.Combine(repository, ".tmp", "trusted-identity", "phase4-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
File.WriteAllText(outputPath, JsonSerializer.Serialize(output,
    new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} trusted downstream identity checks.");

static byte[] Decode(string value)
{
    var normalized = value.Replace('-', '+').Replace('_', '/');
    normalized += (normalized.Length % 4) switch { 2 => "==", 3 => "=", 0 => "", _ => throw new FormatException() };
    return Convert.FromBase64String(normalized);
}

static string Encode(byte[] value) => Convert.ToBase64String(value).TrimEnd('=')
    .Replace('+', '-').Replace('/', '_');
