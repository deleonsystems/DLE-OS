using System.Text.Json;
using Microsoft.Data.SqlClient;

var failures = new List<string>();
void Check(string name, bool condition)
{
    if (!condition) failures.Add(name);
}

CanonicalRelationship Relationship(string status, string? exact, params string[] candidates)
{
    var source = JsonSerializer.SerializeToElement(new
    {
        resolutionStatus = status,
        actionableWorkOrderNumber = exact,
        salesOrderItemNumber = "ITEM-1",
        candidates = candidates.Select((number, index) => new
        {
            workOrderNumber = number,
            itemNumber = index == 0 ? "ITEM-1" : "ITEM-2",
            sourceSnapshotId = "DAILYOPSSYNC-20260804T011504Z-AD0D0F51",
            sourceImportRunId = "dd334ad1-ea2f-4171-a8c9-193d6d25e656"
        })
    });
    return CanonicalRelationship.From(source);
}

var exact = Relationship("EXACT_LINE_UNIQUE", "0115593", "0115593", "0115600");
foreach (var option in WorkOrderApprovalReasonContract.Options)
{
    var validated = WorkOrderApprovalReasonContract.Validate(option.Code,
        option.Code == "OTHER" ? "Operator verified exception." : null);
    Check("reason code round trip " + option.Code, validated.Code == option.Code);
    Check("reason label compatibility " + option.Code,
        validated.LegacyReason.StartsWith(option.Label, StringComparison.Ordinal));
    if (option.Code != "OTHER") Check("predefined note optional " + option.Code, validated.Note is null);
}
try { WorkOrderApprovalReasonContract.Validate(null, null); failures.Add("reason selection required"); }
catch (ApprovalProblem problem) { Check("reason selection required", problem.Code == "decision_reason_code_invalid"); }
try { WorkOrderApprovalReasonContract.Validate("NOT_GOVERNED", null); failures.Add("unknown reason rejected"); }
catch (ApprovalProblem problem) { Check("unknown reason rejected", problem.Code == "decision_reason_code_invalid"); }
try { WorkOrderApprovalReasonContract.Validate("OTHER", "   "); failures.Add("blank Other note rejected"); }
catch (ApprovalProblem problem) { Check("blank Other note rejected", problem.Code == "other_decision_note_required"); }
var otherReason = WorkOrderApprovalReasonContract.Validate("OTHER", "  Verified by operator.  ");
Check("Other note trimmed", otherReason.Note == "Verified by operator.");
foreach (var option in NoWorkOrderRequiredReasonContract.Options)
{
    var validated = NoWorkOrderRequiredReasonContract.Validate(option.Code,
        option.Code == "OTHER" ? "Operator documented the direct-fulfillment exception." : null);
    Check("no-WO reason round trip " + option.Code, validated.Code == option.Code);
}
Check("no-WO reason schema V2", NoWorkOrderRequiredReasonContract.Schema ==
    "DLE_NO_WORK_ORDER_REQUIRED_REASON_V2");
Check("four active no-WO reasons", NoWorkOrderRequiredReasonContract.Options.Select(value => value.Code)
    .SequenceEqual(["PART_COMPONENT_ONLY", "CUSTOMER_SUPPLIED_MATERIAL",
        "SHIPPING_REPLACEMENT_MATERIAL_ONLY", "OTHER"]));
try { NoWorkOrderRequiredReasonContract.Validate("UNKNOWN", null); failures.Add("unknown no-WO reason rejected"); }
catch (ApprovalProblem problem) { Check("unknown no-WO reason rejected", problem.Code == "no_work_order_reason_code_invalid"); }
try { NoWorkOrderRequiredReasonContract.Validate("PURCHASED_RESALE_ITEM", null); failures.Add("retired no-WO reason rejected"); }
catch (ApprovalProblem problem) { Check("retired no-WO reason rejected", problem.Code == "no_work_order_reason_code_invalid"); }
Check("missing object classified as schema unavailable",
    ApprovalSqlFailure.Classify(208).Code == "approval_schema_unavailable");
Check("database write classified precisely",
    ApprovalSqlFailure.Classify(547).Code == "approval_database_write_failed");
