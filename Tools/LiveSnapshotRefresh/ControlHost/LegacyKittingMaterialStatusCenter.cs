using System.Data;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static class LegacyKittingMaterialStatusCenter
{
    private const string AssessmentRoute = "/api/kitting-cases/v1/legacy-material-status/assessment";

    internal static void MapLegacyKittingMaterialStatus(this WebApplication app, string policy)
    {
        var service = new LegacyKittingMaterialStatusService();
        app.MapGet(AssessmentRoute, async (HttpContext context, CancellationToken token) =>
            await Execute(context, () => service.AssessAsync(token))).RequireAuthorization(policy);
        app.MapPost(AssessmentRoute + "/backfill", async (HttpContext context, CancellationToken token) =>
            await Execute(context, () => service.BackfillAsync(
                TrustedDevelopmentIdentity.RequireActorName(context), token), requireSuperAdmin: true))
            .RequireAuthorization(policy);
    }

    private static async Task<IResult> Execute(HttpContext context, Func<Task<object>> operation,
        bool requireSuperAdmin = false)
    {
        if (requireSuperAdmin && context.RequestServices
                .GetRequiredService<TrustedDleOsUserContextAccessor>().AuthorizedUser?.IsSuperAdmin != true)
            return Results.Json(new { code = "super_admin_required",
                message = "Legacy Material Status backfill requires SUPER_ADMIN." }, statusCode: 403);
        try { return Results.Json(await operation()); }
        catch (LegacyKittingMaterialStatusProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (SqlException error)
        {
            Console.Error.WriteLine($"LegacyKittingMaterialStatusSqlFailure {error.Number}: {error.Message}");
            return Results.Json(new { code = "legacy_kitting_material_store_unavailable",
                message = "The DEV legacy Kitting Material evidence store is unavailable." }, statusCode: 503);
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"LegacyKittingMaterialStatusEvidenceFailure: {error.Message}");
            return Results.Json(new { code = "legacy_kitting_evidence_unavailable",
                message = "The governed legacy Kitting evidence folders are unavailable." }, statusCode: 503);
        }
        catch (UnauthorizedAccessException error)
        {
            Console.Error.WriteLine($"LegacyKittingMaterialStatusEvidenceDenied: {error.Message}");
            return Results.Json(new { code = "legacy_kitting_evidence_access_denied",
                message = "The governed service identity cannot read the legacy Kitting evidence folders." }, statusCode: 503);
        }
    }
}

