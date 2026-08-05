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
Check("no approval", WorkOrderApprovalService.Classify(null, ambiguous, true) == "NO_APPROVAL");

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

foreach (var expected in new Dictionary<string, string>
{
    ["MATCHES_CONFIRMED_WO_ON_SAME_SALES_ORDER"] = "Matches confirmed WO on another SO line",
    ["CANDIDATE_EVIDENCE_VERIFIED"] = "Candidate evidence verified",
    ["SAME_ASSEMBLY_AND_PRODUCTION_RELEASE"] = "Same assembly and production release",
    ["HISTORICAL_RELATIONSHIP_VERIFIED"] = "Historical relationship verified",
    ["SPLIT_OR_RELATED_SALES_ORDER_LINE"] = "Split or related Sales Order line",
    ["OPERATIONAL_KNOWLEDGE_CONFIRMED"] = "Operational knowledge confirmed"
})
{
    var resolved = WorkOrderApprovalReasonCatalog.Resolve("APPROVE", expected.Key, "falsified", " note ");
    Check("approval reason " + expected.Key, resolved.Text == expected.Value &&
        resolved.Code == expected.Key && resolved.Note == "note");
}
foreach (var expected in new Dictionary<string, string>
{
    ["APPROVAL_ENTERED_IN_ERROR"] = "Approval entered in error",
    ["CANONICAL_EVIDENCE_CHANGED"] = "Canonical evidence changed",
    ["WORK_ORDER_RELATIONSHIP_REQUIRES_REVIEW"] = "Work Order relationship requires review",
    ["WORK_ORDER_NO_LONGER_APPLIES"] = "Work Order no longer applies"
})
    Check("revocation reason " + expected.Key,
        WorkOrderApprovalReasonCatalog.Resolve("REVOKE", expected.Key, "wrong", null).Text == expected.Value);
void ExpectReasonFailure(string name, string action, string? code, string? text, string? note,
    string expectedCode)
{
    try { WorkOrderApprovalReasonCatalog.Resolve(action, code, text, note); failures.Add(name); }
    catch (ApprovalProblem problem) { Check(name, problem.Code == expectedCode); }
}
ExpectReasonFailure("missing reason code", "APPROVE", null, null, null, "decision_reason_code_required");
ExpectReasonFailure("unknown reason code", "APPROVE", "NOT_ALLOWED", null, null, "decision_reason_code_invalid");
ExpectReasonFailure("approval reason rejected for revoke", "REVOKE", "CANDIDATE_EVIDENCE_VERIFIED", null, null, "decision_reason_code_invalid");
ExpectReasonFailure("revocation reason rejected for approve", "APPROVE", "APPROVAL_ENTERED_IN_ERROR", null, null, "decision_reason_code_invalid");
ExpectReasonFailure("other blank", "APPROVE", "OTHER", "  ", null, "decision_reason_text_required");
ExpectReasonFailure("other overlength", "APPROVE", "OTHER", new string('a', 501), null, "decision_reason_text_required");
ExpectReasonFailure("other controls", "APPROVE", "OTHER", "unsafe\ntext", null, "decision_reason_text_required");
ExpectReasonFailure("note overlength", "APPROVE", "CANDIDATE_EVIDENCE_VERIFIED", null,
    new string('n', 501), "decision_note_invalid");
ExpectReasonFailure("note controls", "APPROVE", "CANDIDATE_EVIDENCE_VERIFIED", null,
    "unsafe\ttext", "decision_note_invalid");
var other = WorkOrderApprovalReasonCatalog.Resolve("APPROVE", "OTHER", "  shop traveler confirms  ", null);
Check("other trimmed", other.Text == "shop traveler confirms" && other.Note is null);
var legacy = WorkOrderApprovalReasonCatalog.ResolveLegacy("  historical event  ");
Check("legacy compatibility", legacy.Code is null && legacy.Text == "historical event");

var key = LineKey.Create("1082", "12097", "10");
Check("identity normalization", key == new LineKey("001082", "0012097", "010"));
try { LineKey.Create("customer", "12097", "10"); failures.Add("malformed identifier"); }
catch (ApprovalProblem problem) { Check("malformed identifier", problem.Code == "malformed_identifier"); }

