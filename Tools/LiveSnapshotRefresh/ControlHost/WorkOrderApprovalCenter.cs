using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using Microsoft.Data.SqlClient;

[assembly: InternalsVisibleTo("DleOs.WorkOrderApproval.Tests")]

internal static class WorkOrderApprovalCenter
{
    private const string Route = "/api/work-order-approvals/v1/sales-order-lines/{customerNumber}/{salesOrderNumber}/{lineNumber}";

    public static void MapWorkOrderApprovals(this WebApplication app, string policy)
    {
        var service = new WorkOrderApprovalService();
        app.MapGet(Route, async (string customerNumber, string salesOrderNumber,
                string lineNumber, HttpContext context, CancellationToken cancellationToken) =>
            await Execute(context, app.Logger, () => service.GetReviewAsync(
                LineKey.Create(customerNumber, salesOrderNumber, lineNumber), cancellationToken)))
            .RequireAuthorization(policy);

        MapAction(app, service, policy, "approve", "APPROVE", "WORK_ORDER_APPROVAL");
        MapAction(app, service, policy, "replace", "REPLACE", "WORK_ORDER_APPROVAL");
        MapAction(app, service, policy, "approve-no-work-order", "APPROVE", "NO_WORK_ORDER_REQUIRED_COMPONENT");
        MapAction(app, service, policy, "replace-no-work-order", "REPLACE", "NO_WORK_ORDER_REQUIRED_COMPONENT");
        MapAction(app, service, policy, "revoke", "REVOKE", null);
    }

