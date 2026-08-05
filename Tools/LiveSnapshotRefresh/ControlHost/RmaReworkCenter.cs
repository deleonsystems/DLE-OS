using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class RmaReworkCenter
{
    private const string BaseRoute = "/api/rma-rework/v1";

    public static void MapRmaRework(this WebApplication app, string policy)
    {
        var service = new RmaReworkService();
        app.MapPost(BaseRoute + "/case-candidates/review", async (RmaReworkReviewRequest request,
                CancellationToken token) => await Execute(() => service.ReviewAsync(request, token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/case-candidates/match", async (RmaReworkMatchRequest request,
                CancellationToken token) => await Execute(() => service.MatchAsync(request, token)))
            .RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/cases", async (RmaReworkCreateRequest request, HttpContext context,
                CancellationToken token) => await Execute(() => service.CreateAsync(
                request, context.User.Identity?.Name ?? "", token)))
            .RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/cases", async (string? status, string? customerNumber,
                string? salesOrderNumber, string? lineNumber, int? page, int? pageSize,
                CancellationToken token) => await Execute(() => service.ListAsync(status, customerNumber,
                salesOrderNumber, lineNumber, page ?? 1, pageSize ?? 50, token)))
            .RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/cases/{caseId:guid}", async (Guid caseId, CancellationToken token) =>
            await Execute(() => service.GetAsync(caseId, token))).RequireAuthorization(policy);
        app.MapGet(BaseRoute + "/cases/{caseId:guid}/history", async (Guid caseId, CancellationToken token) =>
            await Execute(() => service.GetHistoryAsync(caseId, token))).RequireAuthorization(policy);
        app.MapPost(BaseRoute + "/cases/{caseId:guid}/members", async (Guid caseId,
                RmaReworkAddMemberRequest request, HttpContext context, CancellationToken token) =>
            await Execute(() => service.AddMemberAsync(caseId, request,
                context.User.Identity?.Name ?? "", token))).RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> action)
    {
        try { return Results.Json(await action()); }
        catch (RmaReworkProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message }, statusCode: problem.StatusCode);
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            return Results.Json(new { code = "active_case_membership_conflict", message = "A selected canonical Sales Order line already belongs to an active RMA/Rework Case." }, statusCode: 409);
        }
        catch (SqlException)
        {
            return Results.Json(new { code = "rma_rework_store_unavailable", message = "The governed RMA/Rework case store is unavailable." }, statusCode: 503);
        }
        catch (HttpRequestException)
        {
            return Results.Json(new { code = "canonical_evidence_unavailable", message = "Current canonical Sales Order-line evidence is unavailable." }, statusCode: 503);
        }
    }
}

internal sealed class RmaReworkService
{
    internal static readonly string[] CaseTypes = ["RMA_RETURN_REPLACEMENT", "CUSTOMER_REWORK", "INTERNAL_REWORK", "EVALUATION_REPAIR", "OTHER"];
    private readonly RmaReworkRepository repository = new();
    private readonly HttpClient canonical;
    private readonly string shipmentStagingPath;

