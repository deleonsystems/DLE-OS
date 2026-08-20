USE [master];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF ORIGINAL_LOGIN() <> N'DLE-OS-HOST\DLE-OS'
    THROW 51000, 'Bootstrap must run as DLE-OS-HOST\DLE-OS.', 1;

IF CONVERT(sysname, SERVERPROPERTY('MachineName')) <> N'DLE-OS-HOST'
    THROW 51001, 'Bootstrap is restricted to DLE-OS-HOST.', 1;

IF CONVERT(sysname, SERVERPROPERTY('InstanceName')) <> N'SQLEXPRESS'
    THROW 51002, 'Bootstrap is restricted to the SQLEXPRESS instance.', 1;

IF DB_ID(N'DLE_OS_OPERATIONAL_DEV') IS NULL
    THROW 51003, 'DLE_OS_OPERATIONAL_DEV does not exist.', 1;

IF DB_ID(N'DLE_OS_SECURITY_DEV') IS NULL
    THROW 51004, 'DLE_OS_SECURITY_DEV does not exist.', 1;

IF EXISTS
(
    SELECT 1
    FROM sys.server_principals
    WHERE name = N'DLE-OS-HOST\DLE-OS-Developers'
      AND type <> 'G'
)
    THROW 51005, 'An incompatible server principal uses the developer-group name.', 1;

IF NOT EXISTS
(
    SELECT 1
    FROM sys.server_principals
    WHERE name = N'DLE-OS-HOST\DLE-OS-Developers'
)
    CREATE LOGIN [DLE-OS-HOST\DLE-OS-Developers] FROM WINDOWS;

IF EXISTS
(
    SELECT 1
    FROM sys.server_principals
    WHERE name = N'DLE-OS-HOST\DLE-OS-Developers'
      AND is_disabled = 1
)
    THROW 51006, 'The developer-group login exists but is disabled.', 1;

IF EXISTS
(
    SELECT 1
    FROM sys.server_role_members AS membership
    JOIN sys.server_principals AS member
      ON member.principal_id = membership.member_principal_id
    WHERE member.name = N'DLE-OS-HOST\DLE-OS-Developers'
)
    THROW 51007, 'The developer-group login must not belong to a SQL server role.', 1;
GO

USE [DLE_OS_OPERATIONAL_DEV];
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_principals
        WHERE name = N'DLE-OS-HOST\DLE-OS-Developers'
          AND
          (
              type <> 'X'
              OR sid <> SUSER_SID(N'DLE-OS-HOST\DLE-OS-Developers')
          )
    )
        THROW 51010, 'An incompatible operational database principal exists.', 1;

    IF DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS-Developers') IS NULL
        CREATE USER [DLE-OS-HOST\DLE-OS-Developers]
            FOR LOGIN [DLE-OS-HOST\DLE-OS-Developers];

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_principals
        WHERE name = N'dle_os_dev_migrator'
          AND type <> 'R'
    )
        THROW 51011, 'An incompatible operational migrator principal exists.', 1;

    IF DATABASE_PRINCIPAL_ID(N'dle_os_dev_migrator') IS NULL
        CREATE ROLE [dle_os_dev_migrator] AUTHORIZATION [dbo];

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_role_members AS membership
        JOIN sys.database_principals AS member
          ON member.principal_id = membership.member_principal_id
        JOIN sys.database_principals AS role
          ON role.principal_id = membership.role_principal_id
        WHERE member.name = N'DLE-OS-HOST\DLE-OS-Developers'
          AND role.name <> N'dle_os_dev_migrator'
    )
        THROW 51012, 'The operational group user has unexpected role membership.', 1;

    GRANT CONTROL ON DATABASE::[DLE_OS_OPERATIONAL_DEV]
        TO [dle_os_dev_migrator];

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.database_role_members
        WHERE role_principal_id = DATABASE_PRINCIPAL_ID(N'dle_os_dev_migrator')
          AND member_principal_id =
              DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS-Developers')
    )
        ALTER ROLE [dle_os_dev_migrator]
            ADD MEMBER [DLE-OS-HOST\DLE-OS-Developers];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

