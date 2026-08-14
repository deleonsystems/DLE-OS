using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class KittingCaseCenter
{
    private const string Route = "/api/kitting-cases/v1/work-orders/{workOrderNumber}";

    internal static void MapKittingCases(this WebApplication app, string policy)
    {
        var service = new KittingCaseService();
        app.MapGet("/api/kitting-cases/v1/accepted-material-label",
            async (string? partNumber, string? purchaseOrder, CancellationToken token) =>
                await Execute(() => service.ResolveAcceptedMaterialLabelAsync(partNumber, purchaseOrder, token)))
            .RequireAuthorization(policy);
        app.MapGet(Route, async (string workOrderNumber, CancellationToken token) =>
            await Execute(() => service.GetAsync(workOrderNumber, token))).RequireAuthorization(policy);
        app.MapGet(Route + "/submissions", async (string workOrderNumber, CancellationToken token) =>
            await Execute(() => service.GetSubmissionsAsync(workOrderNumber, token))).RequireAuthorization(policy);
        app.MapGet(Route + "/submissions/{submissionId:guid}/pdf",
            async (string workOrderNumber, Guid submissionId, CancellationToken token) =>
                await ExecutePdf(() => service.GetSubmissionPdfAsync(workOrderNumber, submissionId, token)))
            .RequireAuthorization(policy);
        app.MapGet(Route + "/submissions/{submissionId:guid}/layout-preview.pdf",
            async (string workOrderNumber, Guid submissionId, CancellationToken token) =>
                await ExecutePreviewPdf(() => service.GetSubmissionLayoutPreviewAsync(workOrderNumber, submissionId, token)))
            .RequireAuthorization(policy);
        app.MapPost(Route + "/start", async (string workOrderNumber, StartKittingCaseRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.StartAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), token))).RequireAuthorization(policy);
        app.MapPost(Route + "/resume", async (string workOrderNumber, KittingCaseVersionRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.ResumeAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), token))).RequireAuthorization(policy);
        app.MapPut(Route + "/po-traceability", async (string workOrderNumber,
                SetKittingPoTraceabilityRequest request, HttpContext context, CancellationToken token) =>
            await Execute(() => service.SetPoTraceabilityAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), token))).RequireAuthorization(policy);
        app.MapPut(Route + "/draft", async (string workOrderNumber, SaveKittingDraftRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.SaveDraftAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), false, token))).RequireAuthorization(policy);
        app.MapPost(Route + "/save-exit", async (string workOrderNumber, SaveKittingDraftRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.SaveDraftAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), true, token))).RequireAuthorization(policy);
        app.MapPost(Route + "/submit", async (string workOrderNumber, SaveKittingDraftRequest request,
                HttpContext context, CancellationToken token) =>
            await Execute(() => service.SubmitAsync(workOrderNumber, request,
                TrustedDevelopmentIdentity.RequireActorName(context), token))).RequireAuthorization(policy);
        app.MapPost("/api/kitting-cases/v1/admin/wo-0115621/archive-run-001",
            async (HttpContext context,CancellationToken token) =>
            {
                var user=context.RequestServices.GetRequiredService<TrustedDleOsUserContextAccessor>().AuthorizedUser;
                if(user?.IsSuperAdmin!=true)
                    return Results.Json(new { code="super_admin_required",
                        message="This DEV qualification archive requires SUPER_ADMIN." },statusCode:403);
                return await Execute(() => service.ArchiveQualificationRun001Async(
                    TrustedDevelopmentIdentity.RequireActorName(context),token));
            }).RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(Func<Task<object>> operation)
    {
        try { return Results.Json(await operation()); }
        catch (KittingCaseProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (KittingDispositionProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (HttpRequestException error)
        {
            Console.Error.WriteLine($"KittingCaseCanonicalFailure: {error.Message}");
            return Results.Json(new { code = "canonical_evidence_unavailable",
                message = "Current canonical Kitting eligibility evidence is unavailable." }, statusCode: 503);
        }
        catch (SqlException error)
        {
            Console.Error.WriteLine($"KittingCaseSqlFailure {error.Number}: {error.Message}");
            return Results.Json(new { code = "kitting_case_store_unavailable",
                message = "The governed Kitting Case store is unavailable." }, statusCode: 503);
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"KittingCaseEvidenceFailure: {error.Message}");
            return Results.Json(new { code = "kitting_case_evidence_unavailable",
                message = "The governed Kitting PDF destination is unavailable." }, statusCode: 503);
        }
    }

    private static async Task<IResult> ExecutePdf(Func<Task<KittingPdfEvidence>> operation)
    {
        try
        {
            var evidence = await operation();
            return Results.File(evidence.Path, "application/pdf", evidence.FileName, enableRangeProcessing: true);
        }
        catch (KittingCaseProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"KittingCaseEvidenceReadFailure: {error.Message}");
            return Results.Json(new { code = "kitting_case_evidence_unavailable",
                message = "The governed Kitting PDF is unavailable." }, statusCode: 503);
        }
    }

    private static async Task<IResult> ExecutePreviewPdf(Func<Task<KittingPdfPreview>> operation)
    {
        try
        {
            var preview = await operation();
            return Results.File(preview.Bytes, "application/pdf", preview.FileName);
        }
        catch (KittingCaseProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (SqlException error)
        {
            Console.Error.WriteLine($"KittingCaseLayoutPreviewSqlFailure {error.Number}: {error.Message}");
            return Results.Json(new { code = "kitting_case_store_unavailable",
                message = "The governed Kitting Case store is unavailable." }, statusCode: 503);
        }
    }
}

internal sealed class KittingCaseService
{
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(15);
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;
    private readonly string shortageRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_SHORTAGE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
    private readonly string completeRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_COMPLETE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-COMPLETE";
    private readonly HttpClient canonical;
    private readonly CanonicalKittingEvidenceResolver evidenceResolver;
    private readonly OperationalWorkOrderRelationshipService operationalRelationships;