    public RmaReworkService()
    {
        canonical = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(Environment.GetEnvironmentVariable("DLE_OS_CANONICAL_API_BASE_URL") ?? "http://DLE-OS-HOST:5042"),
            Timeout = TimeSpan.FromSeconds(15)
        };
        shipmentStagingPath = Environment.GetEnvironmentVariable("DLE_OS_SHIPMENT_STAGING_PATH") ??
            @"C:\DLE-OS\Repositories\DLE-OS\DATA\shipment-staging\shipment-staging.json";
    }

    public async Task<object> ReviewAsync(RmaReworkReviewRequest request, CancellationToken token)
    {
        var identities = NormalizeMembers(request.Members);
        var members = new List<RmaReworkMemberEvidence>();
        foreach (var identity in identities)
            members.Add(await LoadMemberEvidenceAsync(identity, token));
        ValidateSameCustomer(members);
        var memberships = await repository.GetActiveMembershipsAsync(identities, token);
        var reviewed = members.Select(member => member with
        {
            CurrentCaseId = memberships.TryGetValue(member.Identity.Key, out var current) ? current.CaseId : null,
            CurrentCaseReference = memberships.TryGetValue(member.Identity.Key, out current) ? current.CaseReference : null
        }).ToArray();
        return BuildReview(reviewed);
    }

    public async Task<object> MatchAsync(RmaReworkMatchRequest request, CancellationToken token)
    {
        var identity = NormalizeMembers([request.Member]).Single();
        var member = await LoadMemberEvidenceAsync(identity, token);
        var reference = RmaReworkMatchingRules.ResolveReference(request.CustomerRmaNumber,
            request.InternalReference, true);
        var caseType = NormalizeCaseType(request.CaseType);
        return await BuildMatchAsync(member, reference, caseType, token);
    }

    public async Task<object> CreateAsync(RmaReworkCreateRequest request, string authenticatedUser, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(authenticatedUser))
            throw RmaReworkProblem.Unauthorized("authenticated_identity_required", "An authenticated employee identity is required.");
        var caseType = NormalizeCaseType(request.CaseType);
        var customerRma = NormalizeOptional(request.CustomerRmaNumber, 80);
        var internalReference = NormalizeOptional(request.InternalReference, 80);
        var notes = NormalizeOptional(request.Notes, 1000);
        if (customerRma is null && internalReference is null)
            throw RmaReworkProblem.BadRequest("case_reference_required", "Enter a Customer RMA Number or an Internal RMA Reference.");
        if (caseType == "OTHER" && notes is null)
            throw RmaReworkProblem.BadRequest("other_note_required", "A note is required for Other.");

        var identities = NormalizeMembers(request.Members);
        var members = new List<RmaReworkMemberEvidence>();
        foreach (var identity in identities)
            members.Add(await LoadMemberEvidenceAsync(identity, token));
        ValidateSameCustomer(members);
        var memberships = await repository.GetActiveMembershipsAsync(identities, token);
        if (memberships.Count > 0)
            throw RmaReworkProblem.Conflict("active_case_membership_conflict", "A selected canonical Sales Order line already belongs to an active RMA/Rework Case.");
        var currentReview = BuildReview(members.ToArray());
        if (!FixedEquals(currentReview.EvidenceToken, request.EvidenceToken))
            throw RmaReworkProblem.Conflict("stale_case_evidence", "Canonical line evidence or active case membership changed. Review the selected lines again.");

        if (identities.Count == 1)
        {
            var reference = RmaReworkMatchingRules.ResolveReference(customerRma, internalReference, true);
            var match = await BuildMatchAsync(members[0], reference, caseType, token);
            if (match.MatchingCaseCount > 0)
                throw RmaReworkProblem.Conflict("matching_active_case_exists", "An active matching RMA/Rework Case exists. Confirm adding the line to that case instead.");
            if (!FixedEquals(match.EvidenceToken, request.ReferenceMatchEvidenceToken))
                throw RmaReworkProblem.Conflict("stale_reference_match", "Active RMA/Rework reference matches changed. Review the proposed reference again.");
        }

        var caseId = Guid.NewGuid();
        var correlationId = request.RequestCorrelationId is { } supplied && supplied != Guid.Empty ? supplied : Guid.NewGuid();
        await repository.CreateAsync(caseId, caseType, customerRma, internalReference, notes,
            authenticatedUser, correlationId, currentReview.EvidenceToken, members, token);
        return await GetAsync(caseId, token);
    }

    public async Task<object> AddMemberAsync(Guid caseId, RmaReworkAddMemberRequest request,
        string authenticatedUser, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(authenticatedUser))
            throw RmaReworkProblem.Unauthorized("authenticated_identity_required", "An authenticated employee identity is required.");
        var identity = NormalizeMembers([request.Member]).Single();
        var member = await LoadMemberEvidenceAsync(identity, token);
        var reference = RmaReworkMatchingRules.ResolveReference(request.CustomerRmaNumber,
            request.InternalReference, true);
        var caseType = NormalizeCaseType(request.CaseType);
        var match = await BuildMatchAsync(member, reference, caseType, token);
        if (match.MatchingCaseCount > 1)
            throw RmaReworkProblem.Conflict("ambiguous_reference_match", "More than one active case matches this customer and reference.");
        if (match.MatchingCaseCount == 0 || match.ExistingCase is null || match.ExistingCase.CaseId != caseId)
            throw RmaReworkProblem.Conflict("matching_case_changed", "The active matching case changed. Review the reference again.");
        if (match.ProposedAction == "ALREADY_MEMBER")
            throw RmaReworkProblem.Conflict("active_case_membership_conflict", "The selected canonical Sales Order line already belongs to this active case.");
        if (match.ProposedAction == "CASE_TYPE_MISMATCH")
            throw RmaReworkProblem.Conflict("case_type_mismatch", "The selected case type does not match the existing active case.");
        if (match.ProposedAction != "ADD_TO_EXISTING_CASE")
            throw RmaReworkProblem.Conflict("reference_match_not_actionable", "The reviewed reference match is not actionable.");
        if (!FixedEquals(match.EvidenceToken, request.ReferenceMatchEvidenceToken))
            throw RmaReworkProblem.Conflict("stale_reference_match", "Active RMA/Rework reference matches changed. Review the proposed reference again.");
        if (request.ExpectedCurrentEventId != match.ExpectedCurrentEventId)
            throw RmaReworkProblem.Conflict("case_version_changed", "The RMA/Rework Case history changed. Review the case again.");
        await repository.AddMemberAsync(caseId, member, reference, authenticatedUser,
            request.ExpectedCurrentEventId, request.RequestCorrelationId ?? Guid.NewGuid(),
            NormalizeOptional(request.Notes, 1000), token);
        return await GetAsync(caseId, token);
    }

    private async Task<RmaReworkMatchReview> BuildMatchAsync(RmaReworkMemberEvidence member,
        RmaReworkReference reference, string proposedCaseType, CancellationToken token)
    {
        var matches = await repository.FindActiveMatchesAsync(member.Identity.CustomerNumber,
            reference.ReferenceType, reference.NormalizedValue, token);
        var memberships = await repository.GetActiveMembershipsAsync([member.Identity], token);
        var currentMembership = memberships.TryGetValue(member.Identity.Key, out var membership) ? membership : null;
        var currentCase = currentMembership is null ? null : await repository.GetAsync(currentMembership.CaseId, token);
        var existing = matches.Count == 1 ? matches[0] : currentCase;
        Guid? latestEventId = existing is null ? null : await repository.GetLatestEventIdAsync(existing.CaseId, token);
        var alreadyMember = currentMembership is not null;
        var action = matches.Count > 1 ? "AMBIGUOUS" : existing is null ? "CREATE_NEW_CASE" :
            alreadyMember ? "ALREADY_MEMBER" : existing.CaseType != proposedCaseType ? "CASE_TYPE_MISMATCH" : "ADD_TO_EXISTING_CASE";
        var material = JsonSerializer.Serialize(new { member.Identity, member.ItemNumber, member.Revision,
            member.QuantityOrdered, member.ErpQuantityOpen, member.PendingInvoiceQuantity,
            member.OperationalQuantityOpen, member.RelatedWorkOrderNumber, member.RelationshipStatus,
            reference.ReferenceType, reference.NormalizedValue, proposedCaseType, action,
            currentMembership?.CaseId, matches = matches.Select(item => new { item.CaseId, item.CaseType }) });
        var evidence = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
        return new(member, reference.ReferenceType, reference.DisplayValue, reference.NormalizedValue,
            proposedCaseType, matches.Count, existing, action, latestEventId, evidence);
    }

    public async Task<object> ListAsync(string? status, string? customerNumber, string? salesOrderNumber,
        string? lineNumber, int page, int pageSize, CancellationToken token)
    {
        if (!string.IsNullOrWhiteSpace(status) && !string.Equals(status.Trim(), "ACTIVE", StringComparison.OrdinalIgnoreCase))
            throw RmaReworkProblem.BadRequest("unsupported_case_status", "Only ACTIVE RMA/Rework Cases are currently supported.");
        if (page < 1 || pageSize is < 1 or > 200)
            throw RmaReworkProblem.BadRequest("invalid_pagination", "Page must be positive and pageSize must be between 1 and 200.");
        var customer = NormalizeOptionalDigits(customerNumber, 6, "Customer number");
        var order = NormalizeOptionalDigits(salesOrderNumber, 7, "Sales Order number");
        var line = NormalizeOptionalDigits(lineNumber, 3, "Sales Order line");
        var result = await repository.ListAsync(customer, order, line, page, pageSize, token);
        return new { items = result.Items.Select(RmaReworkPresentation.Case), page, pageSize, totalItems = result.TotalItems,
            totalPages = result.TotalItems == 0 ? 0 : (int)Math.Ceiling(result.TotalItems / (decimal)pageSize) };
    }

    public async Task<object> GetAsync(Guid caseId, CancellationToken token)
    {
        var record = await repository.GetAsync(caseId, token) ?? throw RmaReworkProblem.NotFound("case_not_found", "The RMA/Rework Case was not found.");
        return RmaReworkPresentation.Case(record);
    }

    public async Task<object> GetHistoryAsync(Guid caseId, CancellationToken token)
    {
        if (await repository.GetAsync(caseId, token) is null)
            throw RmaReworkProblem.NotFound("case_not_found", "The RMA/Rework Case was not found.");
        return new { caseId, history = await repository.GetHistoryAsync(caseId, token) };
    }

    private async Task<RmaReworkMemberEvidence> LoadMemberEvidenceAsync(RmaReworkLineIdentity identity, CancellationToken token)
    {
        var line = await GetExactAsync("/api/platform/live/v1/sales-orders/" + Uri.EscapeDataString(identity.RecordId), token);
        var returned = new RmaReworkLineIdentity(
            NormalizeDigits(Text(line, "customerNumber"), 6, "Customer number"),
            NormalizeDigits(Text(line, "salesOrderNumber"), 7, "Sales Order number"),
            NormalizeDigits(Text(line, "lineNumber"), 3, "Sales Order line"));
        if (returned != identity)
            throw RmaReworkProblem.BadRequest("canonical_line_identity_mismatch", "The canonical Sales Order line did not match its requested exact identity.");
        var relationship = await GetRelationshipAsync(identity, token);
        var erpOpen = Number(line, "erpQuantityOpen");
        var pending = LoadPendingInvoiceQuantity(identity);
        var operational = Math.Max(erpOpen - pending, 0m);
        return new(identity, Text(line, "customerName") ?? "", Text(line, "itemNumber") ?? "",
            Text(line, "drawingRevision") ?? Text(line, "bomRevision"), Number(line, "quantityOrdered"), erpOpen,
            pending, operational, Text(relationship, "actionableWorkOrderNumber"),
            Text(relationship, "resolutionStatus") ?? "UNRESOLVED", Text(relationship, "resolutionBasis"), null, null);
    }

    private async Task<JsonElement> GetRelationshipAsync(RmaReworkLineIdentity identity, CancellationToken token)
    {
        var path = "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=2" +
            $"&customerNumber={identity.CustomerNumber}&salesOrderNumber={identity.SalesOrderNumber}&salesOrderLineNumber={identity.LineNumber}";
        using var response = await canonical.GetAsync(path, token);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        var items = document.RootElement.GetProperty("items");
        var total = document.RootElement.TryGetProperty("totalItems", out var count) && count.TryGetInt32(out var value) ? value : items.GetArrayLength();
        if (total == 0) return JsonDocument.Parse("{\"resolutionStatus\":\"UNRESOLVED\"}").RootElement.Clone();
        if (total != 1 || items.GetArrayLength() != 1)
            throw RmaReworkProblem.BadRequest("canonical_relationship_ambiguous", "Multiple canonical relationship records matched the exact Sales Order line.");
        return items[0].Clone();
    }

    private async Task<JsonElement> GetExactAsync(string path, CancellationToken token)
    {
        using var response = await canonical.GetAsync(path, token);
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw RmaReworkProblem.BadRequest("canonical_line_not_found", "A selected exact canonical Sales Order line was not found.");
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        return document.RootElement.Clone();
    }

    private decimal LoadPendingInvoiceQuantity(RmaReworkLineIdentity identity)
    {
        if (!File.Exists(shipmentStagingPath)) return 0m;
        using var document = JsonDocument.Parse(File.ReadAllText(shipmentStagingPath));
        if (!document.RootElement.TryGetProperty("records", out var records)) return 0m;
        decimal total = 0;
        foreach (var record in records.EnumerateArray())
            if (string.Equals(Text(record, "status"), "Pending Invoice", StringComparison.OrdinalIgnoreCase) &&
                LooseDigits(Text(record, "customerNumber"), 6) == identity.CustomerNumber &&
                LooseDigits(Text(record, "salesOrder"), 7) == identity.SalesOrderNumber &&
                LooseDigits(Text(record, "salesOrderLine"), 3) == identity.LineNumber)
                total += Number(record, "quantityShipped");
        return total;
    }

    private static RmaReworkReview BuildReview(IReadOnlyList<RmaReworkMemberEvidence> members)
    {
        var ordered = members.OrderBy(item => item.Identity.Key, StringComparer.Ordinal).ToArray();
        var material = JsonSerializer.Serialize(ordered.Select(item => new
        {
            item.Identity.CustomerNumber, item.Identity.SalesOrderNumber, item.Identity.LineNumber,
            item.ItemNumber, item.Revision, item.QuantityOrdered, item.ErpQuantityOpen,
            item.PendingInvoiceQuantity, item.OperationalQuantityOpen, item.RelatedWorkOrderNumber,
            item.RelationshipStatus, item.RelationshipBasis, item.CurrentCaseId
        }));
        var token = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
        var signs = ordered.Select(item => Math.Sign(item.ErpQuantityOpen)).Distinct().ToArray();
        return new(ordered[0].Identity.CustomerNumber, ordered, ordered.Sum(item => item.ErpQuantityOpen),
            ordered.Sum(item => item.OperationalQuantityOpen), ordered.Select(item => item.Identity.SalesOrderNumber).Distinct().Count() > 1,
            signs.Length == 1, token);
    }

    private static IReadOnlyList<RmaReworkLineIdentity> NormalizeMembers(IReadOnlyList<RmaReworkLineRequest>? members)
    {
        if (members is null || members.Count == 0)
            throw RmaReworkProblem.BadRequest("case_members_required", "Select at least one exact canonical Sales Order line.");
        if (members.Count > 100)
            throw RmaReworkProblem.BadRequest("too_many_case_members", "A case may contain at most 100 Sales Order lines.");
        var identities = members.Select(item => new RmaReworkLineIdentity(
            NormalizeDigits(item.CustomerNumber, 6, "Customer number"),
            NormalizeDigits(item.SalesOrderNumber, 7, "Sales Order number"),
            NormalizeDigits(item.LineNumber, 3, "Sales Order line"))).ToArray();
        if (identities.Select(item => item.Key).Distinct(StringComparer.Ordinal).Count() != identities.Length)
            throw RmaReworkProblem.BadRequest("duplicate_case_member", "The selected Sales Order lines contain a duplicate identity.");
        return identities;
    }

    private static void ValidateSameCustomer(IReadOnlyList<RmaReworkMemberEvidence> members)
    {
        if (members.Select(item => item.Identity.CustomerNumber).Distinct(StringComparer.Ordinal).Count() != 1)
            throw RmaReworkProblem.BadRequest("mixed_customer_case", "All RMA/Rework Case members must belong to the same customer.");
    }

    internal static string NormalizeCaseType(string? value)
    {
        var result = (value ?? "").Trim().ToUpperInvariant();
        if (!CaseTypes.Contains(result, StringComparer.Ordinal))
            throw RmaReworkProblem.BadRequest("unsupported_case_type", "Select a supported RMA/Rework Case type.");
        return result;
    }

    private static string NormalizeDigits(string? value, int width, string label)
    {
        value = (value ?? "").Trim();
        if (!Regex.IsMatch(value, $"^[0-9]{{1,{width}}}$"))
            throw RmaReworkProblem.BadRequest("malformed_identifier", label + " is malformed.");
        return value.PadLeft(width, '0');
    }
    private static string? NormalizeOptionalDigits(string? value, int width, string label) =>
        string.IsNullOrWhiteSpace(value) ? null : NormalizeDigits(value, width, label);
    private static string LooseDigits(string? value, int width) => (value ?? "").Trim().PadLeft(width, '0');
    private static string? NormalizeOptional(string? value, int maximum)
    {
        var result = (value ?? "").Trim();
        if (result.Length == 0) return null;
        if (result.Length > maximum) throw RmaReworkProblem.BadRequest("value_too_long", $"A value exceeds the {maximum}-character limit.");
        return result;
    }
    private static bool FixedEquals(string expected, string? supplied) => supplied is not null && expected.Length == supplied.Length &&
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(supplied.ToUpperInvariant()));
    private static string? Text(JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString().Trim() : null;
    private static decimal Number(JsonElement element, string name) => element.TryGetProperty(name, out var value) && decimal.TryParse(value.ToString(), out var number) ? number : 0m;
}

