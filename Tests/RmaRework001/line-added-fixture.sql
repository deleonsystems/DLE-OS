SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @CaseId uniqueidentifier=NEWID(), @Created uniqueidentifier=NEWID(), @Added uniqueidentifier=NEWID();
    INSERT operational.RmaReworkCase
      (CaseId,CustomerNumber,CaseType,CustomerRmaNumber,InternalReference,Notes,CaseStatus,CreatedBy,RequestCorrelationId,EvidenceToken)
    VALUES
      (@CaseId,'999998','RMA_RETURN_REPLACEMENT',N' Fixture-RMA  123 ',NULL,N'Deterministic rollback fixture','ACTIVE',SUSER_SNAME(),NEWID(),REPLICATE('A',64));
    INSERT operational.RmaReworkCaseMember
      (CaseId,MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,ItemNumber,Revision,QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,RelatedWorkOrderNumber,RelationshipStatus,RelationshipBasis,CaseStatus)
    VALUES
      (@CaseId,1,'999998','9000001','010','9999989000001010','FIXTURE-A',NULL,2,2,0,2,NULL,'UNRESOLVED',NULL,'ACTIVE');
    INSERT operational.RmaReworkCaseEvent
      (EventId,CaseId,EventType,EventPayloadJson,RecordedBy,ExpectedPriorEventId,RequestCorrelationId)
    VALUES
      (@Created,@CaseId,'CASE_CREATED',N'{"fixture":true,"member":"9000001/010"}',SUSER_SNAME(),NULL,NEWID());

    INSERT operational.RmaReworkCaseMember
      (CaseId,MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,ItemNumber,Revision,QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,RelatedWorkOrderNumber,RelationshipStatus,RelationshipBasis,CaseStatus)
    VALUES
      (@CaseId,2,'999998','9000001','020','9999989000001020','FIXTURE-B',NULL,3,3,0,3,NULL,'UNRESOLVED',NULL,'ACTIVE');
    INSERT operational.RmaReworkCaseEvent
      (EventId,CaseId,EventType,EventPayloadJson,RecordedBy,ExpectedPriorEventId,RequestCorrelationId)
    VALUES
      (@Added,@CaseId,'LINE_ADDED',N'{"fixture":true,"member":"9000001/020","referenceType":"CUSTOMER_RMA","normalizedReference":"FIXTURE-RMA 123"}',SUSER_SNAME(),@Created,NEWID());

    IF (SELECT COUNT(*) FROM operational.RmaReworkCaseMember WHERE CaseId=@CaseId)<>2 THROW 51101,'Fixture member append failed.',1;
    IF (SELECT COUNT(*) FROM operational.RmaReworkCaseEvent WHERE CaseId=@CaseId)<>2 THROW 51102,'Fixture history append failed.',1;
    IF NOT EXISTS (SELECT 1 FROM operational.RmaReworkCaseEvent WHERE EventId=@Created AND EventType='CASE_CREATED') THROW 51103,'Original CASE_CREATED event was not preserved.',1;
    IF NOT EXISTS (SELECT 1 FROM operational.RmaReworkCaseEvent WHERE EventId=@Added AND EventType='LINE_ADDED' AND ExpectedPriorEventId=@Created) THROW 51104,'LINE_ADDED concurrency evidence was not preserved.',1;
    ROLLBACK TRANSACTION;
    SELECT 'PASS' AS RmaReworkLineAddedFixture, 0 AS PersistentRowsCreated;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
