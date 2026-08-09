using DleOs.Security;
using Microsoft.Data.SqlClient;
using System.Security.Claims;

public enum CurrentUserStatus
{
    Unauthenticated,
    NotProvisioned,
    PendingAuthentication,
    Disabled,
    SecurityUnavailable,
    Active
}

public sealed record CurrentUserResolution(
    CurrentUserStatus Status,
    string? ExternalSubject,
    ResolvedSecurityUser? User);

public interface ICurrentUserContext
{
    Task<CurrentUserResolution> ResolveAsync(CancellationToken cancellationToken = default);
}

public sealed class CurrentUserContext(
    IHttpContextAccessor httpContextAccessor,
    IIdentityResolver identityResolver) : ICurrentUserContext
{
    private Task<CurrentUserResolution>? resolution;

    public Task<CurrentUserResolution> ResolveAsync(CancellationToken cancellationToken = default) =>
        resolution ??= ResolveCoreAsync(cancellationToken);

    private async Task<CurrentUserResolution> ResolveCoreAsync(CancellationToken cancellationToken)
    {
        var principal = httpContextAccessor.HttpContext?.User;
        var oidcIdentity = principal?.Identities.FirstOrDefault(identity =>
            identity.IsAuthenticated &&
            identity.HasClaim(claim => string.Equals(claim.Type, "sub", StringComparison.Ordinal) &&
                                       !string.IsNullOrWhiteSpace(claim.Value)));
        var provider = "WINDOWS";
        var subject = principal?.Identity?.Name;
        if (oidcIdentity is not null)
        {
            provider = "KEYCLOAK";
            subject = oidcIdentity.FindFirst("sub")?.Value;
        }
        if (string.IsNullOrWhiteSpace(subject))
            return new(CurrentUserStatus.Unauthenticated, null, null);

        try
        {
            var user = await identityResolver.ResolveAsync(provider, subject, cancellationToken);
            if (user is null)
                return new(CurrentUserStatus.NotProvisioned, subject, null);
            if (string.Equals(user.AccountStatus, "PENDING", StringComparison.Ordinal))
                return new(CurrentUserStatus.PendingAuthentication, subject, user);
            if (!user.IsActive)
                return new(CurrentUserStatus.Disabled, subject, user);
            return new(CurrentUserStatus.Active, subject, user);
        }
        catch (SqlException)
        {
            return new(CurrentUserStatus.SecurityUnavailable, subject, null);
        }
    }
}

public sealed record CurrentUserHttpResponse(int StatusCode, string Code, object Body);

public static class CurrentUserResponseFactory
{
    public static CurrentUserHttpResponse Create(CurrentUserResolution resolution) => resolution.Status switch
    {
        CurrentUserStatus.Active when resolution.User is not null => new(200, "OK", new
        {
            isAuthenticated = true,
            user = new
            {
                resolution.User.UserName,
                resolution.User.DisplayName,
                resolution.User.AccountStatus
            },
            roles = resolution.User.Roles.Select(role => role.RoleCode).ToArray(),
            permissions = resolution.User.ExplicitPermissions.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            resolution.User.IsSuperAdmin
        }),
        CurrentUserStatus.NotProvisioned => Error(403, "DLE_OS_USER_NOT_PROVISIONED",
            "Authenticated externally, but no active DLE-OS account exists."),
        CurrentUserStatus.PendingAuthentication => Error(403, "DLE_OS_AUTHENTICATION_PENDING",
            "The DLE-OS user exists, but an external sign-in identity is not configured."),
        CurrentUserStatus.Disabled => Error(403, "DLE_OS_USER_DISABLED",
            "The mapped DLE-OS account is not active."),
        CurrentUserStatus.SecurityUnavailable => Error(503, "DLE_OS_SECURITY_UNAVAILABLE",
            "External authentication succeeded, but DLE-OS identity resolution is temporarily unavailable."),
        _ => Error(401, "AUTHENTICATION_REQUIRED", "DLE-OS authentication is required.")
    };

    private static CurrentUserHttpResponse Error(int status, string code, string message) =>
        new(status, code, new { isAuthenticated = status != 401, error = new { code, message } });
}
