using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace DleOs.Security;

public sealed record SecurityRole(Guid RoleId, string RoleCode, bool IsSuperAdmin);

public sealed record ResolvedSecurityUser(
    Guid UserId,
    string UserName,
    string DisplayName,
    string AccountStatus,
    IReadOnlyList<SecurityRole> Roles,
    IReadOnlySet<string> ExplicitPermissions)
{
    public bool IsActive => string.Equals(AccountStatus, "ACTIVE", StringComparison.Ordinal);
    public bool IsSuperAdmin => IsActive && Roles.Any(role => role.IsSuperAdmin);
}

public sealed record CurrentUserContract(
    bool IsAuthenticated,
    string WindowsIdentity,
    CurrentUserDetails? User,
    IReadOnlyList<string> Roles,
    bool IsSuperAdmin);

public sealed record CurrentUserDetails(
    Guid UserId,
    string UserName,
    string DisplayName,
    string AccountStatus);

public interface IIdentityResolver
{
    Task<ResolvedSecurityUser?> ResolveAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default);
}

public sealed class SqlIdentityResolver(string connectionString) : IIdentityResolver
{
    public async Task<ResolvedSecurityUser?> ResolveAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(provider);
        ArgumentException.ThrowIfNullOrWhiteSpace(subject);

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            DECLARE @UserId uniqueidentifier;
            SELECT @UserId=u.UserId
            FROM security.ExternalIdentity ei
            JOIN security.[User] u ON u.UserId=ei.UserId
            WHERE ei.Provider=UPPER(LTRIM(RTRIM(@Provider)))
              AND ei.NormalizedSubject=UPPER(LTRIM(RTRIM(@Subject)))
              AND ei.IsActive=1;

            SELECT u.UserId,u.UserName,u.DisplayName,u.AccountStatus
            FROM security.[User] u WHERE u.UserId=@UserId;

            SELECT r.RoleId,r.RoleCode,r.IsSuperAdmin
            FROM security.UserRole ur
            JOIN security.[Role] r ON r.RoleId=ur.RoleId
            WHERE ur.UserId=@UserId AND ur.IsActive=1 AND r.IsActive=1
            ORDER BY r.RoleCode;

            SELECT DISTINCT p.PermissionCode
            FROM security.UserRole ur
            JOIN security.[Role] r ON r.RoleId=ur.RoleId
            JOIN security.RolePermission rp ON rp.RoleId=r.RoleId AND rp.IsActive=1
            JOIN security.Permission p ON p.PermissionId=rp.PermissionId AND p.IsActive=1
            WHERE ur.UserId=@UserId AND ur.IsActive=1 AND r.IsActive=1
            ORDER BY p.PermissionCode;
            """,
            connection);
        command.Parameters.AddWithValue("@Provider", provider);
        command.Parameters.AddWithValue("@Subject", subject);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        var userId = reader.GetGuid(0);
        var userName = reader.GetString(1);
        var displayName = reader.GetString(2);
        var accountStatus = reader.GetString(3);

        var roles = new List<SecurityRole>();
        await reader.NextResultAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            roles.Add(new SecurityRole(reader.GetGuid(0), reader.GetString(1), reader.GetBoolean(2)));

        var permissions = new HashSet<string>(StringComparer.Ordinal);
        await reader.NextResultAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            permissions.Add(reader.GetString(0));

        return new ResolvedSecurityUser(
            userId,
            userName,
            displayName,
            accountStatus,
            roles,
            permissions);
    }
}

public sealed class AuthorizationEvaluator
{
    private static readonly Regex PermissionCode = new(
        "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public bool Can(ResolvedSecurityUser? user, string permissionCode)
    {
        if (user is null || !user.IsActive ||
            string.IsNullOrWhiteSpace(permissionCode) ||
            !PermissionCode.IsMatch(permissionCode))
            return false;
        if (user.IsSuperAdmin)
            return true;
        return user.ExplicitPermissions.Contains(permissionCode);
    }
}

public static class CurrentUserContractFactory
{
    public static CurrentUserContract Create(
        string windowsIdentity,
        ResolvedSecurityUser? resolvedUser) =>
        new(
            !string.IsNullOrWhiteSpace(windowsIdentity),
            windowsIdentity,
            resolvedUser is null
                ? null
                : new CurrentUserDetails(
                    resolvedUser.UserId,
                    resolvedUser.UserName,
                    resolvedUser.DisplayName,
                    resolvedUser.AccountStatus),
            resolvedUser?.Roles.Select(role => role.RoleCode).ToArray() ?? [],
            resolvedUser?.IsSuperAdmin ?? false);
}

public interface IWindowsIdentitySource
{
    string Name { get; }
}

[SupportedOSPlatform("windows")]
public sealed class CurrentWindowsIdentitySource : IWindowsIdentitySource
{
    public string Name => WindowsIdentity.GetCurrent().Name;
}

public sealed record BootstrapResult(
    Guid UserId,
    Guid RoleId,
    string ExternalIdentity,
    bool IsSuperAdmin);

public sealed class SecurityBootstrapper(
    string connectionString,
    IWindowsIdentitySource identitySource)
{
    public const string ExpectedIdentity = @"DLE-OS-HOST\Miguel";

    public async Task<BootstrapResult> BootstrapMiguelAsync(
        CancellationToken cancellationToken = default)
    {
        if (!string.Equals(identitySource.Name, ExpectedIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Security bootstrap requires the exact Windows identity {ExpectedIdentity}.");

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(
            "security.usp_BootstrapMiguelSuperAdmin",
            connection)
        {
            CommandType = System.Data.CommandType.StoredProcedure
        };
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException("The governed bootstrap returned no result.");
        return new BootstrapResult(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetBoolean(3));
    }
}