    internal KittingCaseService()
    {
        canonical = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
        {
            BaseAddress = new Uri(ControlHostRuntimeConfiguration.CanonicalApiBaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
        evidenceResolver = new CanonicalKittingEvidenceResolver(canonical);
        operationalRelationships = new OperationalWorkOrderRelationshipService(canonical);
    }

    internal async Task<object> ResolveAcceptedMaterialLabelAsync(string? partValue,string? poValue,
        CancellationToken token)
    {
        var part=(partValue??"").Trim();var purchaseOrder=(poValue??"").Trim();
        if(part.Length==0)return new { resolutionStatus="PART_REQUIRED",candidateCount=0,
            message="Select the actual main or governed Related part before resolving accepted material.",
            missingIdentifier="partNumber" };
        if(part.Length>40)throw KittingCaseProblem.BadRequest("part_number_too_long","Part number is too long.");
        if(purchaseOrder.Length==0)return new { resolutionStatus="PO_REQUIRED",candidateCount=0,
            message="Enter the material source P.O. to resolve an exact accepted receipt line.",
            missingIdentifier="purchaseOrder" };
        if(purchaseOrder.Length>40)throw KittingCaseProblem.BadRequest("purchase_order_too_long","P.O. is too long.");
        var path="api/platform/live/v1/receiving-history?page=1&pageSize=200&itemNumber="+
            Uri.EscapeDataString(part)+"&purchaseOrderNumber="+Uri.EscapeDataString(purchaseOrder);
        using var response=await canonical.GetAsync(path,token);response.EnsureSuccessStatusCode();
        using var document=JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
        var root=document.RootElement;
        var total=root.TryGetProperty("totalItems",out var totalValue)&&totalValue.TryGetInt32(out var count)?count:0;
        var matches=new List<JsonElement>();
        if(root.TryGetProperty("items",out var items)&&items.ValueKind==JsonValueKind.Array)
            foreach(var item in items.EnumerateArray())
            {
                if(!string.Equals(JsonText(item,"itemNumber"),part,StringComparison.OrdinalIgnoreCase) ||
                    !SamePurchaseOrder(JsonText(item,"purchaseOrderNumber"),purchaseOrder))continue;
                var accepted=JsonDecimal(item,"quantityAccepted");var returned=JsonDecimal(item,"quantityReturned");
                if(accepted>0&&returned<accepted)matches.Add(item.Clone());
            }
        if(total>200||matches.Count>1)return new { resolutionStatus="AMBIGUOUS",candidateCount=Math.Max(total,matches.Count),
            message="Part and P.O. identify multiple accepted receipt lines. A future scan/select step must choose the physical material identity.",
            missingIdentifier="purchaseReceiptLineId" };
        if(matches.Count==0)return new { resolutionStatus="NOT_FOUND",candidateCount=0,
            message="No retained accepted receipt line matches this exact part and P.O.",
            missingIdentifier="purchaseReceiptLineId" };
        var match=matches[0];
        return new { resolutionStatus="RESOLVED",candidateCount=1,resolvedAtUtc=DateTime.UtcNow,
            identityType="CANONICAL_PURCHASE_RECEIPT_LINE",
            labelTemplate="DLE_OS_ACCEPTED_MATERIAL_DEV_TRIAL_V1",
            physicalLabelIdAvailable=false,lotIdentityAvailable=false,
            material=new { purchaseReceiptLineId=JsonText(match,"purchaseReceiptLineId"),
                receiverNumber=JsonText(match,"receiverNumber"),receiptDateIso=JsonText(match,"receiptDateIso"),
                purchaseOrderNumber=JsonText(match,"purchaseOrderNumber"),
                purchaseOrderLineNumber=JsonText(match,"purchaseOrderLineNumber"),
                partNumber=JsonText(match,"itemNumber"),itemDescription=JsonText(match,"itemDescription"),
                quantityAccepted=JsonDecimal(match,"quantityAccepted"),unitOfMeasure=JsonText(match,"unitOfMeasure"),
                vendorNumber=JsonText(match,"vendorNumber"),vendorName=JsonText(match,"vendorName"),
                packingSlipNumber=JsonText(match,"packingSlipNumber"),warehouseId=JsonText(match,"warehouseId"),
                inventoryLocation=JsonText(match,"inventoryLocation"),inspectionStatus=JsonText(match,"inspectionStatus") } };
    }

    private static string JsonText(JsonElement value,string name)=>
        value.TryGetProperty(name,out var item)&&item.ValueKind!=JsonValueKind.Null?item.ToString().Trim():"";
    private static decimal JsonDecimal(JsonElement value,string name)=>
        value.TryGetProperty(name,out var item)&&decimal.TryParse(item.ToString(),NumberStyles.Number,
            CultureInfo.InvariantCulture,out var result)?result:0;
    private static bool SamePurchaseOrder(string? left,string? right)
    {
        static string Normalize(string? value){var text=(value??"").Trim();return Regex.IsMatch(text,"^[0-9]+$")?
            text.TrimStart('0') is var digits&&digits.Length>0?digits:"0":text.ToUpperInvariant();}
        return Normalize(left)==Normalize(right);
    }

    private async Task ValidateCanonicalAcceptedMaterialAsync(JsonElement draft,CancellationToken token)
    {
        if(!draft.TryGetProperty("groups",out var groups)||groups.ValueKind!=JsonValueKind.Array)return;
        var evidence=new Dictionary<string,(string Part,string Po)>(StringComparer.OrdinalIgnoreCase);
        foreach(var group in groups.EnumerateArray())
        {
            if(!group.TryGetProperty("entry",out var entry)||entry.ValueKind!=JsonValueKind.Object)continue;
            Capture(entry,JsonText(entry,"selectedPartNumber"),JsonText(entry,"purchaseOrder"));
            if(entry.TryGetProperty("allocations",out var allocations)&&allocations.ValueKind==JsonValueKind.Array)
                foreach(var allocation in allocations.EnumerateArray())
                    Capture(allocation,JsonText(allocation,"partNumber"),JsonText(allocation,"purchaseOrder"));
        }
        foreach(var item in evidence)
        {
            using var response=await canonical.GetAsync("api/platform/live/v1/receiving-history/"+
                Uri.EscapeDataString(item.Key),token);
            if(response.StatusCode==System.Net.HttpStatusCode.NotFound)
                throw KittingCaseProblem.BadRequest("accepted_material_identity_not_found",
                    "The referenced accepted material receipt line no longer exists in canonical Receiving history.");
            response.EnsureSuccessStatusCode();
            using var document=JsonDocument.Parse(await response.Content.ReadAsStreamAsync(token));
            var record=document.RootElement;
            if(!string.Equals(JsonText(record,"purchaseReceiptLineId"),item.Key,StringComparison.OrdinalIgnoreCase)||
                !string.Equals(JsonText(record,"itemNumber"),item.Value.Part,StringComparison.OrdinalIgnoreCase)||
                !SamePurchaseOrder(JsonText(record,"purchaseOrderNumber"),item.Value.Po)||
                JsonDecimal(record,"quantityAccepted")<=0||
                JsonDecimal(record,"quantityReturned")>=JsonDecimal(record,"quantityAccepted"))
                throw KittingCaseProblem.BadRequest("accepted_material_identity_not_accepted",
                    "The referenced receipt line is not accepted material for this exact allocation part and P.O.");
        }

        void Capture(JsonElement source,string part,string po)
        {
            if(!source.TryGetProperty("acceptedMaterial",out var identity)||identity.ValueKind!=JsonValueKind.Object)return;
            var id=JsonText(identity,"purchaseReceiptLineId");
            if(id.Length>0)evidence[id]=(part,po);
        }
    }

    internal async Task<object> ArchiveQualificationRun001Async(string actor,CancellationToken token)
    {
        RequireActor(actor);
        await using var connection=new SqlConnection(connectionString);await connection.OpenAsync(token);
        if(!string.Equals(connection.Database,"DLE_OS_OPERATIONAL_DEV",StringComparison.Ordinal))
            throw new InvalidOperationException("The qualification archive is outside the DEV operational database.");
        var migrationPath=Path.Combine(AppContext.BaseDirectory,"KittingCaseRunMigration.sql");
        if(!File.Exists(migrationPath))throw new FileNotFoundException("The additive Kitting run migration is absent.",migrationPath);
        foreach(var batch in Regex.Split(await File.ReadAllTextAsync(migrationPath,token),@"(?im)^\s*GO\s*$"))
        {
            if(string.IsNullOrWhiteSpace(batch))continue;
            var migration=new SqlCommand(batch,connection){CommandTimeout=60};
            await migration.ExecuteNonQueryAsync(token);
        }
        var caseCommand=new SqlCommand("""
SELECT CaseId FROM operational.KittingCase
WHERE WorkOrderNumber='0115621' AND RunNumber=1 AND IsActive=1;
""",connection);
        var caseValue=await caseCommand.ExecuteScalarAsync(token);
        if(caseValue is not Guid expectedCaseId)
            throw KittingCaseProblem.Conflict("qualification_run_not_active","The sole active WO 0115621 Run 001 case was not found.");
        var evidence=new List<KittingImmutableEvidence>();
        var evidenceCommand=new SqlCommand("""
SELECT s.SubmissionId,s.SubmissionType,s.VersionNumber,s.SnapshotJson,s.PdfFileName,s.PdfPath,
       s.PdfSha256,s.SubmittedBy,s.SubmittedAtUtc
FROM operational.KittingSubmission s WHERE s.CaseId=@CaseId ORDER BY s.SubmissionId;
""",connection);Add(evidenceCommand,"@CaseId",expectedCaseId);
        await using(var reader=await evidenceCommand.ExecuteReaderAsync(token))
            while(await reader.ReadAsync(token))evidence.Add(new(reader.GetGuid(0),reader.GetString(1),reader.GetInt32(2),
                reader.GetString(3),reader.GetString(4),reader.GetString(5),reader.GetString(6),reader.GetString(7),reader.GetDateTime(8)));
        if(evidence.Count!=3)throw KittingCaseProblem.Conflict("qualification_evidence_changed","Run 001 must contain exactly three submissions.");
        var expectedVersions=evidence.Select(x=>$"{x.Type}:{x.Version}").Order().ToArray();
        if(!expectedVersions.SequenceEqual(new[]{"KIT_COMPLETE:1","KIT_SHORT:1","KIT_SHORT:2"}))
            throw KittingCaseProblem.Conflict("qualification_evidence_changed","Run 001 submission versions do not match qualified evidence.");
        foreach(var item in evidence)
        {
            if(!IsApprovedEvidencePath(item.Path)||!File.Exists(item.Path))
                throw KittingCaseProblem.Conflict("qualification_pdf_missing","A Run 001 immutable PDF is unavailable.");
            if(!Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(item.Path,token))).Equals(item.Hash,StringComparison.Ordinal))
                throw KittingCaseProblem.Conflict("qualification_pdf_hash_changed","A Run 001 immutable PDF no longer matches its stored hash.");
        }
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        var archive=new SqlCommand("""
DECLARE @Now datetime2(3)=SYSUTCDATETIME();
IF (SELECT COUNT(*) FROM operational.KittingCase WITH (UPDLOCK,HOLDLOCK)
    WHERE WorkOrderNumber='0115621' AND CaseId=@CaseId AND RunNumber=1 AND IsActive=1)<>1
    THROW 52620,'The expected active Run 001 case was not found.',1;
IF EXISTS (SELECT 1 FROM operational.KittingCase WHERE WorkOrderNumber='0115621' AND CaseId<>@CaseId)
    THROW 52621,'An unexpected additional Kitting run already exists.',1;
UPDATE operational.KittingCase SET IsActive=0,ArchivedAtUtc=@Now,ArchivedBy=@Actor,
 ArchiveReason=N'DEV qualification lifecycle archived before Miguel manual end-to-end Run 002',
 EditingSessionId=NULL,EditingOwner=NULL,EditingAcquiredAtUtc=NULL,EditingExpiresAtUtc=NULL,UpdatedAtUtc=@Now
WHERE CaseId=@CaseId;
INSERT operational.KittingCaseEvent(EventId,CaseId,EventType,Actor,EventAtUtc,WorkingVersion,DetailJson)
SELECT NEWID(),CaseId,'QUALIFICATION_RUN_ARCHIVED',@Actor,@Now,WorkingVersion,
 N'{"runNumber":1,"classification":"DEV_QUALIFICATION_EVIDENCE","nextRunNumber":2,"activeCaseAfterReset":false}'
FROM operational.KittingCase WHERE CaseId=@CaseId;
""",connection,transaction);Add(archive,"@CaseId",expectedCaseId);Add(archive,"@Actor",actor);
        await archive.ExecuteNonQueryAsync(token);await transaction.CommitAsync(token);
        var verify=new SqlCommand("""
SELECT (SELECT COUNT(*) FROM operational.KittingCase WHERE WorkOrderNumber='0115621' AND IsActive=1),
       (SELECT COUNT(*) FROM operational.KittingSubmission WHERE CaseId=@CaseId),
       (SELECT COUNT(*) FROM operational.KittingCaseEvent WHERE CaseId=@CaseId AND EventType='QUALIFICATION_RUN_ARCHIVED');
""",connection);Add(verify,"@CaseId",expectedCaseId);
        await using var result=await verify.ExecuteReaderAsync(token);await result.ReadAsync(token);
        if(result.GetInt32(0)!=0||result.GetInt32(1)!=3||result.GetInt32(2)!=1)
            throw new InvalidOperationException("The Run 001 post-archive boundary is invalid.");
        var evidenceRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"DLE-OS","KittingCase");
        Directory.CreateDirectory(evidenceRoot);var evidencePath=Path.Combine(evidenceRoot,"Run001ArchiveEvidence.json");
        await File.WriteAllTextAsync(evidencePath,JsonSerializer.Serialize(new { verdict="PASS",workOrder="0115621",
            archivedCaseId=expectedCaseId,archivedRunNumber=1,actor,activeCaseCount=0,nextRunNumber=2,
            submissions=evidence.Select(x=>new{x.Id,x.Type,x.Version,x.FileName,x.Hash}),
            immutableSubmissionRowsChanged=false,immutablePdfHashesChanged=false,
            archiveAuditEvent="QUALIFICATION_RUN_ARCHIVED" },new JsonSerializerOptions{WriteIndented=true}),token);
        return new { verdict="PASS",workOrderNumber="0115621",archivedCaseId=expectedCaseId,
            archivedRunNumber=1,activeCaseCount=0,nextRunNumber=2,evidencePath };
    }

    internal async Task<object> GetAsync(string workOrderValue, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue);
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        var value = await ReadCaseAsync(connection, null, workOrder, false, token);
        var legacy = value is null
            ? await new LegacyKittingMaterialStatusRepository().GetAsync(workOrder, token, connection)
            : null;
        return new
        {
            workOrderNumber = workOrder,
            kittingCase = value is null ? null : ToResponse(value),
            hasPersistentKittingHistory = value is not null || legacy?.HasPersistentKittingHistory == true,
            legacyMaterialStatus = value is null && legacy?.HasPersistentKittingHistory == false &&
                legacy.MaterialStatus is not null
                ? new
                {
                    machineValue = legacy.MaterialStatus,
                    source = legacy.EvidenceSource,
                    reconciliationClassification = legacy.ReconciliationClassification,
                    backfilledAtUtc = legacy.BackfilledAtUtc,
                    backfilledBy = legacy.BackfilledBy
                }
                : null
        };
    }

    internal async Task<object> GetSubmissionsAsync(string workOrderValue, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue);
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        var command = new SqlCommand("""
SELECT s.SubmissionId,s.SubmissionType,s.VersionNumber,s.SubmittedBy,s.SubmittedAtUtc,
       s.PdfFileName,s.PdfPath,s.PdfSha256,c.RunNumber,c.IsActive,c.ArchivedAtUtc,
       c.ArchivedBy,c.ArchiveReason
FROM operational.KittingSubmission s
JOIN operational.KittingCase c ON c.CaseId=s.CaseId
WHERE c.WorkOrderNumber=@WorkOrder ORDER BY s.SubmittedAtUtc DESC;
""", connection);
        command.Parameters.AddWithValue("@WorkOrder", workOrder);
        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            rows.Add(new { submissionId=reader.GetGuid(0), submissionType=reader.GetString(1),
                versionNumber=reader.GetInt32(2), submittedBy=reader.GetString(3),
                submittedAtUtc=reader.GetDateTime(4), pdfFileName=reader.GetString(5),
                pdfPath=reader.GetString(6), pdfSha256=reader.GetString(7),
                runNumber=reader.GetInt32(8), isActiveRun=reader.GetBoolean(9),
                archivedAtUtc=reader.IsDBNull(10)?null:(DateTime?)reader.GetDateTime(10),
                archivedBy=reader.IsDBNull(11)?null:reader.GetString(11),
                archiveReason=reader.IsDBNull(12)?null:reader.GetString(12) });
        return new { workOrderNumber=workOrder, submissions=rows };
    }

    internal async Task<KittingPdfEvidence> GetSubmissionPdfAsync(string workOrderValue, Guid submissionId,
        CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue);
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        var command = new SqlCommand("""
SELECT s.PdfFileName,s.PdfPath
FROM operational.KittingSubmission s
JOIN operational.KittingCase c ON c.CaseId=s.CaseId
WHERE c.WorkOrderNumber=@WorkOrder AND s.SubmissionId=@SubmissionId;
""", connection);
        command.Parameters.AddWithValue("@WorkOrder", workOrder);
        command.Parameters.AddWithValue("@SubmissionId", submissionId);
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token))
            throw KittingCaseProblem.NotFound("kitting_submission_not_found", "That immutable Kitting submission was not found.");
        var fileName = reader.GetString(0);
        var path = reader.GetString(1);
        if (!IsApprovedEvidencePath(path) || !File.Exists(path))
            throw KittingCaseProblem.NotFound("kitting_pdf_not_found", "That immutable Kitting PDF is unavailable.");
        return new KittingPdfEvidence(path, fileName);
    }

    internal async Task<KittingPdfPreview> GetSubmissionLayoutPreviewAsync(string workOrderValue,
        Guid submissionId, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue);
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        var command = new SqlCommand("""
SELECT s.SubmissionType,s.VersionNumber,s.SnapshotJson,c.RunNumber
FROM operational.KittingSubmission s
JOIN operational.KittingCase c ON c.CaseId=s.CaseId
WHERE c.WorkOrderNumber=@WorkOrder AND s.SubmissionId=@SubmissionId;
""", connection);
        command.Parameters.AddWithValue("@WorkOrder", workOrder);
        command.Parameters.AddWithValue("@SubmissionId", submissionId);
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token))
            throw KittingCaseProblem.NotFound("kitting_submission_not_found", "That immutable Kitting submission was not found.");
        var type = reader.GetString(0);
        var version = reader.GetInt32(1);
        var snapshot = reader.GetString(2);
        var runNumber = reader.GetInt32(3);
        var label = type == "KIT_SHORT" ? "KIT-SHORT" : "KIT-COMPLETE";
        return new KittingPdfPreview(KittingCasePdfWriter.Create(snapshot),
            runNumber<=1?$"WO{workOrder}_{label}_V{version:000}_LAYOUT-PREVIEW.pdf":
                $"WO{workOrder}_RUN{runNumber:000}_{label}_V{version:000}_LAYOUT-PREVIEW.pdf");
    }

    private bool IsApprovedEvidencePath(string path)
    {
        var candidate = Path.GetFullPath(path);
        return IsWithin(candidate, shortageRoot) || IsWithin(candidate, completeRoot);
    }

    private static bool IsWithin(string candidate, string root)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        return candidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase);
    }

    internal async Task<object> StartAsync(string workOrderValue, StartKittingCaseRequest request,
        string actor, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue);
        RequireActor(actor);
        var disposition = await new KittingDispositionRepository().GetCurrentAsync(workOrder, token);
        if (!string.Equals(disposition?.ResultingDisposition, "NEEDS_KITTING", StringComparison.Ordinal))
            throw KittingCaseProblem.Conflict("needs_kitting_required",
                "Start Kitting requires the current governed disposition to be Needs Kitting.");
        var governedDisposition = disposition!;
        var customer = NormalizeDigits(request.CustomerNumber, 6, "Customer number");
        var salesOrder = NormalizeDigits(request.OriginSalesOrderNumber, 7, "Origin Sales Order");
        var line = NormalizeDigits(request.OriginSalesOrderLineNumber, 3, "Origin Sales Order line");
        var operational = await operationalRelationships.LoadAsync(LineKey.Create(customer, salesOrder, line), token);
        if (operational.OperationalRoute != "NORMAL_PRODUCTION" ||
            operational.ActiveWorkOrderNumber != workOrder)
            throw KittingCaseProblem.BadRequest("operational_work_order_not_actionable",
                "The governed Sales Order relationship does not authorize this Work Order for ordinary production Kitting.");
        var canonicalEvidence = await evidenceResolver.ResolveAsync(workOrder, customer, salesOrder, line, token);
        var validation = KittingDraftValidator.Validate(request.Draft, workOrder, requireComplete:false,
            poTraceabilityRequired:true);
        var assembly = Clean(request.AssemblyItemNumber, 64);
        if (assembly.Length == 0) throw KittingCaseProblem.BadRequest("assembly_required", "Assembly identity is required.");
        var canonicalAssembly = governedDisposition.AssemblyItemNumber;
        if (!string.Equals(assembly, canonicalAssembly, StringComparison.OrdinalIgnoreCase))
            throw KittingCaseProblem.BadRequest("assembly_identity_changed",
                "The released BOM assembly no longer matches the current canonical Work Order.");
        var revision = NullableClean(request.Revision, 32);
        if (!string.Equals(revision ?? "", governedDisposition.Revision ?? "", StringComparison.OrdinalIgnoreCase))
            throw KittingCaseProblem.BadRequest("revision_identity_changed",
                "The released BOM revision no longer matches the current canonical Work Order.");
        var bomIdentity = Clean(request.ReleasedBomIdentity, 128);
        if (bomIdentity.Length < 16) throw KittingCaseProblem.BadRequest("released_bom_identity_required",
            "A stable released BOM identity is required.");
        var now = DateTime.UtcNow;
        var caseId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        if (await ReadCaseAsync(connection, transaction, workOrder, true, token) is not null)
            throw KittingCaseProblem.Conflict("kitting_case_already_exists", "This Work Order already has a Kitting Case.");
        var runCommand=new SqlCommand("""
SELECT ISNULL(MAX(RunNumber),0)+1 FROM operational.KittingCase WITH (UPDLOCK,HOLDLOCK)
WHERE WorkOrderNumber=@WorkOrder;
""",connection,transaction);
        Add(runCommand,"@WorkOrder",workOrder);
        var runNumber=Convert.ToInt32(await runCommand.ExecuteScalarAsync(token),CultureInfo.InvariantCulture);
        var command = new SqlCommand("""
INSERT operational.KittingCase
(CaseId,WorkOrderNumber,RunNumber,IsActive,AssemblyItemNumber,Revision,ReleasedBomIdentity,CaseState,StartedBy,
 StartedAtUtc,LastOperator,LastWorkedAtUtc,EditingSessionId,EditingOwner,EditingAcquiredAtUtc,
 EditingExpiresAtUtc,DraftJson,ActionableCount,CompletedCount,ShortRequirementCount,TotalShortage)
VALUES (@CaseId,@WorkOrder,@RunNumber,1,@Assembly,@Revision,@Bom,'KITTING_IN_PROGRESS',@Actor,@Now,@Actor,@Now,
 @Session,@Actor,@Now,@Expires,@Draft,@Actionable,@Completed,@ShortCount,@Shortage);
""", connection, transaction);
        Add(command,"@CaseId",caseId); Add(command,"@WorkOrder",workOrder); Add(command,"@Assembly",assembly);
        Add(command,"@RunNumber",runNumber);
        Add(command,"@Revision",revision); Add(command,"@Bom",bomIdentity); Add(command,"@Actor",actor);
        Add(command,"@Now",now); Add(command,"@Session",sessionId); Add(command,"@Expires",now+LeaseDuration);
        Add(command,"@Draft",validation.Json); Add(command,"@Actionable",validation.ActionableCount);
        Add(command,"@Completed",validation.CompletedCount); Add(command,"@ShortCount",validation.ShortCount);
        Add(command,"@Shortage",validation.TotalShortage);
        await command.ExecuteNonQueryAsync(token);
        await AppendEventAsync(connection,transaction,caseId,"STARTED",actor,1,
            JsonSerializer.Serialize(new { editingSessionId=sessionId }),token);
        await transaction.CommitAsync(token);
        return await GetRequiredAsync(workOrder, token);
    }

    internal async Task<object> ResumeAsync(string workOrderValue, KittingCaseVersionRequest request,
        string actor, CancellationToken token)
    {
        var workOrder = NormalizeWorkOrder(workOrderValue); RequireActor(actor); var now=DateTime.UtcNow;
        await using var connection=new SqlConnection(connectionString); await connection.OpenAsync(token);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        var current=await ReadCaseAsync(connection,transaction,workOrder,true,token) ??
            throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting Case exists for this Work Order.");
        RequireVersion(current,request.ExpectedWorkingVersion);
        if (current.State=="KIT_COMPLETE") throw KittingCaseProblem.Conflict("kitting_case_complete","Kit Complete is read-only.");
        if (current.EditingSessionId is not null && current.EditingExpiresAtUtc>now)
            throw KittingCaseProblem.Conflict("kitting_case_in_use",$"Kitting is currently being edited by {current.EditingOwner}.");
        if (current.EditingSessionId is not null)
            await AppendEventAsync(connection,transaction,current.CaseId,"STALE_LEASE_RECOVERED",actor,
                current.WorkingVersion,JsonSerializer.Serialize(new { previousOwner=current.EditingOwner }),token);
        var session=Guid.NewGuid();
        var command=new SqlCommand("""
UPDATE operational.KittingCase SET EditingSessionId=@Session,EditingOwner=@Actor,
 EditingAcquiredAtUtc=@Now,EditingExpiresAtUtc=@Expires,LastOperator=@Actor,LastWorkedAtUtc=@Now,
 WorkingVersion=WorkingVersion+1,UpdatedAtUtc=@Now WHERE CaseId=@CaseId;
""",connection,transaction);
        Add(command,"@Session",session);Add(command,"@Actor",actor);Add(command,"@Now",now);
        Add(command,"@Expires",now+LeaseDuration);Add(command,"@CaseId",current.CaseId);
        await command.ExecuteNonQueryAsync(token);
        await AppendEventAsync(connection,transaction,current.CaseId,"EDITING_ACQUIRED",actor,
            current.WorkingVersion+1,JsonSerializer.Serialize(new { editingSessionId=session }),token);
        await transaction.CommitAsync(token);
        return await GetRequiredAsync(workOrder,token);
    }

    internal async Task<object> SaveDraftAsync(string workOrderValue, SaveKittingDraftRequest request,
        string actor, bool release, CancellationToken token)
    {
        var workOrder=NormalizeWorkOrder(workOrderValue);RequireActor(actor);
        await ValidateCanonicalAcceptedMaterialAsync(request.Draft,token);
        var now=DateTime.UtcNow;
        await using var connection=new SqlConnection(connectionString);await connection.OpenAsync(token);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        var current=await ReadCaseAsync(connection,transaction,workOrder,true,token)??
            throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting Case exists for this Work Order.");
        RequireEditable(current,request,actor,now);
        var validation=KittingDraftValidator.Validate(request.Draft,workOrder,requireComplete:false,
            current.PoTraceabilityRequired);
        var next=current.WorkingVersion+1;
        var command=new SqlCommand("""
UPDATE operational.KittingCase SET DraftJson=@Draft,ActionableCount=@Actionable,CompletedCount=@Completed,
 ShortRequirementCount=@ShortCount,TotalShortage=@Shortage,LastOperator=@Actor,LastWorkedAtUtc=@Now,
 EditingSessionId=@Session,EditingOwner=@Owner,EditingAcquiredAtUtc=@Acquired,EditingExpiresAtUtc=@Expires,
 WorkingVersion=@Version,UpdatedAtUtc=@Now WHERE CaseId=@CaseId;
""",connection,transaction);
        Add(command,"@Draft",validation.Json);Add(command,"@Actionable",validation.ActionableCount);
        Add(command,"@Completed",validation.CompletedCount);Add(command,"@ShortCount",validation.ShortCount);
        Add(command,"@Shortage",validation.TotalShortage);Add(command,"@Actor",actor);Add(command,"@Now",now);
        Add(command,"@Session",release?null:current.EditingSessionId);Add(command,"@Owner",release?null:actor);
        Add(command,"@Acquired",release?null:current.EditingAcquiredAtUtc);Add(command,"@Expires",release?null:now+LeaseDuration);
        Add(command,"@Version",next);Add(command,"@CaseId",current.CaseId);
        await command.ExecuteNonQueryAsync(token);
        await AppendEventAsync(connection,transaction,current.CaseId,release?"SAVE_EXIT":"AUTOSAVED",actor,next,
            JsonSerializer.Serialize(new { validation.CompletedCount,validation.ActionableCount }),token);
        await transaction.CommitAsync(token);
        return await GetRequiredAsync(workOrder,token);
    }

    internal async Task<object> SubmitAsync(string workOrderValue, SaveKittingDraftRequest request,
        string actor, CancellationToken token)
    {
        var workOrder=NormalizeWorkOrder(workOrderValue);RequireActor(actor);
        await ValidateCanonicalAcceptedMaterialAsync(request.Draft,token);
        var now=DateTime.UtcNow; string? writtenPath=null;
        await using var connection=new SqlConnection(connectionString);await connection.OpenAsync(token);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        try
        {
            var current=await ReadCaseAsync(connection,transaction,workOrder,true,token)??
                throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting Case exists for this Work Order.");
            RequireEditable(current,request,actor,now);
            var validation=KittingDraftValidator.Validate(request.Draft,workOrder,requireComplete:true,
                current.PoTraceabilityRequired);
            var result=validation.ShortCount>0?"KIT_SHORT":"KIT_COMPLETE";
            var root=result=="KIT_SHORT"?shortageRoot:completeRoot;
            var versionCommand=new SqlCommand("""
SELECT ISNULL(MAX(VersionNumber),0)+1 FROM operational.KittingSubmission WITH (UPDLOCK,HOLDLOCK)
WHERE CaseId=@CaseId AND SubmissionType=@Type;
""",connection,transaction);
            Add(versionCommand,"@CaseId",current.CaseId);Add(versionCommand,"@Type",result);
            var version=Convert.ToInt32(await versionCommand.ExecuteScalarAsync(token),CultureInfo.InvariantCulture);
            var submissionId=Guid.NewGuid();
            using var draftDocument=JsonDocument.Parse(validation.Json);
            var snapshot=JsonSerializer.Serialize(new { schemaVersion=1,submissionId,caseId=current.CaseId,
                runNumber=current.RunNumber,
                workOrderNumber=workOrder,assemblyItemNumber=current.Assembly,revision=current.Revision,
                releasedBomIdentity=current.ReleasedBomIdentity,submissionType=result,versionNumber=version,
                submittedBy=actor,submittedAtUtc=now,
                poTraceabilityRequired=current.PoTraceabilityRequired,draft=draftDocument.RootElement });
            var label=result=="KIT_SHORT"?"KIT-SHORT":"KIT-COMPLETE";
            var fileName=current.RunNumber<=1?$"WO{workOrder}_{label}_V{version:000}.pdf":
                $"WO{workOrder}_RUN{current.RunNumber:000}_{label}_V{version:000}.pdf";
            var pdf=KittingCasePdfWriter.Create(snapshot);
            Directory.CreateDirectory(root);
            writtenPath=Path.Combine(root,fileName);
            using (var stream=new FileStream(writtenPath,FileMode.CreateNew,FileAccess.Write,FileShare.Read))
                await stream.WriteAsync(pdf,token);
            var hash=Convert.ToHexString(SHA256.HashData(pdf));
            var insert=new SqlCommand("""
INSERT operational.KittingSubmission
(SubmissionId,CaseId,SubmissionType,VersionNumber,SnapshotJson,SubmittedBy,SubmittedAtUtc,
 PdfFileName,PdfPath,PdfSha256)
VALUES (@Id,@CaseId,@Type,@Version,@Snapshot,@By,@At,@File,@Path,@Hash);
UPDATE operational.KittingCase SET DraftJson=@Draft,CaseState=@Type,ActionableCount=@Actionable,
 CompletedCount=@Completed,ShortRequirementCount=@ShortCount,TotalShortage=@Shortage,
 LastOperator=@By,LastWorkedAtUtc=@At,EditingSessionId=NULL,EditingOwner=NULL,
 EditingAcquiredAtUtc=NULL,EditingExpiresAtUtc=NULL,WorkingVersion=WorkingVersion+1,UpdatedAtUtc=@At
WHERE CaseId=@CaseId;
""",connection,transaction);
            Add(insert,"@Id",submissionId);Add(insert,"@CaseId",current.CaseId);Add(insert,"@Type",result);
            Add(insert,"@Version",version);Add(insert,"@Snapshot",snapshot);Add(insert,"@By",actor);
            Add(insert,"@At",now);Add(insert,"@File",fileName);Add(insert,"@Path",writtenPath);Add(insert,"@Hash",hash);
            Add(insert,"@Draft",validation.Json);Add(insert,"@Actionable",validation.ActionableCount);
            Add(insert,"@Completed",validation.CompletedCount);Add(insert,"@ShortCount",validation.ShortCount);
            Add(insert,"@Shortage",validation.TotalShortage);
            await insert.ExecuteNonQueryAsync(token);
            await AppendEventAsync(connection,transaction,current.CaseId,
                result=="KIT_SHORT"?"SUBMITTED_KIT_SHORT":"SUBMITTED_KIT_COMPLETE",actor,
                current.WorkingVersion+1,JsonSerializer.Serialize(new { submissionId,version,fileName,hash }),token);
            await transaction.CommitAsync(token);
            writtenPath=null;
            return await GetRequiredAsync(workOrder,token);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            if (writtenPath is not null) try { File.Delete(writtenPath); } catch { }
            throw;
        }
    }

    internal async Task<object> SetPoTraceabilityAsync(string workOrderValue,
        SetKittingPoTraceabilityRequest request, string actor, CancellationToken token)
    {
        var workOrder=NormalizeWorkOrder(workOrderValue);RequireActor(actor);var now=DateTime.UtcNow;
        await using var connection=new SqlConnection(connectionString);await connection.OpenAsync(token);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,token);
        var current=await ReadCaseAsync(connection,transaction,workOrder,true,token)??
            throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting Case exists for this Work Order.");
        RequireEditable(current,request,actor,now);
        if(current.PoTraceabilityRequired==request.PoTraceabilityRequired)
        {
            await transaction.CommitAsync(token);
            return ToResponse(current);
        }
        var next=current.WorkingVersion+1;
        var command=new SqlCommand("""
UPDATE operational.KittingCase SET PoTraceabilityRequired=@Required,LastOperator=@Actor,
 LastWorkedAtUtc=@Now,EditingExpiresAtUtc=@Expires,WorkingVersion=@Version,UpdatedAtUtc=@Now
WHERE CaseId=@CaseId;
""",connection,transaction);
        Add(command,"@Required",request.PoTraceabilityRequired);Add(command,"@Actor",actor);
        Add(command,"@Now",now);Add(command,"@Expires",now+LeaseDuration);Add(command,"@Version",next);
        Add(command,"@CaseId",current.CaseId);await command.ExecuteNonQueryAsync(token);
        await AppendEventAsync(connection,transaction,current.CaseId,"PO_TRACEABILITY_CHANGED",actor,next,
            JsonSerializer.Serialize(new { previousRequired=current.PoTraceabilityRequired,
                poTraceabilityRequired=request.PoTraceabilityRequired }),token);
        await transaction.CommitAsync(token);
        return await GetRequiredAsync(workOrder,token);
    }

    private async Task<object> GetRequiredAsync(string workOrder,CancellationToken token)
    {
        await using var connection=new SqlConnection(connectionString);await connection.OpenAsync(token);
        return ToResponse(await ReadCaseAsync(connection,null,workOrder,false,token)??
            throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting Case exists for this Work Order."));
    }

    private static object ToResponse(KittingCaseRecord value)
    {
        using var doc=JsonDocument.Parse(value.DraftJson);
        return new { caseId=value.CaseId,workOrderNumber=value.WorkOrder,runNumber=value.RunNumber,
            isActiveRun=value.IsActive,assemblyItemNumber=value.Assembly,
            revision=value.Revision,releasedBomIdentity=value.ReleasedBomIdentity,state=value.State,
            startedBy=value.StartedBy,startedAtUtc=value.StartedAtUtc,lastOperator=value.LastOperator,
            lastWorkedAtUtc=value.LastWorkedAtUtc,editingSessionId=value.EditingSessionId,
            editingOwner=value.EditingOwner,editingAcquiredAtUtc=value.EditingAcquiredAtUtc,
            editingExpiresAtUtc=value.EditingExpiresAtUtc,workingVersion=value.WorkingVersion,
            actionableCount=value.ActionableCount,completedCount=value.CompletedCount,
            shortRequirementCount=value.ShortCount,totalShortage=value.TotalShortage,
            poTraceabilityRequired=value.PoTraceabilityRequired,
            isEditing=value.EditingSessionId is not null && value.EditingExpiresAtUtc>DateTime.UtcNow,
            draft=doc.RootElement.Clone() };
    }

    private static async Task<KittingCaseRecord?> ReadCaseAsync(SqlConnection connection,SqlTransaction? transaction,
        string workOrder,bool updateLock,CancellationToken token)
    {
        var hint=updateLock?" WITH (UPDLOCK,HOLDLOCK)":"";
        var command=new SqlCommand($"""
SELECT CaseId,WorkOrderNumber,AssemblyItemNumber,Revision,ReleasedBomIdentity,CaseState,StartedBy,
 StartedAtUtc,LastOperator,LastWorkedAtUtc,EditingSessionId,EditingOwner,EditingAcquiredAtUtc,
 EditingExpiresAtUtc,DraftJson,ActionableCount,CompletedCount,ShortRequirementCount,TotalShortage,
 PoTraceabilityRequired,WorkingVersion,RunNumber,IsActive
FROM operational.KittingCase{hint} WHERE WorkOrderNumber=@WorkOrder AND IsActive=1;
""",connection,transaction);
        command.Parameters.AddWithValue("@WorkOrder",workOrder);
        await using var reader=await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token)) return null;
        return new(reader.GetGuid(0),reader.GetString(1),reader.GetString(2),reader.IsDBNull(3)?null:reader.GetString(3),
            reader.GetString(4),reader.GetString(5),reader.GetString(6),reader.GetDateTime(7),reader.GetString(8),
            reader.GetDateTime(9),reader.IsDBNull(10)?null:reader.GetGuid(10),reader.IsDBNull(11)?null:reader.GetString(11),
            reader.IsDBNull(12)?null:reader.GetDateTime(12),reader.IsDBNull(13)?null:reader.GetDateTime(13),reader.GetString(14),
            reader.GetInt32(15),reader.GetInt32(16),reader.GetInt32(17),reader.GetDecimal(18),reader.GetBoolean(19),
            reader.GetInt64(20),reader.GetInt32(21),reader.GetBoolean(22));
    }

    private static async Task AppendEventAsync(SqlConnection connection,SqlTransaction transaction,Guid caseId,
        string type,string actor,long version,string? detail,CancellationToken token)
    {
        var command=new SqlCommand("""
INSERT operational.KittingCaseEvent(EventId,CaseId,EventType,Actor,WorkingVersion,DetailJson)
VALUES (NEWID(),@CaseId,@Type,@Actor,@Version,@Detail);
""",connection,transaction);
        Add(command,"@CaseId",caseId);Add(command,"@Type",type);Add(command,"@Actor",actor);
        Add(command,"@Version",version);Add(command,"@Detail",detail);await command.ExecuteNonQueryAsync(token);
    }

    private static void RequireEditable(KittingCaseRecord current,KittingEditableRequest request,string actor,DateTime now)
    {
        RequireVersion(current,request.ExpectedWorkingVersion);
        if (current.State=="KIT_COMPLETE") throw KittingCaseProblem.Conflict("kitting_case_complete","Kit Complete is read-only.");
        if (request.EditingSessionId is null || current.EditingSessionId!=request.EditingSessionId ||
            !string.Equals(current.EditingOwner,actor,StringComparison.OrdinalIgnoreCase) || current.EditingExpiresAtUtc<=now)
            throw KittingCaseProblem.Conflict("editing_lease_required","The active Kitting editing lease is absent, expired, or owned by another employee.");
    }
    private static void RequireVersion(KittingCaseRecord current,long expected)
    { if (current.WorkingVersion!=expected) throw KittingCaseProblem.Conflict("kitting_case_version_changed","The Kitting Case changed; reload the latest saved state."); }
    private static string NormalizeWorkOrder(string? value)
    { var v=(value??"").Trim();if(!Regex.IsMatch(v,"^[0-9]{1,7}$"))throw KittingCaseProblem.BadRequest("malformed_identifier","Work Order is malformed.");return v.PadLeft(7,'0'); }
    private static string NormalizeDigits(string? value, int width, string label)
    {
        value = (value ?? "").Trim();
        if (!Regex.IsMatch(value, $"^[0-9]{{1,{width}}}$"))
            throw KittingCaseProblem.BadRequest("malformed_identifier", label + " is malformed.");
        return value.PadLeft(width, '0');
    }
    private static void RequireActor(string actor)
    { if(string.IsNullOrWhiteSpace(actor))throw KittingCaseProblem.Unauthorized("authenticated_identity_required","An authenticated employee identity is required."); }
    private static string Clean(string? value,int max)=>((value??"").Trim() is var v&&v.Length>max?v[..max]:v);
    private static string? NullableClean(string? value,int max){var v=Clean(value,max);return v.Length==0?null:v;}
    private static void Add(SqlCommand command,string name,object? value)=>command.Parameters.AddWithValue(name,value??DBNull.Value);
}