internal sealed class LegacyKittingMaterialStatusService
{
    private static readonly Regex ExactStem = new("^[0-9]{1,7}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex LabeledWorkOrder = new(
        @"(?i)(?:^|[^A-Z0-9])(?:WO|W[.]?O[.]?|WORK[ _-]*ORDER)[ #_:-]*([0-9]{1,7})(?:[^0-9]|$)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex NumericCandidate = new("(?<![0-9])([0-9]{4,7})(?![0-9])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;
    private readonly string shortageRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_SHORTAGE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-SHORTAGES";
    private readonly string completeRoot = Environment.GetEnvironmentVariable("DLE_OS_KIT_COMPLETE_ROOT") ??
        @"\\deleon-server\Production\KITTING\KIT-COMPLETE";

    internal async Task<object> AssessAsync(CancellationToken token) =>
        await BuildAssessmentAsync(Guid.NewGuid(), token);

    internal async Task<object> BackfillAsync(string actor, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(actor))
            throw LegacyKittingMaterialStatusProblem.Unauthorized("authenticated_identity_required",
                "An authenticated DEV employee identity is required.");
        var correlationId = Guid.NewGuid();
        var assessment = await BuildAssessmentAsync(correlationId, token);
        var inserted = new List<string>();
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        if (!string.Equals(connection.Database, "DLE_OS_OPERATIONAL_DEV", StringComparison.Ordinal))
            throw new InvalidOperationException("Legacy Kitting Material backfill is restricted to DLE_OS_OPERATIONAL_DEV.");
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        foreach (var candidate in assessment.HighConfidence)
        {
            var command = new SqlCommand("""
IF NOT EXISTS (SELECT 1 FROM operational.KittingCase WITH (UPDLOCK,HOLDLOCK) WHERE WorkOrderNumber=@WorkOrder)
AND NOT EXISTS (SELECT 1 FROM operational.LegacyKittingMaterialEvidence WITH (UPDLOCK,HOLDLOCK) WHERE WorkOrderNumber=@WorkOrder)
BEGIN
  INSERT operational.LegacyKittingMaterialEvidence
  (EvidenceId,WorkOrderNumber,MaterialStatus,EvidenceSource,CompleteEvidencePath,
   CompleteEvidenceLastWriteUtc,ShortageEvidencePath,ShortageEvidenceLastWriteUtc,
   SupportingDispositionEventId,ReconciliationClassification,AssessmentCorrelationId,BackfilledBy)
  VALUES (@Id,@WorkOrder,@Status,@Source,@CompletePath,@CompleteTime,@ShortagePath,@ShortageTime,
          @DispositionId,@Classification,@Correlation,@Actor);
  SELECT 1;
END
ELSE SELECT 0;
""", connection, transaction);
            void Add(string name, object? value) => command.Parameters.AddWithValue(name, value ?? DBNull.Value);
            Add("@Id", Guid.NewGuid()); Add("@WorkOrder", candidate.WorkOrderNumber);
            Add("@Status", candidate.MaterialStatus); Add("@Source", candidate.EvidenceSource);
            Add("@CompletePath", candidate.CompleteEvidence?.Path);
            Add("@CompleteTime", candidate.CompleteEvidence?.LastWriteTimeUtc);
            Add("@ShortagePath", candidate.ShortageEvidence?.Path);
            Add("@ShortageTime", candidate.ShortageEvidence?.LastWriteTimeUtc);
            Add("@DispositionId", candidate.ManualDisposition?.EventId);
            Add("@Classification", candidate.Classification); Add("@Correlation", correlationId);
            Add("@Actor", actor);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) == 1)
                inserted.Add(candidate.WorkOrderNumber);
        }
        await transaction.CommitAsync(token);
        return new
        {
            verdict = "PASS",
            assessmentCorrelationId = correlationId,
            assessedHighConfidence = assessment.HighConfidence.Count,
            insertedCount = inserted.Count,
            insertedWorkOrders = inserted,
            skippedCount = assessment.HighConfidence.Count - inserted.Count,
            assessment
        };
    }

    private async Task<LegacyKittingAssessment> BuildAssessmentAsync(Guid correlationId, CancellationToken token)
    {
        var inventory = Scan(shortageRoot, "KIT_SHORT").Concat(Scan(completeRoot, "KIT_COMPLETE"))
            .OrderBy(item => item.Path, StringComparer.OrdinalIgnoreCase).ToArray();
        var strong = inventory.Where(item => item.AssociationConfidence == "HIGH" && item.WorkOrderNumber is not null)
            .GroupBy(item => item.WorkOrderNumber!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        var dispositions = await ReadDispositionsAsync(connection, token);
        var caseWorkOrders = await ReadWorkOrderSetAsync(connection,
            "SELECT DISTINCT WorkOrderNumber FROM operational.KittingCase;", token);
        var existingBridge = await ReadWorkOrderSetAsync(connection,
            "SELECT WorkOrderNumber FROM operational.LegacyKittingMaterialEvidence;", token);
        var workOrders = strong.Keys.Concat(dispositions.Keys).Concat(caseWorkOrders).Concat(existingBridge)
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value).ToArray();
        var highConfidence = new List<LegacyKittingBackfillCandidate>();
        var reconciliations = new List<LegacyKittingReconciliation>();
        foreach (var workOrder in workOrders)
        {
            dispositions.TryGetValue(workOrder, out var manual);
            var evidence = strong.GetValueOrDefault(workOrder) ?? [];
            var completes = evidence.Where(item => item.EvidenceType == "KIT_COMPLETE").ToArray();
            var shortages = evidence.Where(item => item.EvidenceType == "KIT_SHORT").ToArray();
            var hasCase = caseWorkOrders.Contains(workOrder);
            var alreadyBackfilled = existingBridge.Contains(workOrder);
            var outcome = Reconcile(workOrder, manual, completes, shortages, hasCase, alreadyBackfilled);
            reconciliations.Add(outcome.Reconciliation);
            if (outcome.Candidate is not null) highConfidence.Add(outcome.Candidate);
        }
        var conflicts = reconciliations.Where(item => item.Category is "CONFLICT" or "AMBIGUOUS_EVIDENCE")
            .ToArray();
        var manualLegacyTotal = reconciliations.Count(item => !item.HasPersistentCase &&
            item.ManualDisposition?.ResultingDisposition is "KIT_SHORT" or "KIT_COMPLETE");
        var manualLegacyUnbackfilled = reconciliations.Count(item => !item.HasPersistentCase && !item.AlreadyBackfilled &&
            item.ManualDisposition?.ResultingDisposition is "KIT_SHORT" or "KIT_COMPLETE");
        return new LegacyKittingAssessment(correlationId, DateTime.UtcNow,
            new LegacyKittingInventorySummary(
                inventory.Length,
                inventory.Count(item => item.WorkOrderNumber is not null),
                inventory.Count(item => item.AssociationConfidence == "HIGH"),
                inventory.Count(item => item.AssociationConfidence == "AMBIGUOUS"),
                inventory.Count(item => item.WorkOrderNumber is null),
                inventory.Count(item => item.EvidenceType == "KIT_COMPLETE"),
                inventory.Count(item => item.EvidenceType == "KIT_SHORT")),
            new LegacyKittingAssessmentCounts(
                manualLegacyTotal,
                manualLegacyUnbackfilled,
                reconciliations.Count(item => !item.HasPersistentCase && item.HasCompleteEvidence),
                reconciliations.Count(item => !item.HasPersistentCase && item.HasShortageEvidence && !item.HasCompleteEvidence),
                reconciliations.Count(item => item.ManualEvidenceMatches),
                conflicts.Length,
                reconciliations.Count(item => item.HasPersistentCase),
                highConfidence.Count,
                existingBridge.Count),
            inventory, reconciliations, highConfidence, conflicts);
    }

    internal static LegacyKittingOutcome Reconcile(string workOrder, LegacyManualDisposition? manual,
        LegacyKittingEvidenceFile[] completes, LegacyKittingEvidenceFile[] shortages,
        bool hasCase, bool alreadyBackfilled)
    {
        var hasComplete = completes.Length > 0;
        var hasShort = shortages.Length > 0;
        var match = manual is not null &&
            ((manual.ResultingDisposition == "KIT_COMPLETE" && hasComplete) ||
             (manual.ResultingDisposition == "KIT_SHORT" && hasShort));
        string category;
        string detail;
        LegacyKittingBackfillCandidate? candidate = null;
        if (hasCase) (category, detail) = ("PERSISTENT_KITTING_CASE", "Modern Kitting Case history suppresses legacy projection.");
        else if (alreadyBackfilled) (category, detail) = ("ALREADY_BACKFILLED", "A governed legacy evidence record already exists.");
        else if (completes.Length > 1 || shortages.Length > 1)
            (category, detail) = ("AMBIGUOUS_EVIDENCE", "Multiple high-confidence PDFs of the same evidence type require review.");
        else if (!hasComplete && !hasShort)
            (category, detail) = manual is null
                ? ("NO_EVIDENCE", "No governed legacy evidence exists.")
                : ("MANUAL_WITHOUT_PDF", "The prior manual disposition has no matching high-confidence PDF.");
        else
        {
            var complete = completes.SingleOrDefault();
            var shortage = shortages.SingleOrDefault();
            var chronologicalComplete = complete is not null &&
                (shortage is null || complete.LastWriteTimeUtc >= shortage.LastWriteTimeUtc);
            var manualContradiction = manual?.ResultingDisposition == "KIT_COMPLETE" && complete is null ||
                manual?.ResultingDisposition == "KIT_SHORT" && complete is not null &&
                complete.LastWriteTimeUtc < manual.RecordedAtUtc;
            if (!chronologicalComplete && complete is not null || manualContradiction)
                (category, detail) = ("CONFLICT", "Evidence type, chronology, and prior manual disposition do not reconcile safely.");
            else
            {
                var status = chronologicalComplete ? "KIT_COMPLETE" : "KIT_SHORT";
                category = status == "KIT_COMPLETE" && manual?.ResultingDisposition == "KIT_SHORT"
                    ? "SHORT_THEN_COMPLETE"
                    : manual is null ? "PDF_WITHOUT_MANUAL_DISPOSITION"
                    : match ? "MANUAL_AND_PDF_MATCH" : "PDF_EVIDENCE_SUPERSEDES_NONFINAL_MANUAL_STATE";
                detail = status == "KIT_COMPLETE" && shortage is not null
                    ? "Later Kit Complete evidence supersedes prior Kit Short evidence."
                    : "A unique high-confidence legacy PDF supports the projected Material Status.";
                if (manual is not null && (match || category == "SHORT_THEN_COMPLETE"))
                    candidate = new LegacyKittingBackfillCandidate(workOrder, status,
                        "LEGACY_KITTING_PDF_WITH_VERIFIED_DISPOSITION",
                        category, complete, shortage, manual);
            }
        }
        return new(new LegacyKittingReconciliation(workOrder, category, detail, hasCase, alreadyBackfilled,
            hasComplete, hasShort, match, manual, completes, shortages), candidate);
    }

    private IEnumerable<LegacyKittingEvidenceFile> Scan(string root, string evidenceType)
    {
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
        foreach (var path in Directory.EnumerateFiles(root, "*.pdf", SearchOption.AllDirectories))
        {
            var file = new FileInfo(path);
            var stem = Path.GetFileNameWithoutExtension(file.Name).Trim();
            string? workOrder = null;
            var confidence = "UNMATCHED";
            var rule = "NO_WORK_ORDER_TOKEN";
            if (ExactStem.IsMatch(stem))
            {
                workOrder = stem.PadLeft(7, '0'); confidence = "HIGH"; rule = "EXACT_NUMERIC_STEM";
            }
            else
            {
                var labeled = LabeledWorkOrder.Matches(stem).Select(match => match.Groups[1].Value)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if (labeled.Length == 1)
                {
                    workOrder = labeled[0].PadLeft(7, '0'); confidence = "HIGH"; rule = "LABELED_WORK_ORDER";
                }
                else
                {
                    var candidates = NumericCandidate.Matches(stem).Select(match => match.Groups[1].Value)
                        .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                    if (candidates.Length == 1)
                    {
                        workOrder = candidates[0].PadLeft(7, '0'); confidence = "AMBIGUOUS";
                        rule = "UNLABELED_NUMERIC_TOKEN";
                    }
                    else if (candidates.Length > 1) (confidence, rule) = ("AMBIGUOUS", "MULTIPLE_NUMERIC_TOKENS");
                }
            }
            yield return new LegacyKittingEvidenceFile(workOrder, evidenceType, path, file.Name,
                file.Length, file.CreationTimeUtc, file.LastWriteTimeUtc, confidence, rule);
        }
    }

    private static async Task<Dictionary<string, LegacyManualDisposition>> ReadDispositionsAsync(
        SqlConnection connection, CancellationToken token)
    {
        var result = new Dictionary<string, LegacyManualDisposition>(StringComparer.OrdinalIgnoreCase);
        var command = new SqlCommand("""
SELECT EventId,WorkOrderNumber,ResultingDisposition,RecordedAtUtc,RecordedBy,
       DocumentEvidenceStatus,CompleteEvidenceFileName,ShortageEvidenceFileName
FROM operational.vw_CurrentKittingDisposition;
""", connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            result[reader.GetString(1)] = new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                reader.GetDateTime(3), reader.GetString(4), reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7));
        return result;
    }

    private static async Task<HashSet<string>> ReadWorkOrderSetAsync(SqlConnection connection, string sql,
        CancellationToken token)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) result.Add(reader.GetString(0));
        return result;
    }
}