Check("deadlock classified as concurrency",
    ApprovalSqlFailure.Classify(1205).Code == "approval_concurrency_conflict");
Check("exact choice is exact only", exact.ApprovalChoices.SequenceEqual(["0115593"]));
Check("snapshot identity captured", exact.SnapshotId == "DAILYOPSSYNC-20260804T011504Z-AD0D0F51");
Check("import identity captured", exact.ImportRunId == "dd334ad1-ea2f-4171-a8c9-193d6d25e656");
using (var evidence = JsonDocument.Parse(exact.CandidateSetJson))
    Check("complete candidate evidence captured", evidence.RootElement[0].TryGetProperty("itemNumber", out _));
Check("agrees exact", WorkOrderApprovalService.Classify("0115593", exact, true) == "APPROVED_AGREES_EXACT");
Check("conflicts exact", WorkOrderApprovalService.Classify("0115505", exact, true) == "APPROVED_CONFLICTS_EXACT");

var unique = Relationship("SALES_ORDER_ITEM_UNIQUE_CANDIDATE", null, "0115505", "0115600");
Check("item choice is applicable item only", unique.ApprovalChoices.SequenceEqual(["0115505"]));
Check("candidate supported", WorkOrderApprovalService.Classify("0115505", unique, true) == "APPROVED_SUPPORTED_CANDIDATE");
Check("candidate unsupported", WorkOrderApprovalService.Classify("0115600", unique, true) == "APPROVED_NOT_IN_CURRENT_CANDIDATES");

var ambiguous = Relationship("AMBIGUOUS", null, "0115350", "0115417");
Check("ambiguous choices complete", ambiguous.ApprovalChoices.Count == 2);
Check("approved ambiguity", WorkOrderApprovalService.Classify("0115350", ambiguous, true) == "APPROVED_WITH_CURRENT_AMBIGUITY");
Check("missing work order", WorkOrderApprovalService.Classify("0115350", ambiguous, false) == "APPROVED_WORK_ORDER_MISSING");
Check("no approval", WorkOrderApprovalService.Classify((string?)null, ambiguous, true) == "NO_APPROVAL");

var unresolved = Relationship("UNRESOLVED", null);
Check("unresolved has no choices", unresolved.ApprovalChoices.Count == 0);

var controlledMembership = new RmaReworkMembership(Guid.NewGuid(), "RMA-123");
try
{
    WorkOrderApprovalService.EnsureRmaAllowsApprovalAction(controlledMembership, "APPROVE");
    failures.Add("RMA-controlled approve rejected");
}
catch (ApprovalProblem problem)
{
    Check("RMA-controlled approve rejected", problem.Code == "rma_rework_controls_work_order_decision");
}
try
{
    WorkOrderApprovalService.EnsureRmaAllowsApprovalAction(controlledMembership, "REPLACE");
    failures.Add("RMA-controlled replacement rejected");
}
catch (ApprovalProblem problem)
{
    Check("RMA-controlled replacement rejected", problem.Code == "rma_rework_controls_work_order_decision");
}
WorkOrderApprovalService.EnsureRmaAllowsApprovalAction(controlledMembership, "REVOKE");

var safrranHistory = new[]
{
    new HistoricalWorkOrderEvidence("0115414", "ORIGINAL_BUILD", true, true,
        new DateTime(2024, 8, 27), "Earlier positive invoice and production evidence.")
};
var safrranKey = new LineKey("578350", "0011896", "010");
var safrranRelationship = Relationship("EXACT_LINE_UNIQUE", "0115414", "0115414");
var protectedReturn = OperationalWorkOrderRelationshipRules.Resolve(new(
    safrranKey, -1m, safrranRelationship, null, null, null, safrranHistory));
Check("Safran active Work Order suppressed", protectedReturn.ActiveWorkOrderNumber is null);
Check("Safran routed to return review", protectedReturn.OperationalRoute == "RETURN_RMA_REVIEW_REQUIRED");
Check("Safran original build retained", protectedReturn.HistoricalWorkOrders.Single().WorkOrderNumber == "0115414");
Check("Safran original build role", protectedReturn.HistoricalWorkOrders.Single().RelationshipRole == "ORIGINAL_BUILD");
Check("missing membership blocks approval", !WorkOrderApprovalService.OperationalAllowsApproval(protectedReturn));