USE [DLE_OS_SECURITY_DEV];
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_principals
        WHERE name = N'DLE-OS-HOST\DLE-OS-Developers'
          AND
          (
              type <> 'X'
              OR sid <> SUSER_SID(N'DLE-OS-HOST\DLE-OS-Developers')
          )
    )
        THROW 51020, 'An incompatible security database principal exists.', 1;

    IF DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS-Developers') IS NULL
        CREATE USER [DLE-OS-HOST\DLE-OS-Developers]
            FOR LOGIN [DLE-OS-HOST\DLE-OS-Developers];

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_principals
        WHERE name = N'dle_os_dev_migrator'
          AND type <> 'R'
    )
        THROW 51021, 'An incompatible security migrator principal exists.', 1;

    IF DATABASE_PRINCIPAL_ID(N'dle_os_dev_migrator') IS NULL
        CREATE ROLE [dle_os_dev_migrator] AUTHORIZATION [dbo];

    IF EXISTS
    (
        SELECT 1
        FROM sys.database_role_members AS membership
        JOIN sys.database_principals AS member
          ON member.principal_id = membership.member_principal_id
        JOIN sys.database_principals AS role
          ON role.principal_id = membership.role_principal_id
        WHERE member.name = N'DLE-OS-HOST\DLE-OS-Developers'
          AND role.name <> N'dle_os_dev_migrator'
    )
        THROW 51022, 'The security group user has unexpected role membership.', 1;

    GRANT CONTROL ON DATABASE::[DLE_OS_SECURITY_DEV]
        TO [dle_os_dev_migrator];

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.database_role_members
        WHERE role_principal_id = DATABASE_PRINCIPAL_ID(N'dle_os_dev_migrator')
          AND member_principal_id =
              DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS-Developers')
    )
        ALTER ROLE [dle_os_dev_migrator]
            ADD MEMBER [DLE-OS-HOST\DLE-OS-Developers];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

USE [master];
GO

SELECT
    server_principal.name,
    server_principal.type_desc,
    server_principal.is_disabled,
    server_role.name AS ServerRole
FROM sys.server_principals AS server_principal
LEFT JOIN sys.server_role_members AS membership
  ON membership.member_principal_id = server_principal.principal_id
LEFT JOIN sys.server_principals AS server_role
  ON server_role.principal_id = membership.role_principal_id
WHERE server_principal.name = N'DLE-OS-HOST\DLE-OS-Developers';
GO

USE [DLE_OS_OPERATIONAL_DEV];
GO

SELECT
    DB_NAME() AS DatabaseName,
    member.name AS MemberName,
    role.name AS RoleName,
    permission.state_desc,
    permission.permission_name
FROM sys.database_principals AS member
JOIN sys.database_role_members AS membership
  ON membership.member_principal_id = member.principal_id
JOIN sys.database_principals AS role
  ON role.principal_id = membership.role_principal_id
LEFT JOIN sys.database_permissions AS permission
  ON permission.grantee_principal_id = role.principal_id
WHERE member.name = N'DLE-OS-HOST\DLE-OS-Developers';
GO

USE [DLE_OS_SECURITY_DEV];
GO

SELECT
    DB_NAME() AS DatabaseName,
    member.name AS MemberName,
    role.name AS RoleName,
    permission.state_desc,
    permission.permission_name
FROM sys.database_principals AS member
JOIN sys.database_role_members AS membership
  ON membership.member_principal_id = member.principal_id
JOIN sys.database_principals AS role
  ON role.principal_id = membership.role_principal_id
LEFT JOIN sys.database_permissions AS permission
  ON permission.grantee_principal_id = role.principal_id
WHERE member.name = N'DLE-OS-HOST\DLE-OS-Developers';
GO