internal sealed class LegacyKittingMaterialStatusRepository
{
    private readonly string connectionString = ControlHostRuntimeConfiguration.OperationalConnectionString;

    internal async Task<LegacyKittingMaterialProjection?> GetAsync(string workOrder, CancellationToken token,
        SqlConnection? connection = null)
    {
        var owns = connection is null;
        connection ??= new SqlConnection(connectionString);
        if (owns) await connection.OpenAsync(token);
        try
        {
            var command = new SqlCommand("""
IF EXISTS (SELECT 1 FROM operational.KittingCase WHERE WorkOrderNumber=@WorkOrder)
  SELECT CAST(1 AS bit),NULL,NULL,NULL,NULL,NULL;
ELSE
  SELECT CAST(0 AS bit),MaterialStatus,EvidenceSource,ReconciliationClassification,
         BackfilledAtUtc,BackfilledBy
  FROM operational.LegacyKittingMaterialEvidence WHERE WorkOrderNumber=@WorkOrder;
""", connection);
            command.Parameters.AddWithValue("@WorkOrder", workOrder);
            await using var reader = await command.ExecuteReaderAsync(token);
            if (!await reader.ReadAsync(token)) return null;
            var hasPersistentHistory = reader.GetBoolean(0);
            return new(hasPersistentHistory,
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetDateTime(4),
                reader.IsDBNull(5) ? null : reader.GetString(5));
        }
        finally { if (owns) await connection.DisposeAsync(); }
    }
}