var activeRma = OperationalWorkOrderRelationshipRules.Resolve(new(
    safrranKey, -1m, safrranRelationship, null,
    new RmaReworkMembership(Guid.Parse("be42eab9-1c24-403f-b005-a485d8d19989"), 1, "RMA 4228"),
    null, safrranHistory));
Check("active RMA has no normal Work Order", activeRma.ActiveWorkOrderNumber is null);
Check("active RMA decision pending", activeRma.OperationalStatus == "RMA_DECISION_PENDING");
Check("active RMA route", activeRma.OperationalRoute == "RMA_REWORK");

var issuedPendingEvent = new OperationalInterpretationEvent(Guid.NewGuid(),
    activeRma.RmaReworkControl!.CaseId, 1, null, "0115414", "ORIGINAL_BUILD",
    "RMA_DECISION_PENDING", "RMA/Rework membership issued; original build retained as history.",
    "DLE-OS-HOST\\DLE-OS", DateTime.UtcNow, null, Guid.NewGuid());
var reloadedIssuedRma = OperationalWorkOrderRelationshipRules.Resolve(new(
    safrranKey, -1m, safrranRelationship, null,
    new RmaReworkMembership(activeRma.RmaReworkControl.CaseId, 1, "RMA 4228"),
    issuedPendingEvent, safrranHistory));
Check("issued membership reload stays RMA", reloadedIssuedRma.OperationalRoute == "RMA_REWORK");
Check("issued membership reload active Work Order null", reloadedIssuedRma.ActiveWorkOrderNumber is null);
Check("issued membership reload historical Work Order", reloadedIssuedRma.HistoricalWorkOrders.Single().WorkOrderNumber == "0115414");
Check("issued membership reload approval blocked", !WorkOrderApprovalService.OperationalAllowsApproval(reloadedIssuedRma));

var assignedEvent = new OperationalInterpretationEvent(Guid.NewGuid(), activeRma.RmaReworkControl!.CaseId,
    1, "0115999", "0115414", "RMA_ASSIGNED", "RMA_WORK_ORDER_ASSIGNED",
    "Authorized repair Work Order assigned.", "DLE-OS-HOST\\DLE-OS", DateTime.UtcNow, null, Guid.NewGuid());
var assignedRma = OperationalWorkOrderRelationshipRules.Resolve(new(
    safrranKey, -1m, safrranRelationship, null,
    new RmaReworkMembership(activeRma.RmaReworkControl.CaseId, 1, "RMA 4225"),
    assignedEvent, safrranHistory));
Check("explicit RMA decision active", assignedRma.ActiveWorkOrderNumber == "0115999");
Check("explicit RMA decision source", assignedRma.ActiveWorkOrderSource == "RMA_DECISION");

var normalPositive = OperationalWorkOrderRelationshipRules.Resolve(new(
    new LineKey("001082", "0012097", "010"), 5m,
    Relationship("EXACT_LINE_UNIQUE", "0115619", "0115619"), null, null, null, []));
Check("positive exact unchanged", normalPositive.ActiveWorkOrderNumber == "0115619");
Check("positive normal route", normalPositive.OperationalRoute == "NORMAL_PRODUCTION");

var noWorkOrderDecision = new DecisionRecord(Guid.NewGuid(), "APPROVE",
    "NO_WORK_ORDER_REQUIRED_COMPONENT", null, null, "AMBIGUOUS", null, null, null,
    new string('A', 64), "[]", "NO_WORK_ORDER_REQUIRED_COMPONENT", "Part/Component Only",
    "PART_COMPONENT_ONLY", null, "DLE-OS-HOST\\DLE-OS", DateTime.UtcNow, Guid.NewGuid());
var kingNutronics = OperationalWorkOrderRelationshipRules.Resolve(new(
    new LineKey("001238", "0012090", "090"), 60m,
    Relationship("AMBIGUOUS", null, "0115611", "0115612"),
    noWorkOrderDecision, null, null, []));