    private static void MapAction(WebApplication app, WorkOrderApprovalService service,
        string policy, string routeAction, string decisionAction, string? decisionClassification)
    {
        app.MapPost(Route + "/" + routeAction,
            async (string customerNumber, string salesOrderNumber, string lineNumber,
                ApprovalActionRequest request, HttpContext context, CancellationToken cancellationToken) =>
                await Execute(context, app.Logger, () => service.DecideAsync(
                    LineKey.Create(customerNumber, salesOrderNumber, lineNumber),
                    decisionAction, decisionClassification, request,
                    TrustedDevelopmentIdentity.RequireActorName(context), cancellationToken)))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(HttpContext context, ILogger logger,
        Func<Task<object>> action)
    {
        context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
        try { return Results.Json(await action()); }
        catch (ApprovalProblem problem)
        {
            return Results.Json(new
                { code = problem.Code, message = problem.Message, requestId = context.TraceIdentifier },
                statusCode: problem.StatusCode);
        }
        catch (SqlException error)
        {
            var failure = ApprovalSqlFailure.Classify(error.Number);
            logger.LogError(error,
                "Work Order approval SQL failure {FailureCode}; SQL {SqlNumber}, procedure {Procedure}, line {SqlLine}; request {RequestId}; route {Route}",
                failure.Code, error.Number, error.Procedure, error.LineNumber,
                context.TraceIdentifier, context.Request.Path);
            return Results.Json(new
            {
                code = failure.Code,
                message = failure.Message,
                requestId = context.TraceIdentifier
            }, statusCode: failure.StatusCode);
        }
        catch (HttpRequestException)
        {
            return Results.Json(new
            {
                code = "canonical_evidence_unavailable",
                message = "Current canonical Work Order relationship evidence is unavailable.",
                requestId = context.TraceIdentifier
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

internal sealed record ApprovalSqlFailure(int StatusCode, string Code, string Message)
{
    internal static ApprovalSqlFailure Classify(int sqlNumber) => sqlNumber switch
    {
        207 or 208 or 2812 => new(StatusCodes.Status503ServiceUnavailable,
            "approval_schema_unavailable",
            "The required Work Order approval migration or schema is unavailable."),
        1205 or 2601 or 2627 or 3960 => new(StatusCodes.Status409Conflict,
            "approval_concurrency_conflict",
            "The governing decision changed concurrently. Reload and review again."),
        -1 or 2 or 53 or 4060 or 18456 => new(StatusCodes.Status503ServiceUnavailable,
            "approval_store_unavailable",
            "The governed Work Order approval store is unavailable."),
        _ => new(StatusCodes.Status500InternalServerError,
            "approval_database_write_failed",
            "The governed Work Order decision could not be written. No decision was recorded.")
    };
}

internal sealed record DecisionReasonOption(string Code, string Label);

internal sealed record ValidatedDecisionReason(string Code, string? Note, string LegacyReason);

internal static class WorkOrderApprovalReasonContract
{
    internal const string Schema = "DLE_WORK_ORDER_APPROVAL_REASON_V1";
    internal static readonly IReadOnlyList<DecisionReasonOption> Options =
    [
        new("ERP_CONFIRMED_CANDIDATE_MATCH", "ERP confirmed and candidate matches"),
        new("SALES_ORDER_ITEM_MATCH", "Candidate matches Sales Order and item"),
        new("HISTORICAL_RELATIONSHIP_VERIFIED", "Historical relationship verified"),
        new("SUPPORTING_DOCUMENTATION_VERIFIED", "Work Order verified from supporting documentation"),
        new("CUSTOMER_RMA_RELATIONSHIP_VERIFIED", "Customer or RMA relationship verified"),
        new("SUPERVISOR_REVIEW", "Supervisor review"),
        new("OTHER", "Other")
    ];

    internal static ValidatedDecisionReason Validate(string? codeValue, string? noteValue)
    {
        var code = (codeValue ?? "").Trim().ToUpperInvariant();
        var option = Options.SingleOrDefault(value => value.Code == code);
        if (option is null)
            throw ApprovalProblem.BadRequest("decision_reason_code_invalid",
                "Select a governed Work Order approval decision reason.");

        var note = string.IsNullOrWhiteSpace(noteValue) ? null : noteValue.Trim();
        if (note?.Length > 500)
            throw ApprovalProblem.BadRequest("decision_note_too_long",
                "The decision note cannot exceed 500 characters.");
        if (code == "OTHER" && note is null)
            throw ApprovalProblem.BadRequest("other_decision_note_required",
                "Other requires a nonblank decision note.");

        return new(code, note, option.Label);
    }
}

internal static class NoWorkOrderRequiredReasonContract
{
    internal const string Schema = "DLE_NO_WORK_ORDER_REQUIRED_REASON_V2";
    internal static readonly IReadOnlyList<DecisionReasonOption> Options =
    [
        new("PART_COMPONENT_ONLY", "Part/Component Only"),
        new("CUSTOMER_SUPPLIED_MATERIAL", "Customer-Supplied Material"),
        new("SHIPPING_REPLACEMENT_MATERIAL_ONLY", "Shipping or Replacement Material Only"),
        new("OTHER", "Other")
    ];

    internal static ValidatedDecisionReason Validate(string? codeValue, string? noteValue)
    {
        var code = (codeValue ?? "").Trim().ToUpperInvariant();
        var option = Options.SingleOrDefault(value => value.Code == code);
        if (option is null)
            throw ApprovalProblem.BadRequest("no_work_order_reason_code_invalid",
                "Select a governed No Work Order Required decision reason.");

        var note = string.IsNullOrWhiteSpace(noteValue) ? null : noteValue.Trim();
        if (note?.Length > 500)
            throw ApprovalProblem.BadRequest("decision_note_too_long",
                "The decision note cannot exceed 500 characters.");
        if (code == "OTHER" && note is null)
            throw ApprovalProblem.BadRequest("other_decision_note_required",
                "Other requires a nonblank decision note.");
        return new(code, note, option.Label);
    }
}

internal sealed class WorkOrderApprovalService
{
    private readonly ApprovalRepository _repository = new();
    private readonly RmaReworkRepository _rmaRepository = new();
    private readonly OperationalWorkOrderRelationshipService _operationalRelationships;
    private readonly HttpClient _canonical;

    public WorkOrderApprovalService()
    {
        _canonical = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
        _operationalRelationships = new OperationalWorkOrderRelationshipService(_canonical);
    }

    public async Task<object> GetReviewAsync(LineKey key, CancellationToken cancellationToken)
    {
        await _repository.EnsureSchemaReadyAsync(cancellationToken);
        var relationship = await LoadRelationshipAsync(key, cancellationToken);
        var current = await _repository.GetCurrentAsync(key, cancellationToken);
        var membership = await GetActiveRmaMembershipAsync(key, cancellationToken);
        var operational = await _operationalRelationships.LoadAsync(key, cancellationToken);
        var choices = membership is null ? relationship.ApprovalChoices : Array.Empty<string>();
        if (!OperationalAllowsApproval(operational)) choices = Array.Empty<string>();
        var workOrderExists = current is null || string.IsNullOrEmpty(current.ApprovedWorkOrderNumber) ||
            await WorkOrderExistsAsync(current.ApprovedWorkOrderNumber, cancellationToken);
        var classification = Classify(current, relationship, workOrderExists);
        var history = await _repository.GetHistoryAsync(key, cancellationToken);
        return BuildReview(key, relationship, current, history, classification, choices, membership,
            operational);
    }

    public async Task<object> DecideAsync(LineKey key, string action, string? decisionClassification,
        ApprovalActionRequest request,
        string authenticatedUser, CancellationToken cancellationToken)
    {
        var classification = decisionClassification ?? "REVOCATION";
        var reason = classification == "NO_WORK_ORDER_REQUIRED_COMPONENT"
            ? NoWorkOrderRequiredReasonContract.Validate(request.DecisionReasonCode, request.DecisionNote)
            : WorkOrderApprovalReasonContract.Validate(request.DecisionReasonCode, request.DecisionNote);

        await _repository.EnsureSchemaReadyAsync(cancellationToken);

        var membership = await GetActiveRmaMembershipAsync(key, cancellationToken);
        EnsureRmaAllowsApprovalAction(membership, action);
        var operational = await _operationalRelationships.LoadAsync(key, cancellationToken);
        EnsureOperationalAllowsApprovalAction(operational, action);

        var relationship = await LoadRelationshipAsync(key, cancellationToken);
        var current = await _repository.GetCurrentAsync(key, cancellationToken);
        var currentToken = CreateEvidenceToken(key, relationship, current?.DecisionId);
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(currentToken), Encoding.UTF8.GetBytes(request.EvidenceToken ?? "")))
            throw ApprovalProblem.Conflict("stale_relationship_evidence",
                "Canonical relationship evidence or the current approval changed. Reload and review again.");

        if (request.ExpectedCurrentDecisionId != current?.DecisionId)
            throw ApprovalProblem.Conflict("current_decision_changed",
                "The governing approval changed. Reload and review again.");

        string? selected = null;
        if (action is ("APPROVE" or "REPLACE") && classification == "WORK_ORDER_APPROVAL")
        {
            selected = NormalizeWorkOrder(request.SelectedWorkOrderNumber);
            if (selected is null || !relationship.ApprovalChoices.Contains(selected, StringComparer.Ordinal))
                throw ApprovalProblem.BadRequest("work_order_outside_current_evidence",
                    "Select a Work Order from the current canonical relationship evidence.");
            if (!await WorkOrderExistsAsync(selected, cancellationToken))
                throw ApprovalProblem.BadRequest("canonical_work_order_missing",
                    "The selected Work Order does not exist in the current canonical Work Order dataset.");
        }

        if (action == "APPROVE" && current is not null)
            throw ApprovalProblem.Conflict("approval_already_exists", "This Sales Order line already has an approval.");
        if (action is "REPLACE" or "REVOKE" && current is null)
            throw ApprovalProblem.Conflict("approval_not_current", "There is no current approval to supersede.");
        if (action == "REPLACE" && classification == current!.DecisionClassification &&
            selected == current.ApprovedWorkOrderNumber)
            throw ApprovalProblem.BadRequest("replacement_must_change_work_order",
                "Replacement must change the governing decision.");

        var persistedClassification = action == "REVOKE"
            ? current!.DecisionClassification : classification;
        var decision = await _repository.AppendAsync(key, action, persistedClassification, selected,
            current?.DecisionId,
            relationship, reason, operational.QuantityOrdered, authenticatedUser, cancellationToken);
        var refreshed = await _repository.GetCurrentAsync(key, cancellationToken);
        var history = await _repository.GetHistoryAsync(key, cancellationToken);
        var exists = refreshed is null || string.IsNullOrEmpty(refreshed.ApprovedWorkOrderNumber) ||
            await WorkOrderExistsAsync(refreshed.ApprovedWorkOrderNumber, cancellationToken);
        membership = await GetActiveRmaMembershipAsync(key, cancellationToken);
        operational = await _operationalRelationships.LoadAsync(key, cancellationToken);
        return BuildReview(key, relationship, refreshed, history,
            Classify(refreshed, relationship, exists),
            membership is null && OperationalAllowsApproval(operational)
                ? relationship.ApprovalChoices : Array.Empty<string>(),
            membership, operational, decision.RequestCorrelationId);
    }

    private object BuildReview(LineKey key, CanonicalRelationship relationship,
        DecisionRecord? current, IReadOnlyList<DecisionRecord> history, string classification,
        IReadOnlyList<string> choices, RmaReworkMembership? membership,
        OperationalRelationshipPresentation operational, Guid? correlationId = null) => new
    {
        identity = new { customerNumber = key.Customer, salesOrderNumber = key.SalesOrder, salesOrderLineNumber = key.Line },
        canonicalRelationship = relationship.Raw,
        currentApproval = current,
        decisionHistory = history,
        conflictClassification = classification,
        evidenceToken = CreateEvidenceToken(key, relationship, current?.DecisionId),
        availableApprovalChoices = choices,
        decisionReasonContract = new
        {
            schema = WorkOrderApprovalReasonContract.Schema,
            options = WorkOrderApprovalReasonContract.Options,
            otherCode = "OTHER"
        },
        noWorkOrderDecisionReasonContract = new
        {
            schema = NoWorkOrderRequiredReasonContract.Schema,
            options = NoWorkOrderRequiredReasonContract.Options,
            otherCode = "OTHER"
        },
        operationalRelationship = operational,
        permissions = new
        {
            canApprove = OperationalAllowsApproval(operational) && membership is null && current is null && choices.Count > 0,
            canReplace = OperationalAllowsApproval(operational) && membership is null && current is not null && choices.Any(value => value != current.ApprovedWorkOrderNumber),
            canApproveNoWorkOrder = OperationalAllowsApproval(operational) && membership is null && current is null && operational.QuantityOrdered > 0,
            canReplaceWithNoWorkOrder = OperationalAllowsApproval(operational) && membership is null && current is not null &&
                current.DecisionClassification != "NO_WORK_ORDER_REQUIRED_COMPONENT" && operational.QuantityOrdered > 0,
            canRevoke = membership is null && current is not null
        },
        rmaReworkControl = membership is null ? null : new
        {
            active = true,
            caseId = membership.CaseId,
            caseReference = membership.CaseReference,
            suppressionReason = "rma_rework_controls_work_order_decision",
            operationalRoute = "RMA / Rework",
            workOrderDecision = "Decision Pending",
            priorApprovalStatus = current is null ? null : "Superseded by active RMA/Rework case"
        },
        requestCorrelationId = correlationId
    };

    private async Task<RmaReworkMembership?> GetActiveRmaMembershipAsync(LineKey key, CancellationToken token)
    {
        var memberships = await _rmaRepository.GetActiveMembershipsAsync(
            [new RmaReworkLineIdentity(key.Customer, key.SalesOrder, key.Line)], token);
        return memberships.GetValueOrDefault(key.Customer + "|" + key.SalesOrder + "|" + key.Line);
    }

    internal static string Classify(DecisionRecord? current, CanonicalRelationship relationship,
        bool workOrderExists)
    {
        if (current?.DecisionClassification == "NO_WORK_ORDER_REQUIRED_COMPONENT")
            return "NO_WORK_ORDER_REQUIRED_COMPONENT";
        return Classify(current?.ApprovedWorkOrderNumber, relationship, workOrderExists);
    }

    internal static string Classify(string? approved, CanonicalRelationship relationship,
        bool workOrderExists)
    {
        if (string.IsNullOrEmpty(approved)) return "NO_APPROVAL";
        if (!workOrderExists) return "APPROVED_WORK_ORDER_MISSING";
        if (relationship.Status == "EXACT_LINE_UNIQUE")
            return approved == relationship.ExactWorkOrder
                ? "APPROVED_AGREES_EXACT" : "APPROVED_CONFLICTS_EXACT";
        if (relationship.Status == "AMBIGUOUS" && relationship.ApprovalChoices.Contains(approved))
            return "APPROVED_WITH_CURRENT_AMBIGUITY";
        if (relationship.ApprovalChoices.Contains(approved))
            return "APPROVED_SUPPORTED_CANDIDATE";
        return "APPROVED_NOT_IN_CURRENT_CANDIDATES";
    }

    internal static void EnsureRmaAllowsApprovalAction(RmaReworkMembership? membership, string action)
    {
        if (membership is not null && action is ("APPROVE" or "REPLACE"))
            throw ApprovalProblem.Conflict("rma_rework_controls_work_order_decision",
                "The active RMA/Rework case controls the Work Order decision for this Sales Order line.");
    }

    internal static bool OperationalAllowsApproval(OperationalRelationshipPresentation relationship) =>
        relationship.OperationalRoute is not ("RMA_REWORK" or "RETURN_RMA_REVIEW_REQUIRED");

    internal static void EnsureOperationalAllowsApprovalAction(
        OperationalRelationshipPresentation relationship, string action)
    {
        if (action is ("APPROVE" or "REPLACE") && !OperationalAllowsApproval(relationship))
            throw ApprovalProblem.Conflict("return_review_controls_work_order_decision",
                "RMA/return review controls the Work Order decision for this Sales Order line.");
    }

    private async Task<CanonicalRelationship> LoadRelationshipAsync(LineKey key, CancellationToken cancellationToken)
    {
        var path = "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=2" +
            $"&customerNumber={Uri.EscapeDataString(key.Customer)}" +
            $"&salesOrderNumber={Uri.EscapeDataString(key.SalesOrder)}" +
            $"&salesOrderLineNumber={Uri.EscapeDataString(key.Line)}";
        using var response = await _canonical.GetAsync(path, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        var items = document.RootElement.TryGetProperty("items", out var itemArray) ? itemArray : default;
        if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() != 1)
            throw ApprovalProblem.NotFound("sales_order_line_not_found",
                "The Sales Order line does not exist in the current canonical snapshot.");
        return CanonicalRelationship.From(items[0]);
    }

    private async Task<bool> WorkOrderExistsAsync(string workOrderNumber, CancellationToken cancellationToken)
    {
        var path = "/api/platform/live/v1/work-orders?page=1&pageSize=1&workOrderNumber=" +
            Uri.EscapeDataString(workOrderNumber);
        using var response = await _canonical.GetAsync(path, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        return document.RootElement.TryGetProperty("totalItems", out var total) && total.GetInt64() == 1;
    }

    private static string CreateEvidenceToken(LineKey key, CanonicalRelationship relationship, Guid? decisionId)
    {
        var material = string.Join("|", key.Customer, key.SalesOrder, key.Line,
            relationship.Status, relationship.ExactWorkOrder ?? "", relationship.SnapshotId ?? "",
            relationship.ImportRunId ?? "",
            relationship.CandidateSetHash, decisionId?.ToString("D") ?? "");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }

    private static string? NormalizeWorkOrder(string? value)
    {
        value = (value ?? "").Trim();
        return Regex.IsMatch(value, "^[0-9]{1,7}$") ? value.PadLeft(7, '0') : null;
    }
}

internal sealed class ApprovalRepository
{
    private readonly string _connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;
    internal const string SchemaReadinessSql = """
SELECT CASE WHEN
    OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent',N'U') IS NOT NULL
    AND OBJECT_ID(N'operational.vw_CurrentSalesOrderLineWorkOrderDecision',N'V') IS NOT NULL
    AND OBJECT_ID(N'operational.tr_SalesOrderLineWorkOrderDecisionEvent_AppendOnly',N'TR') IS NOT NULL
    AND COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent',N'DecisionClassification') IS NOT NULL
    AND COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent',N'DecisionReasonCode') IS NOT NULL
    AND COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent',N'DecisionNote') IS NOT NULL
    AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent') AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_WorkOrder')
    AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent') AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_Classification')
    AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent') AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode')
    AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent') AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_OtherNote')
THEN 1 ELSE 0 END;
""";

    public async Task EnsureSchemaReadyAsync(CancellationToken token,
        SqlConnection? connection = null, SqlTransaction? transaction = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(_connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand(SchemaReadinessSql, connection, transaction);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) != 1)
                throw ApprovalProblem.ServiceUnavailable("approval_schema_unavailable",
                    "The required Work Order approval migration or schema is unavailable.");
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }

    public async Task<DecisionRecord?> GetCurrentAsync(LineKey key, CancellationToken token,
        SqlConnection? connection = null, SqlTransaction? transaction = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(_connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand("""
SELECT DecisionId, DecisionAction, DecisionClassification, ApprovedWorkOrderNumber, SupersedesDecisionId,
       CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
       CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
       CandidateSetHash, CandidateSetJson, SelectionSource,
       DecisionReason, DecisionReasonCode, DecisionNote,
       ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line;
""", connection, transaction);
            AddKey(command, key);
            await using var reader = await command.ExecuteReaderAsync(token);
            return await reader.ReadAsync(token) ? DecisionRecord.From(reader) : null;
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }

    public async Task<IReadOnlyList<DecisionRecord>> GetHistoryAsync(LineKey key, CancellationToken token)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(token);
        var command = new SqlCommand("""
SELECT TOP (50) DecisionId, DecisionAction,
       COALESCE(DecisionClassification,'WORK_ORDER_APPROVAL') AS DecisionClassification,
       ApprovedWorkOrderNumber, SupersedesDecisionId,
       CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
       CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
       CandidateSetHash, CandidateSetJson, SelectionSource,
       DecisionReason, DecisionReasonCode, DecisionNote,
       ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM operational.SalesOrderLineWorkOrderDecisionEvent
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line
ORDER BY DecisionSequence DESC;
""", connection);
        AddKey(command, key);
        var results = new List<DecisionRecord>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) results.Add(DecisionRecord.From(reader));
        return results;
    }

    public async Task<DecisionRecord> AppendAsync(LineKey key, string action,
        string decisionClassification, string? selected,
        Guid? expectedCurrent, CanonicalRelationship relationship, ValidatedDecisionReason reason,
        decimal authoritativeQuantityOrdered, string approvedBy,
        CancellationToken token)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        await EnsureSchemaReadyAsync(token, connection, transaction);
        if (action is "APPROVE" or "REPLACE")
        {
            WorkOrderApprovalService.EnsureRmaAllowsApprovalAction(
                await RmaReworkRepository.GetActiveMembershipAsync(
                    key.Customer, key.SalesOrder, key.Line, connection, transaction, token), action);
            var quantityOrdered = authoritativeQuantityOrdered;
#if !DLE_OS_DEV_ONLY
            if (!ControlHostRuntimeConfiguration.IsIsolatedDevelopment)
            {
                var quantityCommand = new SqlCommand("""
SELECT QuantityOrdered FROM canonical.SalesOrderLine WITH (UPDLOCK,HOLDLOCK)
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND LineNumber=@Line;
""", connection, transaction);
                AddKey(quantityCommand, key);
                var quantityValue = await quantityCommand.ExecuteScalarAsync(token);
                if (quantityValue is decimal canonicalQuantity) quantityOrdered = canonicalQuantity;
            }
#endif
            if (quantityOrdered < 0)
                throw ApprovalProblem.Conflict("return_review_controls_work_order_decision",
                    "Negative return quantity blocks normal-production Work Order approval.");
            if (decisionClassification == "NO_WORK_ORDER_REQUIRED_COMPONENT" && quantityOrdered <= 0)
                throw ApprovalProblem.Conflict("positive_fulfillment_quantity_required",
                    "No Work Order Required is limited to active positive fulfillment demand.");
        }
        var actual = await GetCurrentAsync(key, token, connection, transaction);
        if (actual?.DecisionId != expectedCurrent)
            throw ApprovalProblem.Conflict("current_decision_changed",
                "The governing approval changed while this decision was being recorded.");

        var decisionId = Guid.NewGuid();
        var correlationId = Guid.NewGuid();
        var command = new SqlCommand("""
INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId, CustomerNumber, SalesOrderNumber, SalesOrderLineNumber, DecisionAction,
 DecisionClassification, ApprovedWorkOrderNumber, SupersedesDecisionId, CandidateResolutionStatusAtDecision,
 CanonicalExactWorkOrderAtDecision, CandidateSnapshotIdAtDecision,
 CandidateSnapshotImportRunId, CandidateSetHash,
 CandidateSetJson, SelectionSource, DecisionReason, DecisionReasonCode, DecisionNote,
 ApprovedBy, ApprovedAtUtc, RequestCorrelationId)
VALUES
(@DecisionId,@Customer,@SalesOrder,@Line,@Action,@Classification,@Selected,@Supersedes,@Status,@Exact,
 @SnapshotId,@ImportRun,@CandidateHash,@CandidateJson,@SelectionSource,@Reason,@ReasonCode,@DecisionNote,
 @ApprovedBy,SYSUTCDATETIME(),@CorrelationId);
""", connection, transaction);
        AddKey(command, key);
        command.Parameters.AddWithValue("@DecisionId", decisionId);
        command.Parameters.AddWithValue("@Action", action);
        command.Parameters.AddWithValue("@Classification", decisionClassification);
        command.Parameters.AddWithValue("@Selected", (object?)selected ?? DBNull.Value);
        command.Parameters.AddWithValue("@Supersedes", (object?)expectedCurrent ?? DBNull.Value);
        command.Parameters.AddWithValue("@Status", relationship.Status);
        command.Parameters.AddWithValue("@Exact", (object?)relationship.ExactWorkOrder ?? DBNull.Value);
        command.Parameters.AddWithValue("@SnapshotId", (object?)relationship.SnapshotId ?? DBNull.Value);
        command.Parameters.AddWithValue("@ImportRun", (object?)relationship.ImportRunId ?? DBNull.Value);
        command.Parameters.AddWithValue("@CandidateHash", relationship.CandidateSetHash);
        command.Parameters.AddWithValue("@CandidateJson", relationship.CandidateSetJson);
        command.Parameters.AddWithValue("@SelectionSource",
            relationship.SelectionSource(selected, decisionClassification));
        command.Parameters.AddWithValue("@Reason", reason.LegacyReason);
        command.Parameters.AddWithValue("@ReasonCode", reason.Code);
        command.Parameters.AddWithValue("@DecisionNote", (object?)reason.Note ?? DBNull.Value);
        command.Parameters.AddWithValue("@ApprovedBy", approvedBy);
        command.Parameters.AddWithValue("@CorrelationId", correlationId);
        await command.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
        _ = Guid.TryParse(relationship.ImportRunId, out var importRunId);
        return new DecisionRecord(decisionId, action, decisionClassification, selected, expectedCurrent,
            relationship.Status, relationship.ExactWorkOrder, relationship.SnapshotId,
            importRunId == Guid.Empty ? null : importRunId, relationship.CandidateSetHash,
            relationship.CandidateSetJson,
            relationship.SelectionSource(selected, decisionClassification),
            reason.LegacyReason, reason.Code, reason.Note,
            approvedBy, DateTime.UtcNow, correlationId);
    }

    private static void AddKey(SqlCommand command, LineKey key)
    {
        command.Parameters.AddWithValue("@Customer", key.Customer);
        command.Parameters.AddWithValue("@SalesOrder", key.SalesOrder);
        command.Parameters.AddWithValue("@Line", key.Line);
    }
}

internal sealed record LineKey(string Customer, string SalesOrder, string Line)
{
    public static LineKey Create(string customer, string salesOrder, string line)
    {
        static string Normalize(string value, int width, string name)
        {
            value = (value ?? "").Trim();
            if (!Regex.IsMatch(value, $"^[0-9]{{1,{width}}}$"))
                throw ApprovalProblem.BadRequest("malformed_identifier", $"{name} is malformed.");
            return value.PadLeft(width, '0');
        }
        return new(Normalize(customer, 6, "Customer number"),
            Normalize(salesOrder, 7, "Sales Order number"), Normalize(line, 3, "Line number"));
    }
}

internal sealed class CanonicalRelationship
{
    public required JsonElement Raw { get; init; }
    public required string Status { get; init; }
    public string? ExactWorkOrder { get; init; }
    public required IReadOnlyList<string> EvidenceWorkOrders { get; init; }
    public required IReadOnlyList<string> ApprovalChoices { get; init; }
    public string? SnapshotId { get; init; }
    public string? ImportRunId { get; init; }
    public required string CandidateSetHash { get; init; }
    public required string CandidateSetJson { get; init; }

    public static CanonicalRelationship From(JsonElement source)
    {
        var status = Text(source, "resolutionStatus") ?? Text(source, "status") ?? "UNRESOLVED";
        var exact = Normalize(Text(source, "actionableWorkOrderNumber"));
        var values = new List<string>();
        var itemMatches = new List<string>();
        var salesOrderItem = Text(source, "salesOrderItemNumber")?.Trim();
        string? snapshot = null;
        string? import = null;
        JsonElement[] candidateEvidence = [];
        if (source.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array)
        {
            candidateEvidence = candidates.EnumerateArray()
                .OrderBy(candidate => Normalize(Text(candidate, "workOrderNumber")) ?? "", StringComparer.Ordinal)
                .Select(candidate => candidate.Clone()).ToArray();
            foreach (var candidate in candidates.EnumerateArray())
            {
                var number = Normalize(Text(candidate, "workOrderNumber"));
                if (number is not null)
                {
                    values.Add(number);
                    if (!string.IsNullOrEmpty(salesOrderItem) &&
                        string.Equals(Text(candidate, "itemNumber")?.Trim(), salesOrderItem, StringComparison.Ordinal))
                        itemMatches.Add(number);
                }
                snapshot ??= Text(candidate, "sourceSnapshotId");
                import ??= Text(candidate, "sourceImportRunId");
            }
        }
        if (exact is not null) values.Add(exact);
        var normalized = values.Distinct(StringComparer.Ordinal).Order().ToArray();
        var normalizedSetJson = JsonSerializer.Serialize(normalized);
        var evidenceJson = JsonSerializer.Serialize(candidateEvidence);
        IReadOnlyList<string> choices = status switch
        {
            "EXACT_LINE_UNIQUE" when exact is not null => [exact],
            "SALES_ORDER_ITEM_UNIQUE_CANDIDATE" => itemMatches.Distinct().ToArray(),
            "SALES_ORDER_LEVEL_CANDIDATE" when normalized.Length == 1 => normalized,
            "AMBIGUOUS" => normalized,
            _ => []
        };
        return new CanonicalRelationship
        {
            Raw = source.Clone(), Status = status, ExactWorkOrder = exact,
            EvidenceWorkOrders = normalized, ApprovalChoices = choices,
            SnapshotId = snapshot, ImportRunId = import, CandidateSetJson = evidenceJson,
            CandidateSetHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedSetJson)))
        };
    }

    public string SelectionSource(string? selected, string classification = "WORK_ORDER_APPROVAL") =>
        classification == "NO_WORK_ORDER_REQUIRED_COMPONENT" ? "NO_WORK_ORDER_REQUIRED_COMPONENT" :
        selected is null ? "REVOCATION" :
        selected == ExactWorkOrder ? "EXACT_RELATIONSHIP" :
        Status == "AMBIGUOUS" ? "AMBIGUOUS_CANDIDATE_SELECTION" : "UNIQUE_CANDIDATE";
    private static string? Text(JsonElement value, string property) =>
        value.TryGetProperty(property, out var result) && result.ValueKind == JsonValueKind.String
            ? result.GetString() : null;
    private static string? Normalize(string? value)
    {
        value = (value ?? "").Trim();
        return Regex.IsMatch(value, "^[0-9]{1,7}$") ? value.PadLeft(7, '0') : null;
    }
}