internal sealed class RmaReworkRepository
{
    private readonly string connectionString = Environment.GetEnvironmentVariable("DLE_OS_WORK_ORDER_APPROVAL_CONNECTION_STRING") ??
        @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;";

    public async Task<Dictionary<string, RmaReworkMembership>> GetActiveMembershipsAsync(IReadOnlyList<RmaReworkLineIdentity> identities, CancellationToken token)
    {
        var result = new Dictionary<string, RmaReworkMembership>(StringComparer.Ordinal);
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        foreach (var identity in identities)
        {
            var command = new SqlCommand("SELECT TOP(1) CaseId,COALESCE(NULLIF(CustomerRmaNumber,''),InternalReference) FROM operational.vw_ActiveRmaReworkCaseMember WHERE CustomerNumber=@C AND SalesOrderNumber=@S AND SalesOrderLineNumber=@L;", connection);
            command.Parameters.AddWithValue("@C", identity.CustomerNumber); command.Parameters.AddWithValue("@S", identity.SalesOrderNumber); command.Parameters.AddWithValue("@L", identity.LineNumber);
            await using var reader = await command.ExecuteReaderAsync(token);
            if (await reader.ReadAsync(token)) result[identity.Key] = new(reader.GetGuid(0), reader.GetString(1));
        }
        return result;
    }