internal static class KittingDraftValidator
{
    internal static KittingDraftValidation Validate(JsonElement draft,string workOrder,bool requireComplete,
        bool poTraceabilityRequired)
    {
        if (draft.ValueKind!=JsonValueKind.Object) throw Bad("draft_required","A Kitting draft is required.");
        if (Text(draft,"workOrder")?.PadLeft(7,'0')!=workOrder) throw Bad("draft_work_order_mismatch","The draft Work Order does not match the case.");
        if (!draft.TryGetProperty("groups",out var groups)||groups.ValueKind!=JsonValueKind.Array)
            throw Bad("requirements_required","The Kitting draft has no requirement collection.");
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var actionable=0;var completed=0;var shortCount=0;decimal shortage=0;
        foreach(var group in groups.EnumerateArray())
        {
            var sequence=Text(group,"sequence")??"";if(sequence.Length==0||!seen.Add(sequence))throw Bad("requirement_identity_invalid","Requirement identities must be unique.");
            if(!Bool(group,"actionable"))continue;actionable++;
            if(!group.TryGetProperty("entry",out var entry)||entry.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)continue;
            var eligible=group.GetProperty("eligibleParts").EnumerateArray().Select(x=>x.GetString()?.Trim()??"").Where(x=>x.Length>0).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if(eligible.Count==0)throw Bad("eligible_parts_required","An actionable requirement has no governed eligible parts.");
            var method=Text(entry,"method")??"";decimal calculatedShort;
            var submitted=string.Equals(Text(group,"rowState"),"SUBMITTED",StringComparison.OrdinalIgnoreCase);
            if(!submitted)
            {
                if(method is not ("COMPLETE" or "COMPLETE_MIN_EXTRA" or "COUNT"))
                    throw Bad("kitting_method_invalid","Kitting method is invalid.");
                var draftPart=Text(entry,"selectedPartNumber");
                if(!string.IsNullOrWhiteSpace(draftPart)&&!eligible.Contains(draftPart))
                    throw Bad("eligible_part_required","The draft selected part is outside the governed main/Related set.");
                ValidatePo(Text(entry,"purchaseOrder"));
                if(entry.TryGetProperty("allocations",out var draftAllocations)&&draftAllocations.ValueKind==JsonValueKind.Array)
                    foreach(var allocation in draftAllocations.EnumerateArray())
                    {
                        var part=Text(allocation,"partNumber");
                        if(!string.IsNullOrWhiteSpace(part)&&!eligible.Contains(part))
                            throw Bad("allocation_part_not_eligible","Allocation part is outside the governed main/Related set.");
                        if(allocation.TryGetProperty("quantity",out var quantityValue)&&quantityValue.ValueKind!=JsonValueKind.Null&&
                            (!decimal.TryParse(quantityValue.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out var quantity)||quantity<0))
                            throw Bad("allocation_quantity_invalid","Allocation quantity must be zero or greater.");
                        ValidatePo(Text(allocation,"purchaseOrder"));
                        ValidateAcceptedMaterial(allocation,part,Text(allocation,"purchaseOrder"));
                    }
                continue;
            }
            if(method is "COMPLETE" or "COMPLETE_MIN_EXTRA")
            {
                if(!eligible.Contains(Text(entry,"selectedPartNumber")??""))throw Bad("eligible_part_required","Complete results require a governed selected part.");
                calculatedShort=0;ValidatePo(Text(entry,"purchaseOrder"));
                ValidateAcceptedMaterial(entry,Text(entry,"selectedPartNumber"),Text(entry,"purchaseOrder"));
                if(poTraceabilityRequired&&!HasPoEvidence(entry))
                    throw Bad("po_traceability_required","P.O. traceability is required for each material source actually used.");
            }
            else if(method=="COUNT")
            {
                if(!entry.TryGetProperty("allocations",out var allocations)||allocations.ValueKind!=JsonValueKind.Array||allocations.GetArrayLength()==0)
                    throw Bad("count_allocations_required","Count requires at least one allocation.");
                decimal total=0;foreach(var allocation in allocations.EnumerateArray())
                { if(!eligible.Contains(Text(allocation,"partNumber")??""))throw Bad("allocation_part_not_eligible","Allocation part is outside the governed main/Related set.");
                  if(!Decimal(allocation,"quantity",out var quantity)||quantity<0)throw Bad("allocation_quantity_invalid","Allocation quantity must be zero or greater.");
                  ValidatePo(Text(allocation,"purchaseOrder"));
                  ValidateAcceptedMaterial(allocation,Text(allocation,"partNumber"),Text(allocation,"purchaseOrder"));
                  if(poTraceabilityRequired&&quantity>0&&!HasPoEvidence(allocation))
                      throw Bad("po_traceability_required","Every positive material allocation requires its own P.O. traceability evidence.");
                  total+=quantity; }
                if(!Decimal(group,"requiredQuantity",out var required)||required<0)throw Bad("required_quantity_invalid","Requirement quantity is invalid.");
                calculatedShort=Math.Max(required-total,0);
            }
            else throw Bad("kitting_method_invalid","Kitting method is invalid.");
            if(!Decimal(entry,"shortageQuantity",out var claimed)||Math.Abs(claimed-calculatedShort)>0.0001m)
                throw Bad("kitting_calculation_mismatch","Submitted shortage does not match the authoritative allocation calculation.");
            completed++;
            if(calculatedShort>0){shortCount++;shortage+=calculatedShort;}
        }
        if(actionable==0)throw Bad("actionable_requirements_required","The Kitting Case has no actionable requirements.");
        if(requireComplete&&completed!=actionable)throw Bad("all_requirements_required","Every actionable requirement must be dispositioned before Submit Kitting.");
        return new(JsonSerializer.Serialize(draft),actionable,completed,shortCount,shortage);
    }
    // This evidence boundary intentionally centralizes allocation traceability so future governed
    // Customer Supplied Material and Approved Exception evidence can be added without changing case policy.
    private static bool HasPoEvidence(JsonElement value)=>!string.IsNullOrWhiteSpace(Text(value,"purchaseOrder"));
    private static void ValidatePo(string? value){if((value??"").Length>80)throw Bad("purchase_order_too_long","P.O. evidence is limited to 80 characters.");}
    private static void ValidateAcceptedMaterial(JsonElement source,string? part,string? purchaseOrder)
    {
        if(!source.TryGetProperty("acceptedMaterial",out var identity)||identity.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)return;
        if(identity.ValueKind!=JsonValueKind.Object||Text(identity,"identityType")!="CANONICAL_PURCHASE_RECEIPT_LINE"||
            !Regex.IsMatch(Text(identity,"purchaseReceiptLineId")??"","^[0-9a-fA-F]{50}$"))
            throw Bad("accepted_material_identity_invalid","Accepted material must reference a governed canonical receipt line.");
        if(!string.Equals(Text(identity,"partNumber"),part,StringComparison.OrdinalIgnoreCase)||
            !SamePo(Text(identity,"purchaseOrderNumber"),purchaseOrder)||
            !Decimal(identity,"quantityAccepted",out var accepted)||accepted<=0)
            throw Bad("accepted_material_source_mismatch","Accepted material identity does not match the allocation part and P.O.");
    }
    private static bool SamePo(string? left,string? right)
    {
        static string Normalize(string? value){var text=(value??"").Trim();return Regex.IsMatch(text,"^[0-9]+$")?
            text.TrimStart('0') is var digits&&digits.Length>0?digits:"0":text.ToUpperInvariant();}
        return Normalize(left)==Normalize(right);
    }
    private static string? Text(JsonElement value,string name)=>value.TryGetProperty(name,out var item)&&item.ValueKind!=JsonValueKind.Null?item.ToString().Trim():null;
    private static bool Bool(JsonElement value,string name)=>value.TryGetProperty(name,out var item)&&item.ValueKind==JsonValueKind.True;
    private static bool Decimal(JsonElement value,string name,out decimal result)
    {
        result=0;
        return value.TryGetProperty(name,out var item)&&
            decimal.TryParse(item.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out result);
    }
    private static KittingCaseProblem Bad(string code,string message)=>KittingCaseProblem.BadRequest(code,message);
}