internal sealed record LegacyKittingAssessment(Guid AssessmentCorrelationId, DateTime AssessedAtUtc,
    LegacyKittingInventorySummary Inventory, LegacyKittingAssessmentCounts Counts,
    IReadOnlyList<LegacyKittingEvidenceFile> Files, IReadOnlyList<LegacyKittingReconciliation> Reconciliations,
    IReadOnlyList<LegacyKittingBackfillCandidate> HighConfidence, IReadOnlyList<LegacyKittingReconciliation> Conflicts);
internal sealed record LegacyKittingInventorySummary(int TotalPdfFiles, int FilesWithWorkOrderCandidate,
    int HighConfidenceFiles, int AmbiguousFiles, int UnmatchedFiles, int KitCompleteFiles, int KitShortFiles);
internal sealed record LegacyKittingAssessmentCounts(int LegacyDispositionWorkOrdersWithoutPersistentCase,
    int UnbackfilledLegacyDispositionWorkOrdersWithoutPersistentCase,
    int WorkOrdersWithCompleteEvidence, int WorkOrdersWithShortOnlyEvidence, int MatchingManualDispositions,
    int ConflictsOrAmbiguities, int PersistentKittingCaseWorkOrders, int HighConfidenceBackfill,
    int AlreadyBackfilled);