    public static async Task<RmaReworkMembership?> GetActiveMembershipAsync(
        string customerNumber, string salesOrderNumber, string lineNumber,
        SqlConnection connection, SqlTransaction? transaction, CancellationToken token)
    {
        var command = new SqlCommand("""
SELECT TOP(1) CaseId,COALESCE(NULLIF(CustomerRmaNumber,''),InternalReference)
FROM operational.vw_ActiveRmaReworkCaseMember
WHERE CustomerNumber=@Customer AND SalesOrderNumber=@SalesOrder AND SalesOrderLineNumber=@Line;
""", connection, transaction);
        command.Parameters.AddWithValue("@Customer", customerNumber);
        command.Parameters.AddWithValue("@SalesOrder", salesOrderNumber);
        command.Parameters.AddWithValue("@Line", lineNumber);
        await using var reader = await command.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token)
            ? new RmaReworkMembership(reader.GetGuid(0), reader.IsDBNull(1) ? "" : reader.GetString(1))
            : null;
    }

    public async Task CreateAsync(Guid caseId, string caseType, string? customerRma, string? internalReference,
        string? notes, string actor, Guid correlationId, string evidenceToken,
        IReadOnlyList<RmaReworkMemberEvidence> members, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        foreach (var reference in RmaReworkMatchingRules.ResolveAllReferences(customerRma, internalReference))
        {
            await AcquireReferenceLockAsync(connection, transaction, members[0].Identity.CustomerNumber, reference, token);
            var matchingIds = await FindMatchingIdsAsync(connection, transaction, members[0].Identity.CustomerNumber, reference, token);
            if (matchingIds.Count > 0)
                throw RmaReworkProblem.Conflict("matching_active_case_exists", "An active matching RMA/Rework Case exists. Confirm adding lines to that case instead.");
        }
        var insertCase = new SqlCommand("""
INSERT operational.RmaReworkCase
(CaseId,CustomerNumber,CaseType,CustomerRmaNumber,InternalReference,Notes,CaseStatus,CreatedBy,RequestCorrelationId,EvidenceToken)
VALUES(@Id,@Customer,@Type,@CustomerRma,@InternalReference,@Notes,'ACTIVE',@Actor,@Correlation,@Evidence);
""", connection, transaction);
        insertCase.Parameters.AddWithValue("@Id", caseId); insertCase.Parameters.AddWithValue("@Customer", members[0].Identity.CustomerNumber);
        insertCase.Parameters.AddWithValue("@Type", caseType); insertCase.Parameters.AddWithValue("@CustomerRma", (object?)customerRma ?? DBNull.Value);
        insertCase.Parameters.AddWithValue("@InternalReference", (object?)internalReference ?? DBNull.Value); insertCase.Parameters.AddWithValue("@Notes", (object?)notes ?? DBNull.Value);
        insertCase.Parameters.AddWithValue("@Actor", actor); insertCase.Parameters.AddWithValue("@Correlation", correlationId); insertCase.Parameters.AddWithValue("@Evidence", evidenceToken);
        await insertCase.ExecuteNonQueryAsync(token);

        for (var index = 0; index < members.Count; index++)
        {
            var member = members[index];
            var command = new SqlCommand("""
INSERT operational.RmaReworkCaseMember
(CaseId,MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,ItemNumber,Revision,
 QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,RelatedWorkOrderNumber,
 RelationshipStatus,RelationshipBasis,CaseStatus)
VALUES(@CaseId,@Sequence,@Customer,@SalesOrder,@Line,@LineId,@Item,@Revision,@Ordered,@ErpOpen,@Pending,@Operational,
 @WorkOrder,@RelationshipStatus,@RelationshipBasis,'ACTIVE');
""", connection, transaction);
            command.Parameters.AddWithValue("@CaseId", caseId); command.Parameters.AddWithValue("@Sequence", index + 1);
            command.Parameters.AddWithValue("@Customer", member.Identity.CustomerNumber); command.Parameters.AddWithValue("@SalesOrder", member.Identity.SalesOrderNumber);
            command.Parameters.AddWithValue("@Line", member.Identity.LineNumber); command.Parameters.AddWithValue("@LineId", member.Identity.RecordId);
            command.Parameters.AddWithValue("@Item", member.ItemNumber); command.Parameters.AddWithValue("@Revision", (object?)member.Revision ?? DBNull.Value);
            command.Parameters.AddWithValue("@Ordered", member.QuantityOrdered); command.Parameters.AddWithValue("@ErpOpen", member.ErpQuantityOpen);
            command.Parameters.AddWithValue("@Pending", member.PendingInvoiceQuantity); command.Parameters.AddWithValue("@Operational", member.OperationalQuantityOpen);
            command.Parameters.AddWithValue("@WorkOrder", (object?)member.RelatedWorkOrderNumber ?? DBNull.Value);
            command.Parameters.AddWithValue("@RelationshipStatus", member.RelationshipStatus); command.Parameters.AddWithValue("@RelationshipBasis", (object?)member.RelationshipBasis ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(token);
        }

        var eventPayload = JsonSerializer.Serialize(new { caseId, caseType, customerRmaNumber = customerRma,
            internalReference, notes, status = "ACTIVE", members });
        var insertEvent = new SqlCommand("""
INSERT operational.RmaReworkCaseEvent
(EventId,CaseId,EventType,EventPayloadJson,RecordedBy,ExpectedPriorEventId,RequestCorrelationId)
VALUES(@EventId,@CaseId,'CASE_CREATED',@Payload,@Actor,NULL,@Correlation);
""", connection, transaction);
        insertEvent.Parameters.AddWithValue("@EventId", Guid.NewGuid()); insertEvent.Parameters.AddWithValue("@CaseId", caseId);
        insertEvent.Parameters.AddWithValue("@Payload", eventPayload); insertEvent.Parameters.AddWithValue("@Actor", actor);
        insertEvent.Parameters.AddWithValue("@Correlation", Guid.NewGuid()); await insertEvent.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
    }

    public async Task<List<RmaReworkCaseRecord>> FindActiveMatchesAsync(string customerNumber,
        string referenceType, string normalizedReference, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var command = new SqlCommand("SELECT CaseId FROM operational.RmaReworkCase WHERE CustomerNumber=@Customer AND CaseStatus='ACTIVE';", connection);
        command.Parameters.AddWithValue("@Customer", customerNumber);
        var ids = new List<Guid>();
        await using (var reader = await command.ExecuteReaderAsync(token))
            while (await reader.ReadAsync(token)) ids.Add(reader.GetGuid(0));
        var records = new List<RmaReworkCaseRecord>();
        foreach (var id in ids) { var record = await GetAsync(id, token); if (record is not null) records.Add(record); }
        return records.Where(record =>
        {
            var reference = RmaReworkMatchingRules.GetCaseReference(record, referenceType);
            return reference is not null && string.Equals(reference.NormalizedValue, normalizedReference,
                StringComparison.Ordinal);
        }).ToList();
    }

    public async Task<Guid?> GetLatestEventIdAsync(Guid caseId, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var command = new SqlCommand("SELECT TOP(1) EventId FROM operational.RmaReworkCaseEvent WHERE CaseId=@CaseId ORDER BY EventSequence DESC;", connection);
        command.Parameters.AddWithValue("@CaseId", caseId);
        var result = await command.ExecuteScalarAsync(token);
        return result is Guid value ? value : null;
    }

    public async Task AddMemberAsync(Guid caseId, RmaReworkMemberEvidence member,
        RmaReworkReference reference, string actor, Guid? expectedPriorEventId, Guid correlationId,
        string? note, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        await AcquireReferenceLockAsync(connection, transaction, member.Identity.CustomerNumber, reference, token);
        var matchingIds = await FindMatchingIdsAsync(connection, transaction, member.Identity.CustomerNumber, reference, token);
        if (matchingIds.Count != 1 || matchingIds[0] != caseId)
            throw RmaReworkProblem.Conflict(matchingIds.Count > 1 ? "ambiguous_reference_match" : "matching_case_changed",
                matchingIds.Count > 1 ? "More than one active case matches this customer and reference." : "The active matching case changed. Review the reference again.");
        var current = new SqlCommand("SELECT CustomerNumber,CaseStatus,CustomerRmaNumber,InternalReference FROM operational.RmaReworkCase WITH (UPDLOCK,HOLDLOCK) WHERE CaseId=@CaseId;", connection, transaction);
        current.Parameters.AddWithValue("@CaseId", caseId);
        string customer; string status; string? customerRma; string? internalReference;
        await using (var reader = await current.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token)) throw RmaReworkProblem.NotFound("case_not_found", "The RMA/Rework Case was not found.");
            customer = reader.GetString(0); status = reader.GetString(1);
            customerRma = reader.IsDBNull(2) ? null : reader.GetString(2);
            internalReference = reader.IsDBNull(3) ? null : reader.GetString(3);
        }
        if (status != "ACTIVE" || customer != member.Identity.CustomerNumber)
            throw RmaReworkProblem.Conflict("case_customer_or_status_changed", "The active case no longer matches the canonical line customer.");
        var storedReference = RmaReworkMatchingRules.ResolveStoredReference(customerRma, internalReference, reference.ReferenceType);
        if (storedReference is null || storedReference.NormalizedValue != reference.NormalizedValue)
            throw RmaReworkProblem.Conflict("matching_case_changed", "The case reference no longer matches the reviewed reference.");

        var latest = new SqlCommand("SELECT TOP(1) EventId FROM operational.RmaReworkCaseEvent WITH (UPDLOCK,HOLDLOCK) WHERE CaseId=@CaseId ORDER BY EventSequence DESC;", connection, transaction);
        latest.Parameters.AddWithValue("@CaseId", caseId);
        var latestValue = await latest.ExecuteScalarAsync(token);
        var latestEventId = latestValue is Guid value ? value : (Guid?)null;
        if (latestEventId is null || latestEventId != expectedPriorEventId)
            throw RmaReworkProblem.Conflict("case_version_changed", "The RMA/Rework Case history changed. Review the case again.");

        var sequence = new SqlCommand("SELECT ISNULL(MAX(MemberSequence),0)+1 FROM operational.RmaReworkCaseMember WITH (UPDLOCK,HOLDLOCK) WHERE CaseId=@CaseId;", connection, transaction);
        sequence.Parameters.AddWithValue("@CaseId", caseId);
        var nextSequence = Convert.ToInt32(await sequence.ExecuteScalarAsync(token));
        var insertMember = new SqlCommand("""
INSERT operational.RmaReworkCaseMember
(CaseId,MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,ItemNumber,Revision,
 QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,RelatedWorkOrderNumber,
 RelationshipStatus,RelationshipBasis,CaseStatus)
VALUES(@CaseId,@Sequence,@Customer,@SalesOrder,@Line,@LineId,@Item,@Revision,@Ordered,@ErpOpen,@Pending,@Operational,
 @WorkOrder,@RelationshipStatus,@RelationshipBasis,'ACTIVE');
""", connection, transaction);
        insertMember.Parameters.AddWithValue("@CaseId", caseId); insertMember.Parameters.AddWithValue("@Sequence", nextSequence);
        insertMember.Parameters.AddWithValue("@Customer", member.Identity.CustomerNumber); insertMember.Parameters.AddWithValue("@SalesOrder", member.Identity.SalesOrderNumber);
        insertMember.Parameters.AddWithValue("@Line", member.Identity.LineNumber); insertMember.Parameters.AddWithValue("@LineId", member.Identity.RecordId);
        insertMember.Parameters.AddWithValue("@Item", member.ItemNumber); insertMember.Parameters.AddWithValue("@Revision", (object?)member.Revision ?? DBNull.Value);
        insertMember.Parameters.AddWithValue("@Ordered", member.QuantityOrdered); insertMember.Parameters.AddWithValue("@ErpOpen", member.ErpQuantityOpen);
        insertMember.Parameters.AddWithValue("@Pending", member.PendingInvoiceQuantity); insertMember.Parameters.AddWithValue("@Operational", member.OperationalQuantityOpen);
        insertMember.Parameters.AddWithValue("@WorkOrder", (object?)member.RelatedWorkOrderNumber ?? DBNull.Value);
        insertMember.Parameters.AddWithValue("@RelationshipStatus", member.RelationshipStatus); insertMember.Parameters.AddWithValue("@RelationshipBasis", (object?)member.RelationshipBasis ?? DBNull.Value);
        await insertMember.ExecuteNonQueryAsync(token);

        var payload = JsonSerializer.Serialize(new { caseId, addedMember = member,
            matchingReferenceType = reference.ReferenceType, matchingReferenceDisplay = reference.DisplayValue,
            matchingReferenceNormalized = reference.NormalizedValue, note, expectedPriorEventId });
        var insertEvent = new SqlCommand("""
INSERT operational.RmaReworkCaseEvent
(EventId,CaseId,EventType,EventPayloadJson,RecordedBy,ExpectedPriorEventId,RequestCorrelationId)
VALUES(@EventId,@CaseId,'LINE_ADDED',@Payload,@Actor,@ExpectedPrior,@Correlation);
""", connection, transaction);
        insertEvent.Parameters.AddWithValue("@EventId", Guid.NewGuid()); insertEvent.Parameters.AddWithValue("@CaseId", caseId);
        insertEvent.Parameters.AddWithValue("@Payload", payload); insertEvent.Parameters.AddWithValue("@Actor", actor);
        insertEvent.Parameters.AddWithValue("@ExpectedPrior", expectedPriorEventId.Value); insertEvent.Parameters.AddWithValue("@Correlation", correlationId);
        await insertEvent.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
    }

    private static async Task AcquireReferenceLockAsync(SqlConnection connection, SqlTransaction transaction,
        string customer, RmaReworkReference reference, CancellationToken token)
    {
        var material = customer + "|" + reference.ReferenceType + "|" + reference.NormalizedValue;
        var resource = "RMAREF:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
        var command = new SqlCommand("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@Resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; SELECT @r;", connection, transaction);
        command.Parameters.AddWithValue("@Resource", resource);
        var result = Convert.ToInt32(await command.ExecuteScalarAsync(token));
        if (result < 0) throw RmaReworkProblem.Conflict("reference_lock_unavailable", "The RMA reference is being classified by another request. Review it again.");
    }

    private static async Task<List<Guid>> FindMatchingIdsAsync(SqlConnection connection, SqlTransaction transaction,
        string customer, RmaReworkReference reference, CancellationToken token)
    {
        var command = new SqlCommand("SELECT CaseId,CustomerRmaNumber,InternalReference FROM operational.RmaReworkCase WITH (UPDLOCK,HOLDLOCK) WHERE CustomerNumber=@Customer AND CaseStatus='ACTIVE';", connection, transaction);
        command.Parameters.AddWithValue("@Customer", customer);
        var result = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
        {
            var stored = RmaReworkMatchingRules.ResolveStoredReference(reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2), reference.ReferenceType);
            if (stored?.NormalizedValue == reference.NormalizedValue) result.Add(reader.GetGuid(0));
        }
        return result;
    }

    public async Task<RmaReworkCaseRecord?> GetAsync(Guid caseId, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var cases = await LoadCasesAsync(connection, "WHERE c.CaseId=@CaseId", command => command.Parameters.AddWithValue("@CaseId", caseId), token);
        return cases.SingleOrDefault();
    }

    public async Task<RmaReworkPage> ListAsync(string? customer, string? order, string? line, int page, int pageSize, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var memberFilter = order is null && line is null ? "" :
            " AND EXISTS(SELECT 1 FROM operational.RmaReworkCaseMember mx WHERE mx.CaseId=c.CaseId" +
            (order is null ? "" : " AND mx.SalesOrderNumber=@SalesOrder") +
            (line is null ? "" : " AND mx.SalesOrderLineNumber=@Line") + ")";
        var filters = "WHERE c.CaseStatus='ACTIVE'" + (customer is null ? "" : " AND c.CustomerNumber=@Customer") + memberFilter;
        var count = new SqlCommand("SELECT COUNT(*) FROM operational.RmaReworkCase c " + filters, connection);
        AddFilters(count, customer, order, line); var total = Convert.ToInt32(await count.ExecuteScalarAsync(token));
        var ids = new List<Guid>();
        var query = new SqlCommand($"SELECT c.CaseId FROM operational.RmaReworkCase c {filters} ORDER BY c.CreatedAtUtc DESC,c.CaseSequence DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;", connection);
        AddFilters(query, customer, order, line); query.Parameters.AddWithValue("@Offset", (page - 1) * pageSize); query.Parameters.AddWithValue("@PageSize", pageSize);
        await using (var reader = await query.ExecuteReaderAsync(token)) while (await reader.ReadAsync(token)) ids.Add(reader.GetGuid(0));
        var items = new List<RmaReworkCaseRecord>(); foreach (var id in ids) { var item = await GetAsync(id, token); if (item is not null) items.Add(item); }
        return new(items, total);
    }

    private static void AddFilters(SqlCommand command, string? customer, string? order, string? line)
    {
        if (customer is not null) command.Parameters.AddWithValue("@Customer", customer);
        if (order is not null) command.Parameters.AddWithValue("@SalesOrder", order);
        if (line is not null) command.Parameters.AddWithValue("@Line", line);
    }

    private async Task<List<RmaReworkCaseRecord>> LoadCasesAsync(SqlConnection connection, string where,
        Action<SqlCommand> parameters, CancellationToken token)
    {
        var command = new SqlCommand($"SELECT c.CaseId,c.CaseSequence,c.CustomerNumber,c.CaseType,c.CustomerRmaNumber,c.InternalReference,c.Notes,c.CaseStatus,c.CreatedBy,c.CreatedAtUtc FROM operational.RmaReworkCase c {where};", connection);
        parameters(command); var records = new List<RmaReworkCaseRecord>();
        await using (var reader = await command.ExecuteReaderAsync(token)) while (await reader.ReadAsync(token))
            records.Add(new(reader.GetGuid(0),reader.GetInt64(1),reader.GetString(2),reader.GetString(3),reader.IsDBNull(4)?null:reader.GetString(4),reader.IsDBNull(5)?null:reader.GetString(5),reader.IsDBNull(6)?null:reader.GetString(6),reader.GetString(7),reader.GetString(8),reader.GetDateTime(9),[]));
        foreach (var record in records)
        {
            var memberCommand = new SqlCommand("SELECT MemberSequence,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,SalesOrderLineId,ItemNumber,Revision,QuantityOrdered,ErpQuantityOpen,PendingInvoiceQuantity,OperationalQuantityOpen,RelatedWorkOrderNumber,RelationshipStatus,RelationshipBasis,CapturedAtUtc FROM operational.RmaReworkCaseMember WHERE CaseId=@CaseId ORDER BY MemberSequence;", connection);
            memberCommand.Parameters.AddWithValue("@CaseId", record.CaseId); var members = new List<RmaReworkStoredMember>();
            await using var memberReader = await memberCommand.ExecuteReaderAsync(token); while (await memberReader.ReadAsync(token))
                members.Add(new(memberReader.GetInt32(0),memberReader.GetString(1),memberReader.GetString(2),memberReader.GetString(3),memberReader.GetString(4),memberReader.GetString(5),memberReader.IsDBNull(6)?null:memberReader.GetString(6),memberReader.GetDecimal(7),memberReader.GetDecimal(8),memberReader.GetDecimal(9),memberReader.GetDecimal(10),memberReader.IsDBNull(11)?null:memberReader.GetString(11),memberReader.GetString(12),memberReader.IsDBNull(13)?null:memberReader.GetString(13),memberReader.GetDateTime(14)));
            record.Members.AddRange(members);
        }
        return records;
    }

    public async Task<IReadOnlyList<object>> GetHistoryAsync(Guid caseId, CancellationToken token)
    {
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
        var command = new SqlCommand("SELECT EventId,EventSequence,EventType,EventPayloadJson,RecordedBy,RecordedAtUtc,ExpectedPriorEventId,RequestCorrelationId FROM operational.RmaReworkCaseEvent WHERE CaseId=@CaseId ORDER BY EventSequence;", connection);
        command.Parameters.AddWithValue("@CaseId", caseId); var history = new List<object>(); await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) history.Add(new { eventId=reader.GetGuid(0),eventSequence=reader.GetInt64(1),eventType=reader.GetString(2),eventPayload=JsonSerializer.Deserialize<JsonElement>(reader.GetString(3)),recordedBy=reader.GetString(4),recordedAtUtc=reader.GetDateTime(5),expectedPriorEventId=reader.IsDBNull(6)?null:(Guid?)reader.GetGuid(6),requestCorrelationId=reader.GetGuid(7) });
        return history;
    }
}