await using (var connection = new SqlConnection(
    @"Server=lpc:.\SQLEXPRESS;Database=tempdb;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;"))
{
    await connection.OpenAsync();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
    var migrationPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
        "..", "..", "..", "..", "..", "Tools", "WorkOrderApproval", "Database",
        "001_AddSalesOrderLineWorkOrderDecision.sql"));
    var migration = await File.ReadAllTextAsync(migrationPath);
    foreach (var batch in System.Text.RegularExpressions.Regex.Split(
        migration, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline |
        System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        if (!string.IsNullOrWhiteSpace(batch))
            await new SqlCommand(batch, connection, transaction).ExecuteNonQueryAsync();
    await new SqlCommand("SET XACT_ABORT OFF;", connection, transaction).ExecuteNonQueryAsync();

    var approvalId = Guid.NewGuid();
    var replacementId = Guid.NewGuid();
    var revocationId = Guid.NewGuid();
    var replayCorrelation = Guid.NewGuid();
    async Task Insert(Guid id, string action, string? workOrder, Guid? supersedes, Guid correlation,
        string? reasonCode = null, string reason = "fixture reason", string? note = null,
        string line = "040")
    {
        var command = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 ApprovedWorkOrderNumber,SupersedesDecisionId,CandidateResolutionStatusAtDecision,
 CanonicalExactWorkOrderAtDecision,CandidateSnapshotImportRunId,CandidateSetHash,
 CandidateSetJson,SelectionSource,DecisionReasonCode,DecisionReason,DecisionNote,ApprovedBy,RequestCorrelationId)
VALUES(@Id,'001082','0011998',@Line,@Action,@WorkOrder,@Supersedes,
 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',NULL,NULL,REPLICATE('A',64),
 '["0115505","0115506"]','TEST',@ReasonCode,@Reason,@Note,'DLE-OS-HOST\DLE-OS',@Correlation);
""", connection, transaction);
        command.Parameters.AddWithValue("@Id", id);
        command.Parameters.AddWithValue("@Action", action);
        command.Parameters.AddWithValue("@WorkOrder", (object?)workOrder ?? DBNull.Value);
        command.Parameters.AddWithValue("@Supersedes", (object?)supersedes ?? DBNull.Value);
        command.Parameters.AddWithValue("@Correlation", correlation);
        command.Parameters.AddWithValue("@ReasonCode", (object?)reasonCode ?? DBNull.Value);
        command.Parameters.AddWithValue("@Reason", reason);
        command.Parameters.AddWithValue("@Note", (object?)note ?? DBNull.Value);
        command.Parameters.AddWithValue("@Line", line);
        await command.ExecuteNonQueryAsync();
    }
    async Task<string?> Current()
    {
        var value = await new SqlCommand(
            "SELECT ApprovedWorkOrderNumber FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision;",
            connection, transaction).ExecuteScalarAsync();
        return value is null or DBNull ? null : (string)value;
    }

    await Insert(approvalId, "APPROVE", "0115505", null, replayCorrelation,
        "MATCHES_CONFIRMED_WO_ON_SAME_SALES_ORDER", "Matches confirmed WO on another SO line", "line 010");
    Check("first approval current", await Current() == "0115505");
    await Insert(replacementId, "REPLACE", "0115506", approvalId, Guid.NewGuid(),
        "CANDIDATE_EVIDENCE_VERIFIED", "Candidate evidence verified");
    Check("replacement current", await Current() == "0115506");
    await Insert(revocationId, "REVOKE", null, replacementId, Guid.NewGuid(),
        "APPROVAL_ENTERED_IN_ERROR", "Approval entered in error");
    Check("revocation clears current", await Current() is null);
    var historyCount = Convert.ToInt32(await new SqlCommand(
        "SELECT COUNT(*) FROM operational.SalesOrderLineWorkOrderDecisionEvent;",
        connection, transaction).ExecuteScalarAsync());
    Check("history preserved", historyCount == 3);
    var audit = await new SqlCommand(
        "SELECT DecisionReasonCode+'|'+DecisionReason+'|'+DecisionNote FROM operational.SalesOrderLineWorkOrderDecisionEvent WHERE DecisionId='" +
        approvalId + "';", connection, transaction).ExecuteScalarAsync();
    Check("controlled reason persisted", Convert.ToString(audit) ==
        "MATCHES_CONFIRMED_WO_ON_SAME_SALES_ORDER|Matches confirmed WO on another SO line|line 010");
    var legacyId = Guid.NewGuid();
    await Insert(legacyId, "APPROVE", "0115505", null, Guid.NewGuid(), line: "050");
    var historicalReasonCode = await new SqlCommand(
        "SELECT DecisionReasonCode FROM operational.SalesOrderLineWorkOrderDecisionEvent WHERE DecisionId='" +
        legacyId + "';", connection, transaction).ExecuteScalarAsync();
    Check("historical null reason code readable", historicalReasonCode is null or DBNull);
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

if (failures.Count > 0)
{
    Console.Error.WriteLine("WORKORDER-APPROVAL-001 failures: " + string.Join(", ", failures));
    return 1;
}
Console.WriteLine("WORKORDER-APPROVAL-001 service classification: PASS");
return 0;