Check("no-WO active Work Order remains null", kingNutronics.ActiveWorkOrderNumber is null);
Check("no-WO direct fulfillment route", kingNutronics.OperationalRoute == "DIRECT_FULFILLMENT");
Check("no-WO status", kingNutronics.OperationalStatus == "NO_WORK_ORDER_REQUIRED");
Check("no-WO remains shippable", kingNutronics.FulfillmentRequired && kingNutronics.ShippingRequired);
Check("no-WO excludes production", !kingNutronics.ProductionWorkOrderRequired);
Check("no-WO classification", WorkOrderApprovalService.Classify(noWorkOrderDecision, ambiguous, true) ==
    "NO_WORK_ORDER_REQUIRED_COMPONENT");
var rmaOverNoWorkOrder = OperationalWorkOrderRelationshipRules.Resolve(new(
    new LineKey("001238", "0012090", "090"), 60m, ambiguous, noWorkOrderDecision,
    new RmaReworkMembership(Guid.NewGuid(), 1, "RMA TEST"), null, []));
Check("RMA precedence over no-WO", rmaOverNoWorkOrder.OperationalRoute == "RMA_REWORK");

var negativeWithoutHistory = OperationalWorkOrderRelationshipRules.Resolve(new(
    new LineKey("578350", "0011896", "050"), -2m,
    Relationship("UNRESOLVED", null), null, null, null, []));
Check("negative line invents no Work Order", negativeWithoutHistory.ActiveWorkOrderNumber is null);
Check("negative line remains protected", negativeWithoutHistory.OperationalStatus == "RETURN_REVIEW_REQUIRED");

var key = LineKey.Create("1082", "12097", "10");
Check("identity normalization", key == new LineKey("001082", "0012097", "010"));
try { LineKey.Create("customer", "12097", "10"); failures.Add("malformed identifier"); }
catch (ApprovalProblem problem) { Check("malformed identifier", problem.Code == "malformed_identifier"); }