internal static class RmaReworkPresentation
{
    public static object Case(RmaReworkCaseRecord record) => new
    {
        caseId=record.CaseId, caseSequence=record.CaseSequence, caseReference=record.CustomerRmaNumber ?? record.InternalReference,
        customerNumber=record.CustomerNumber, caseType=record.CaseType, customerRmaNumber=record.CustomerRmaNumber,
        internalReference=record.InternalReference, notes=record.Notes, caseStatus=record.CaseStatus,
        statusLabel="Active RMA / Rework", createdBy=record.CreatedBy, createdAtUtc=record.CreatedAtUtc,
        signedNetQuantity=record.Members.Sum(item=>item.ErpQuantityOpen), operationalNetQuantity=record.Members.Sum(item=>item.OperationalQuantityOpen),
        members=record.Members.Select(item=>new { item.MemberSequence,item.CustomerNumber,item.SalesOrderNumber,item.SalesOrderLineNumber,item.SalesOrderLineId,item.ItemNumber,item.Revision,item.QuantityOrdered,item.ErpQuantityOpen,item.PendingInvoiceQuantity,item.OperationalQuantityOpen,item.RelatedWorkOrderNumber,item.RelationshipStatus,item.RelationshipBasis,item.CapturedAtUtc })
    };
}

internal class RmaReworkReviewRequest { public List<RmaReworkLineRequest> Members { get; set; } = []; }
internal sealed class RmaReworkCreateRequest : RmaReworkReviewRequest { public string? CaseType { get; set; } public string? CustomerRmaNumber { get; set; } public string? InternalReference { get; set; } public string? Notes { get; set; } public string? EvidenceToken { get; set; } public string? ReferenceMatchEvidenceToken { get; set; } public Guid? RequestCorrelationId { get; set; } }
internal class RmaReworkMatchRequest { public RmaReworkLineRequest Member { get; set; } = new(); public string? CaseType { get; set; } public string? CustomerRmaNumber { get; set; } public string? InternalReference { get; set; } }
internal sealed class RmaReworkAddMemberRequest : RmaReworkMatchRequest { public string? Notes { get; set; } public string? ReferenceMatchEvidenceToken { get; set; } public Guid? ExpectedCurrentEventId { get; set; } public Guid? RequestCorrelationId { get; set; } }
internal sealed class RmaReworkLineRequest { public string? CustomerNumber { get; set; } public string? SalesOrderNumber { get; set; } public string? LineNumber { get; set; } }
internal sealed record RmaReworkLineIdentity(string CustomerNumber,string SalesOrderNumber,string LineNumber) { public string Key => CustomerNumber+"|"+SalesOrderNumber+"|"+LineNumber; public string RecordId => CustomerNumber+SalesOrderNumber+LineNumber; }
internal sealed record RmaReworkMemberEvidence(RmaReworkLineIdentity Identity,string CustomerName,string ItemNumber,string? Revision,decimal QuantityOrdered,decimal ErpQuantityOpen,decimal PendingInvoiceQuantity,decimal OperationalQuantityOpen,string? RelatedWorkOrderNumber,string RelationshipStatus,string? RelationshipBasis,Guid? CurrentCaseId,string? CurrentCaseReference);
internal sealed record RmaReworkReview(string CustomerNumber,IReadOnlyList<RmaReworkMemberEvidence> Members,decimal SignedNetQuantity,decimal OperationalNetQuantity,bool MultipleSalesOrders,bool SameSignOnly,string EvidenceToken);
internal sealed record RmaReworkMembership(Guid CaseId,string CaseReference);
internal sealed record RmaReworkPage(IReadOnlyList<RmaReworkCaseRecord> Items,int TotalItems);
internal sealed record RmaReworkStoredMember(int MemberSequence,string CustomerNumber,string SalesOrderNumber,string SalesOrderLineNumber,string SalesOrderLineId,string ItemNumber,string? Revision,decimal QuantityOrdered,decimal ErpQuantityOpen,decimal PendingInvoiceQuantity,decimal OperationalQuantityOpen,string? RelatedWorkOrderNumber,string RelationshipStatus,string? RelationshipBasis,DateTime CapturedAtUtc);
internal sealed record RmaReworkCaseRecord(Guid CaseId,long CaseSequence,string CustomerNumber,string CaseType,string? CustomerRmaNumber,string? InternalReference,string? Notes,string CaseStatus,string CreatedBy,DateTime CreatedAtUtc,List<RmaReworkStoredMember> Members)
{
    public string? CaseReference => CustomerRmaNumber ?? InternalReference;
}
internal sealed record RmaReworkReference(string ReferenceType,string DisplayValue,string NormalizedValue);
internal sealed record RmaReworkMatchReview(RmaReworkMemberEvidence LineEvidence,string ReferenceType,string EnteredReference,string NormalizedReference,string ProposedCaseType,int MatchingCaseCount,RmaReworkCaseRecord? ExistingCase,string ProposedAction,Guid? ExpectedCurrentEventId,string EvidenceToken);

