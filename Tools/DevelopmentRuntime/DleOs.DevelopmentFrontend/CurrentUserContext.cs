using DleOs.Security;
using Microsoft.Data.SqlClient;

public enum CurrentUserStatus
{
    Unauthenticated,
    NotProvisioned,
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
        var identity = httpContextAccessor.HttpContext?.User.Identity;
        if (identity?.IsAuthenticated != true || string.IsNullOrWhiteSpace(identity.Name))
            return new(CurrentUserStatus.Unauthenticated, null, null);

        try
        {
            var user = await identityResolver.ResolveAsync("WINDOWS", identity.Name, cancellationToken);
            if (user is null)
                return new(CurrentUserStatus.NotProvisioned, identity.Name, null);
            if (!user.IsActive)
                return new(CurrentUserStatus.Disabled, identity.Name, user);
            return new(CurrentUserStatus.Active, identity.Name, user);
        }
        catch (SqlException)
        {
            return new(CurrentUserStatus.SecurityUnavailable, identity.Name, null);
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
            resolution.User.IsSuperAdmin
        }),
        CurrentUserStatus.NotProvisioned => Error(403, "DLE_OS_USER_NOT_PROVISIONED",
            "Authenticated by Windows, but no active DLE-OS account exists."),
        CurrentUserStatus.Disabled => Error(403, "DLE_OS_USER_DISABLED",
            "The mapped DLE-OS account is not active."),
        CurrentUserStatus.SecurityUnavailable => Error(503, "DLE_OS_SECURITY_UNAVAILABLE",
            "Windows authentication succeeded, but DLE-OS identity resolution is temporarily unavailable."),
        _ => Error(401, "WINDOWS_AUTHENTICATION_REQUIRED", "Windows authentication is required.")
    };

    private static CurrentUserHttpResponse Error(int status, string code, string message) =>
        new(status, code, new { isAuthenticated = status != 401, error = new { code, message } });
}
