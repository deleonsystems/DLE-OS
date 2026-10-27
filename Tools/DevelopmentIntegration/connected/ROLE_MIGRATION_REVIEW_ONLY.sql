-- REVIEW ONLY. Not authorized for execution. No account grants or credentials.
-- SQL Server / existing security foundation schema. Run on disposable SQL clone first.
SET XACT_ABORT ON;
DECLARE @ReviewedAndApproved bit=0; -- remains false in this proposal
DECLARE @Commit bit=0; -- default transaction rehearsal rolls back
IF @ReviewedAndApproved<>1 THROW 52900,'Role proposal requires separate approval and clone qualification.',1;
IF DB_NAME()<>N'DLE_OS_SECURITY_DEV' THROW 52901,'Wrong target database.',1;
DECLARE @Actor nvarchar(256)=N'phase-one-quoting-role-migration';
DECLARE @Catalog nvarchar(max)=N'[{"code":"QUOTING_MATERIALS_ESTIMATOR","displayName":"Quoting Materials Estimator","persona":"ray","permissions":["rfq.intake.create","rfq.view","rfq.materials.edit","rfq.readiness.view","rfq.part_requests.create","rfq.quote.prepare","assembly_library.view"],"workspaces":["dle-home","rfq-quoting","rfqs","assembly-library"]},{"code":"QUOTING_MATERIALS_LIBRARY_CLERK","displayName":"Quoting Materials and Library Clerk","persona":"michelle","permissions":["rfq.view","rfq.materials.edit","assembly_library.view","assembly_library.edit"],"workspaces":["dle-home","rfqs","assembly-library"]},{"code":"QUOTING_LIBRARY_CLERK","displayName":"Quoting Library Clerk","persona":"adan","permissions":["assembly_library.view","assembly_library.edit"],"workspaces":["dle-home","assembly-library"]}]';
DECLARE @Roles TABLE(Code varchar(100) PRIMARY KEY,Name nvarchar(200),Permissions nvarchar(max));
INSERT @Roles SELECT code,displayName,permissions FROM OPENJSON(@Catalog)
WITH(code varchar(100),displayName nvarchar(200),permissions nvarchar(max) AS JSON);
DECLARE @Expected TABLE(Code varchar(100),Permission varchar(160),PRIMARY KEY(Code,Permission));
INSERT @Expected SELECT r.Code,j.value FROM @Roles r CROSS APPLY OPENJSON(r.Permissions) j;
BEGIN TRANSACTION;
-- Serialize this small catalog change; never silently repair conflicting definitions.
DECLARE @Lock int;
EXEC @Lock=sys.sp_getapplock @Resource=N'DLE-OS:phase-one-quoting-roles',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0;
IF @Lock<0 THROW 52902,'Another role operation is active.',1;
IF EXISTS(SELECT 1 FROM @Roles e JOIN security.[Role] r ON r.RoleCode=e.Code
 WHERE r.IsActive<>1 OR r.IsSuperAdmin<>0 OR r.IsSystemRole<>0 OR r.DisplayName<>e.Name)
 THROW 52903,'Existing role metadata conflicts; no automatic alteration.',1;
IF EXISTS(SELECT 1 FROM @Roles e JOIN security.[Role] r ON r.RoleCode=e.Code
 WHERE EXISTS(SELECT p.PermissionCode FROM security.RolePermission rp JOIN security.Permission p ON p.PermissionId=rp.PermissionId WHERE rp.RoleId=r.RoleId AND rp.IsActive=1
 EXCEPT SELECT Permission FROM @Expected WHERE Code=e.Code)
 OR EXISTS(SELECT Permission FROM @Expected WHERE Code=e.Code EXCEPT
 SELECT p.PermissionCode FROM security.RolePermission rp JOIN security.Permission p ON p.PermissionId=rp.PermissionId WHERE rp.RoleId=r.RoleId AND rp.IsActive=1))
 THROW 52904,'Existing role permission set conflicts; no automatic alteration.',1;
IF EXISTS(SELECT 1 FROM @Expected e JOIN security.Permission p ON p.PermissionCode=e.Permission WHERE p.IsActive<>1)
 THROW 52905,'Required permission is inactive; no automatic reactivation.',1;
-- Existing permission meanings/descriptions must be reviewed before approval.
SELECT DISTINCT p.* FROM @Expected e JOIN security.Permission p ON p.PermissionCode=e.Permission;
DECLARE @NewRoles TABLE(RoleId uniqueidentifier,RoleCode varchar(100));
DECLARE @NewPermissions TABLE(PermissionId uniqueidentifier,PermissionCode varchar(160));
INSERT security.Permission(PermissionId,PermissionCode,DisplayName,Description,Category,IsActive,CreatedBy)
OUTPUT inserted.PermissionId,inserted.PermissionCode INTO @NewPermissions
SELECT NEWID(),e.Permission,e.Permission,N'Checkpoint 66251559 phase-one quoting contract',
CASE WHEN e.Permission LIKE 'assembly_library.%' THEN 'assembly_library' ELSE 'rfq' END,1,@Actor
FROM (SELECT DISTINCT Permission FROM @Expected) e
WHERE NOT EXISTS(SELECT 1 FROM security.Permission p WHERE p.PermissionCode=e.Permission);
INSERT security.[Role](RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy)
OUTPUT inserted.RoleId,inserted.RoleCode INTO @NewRoles
SELECT NEWID(),e.Code,e.Name,N'Phase-one quoting; no technical approval, Kitting or administrator rights',0,0,1,@Actor
FROM @Roles e WHERE NOT EXISTS(SELECT 1 FROM security.[Role] r WHERE r.RoleCode=e.Code);
INSERT security.RolePermission(RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor)
SELECT NEWID(),r.RoleId,p.PermissionId,1,@Actor FROM @Expected e
JOIN @NewRoles r ON r.RoleCode=e.Code JOIN security.Permission p ON p.PermissionCode=e.Permission;
-- Retain these output IDs in the approved change record for scoped rollback.
SELECT * FROM @NewRoles; SELECT * FROM @NewPermissions;
IF @Commit=1 COMMIT; ELSE ROLLBACK;
-- Never touches User/UserRole/ExternalIdentity/Employee or existing role grants.