internal static class RmaReworkMatchingRules
{
    public static RmaReworkReference ResolveReference(string? customerRmaNumber, string? internalReference,
        bool requireExactlyOne)
    {
        var customer = NormalizeDisplay(customerRmaNumber);
        var internalValue = NormalizeDisplay(internalReference);
        if (customer is null && internalValue is null)
            throw RmaReworkProblem.BadRequest("case_reference_required", "Enter a Customer RMA Number or an Internal RMA Reference.");
        if (requireExactlyOne && customer is not null && internalValue is not null)
            throw RmaReworkProblem.BadRequest("single_reference_type_required", "Enter either a Customer RMA Number or an Internal RMA Reference, not both.");
        return customer is not null ? new("CUSTOMER_RMA", customer, NormalizeComparison(customer)) :
            new("INTERNAL_RMA", internalValue!, NormalizeComparison(internalValue!));
    }

    public static RmaReworkReference? GetCaseReference(RmaReworkCaseRecord record, string referenceType) =>
        ResolveStoredReference(record.CustomerRmaNumber, record.InternalReference, referenceType);

    public static IReadOnlyList<RmaReworkReference> ResolveAllReferences(string? customerRmaNumber,
        string? internalReference)
    {
        var result = new List<RmaReworkReference>();
        var customer = ResolveStoredReference(customerRmaNumber, internalReference, "CUSTOMER_RMA");
        var internalValue = ResolveStoredReference(customerRmaNumber, internalReference, "INTERNAL_RMA");
        if (customer is not null) result.Add(customer);
        if (internalValue is not null) result.Add(internalValue);
        return result;
    }