internal sealed record DecisionRecord(Guid DecisionId, string DecisionAction,
    string DecisionClassification, string? ApprovedWorkOrderNumber, Guid? SupersedesDecisionId,
    string CandidateResolutionStatusAtDecision, string? CanonicalExactWorkOrderAtDecision,
    string? CandidateSnapshotIdAtDecision, Guid? CandidateSnapshotImportRunId,
    string CandidateSetHash, string CandidateSetJson, string SelectionSource,
    string DecisionReason, string? DecisionReasonCode, string? DecisionNote,
    string ApprovedBy, DateTime ApprovedAtUtc, Guid RequestCorrelationId)
{
    public static DecisionRecord From(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetGuid(4), reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetGuid(8), reader.GetString(9), reader.GetString(10),
        reader.GetString(11), reader.GetString(12),
        reader.IsDBNull(13) ? null : reader.GetString(13),
        reader.IsDBNull(14) ? null : reader.GetString(14),
        reader.GetString(15), reader.GetDateTime(16), reader.GetGuid(17));
}

internal sealed class ApprovalActionRequest
{
    public string? SelectedWorkOrderNumber { get; set; }
    public string? DecisionReasonCode { get; set; }
    public string? DecisionNote { get; set; }
    public string? EvidenceToken { get; set; }
    public Guid? ExpectedCurrentDecisionId { get; set; }
    // ApprovedBy and timestamps are intentionally absent: identity and UTC time are server-derived.
}

internal sealed class ApprovalProblem : Exception
{
    public int StatusCode { get; }
    public string Code { get; }
    private ApprovalProblem(int statusCode, string code, string message) : base(message)
        => (StatusCode, Code) = (statusCode, code);
    public static ApprovalProblem BadRequest(string code, string message) => new(400, code, message);
    public static ApprovalProblem NotFound(string code, string message) => new(404, code, message);
    public static ApprovalProblem Conflict(string code, string message) => new(409, code, message);
    public static ApprovalProblem ServiceUnavailable(string code, string message) => new(503, code, message);
}
