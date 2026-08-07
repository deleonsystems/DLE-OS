SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

IF OBJECT_ID(N'security.Permission', N'U') IS NULL
    THROW 52100, 'The security foundation must exist before the operational permission catalog.', 1;

DECLARE @Catalog TABLE
(
    PermissionId uniqueidentifier NOT NULL,
    PermissionCode varchar(160) NOT NULL,
    DisplayName nvarchar(200) NOT NULL,
    Description nvarchar(1000) NOT NULL,
    Category varchar(100) NOT NULL
);

INSERT @Catalog(PermissionId,PermissionCode,DisplayName,Description,Category) VALUES
('51000000-0000-4000-8000-000000000001','work_orders.view',N'View Work Orders',N'View governed Work Order operational state.','work_orders'),
('51000000-0000-4000-8000-000000000002','work_orders.approve',N'Approve Work Orders',N'Approve a supported Work Order decision.','work_orders'),
('51000000-0000-4000-8000-000000000003','work_orders.replace',N'Replace Work Order Decisions',N'Replace an existing governed Work Order decision.','work_orders'),
('51000000-0000-4000-8000-000000000004','work_orders.revoke',N'Revoke Work Order Decisions',N'Revoke an existing governed Work Order decision.','work_orders'),
('51000000-0000-4000-8000-000000000005','work_orders.mark_no_work_order_required',N'Mark No Work Order Required',N'Record a governed No Work Order Required decision.','work_orders'),
('51000000-0000-4000-8000-000000000006','kitting.view',N'View Kitting',N'View governed kitting disposition state.','kitting'),
('51000000-0000-4000-8000-000000000007','kitting.disposition',N'Set Kitting Disposition',N'Record Needs Kitting, Kit Short, or Kit Complete.','kitting'),
('51000000-0000-4000-8000-000000000008','rma_rework.view',N'View RMA/Rework',N'View governed RMA/Rework cases and history.','rma_rework'),
('51000000-0000-4000-8000-000000000009','rma_rework.manage',N'Manage RMA/Rework',N'Review, create, or update governed RMA/Rework cases.','rma_rework'),
('51000000-0000-4000-8000-00000000000A','shipments.view',N'View Shipments',N'View governed Shipment Staging state and history.','shipments'),
('51000000-0000-4000-8000-00000000000B','shipments.stage',N'Stage Shipments',N'Create governed Shipment Staging records.','shipments'),
('51000000-0000-4000-8000-00000000000C','shipments.cancel',N'Cancel Staged Shipments',N'Cancel a governed staged shipment without deleting it.','shipments'),
('51000000-0000-4000-8000-00000000000D','shipments.confirm',N'Confirm Shipment Evidence',N'Confirm, reject, or classify shipment reconciliation evidence.','shipments'),
('51000000-0000-4000-8000-00000000000E','shipments.reconcile',N'Reconcile Shipments',N'Run governed Shipment Staging reconciliation.','shipments');

IF EXISTS
(
    SELECT 1 FROM @Catalog c
    JOIN security.Permission p ON p.PermissionCode=c.PermissionCode
    WHERE p.PermissionId<>c.PermissionId
)
    THROW 52101, 'An operational permission code has a contradictory immutable ID.', 1;

DECLARE @Created TABLE(PermissionId uniqueidentifier,PermissionCode varchar(160));
MERGE security.Permission AS target
USING @Catalog AS source ON target.PermissionCode=source.PermissionCode
WHEN NOT MATCHED THEN INSERT
    (PermissionId,PermissionCode,DisplayName,Description,Category,IsActive,CreatedBy)
    VALUES(source.PermissionId,source.PermissionCode,source.DisplayName,source.Description,
           source.Category,1,N'PHASE_5_1_MIGRATION')
OUTPUT inserted.PermissionId,inserted.PermissionCode INTO @Created;

INSERT security.AuditEvent
    (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
SELECT NEWID(),'PERMISSION_CREATED',N'PHASE_5_1_MIGRATION','PERMISSION',PermissionId,
       PermissionCode,N'{"phase":"5.1","environment":"DEVELOPMENT"}'
FROM @Created;

COMMIT TRANSACTION;
