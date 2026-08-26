using Microsoft.Data.SqlClient;

internal static class DevOperationalSchema
{
    internal static async Task ValidateAsync(CancellationToken token = default)
    {
        await ValidateOperationalAsync(token);
        await ValidateSecurityAsync(token);
    }

    private static async Task ValidateOperationalAsync(CancellationToken token)
    {
        const string sql = """
            SELECT
              HAS_PERMS_BY_NAME(N'operational.KittingCase',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'operational.KittingCase',N'OBJECT',N'INSERT'),
              HAS_PERMS_BY_NAME(N'operational.KittingCase',N'OBJECT',N'UPDATE'),
              HAS_PERMS_BY_NAME(N'operational.KittingCase',N'OBJECT',N'DELETE'),
              HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'ALTER'),
              HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL');

            SELECT TOP (0) * FROM operational.KittingCase;
            SELECT TOP (0) * FROM operational.KittingCaseEvent;
            SELECT TOP (0) * FROM operational.KittingDispositionEvent;
            SELECT TOP (0) * FROM operational.KittingSubmission;
            SELECT TOP (0) * FROM operational.LegacyKittingMaterialEvidence;
            SELECT TOP (0) * FROM operational.OperationsCenterVerifiedStatusEvent;
            SELECT TOP (0) * FROM operational.OperationsCenterWorkOrderVerifiedStatusEvent;
            SELECT TOP (0) * FROM operational.RmaReworkCase;
            SELECT TOP (0) * FROM operational.RmaReworkCaseEvent;
            SELECT TOP (0) * FROM operational.RmaReworkCaseMember;
            SELECT TOP (0) * FROM operational.SalesOrderLineWorkOrderDecisionEvent;
            SELECT TOP (0) * FROM operational.SalesOrderLineWorkOrderInterpretationEvent;
            SELECT TOP (0) * FROM operational.ShipmentInvoiceAllocation;
            SELECT TOP (0) * FROM operational.ShipmentInvoiceDecisionEvent;
            SELECT TOP (0) * FROM operational.ShipmentInvoiceMatchProposal;
            SELECT TOP (0) * FROM operational.ShipmentReconciliationRun;
            SELECT TOP (0) * FROM operational.ShipmentStaging;
            SELECT TOP (0) * FROM operational.ShipmentStagingEvent;
            SELECT TOP (0) * FROM operational.vw_ActiveRmaReworkCaseMember;
            SELECT TOP (0) * FROM operational.vw_CurrentKittingDisposition;
            SELECT TOP (0) * FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision;
            SELECT TOP (0) * FROM operational.vw_CurrentSalesOrderLineWorkOrderInterpretation;
            SELECT TOP (0) * FROM operational.vw_CurrentShipmentStaging;
            """;

        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.OperationalConnectionString);
        await connection.OpenAsync(token);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token) ||
            reader.GetInt32(0) != 1 || reader.GetInt32(1) != 1 || reader.GetInt32(2) != 1 ||
            reader.GetInt32(3) != 0 || reader.GetInt32(4) != 0 || reader.GetInt32(5) != 0)
            throw new InvalidOperationException("The DEV operational database permission boundary is not exact.");

        do
        {
            while (await reader.ReadAsync(token)) { }
        } while (await reader.NextResultAsync(token));
    }

    private static async Task ValidateSecurityAsync(CancellationToken token)
    {
        const string sql = """
            SELECT
              HAS_PERMS_BY_NAME(N'security.User',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.ExternalIdentity',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.Role',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.Permission',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.UserRole',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.RolePermission',N'OBJECT',N'SELECT'),
              HAS_PERMS_BY_NAME(N'security.User',N'OBJECT',N'UPDATE'),
              HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL');
            SELECT TOP (0)
              u.UserId,ei.ExternalIdentityId,r.RoleId,p.PermissionId,ur.UserRoleId,rp.RolePermissionId
            FROM security.[User] u
            LEFT JOIN security.ExternalIdentity ei ON ei.UserId=u.UserId
            LEFT JOIN security.UserRole ur ON ur.UserId=u.UserId
            LEFT JOIN security.[Role] r ON r.RoleId=ur.RoleId
            LEFT JOIN security.RolePermission rp ON rp.RoleId=r.RoleId
            LEFT JOIN security.Permission p ON p.PermissionId=rp.PermissionId;
            """;

        await using var connection = new SqlConnection(ControlHostRuntimeConfiguration.SecurityConnectionString);
        await connection.OpenAsync(token);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token) ||
            Enumerable.Range(0, 6).Any(index => reader.GetInt32(index) != 1) ||
            reader.GetInt32(6) != 0 || reader.GetInt32(7) != 0)
            throw new InvalidOperationException("The DEV security database permission boundary is not exact.");

        do
        {
            while (await reader.ReadAsync(token)) { }
        } while (await reader.NextResultAsync(token));
    }
}