internal sealed record LegacyKittingEvidenceFile(string? WorkOrderNumber, string EvidenceType, string Path,
    string FileName, long Length, DateTime CreationTimeUtc, DateTime LastWriteTimeUtc,
    string AssociationConfidence, string AssociationRule);
internal sealed record LegacyManualDisposition(Guid EventId, string WorkOrderNumber, string ResultingDisposition,
    DateTime RecordedAtUtc, string RecordedBy, string DocumentEvidenceStatus,
    string? CompleteEvidenceFileName, string? ShortageEvidenceFileName);
internal sealed record LegacyKittingReconciliation(string WorkOrderNumber, string Category, string Detail,
    bool HasPersistentCase, bool AlreadyBackfilled, bool HasCompleteEvidence, bool HasShortageEvidence,
    bool ManualEvidenceMatches, LegacyManualDisposition? ManualDisposition,
    IReadOnlyList<LegacyKittingEvidenceFile> CompleteEvidence,
    IReadOnlyList<LegacyKittingEvidenceFile> ShortageEvidence);
internal sealed record LegacyKittingBackfillCandidate(string WorkOrderNumber, string MaterialStatus,
    string EvidenceSource, string Classification, LegacyKittingEvidenceFile? CompleteEvidence,
    LegacyKittingEvidenceFile? ShortageEvidence, LegacyManualDisposition? ManualDisposition);
internal sealed record LegacyKittingOutcome(LegacyKittingReconciliation Reconciliation,
    LegacyKittingBackfillCandidate? Candidate);
internal sealed record LegacyKittingMaterialProjection(bool HasPersistentKittingHistory, string? MaterialStatus,
    string? EvidenceSource, string? ReconciliationClassification, DateTime? BackfilledAtUtc, string? BackfilledBy);

internal sealed class LegacyKittingMaterialStatusProblem : Exception
{
    internal int StatusCode { get; }
    internal string Code { get; }
    private LegacyKittingMaterialStatusProblem(int statusCode, string code, string message) : base(message) =>
        (StatusCode, Code) = (statusCode, code);
    internal static LegacyKittingMaterialStatusProblem Unauthorized(string code, string message) => new(401, code, message);
}