internal sealed class StartKittingCaseRequest { public string? CustomerNumber{get;set;} public string? OriginSalesOrderNumber{get;set;} public string? OriginSalesOrderLineNumber{get;set;} public string? AssemblyItemNumber{get;set;} public string? Revision{get;set;} public string? ReleasedBomIdentity{get;set;} public JsonElement Draft{get;set;} }
internal class KittingCaseVersionRequest { public long ExpectedWorkingVersion{get;set;} }
internal class KittingEditableRequest:KittingCaseVersionRequest { public Guid? EditingSessionId{get;set;} }
internal sealed class SaveKittingDraftRequest:KittingEditableRequest { public JsonElement Draft{get;set;} }
internal sealed class SetKittingPoTraceabilityRequest:KittingEditableRequest { public bool PoTraceabilityRequired{get;set;} }
internal sealed record KittingDraftValidation(string Json,int ActionableCount,int CompletedCount,int ShortCount,decimal TotalShortage);
internal sealed record KittingPdfEvidence(string Path,string FileName);
internal sealed record KittingPdfPreview(byte[] Bytes,string FileName);
internal sealed record KittingImmutableEvidence(Guid Id,string Type,int Version,string Snapshot,string FileName,string Path,string Hash,string SubmittedBy,DateTime SubmittedAtUtc);
internal sealed record KittingCaseRecord(Guid CaseId,string WorkOrder,string Assembly,string? Revision,string ReleasedBomIdentity,string State,string StartedBy,DateTime StartedAtUtc,string LastOperator,DateTime LastWorkedAtUtc,Guid? EditingSessionId,string? EditingOwner,DateTime? EditingAcquiredAtUtc,DateTime? EditingExpiresAtUtc,string DraftJson,int ActionableCount,int CompletedCount,int ShortCount,decimal TotalShortage,bool PoTraceabilityRequired,long WorkingVersion,int RunNumber,bool IsActive);
internal sealed class KittingCaseProblem:Exception
{
    internal int StatusCode{get;} internal string Code{get;}
    private KittingCaseProblem(int status,string code,string message):base(message)=>(StatusCode,Code)=(status,code);
    internal static KittingCaseProblem BadRequest(string code,string message)=>new(400,code,message);
    internal static KittingCaseProblem Unauthorized(string code,string message)=>new(401,code,message);
    internal static KittingCaseProblem NotFound(string code,string message)=>new(404,code,message);
    internal static KittingCaseProblem Conflict(string code,string message)=>new(409,code,message);
}