    public static RmaReworkReference? ResolveStoredReference(string? customerRmaNumber,
        string? internalReference, string referenceType)
    {
        var value = referenceType == "CUSTOMER_RMA" ? NormalizeDisplay(customerRmaNumber) :
            referenceType == "INTERNAL_RMA" ? NormalizeDisplay(internalReference) : null;
        return value is null ? null : new(referenceType, value, NormalizeComparison(value));
    }

    private static string? NormalizeDisplay(string? value)
    {
        var display = (value ?? "").Trim();
        if (display.Length == 0) return null;
        if (display.Length > 80) throw RmaReworkProblem.BadRequest("value_too_long", "A reference exceeds the 80-character limit.");
        return display;
    }
    private static string NormalizeComparison(string value) => Regex.Replace(value.Trim(), @"\s+", " ").ToUpperInvariant();
}

internal sealed class RmaReworkProblem : Exception
{
    public int StatusCode { get; } public string Code { get; }
    private RmaReworkProblem(int status,string code,string message):base(message){StatusCode=status;Code=code;}
    public static RmaReworkProblem BadRequest(string code,string message)=>new(400,code,message);
    public static RmaReworkProblem Unauthorized(string code,string message)=>new(401,code,message);
    public static RmaReworkProblem NotFound(string code,string message)=>new(404,code,message);
    public static RmaReworkProblem Conflict(string code,string message)=>new(409,code,message);
}
