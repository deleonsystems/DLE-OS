using System.Security.Principal;
using Dapper;
using DLE_OS_Server.Data.Platform.Live;

public sealed class DevelopmentReadOnlyGuard
{
    private readonly LivePlatformSqlConnectionFactory _connections;
    public object Evidence { get; private set; } = new { verdict = "NOT_RUN" };

    public DevelopmentReadOnlyGuard(LivePlatformSqlConnectionFactory connections)
    {
        _connections = connections;
    }

    public async Task ValidateAsync(CancellationToken cancellationToken)
    {
        var windowsIdentity = WindowsIdentity.GetCurrent().Name;
        if (!string.Equals(
                windowsIdentity,
                @"DLE-OS-HOST\DLE-OS-LIVE-API",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Development API requires the qualified read-only identity; actual: {windowsIdentity}.");
        }

        await using var connection = _connections.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var permissions = await connection.QuerySingleAsync<dynamic>("""
SELECT
  ORIGINAL_LOGIN() AS OriginalLogin,
  USER_NAME() AS DatabaseUser,
  DB_NAME() AS DatabaseName,
  IS_ROLEMEMBER(N'dle_live_api_reader') AS IsReader,
  IS_ROLEMEMBER(N'db_datawriter') AS IsWriter,
  IS_ROLEMEMBER(N'db_owner') AS IsOwner,
  IS_SRVROLEMEMBER(N'sysadmin') AS IsSysadmin,
  HAS_PERMS_BY_NAME(N'canonical.WorkOrder', N'OBJECT', N'SELECT') AS CanSelect,
  HAS_PERMS_BY_NAME(N'canonical.WorkOrder', N'OBJECT', N'INSERT') AS CanInsert,
  HAS_PERMS_BY_NAME(N'canonical.WorkOrder', N'OBJECT', N'UPDATE') AS CanUpdate,
  HAS_PERMS_BY_NAME(N'canonical.WorkOrder', N'OBJECT', N'DELETE') AS CanDelete,
  HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'EXECUTE') AS CanExecute;
""");

        var values = (IDictionary<string, object>)permissions;
        int Flag(string name) => Convert.ToInt32(values[name]);
        if (Flag("IsReader") != 1 || Flag("CanSelect") != 1 ||
            Flag("IsWriter") != 0 || Flag("IsOwner") != 0 ||
            Flag("IsSysadmin") != 0 || Flag("CanInsert") != 0 ||
            Flag("CanUpdate") != 0 || Flag("CanDelete") != 0 ||
            Flag("CanExecute") != 0)
        {
            throw new InvalidOperationException(
                "Development SQL identity is outside the strict read-only boundary.");
        }

        async Task<string> ExpectDeniedAsync(string operation, string sql)
        {
            try
            {
                await connection.ExecuteAsync(sql);
                throw new InvalidOperationException($"{operation} unexpectedly succeeded.");
            }
            catch (Microsoft.Data.SqlClient.SqlException exception)
            {
                return exception.Message;
            }
        }

        var insert = await ExpectDeniedAsync(
            "INSERT",
            "INSERT INTO canonical.WorkOrder (WorkOrderNumber) SELECT N'0000000' WHERE 1=0;");
        var update = await ExpectDeniedAsync(
            "UPDATE",
            "UPDATE canonical.WorkOrder SET WorkOrderNumber=WorkOrderNumber WHERE 1=0;");
        var delete = await ExpectDeniedAsync(
            "DELETE",
            "DELETE FROM canonical.WorkOrder WHERE 1=0;");

        Evidence = new
        {
            verdict = "PASS",
            checkedAtUtc = DateTimeOffset.UtcNow,
            processId = Environment.ProcessId,
            windowsIdentity,
            sqlIdentity = new
            {
                originalLogin = values["OriginalLogin"],
                databaseUser = values["DatabaseUser"],
                database = values["DatabaseName"]
            },
            select = "PERMITTED",
            insert = new { result = "DENIED", error = insert },
            update = new { result = "DENIED", error = update },
            delete = new { result = "DENIED", error = delete },
            execute = "DENIED"
        };
    }
}