await using (var connection = new SqlConnection(
    @"Server=lpc:.\SQLEXPRESS;Database=tempdb;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;"))
{
    await connection.OpenAsync();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
    async Task ApplyMigration(params string[] parts)
    {
        var migrationPath = Path.GetFullPath(Path.Combine(
            new[] { AppContext.BaseDirectory, "..", "..", "..", "..", ".." }.Concat(parts).ToArray()));
        var migration = await File.ReadAllTextAsync(migrationPath);
        foreach (var batch in System.Text.RegularExpressions.Regex.Split(
            migration, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline |
            System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            if (!string.IsNullOrWhiteSpace(batch))
                await new SqlCommand(batch, connection, transaction).ExecuteNonQueryAsync();
    }
    await ApplyMigration("Tools", "WorkOrderApproval", "Database", "001_AddSalesOrderLineWorkOrderDecision.sql");
    await ApplyMigration("Tools", "WorkOrderApproval", "Database", "002_AddGovernedDecisionReasons.sql");
    var beforeNoWorkOrderMigration = Convert.ToInt32(await new SqlCommand(
        ApprovalRepository.SchemaReadinessSql, connection, transaction).ExecuteScalarAsync());
    Check("missing migration 003 detected precisely", beforeNoWorkOrderMigration == 0);
    var eventsBeforeMigrationFailure = Convert.ToInt32(await new SqlCommand(
        "SELECT COUNT(*) FROM operational.SalesOrderLineWorkOrderDecisionEvent;",
        connection, transaction).ExecuteScalarAsync());
    Check("missing migration detection writes no event", eventsBeforeMigrationFailure == 0);
    await ApplyMigration("Tools", "WorkOrderApproval", "Database", "003_AddNoWorkOrderRequiredDecision.sql");
    var fullyMigrated = Convert.ToInt32(await new SqlCommand(
        ApprovalRepository.SchemaReadinessSql, connection, transaction).ExecuteScalarAsync());
    Check("fully migrated store detected", fullyMigrated == 1);
    await new SqlCommand("ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent DROP CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_Classification;",
        connection, transaction).ExecuteNonQueryAsync();
    var partiallyMigrated = Convert.ToInt32(await new SqlCommand(
        ApprovalRepository.SchemaReadinessSql, connection, transaction).ExecuteScalarAsync());
    Check("partial schema detected precisely", partiallyMigrated == 0);
    var eventsAfterPartialSchemaFailure = Convert.ToInt32(await new SqlCommand(
        "SELECT COUNT(*) FROM operational.SalesOrderLineWorkOrderDecisionEvent;",
        connection, transaction).ExecuteScalarAsync());
    Check("partial schema detection writes no event", eventsAfterPartialSchemaFailure == 0);
    await ApplyMigration("Tools", "WorkOrderApproval", "Database", "003_AddNoWorkOrderRequiredDecision.sql");
    await ApplyMigration("Tools", "RmaRework", "Database", "001_AddRmaReworkCase.sql");
    await ApplyMigration("Tools", "RmaRework", "Database", "002_AddSalesOrderLineWorkOrderInterpretation.sql");
    await new SqlCommand("SET XACT_ABORT OFF;", connection, transaction).ExecuteNonQueryAsync();

    var approvalId = Guid.NewGuid();
    var replacementId = Guid.NewGuid();
    var revocationId = Guid.NewGuid();
    var replayCorrelation = Guid.NewGuid();
    async Task Insert(Guid id, string action, string? workOrder, Guid? supersedes, Guid correlation)
    {
        var command = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 ApprovedWorkOrderNumber,SupersedesDecisionId,CandidateResolutionStatusAtDecision,
 CanonicalExactWorkOrderAtDecision,CandidateSnapshotImportRunId,CandidateSetHash,
 CandidateSetJson,SelectionSource,DecisionReason,DecisionReasonCode,DecisionNote,
 ApprovedBy,RequestCorrelationId)
VALUES(@Id,'001082','0011998','040',@Action,@WorkOrder,@Supersedes,
 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',NULL,NULL,REPLICATE('A',64),
 '["0115505","0115506"]','TEST','Supervisor review','SUPERVISOR_REVIEW',NULL,
 'DLE-OS-HOST\DLE-OS',@Correlation);
""", connection, transaction);
        command.Parameters.AddWithValue("@Id", id);
        command.Parameters.AddWithValue("@Action", action);
        command.Parameters.AddWithValue("@WorkOrder", (object?)workOrder ?? DBNull.Value);
        command.Parameters.AddWithValue("@Supersedes", (object?)supersedes ?? DBNull.Value);
        command.Parameters.AddWithValue("@Correlation", correlation);
        await command.ExecuteNonQueryAsync();
    }
    async Task<string?> Current()
    {
        var value = await new SqlCommand(
            "SELECT ApprovedWorkOrderNumber FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision;",
            connection, transaction).ExecuteScalarAsync();
        return value is null or DBNull ? null : (string)value;
    }

    await Insert(approvalId, "APPROVE", "0115505", null, replayCorrelation);
    Check("first approval current", await Current() == "0115505");
    var persistedReasonCode = await new SqlCommand(
        "SELECT DecisionReasonCode FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision;",
        connection, transaction).ExecuteScalarAsync();
    Check("governed reason code persists", Convert.ToString(persistedReasonCode) == "SUPERVISOR_REVIEW");
    await Insert(replacementId, "REPLACE", "0115506", approvalId, Guid.NewGuid());
    Check("replacement current", await Current() == "0115506");
    await Insert(revocationId, "REVOKE", null, replacementId, Guid.NewGuid());
    Check("revocation clears current", await Current() is null);
    var historyCount = Convert.ToInt32(await new SqlCommand(
        "SELECT COUNT(*) FROM operational.SalesOrderLineWorkOrderDecisionEvent;",
        connection, transaction).ExecuteScalarAsync());
    Check("history preserved", historyCount == 3);

    var noWorkOrderId = Guid.NewGuid();
    var insertNoWorkOrder = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(@Id,'001238','0012090','090','APPROVE','NO_WORK_ORDER_REQUIRED_COMPONENT',NULL,NULL,
 'AMBIGUOUS',REPLICATE('B',64),'["0115611","0115612"]','NO_WORK_ORDER_REQUIRED_COMPONENT',
 'Part/Component Only','PART_COMPONENT_ONLY','DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction);
    insertNoWorkOrder.Parameters.AddWithValue("@Id", noWorkOrderId);
    await insertNoWorkOrder.ExecuteNonQueryAsync();
    var currentNoWorkOrder = await new SqlCommand("""
SELECT DecisionClassification,ApprovedWorkOrderNumber,DecisionReasonCode
FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE CustomerNumber='001238' AND SalesOrderNumber='0012090' AND SalesOrderLineNumber='090';
""", connection, transaction).ExecuteReaderAsync();
    Check("no-WO current event exists", await currentNoWorkOrder.ReadAsync());
    Check("no-WO classification persists", currentNoWorkOrder.GetString(0) == "NO_WORK_ORDER_REQUIRED_COMPONENT");
    Check("no fake Work Order persists", currentNoWorkOrder.IsDBNull(1));
    Check("no-WO governed reason persists", currentNoWorkOrder.GetString(2) == "PART_COMPONENT_ONLY");
    await currentNoWorkOrder.DisposeAsync();

    await new SqlCommand("""
ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
    DROP CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode;
ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
    ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode
    CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode IN
        ('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
         'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
         'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW',
         'PART_COMPONENT_ONLY','CUSTOMER_SUPPLIED_MATERIAL','PURCHASED_RESALE_ITEM',
         'SHIPPING_REPLACEMENT_MATERIAL_ONLY','OTHER'));
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(NEWID(),'001238','0012090','092','APPROVE','NO_WORK_ORDER_REQUIRED_COMPONENT',NULL,NULL,
 'UNRESOLVED',REPLICATE('R',64),'[]','NO_WORK_ORDER_REQUIRED_COMPONENT',
 'Purchased Item / Resale Item','PURCHASED_RESALE_ITEM','DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction).ExecuteNonQueryAsync();
    await ApplyMigration("Tools", "WorkOrderApproval", "Database", "003_AddNoWorkOrderRequiredDecision.sql");
    var retiredHistoryReadable = Convert.ToInt32(await new SqlCommand("""
SELECT COUNT(*) FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE SalesOrderNumber='0012090' AND SalesOrderLineNumber='092'
  AND DecisionReasonCode='PURCHASED_RESALE_ITEM'
  AND DecisionReason='Purchased Item / Resale Item';
""", connection, transaction).ExecuteScalarAsync());
    Check("retired no-WO history remains readable", retiredHistoryReadable == 1);
    await new SqlCommand("SET XACT_ABORT OFF;", connection, transaction).ExecuteNonQueryAsync();
    try
    {
        await new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(NEWID(),'001238','0012090','093','APPROVE','NO_WORK_ORDER_REQUIRED_COMPONENT',NULL,NULL,
 'UNRESOLVED',REPLICATE('N',64),'[]','NO_WORK_ORDER_REQUIRED_COMPONENT',
 'Purchased Item / Resale Item','PURCHASED_RESALE_ITEM','DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction).ExecuteNonQueryAsync();
        failures.Add("retired no-WO reason rejected by SQL");
    }
    catch (SqlException error)
    {
        Check("retired no-WO reason rejected by SQL", error.Number == 547);
    }

    var realWorkOrderReplacement = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(NEWID(),'001238','0012090','090','REPLACE','WORK_ORDER_APPROVAL','0115611',@Supersedes,
 'AMBIGUOUS',REPLICATE('C',64),'["0115611","0115612"]','AMBIGUOUS_CANDIDATE_SELECTION',
 'Supervisor review','SUPERVISOR_REVIEW','DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction);
    realWorkOrderReplacement.Parameters.AddWithValue("@Supersedes", noWorkOrderId);
    await realWorkOrderReplacement.ExecuteNonQueryAsync();
    var replacementWorkOrder = await new SqlCommand("""
SELECT ApprovedWorkOrderNumber FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE CustomerNumber='001238' AND SalesOrderNumber='0012090' AND SalesOrderLineNumber='090';
""", connection, transaction).ExecuteScalarAsync();
    Check("real Work Order supersedes no-WO", Convert.ToString(replacementWorkOrder) == "0115611");

    var revocableNoWorkOrderId = Guid.NewGuid();
    var revokedNoWorkOrderId = Guid.NewGuid();
    var noWorkOrderLifecycle = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(@ApproveId,'001238','0012090','091','APPROVE','NO_WORK_ORDER_REQUIRED_COMPONENT',NULL,NULL,
 'UNRESOLVED',REPLICATE('D',64),'[]','NO_WORK_ORDER_REQUIRED_COMPONENT',
 'Part/Component Only','PART_COMPONENT_ONLY','DLE-OS-HOST\DLE-OS',NEWID());
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 DecisionClassification,ApprovedWorkOrderNumber,SupersedesDecisionId,
 CandidateResolutionStatusAtDecision,CandidateSetHash,CandidateSetJson,SelectionSource,
 DecisionReason,DecisionReasonCode,ApprovedBy,RequestCorrelationId)
VALUES(@RevokeId,'001238','0012090','091','REVOKE','NO_WORK_ORDER_REQUIRED_COMPONENT',NULL,@ApproveId,
 'UNRESOLVED',REPLICATE('E',64),'[]','REVOCATION',
 'Supervisor review','SUPERVISOR_REVIEW','DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction);
    noWorkOrderLifecycle.Parameters.AddWithValue("@ApproveId", revocableNoWorkOrderId);
    noWorkOrderLifecycle.Parameters.AddWithValue("@RevokeId", revokedNoWorkOrderId);
    await noWorkOrderLifecycle.ExecuteNonQueryAsync();
    var revokedCurrentCount = Convert.ToInt32(await new SqlCommand("""
SELECT COUNT(*) FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE CustomerNumber='001238' AND SalesOrderNumber='0012090' AND SalesOrderLineNumber='091';
""", connection, transaction).ExecuteScalarAsync());
    Check("no-WO revocation restores canonical state", revokedCurrentCount == 0);

    var persistedRmaCaseId = Guid.NewGuid();
    var insertRma = new SqlCommand("""
INSERT operational.RmaReworkCase
(CaseId,CustomerNumber,CaseType,InternalReference,CaseStatus,CreatedBy,RequestCorrelationId,EvidenceToken)
VALUES(@CaseId,'578350','RMA_RETURN_REPLACEMENT','RMA 4228','ACTIVE','DLE-OS-HOST\DLE-OS',NEWID(),REPLICATE('B',64));
INSERT operational.RmaReworkCaseMember
(CaseId,MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,
 ItemNumber,QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,
 RelatedWorkOrderNumber,RelationshipStatus,RelationshipBasis,CaseStatus)
VALUES(@CaseId,1,'578350','0011896','010','5783500011896010','500144-103',-1,-1,0,0,
 '0115414','EXACT_LINE_UNIQUE','CUSTOMER+SALES_ORDER+SALES_ORDER_LINE','ACTIVE');
""", connection, transaction);
    insertRma.Parameters.AddWithValue("@CaseId", persistedRmaCaseId);
    await insertRma.ExecuteNonQueryAsync();

    var interpretationId = Guid.NewGuid();
    var interpretationCorrelation = Guid.NewGuid();
    var interpretation = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderInterpretationEvent
(EventId,RmaCaseId,RmaMemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,ActiveWorkOrderNumber,
 HistoricalWorkOrderNumber,RelationshipRole,ResultingOperationalStatus,Reason,RecordedBy,
 SupersedesEventId,RequestCorrelationId)
VALUES(@Id,@CaseId,1,'578350','0011896','010',NULL,'0115414','ORIGINAL_BUILD',
 'RMA_DECISION_PENDING','RMA membership issued; historical production Work Order retained.',
 'DLE-OS-HOST\DLE-OS',NULL,@Correlation);
""", connection, transaction);
    interpretation.Parameters.AddWithValue("@Id", interpretationId);
    interpretation.Parameters.AddWithValue("@CaseId", persistedRmaCaseId);
    interpretation.Parameters.AddWithValue("@Correlation", interpretationCorrelation);
    await interpretation.ExecuteNonQueryAsync();
    var persisted = await new SqlCommand("""
SELECT RmaCaseId,RmaMemberSequence,HistoricalWorkOrderNumber,RelationshipRole,ResultingOperationalStatus,RecordedBy
FROM operational.vw_CurrentSalesOrderLineWorkOrderInterpretation
WHERE CustomerNumber='578350' AND SalesOrderNumber='0011896' AND SalesOrderLineNumber='010';
""", connection, transaction).ExecuteReaderAsync();
    Check("interpretation reload exists", await persisted.ReadAsync());
    Check("interpretation RMA case persists", persisted.GetGuid(0) == persistedRmaCaseId);
    Check("interpretation member sequence persists", persisted.GetInt32(1) == 1);
    Check("interpretation historical Work Order persists", persisted.GetString(2) == "0115414");
    Check("interpretation role persists", persisted.GetString(3) == "ORIGINAL_BUILD");
    Check("interpretation status persists", persisted.GetString(4) == "RMA_DECISION_PENDING");
    Check("interpretation actor persists", persisted.GetString(5) == "DLE-OS-HOST\\DLE-OS");
    await persisted.DisposeAsync();
    try
    {
        await new SqlCommand(
            "UPDATE operational.SalesOrderLineWorkOrderDecisionEvent SET DecisionReason='rewrite';",
            connection, transaction).ExecuteNonQueryAsync();
        failures.Add("append-only update blocked");
    }
    catch (SqlException error) { Check("append-only update blocked", error.Number == 51001); }
    try
    {
        await Insert(Guid.NewGuid(), "APPROVE", "0115505", null, replayCorrelation);
        failures.Add("duplicate correlation blocked");
    }
    catch (SqlException) { Check("duplicate correlation blocked", true); }
    await transaction.RollbackAsync();
}

await using (var connection = new SqlConnection(
    @"Server=lpc:.\SQLEXPRESS;Database=tempdb;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;"))
{
    await connection.OpenAsync();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
    async Task ApplyMigration(params string[] parts)
    {
        var path = Path.GetFullPath(Path.Combine(
            new[] { AppContext.BaseDirectory, "..", "..", "..", "..", ".." }.Concat(parts).ToArray()));
        var migration = await File.ReadAllTextAsync(path);
        foreach (var batch in System.Text.RegularExpressions.Regex.Split(
            migration, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline |
            System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            if (!string.IsNullOrWhiteSpace(batch))
                await new SqlCommand(batch, connection, transaction).ExecuteNonQueryAsync();
    }
    await ApplyMigration("Tools", "RmaRework", "Database", "001_AddRmaReworkCase.sql");
    await ApplyMigration("Tools", "RmaRework", "Database", "002_AddSalesOrderLineWorkOrderInterpretation.sql");
    await new SqlCommand("SET XACT_ABORT OFF;", connection, transaction).ExecuteNonQueryAsync();
    var insert = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderInterpretationEvent
(EventId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,HistoricalWorkOrderNumber,
 RelationshipRole,ResultingOperationalStatus,Reason,RecordedBy,RequestCorrelationId)
VALUES(NEWID(),'578350','0011896','010','0115414','ORIGINAL_BUILD',
 'RETURN_REVIEW_REQUIRED','Historical production Work Order for current return occurrence.',
 'DLE-OS-HOST\DLE-OS',NEWID());
""", connection, transaction);
    await insert.ExecuteNonQueryAsync();
    try
    {
        await new SqlCommand(
            "UPDATE operational.SalesOrderLineWorkOrderInterpretationEvent SET Reason='rewrite';",
            connection, transaction).ExecuteNonQueryAsync();
        failures.Add("interpretation append-only update blocked");
    }
    catch (SqlException error) { Check("interpretation append-only update blocked", error.Number == 51041); }
    await transaction.RollbackAsync();
}

if (failures.Count > 0)
{
    Console.Error.WriteLine("WORKORDER-APPROVAL-001 failures: " + string.Join(", ", failures));
    return 1;
}
Console.WriteLine("WORKORDER-APPROVAL-001 service classification: PASS");
return 0;
