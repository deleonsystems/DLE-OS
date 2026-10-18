using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

internal sealed record SimOperationsPacketSource(string IntakeId, string AcceptanceId, int AcceptedRevision,
    string AcceptanceToken, string BridgeId, int BridgeRevision, string SourceRfq, string SourceQuote,
    string AcceptedBomReference, string TechnicalDefinitionReference);
internal sealed record SimOperationsPacketLine(string CustomerNumber, string CustomerName, string PurchaseOrder,
    string SalesOrderNumber, string LineNumber, string ItemNumber, string Revision, string Description,
    decimal QuantityOrdered, decimal ErpQuantityOpen, decimal OpeningShippedQuantity, string Currency,
    decimal UnitPrice, decimal ExtendedPrice, string CustomerDueDate, string? EstimatedShipDate,
    string? OrderDate, string[] SimulatedFacts,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? CustomerPoDate = null);
internal sealed record SimOperationsPacketWorkOrder(string WorkOrderNumber, string CustomerNumber,
    string SalesOrderNumber, string SalesOrderLineNumber, string ItemNumber, string Revision,
    decimal ScheduledQuantity, string WorkOrderType, string WorkOrderStatus, string OpenedDate,
    string UnitOfMeasure);
internal sealed record SimOperationsRelationshipEvidence(string EvidenceId, string SourceRecord,
    string CustomerNumber, string SalesOrderNumber, string SalesOrderLineNumber, string WorkOrderNumber,
    string ItemNumber, string Revision, decimal ScheduledQuantity);
internal sealed record SimOperationsPacket(string PacketId, int SchemaVersion, string ContentHash,
    string PreparedBy, DateTimeOffset PreparedAt, string Environment, string ErpSource, string ImportType,
    string DevelopmentScenario, string RuntimeScenario, int RuntimeVersion, long Generation,
    SimOperationsPacketSource Source, SimOperationsPacketLine OrderLine,
    SimOperationsPacketWorkOrder WorkOrder, SimOperationsRelationshipEvidence[] RelationshipEvidence);
internal sealed record SimOperationsRecordPlan(string RecordType, string Identity, string Action);
internal sealed record SimOperationsPacketValidation(string Status, string[] Errors, string[] Warnings,
    SimOperationsRecordPlan[] Records, string Relationship, string SalesOrderLineId);
internal sealed record SimOperationsImportReceipt(string ReceiptId, string PacketId, string ContentHash,
    string BridgeId, int BridgeRevision, string AcceptanceId, int AcceptedRevision,
    string SalesOrderLineId, string CustomerNumber, string SalesOrderNumber, string SalesOrderLineNumber,
    string WorkOrderNumber, string Relationship, string ActorId, string Actor, DateTimeOffset ImportedAt,
    string DevelopmentScenario, string RuntimeScenario, int RuntimeVersion, long Generation,
    SimOperationsPacket Packet, SimOperationsPacketValidation Validation);
internal sealed record SimOperationsRecognition(bool Verified, string[] Errors, object? SalesOrderLine,
    object? WorkOrder, object? Relationship);
internal sealed record SimOperationsImportResult(bool Duplicate, SimOperationsImportReceipt Receipt,
    SimOperationsRecognition Readback);
internal sealed class SimOperationsPacketProblem(string code, string message) : Exception(message)
{
    internal string Code { get; } = code;
}

internal sealed partial class SimOperationsDataStore
{
    internal static readonly JsonSerializerOptions PacketJson = new(JsonSerializerDefaults.Web);
    internal static string PacketHash(SimOperationsPacket packet)
    {
        // Hash semantic packet content, not serializer choices made by the client. UTC offset
        // and decimal scale may change on a lossless wire round trip (10.0 equals 10).
        var value = JsonSerializer.SerializeToElement(packet with
            { ContentHash = "", PreparedAt = packet.PreparedAt.ToUniversalTime() }, PacketJson);
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer)) WriteCanonicalPacketJson(writer, value);
        return Convert.ToHexString(SHA256.HashData(buffer.WrittenSpan));
    }

    private static void WriteCanonicalPacketJson(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(x => x.Name, StringComparer.Ordinal))
                { writer.WritePropertyName(property.Name); WriteCanonicalPacketJson(writer, property.Value); }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var element in value.EnumerateArray()) WriteCanonicalPacketJson(writer, element);
                writer.WriteEndArray();
                break;
            case JsonValueKind.Number when value.TryGetDecimal(out var number):
                writer.WriteRawValue(number.ToString("G29", CultureInfo.InvariantCulture));
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }
    internal static string PacketSalesOrderLineId(SimOperationsPacket packet) =>
        $"{packet.OrderLine.CustomerNumber}{packet.OrderLine.SalesOrderNumber}{packet.OrderLine.LineNumber}";

    // This exact-line slice implements the same unique WO and customer/SO/line anchor requirements
    // consumed by KittingDispositionCenter. Candidate-only and ambiguous evidence never become exact.
    internal static string ResolvePacketRelationship(SimOperationsPacket packet, List<string> errors)
    {
        var line = packet.OrderLine;
        var wo = packet.WorkOrder;
        var evidence = packet.RelationshipEvidence ?? [];
        if (evidence.Length == 0) { errors.Add("No source relationship evidence was supplied."); return "UNRESOLVED"; }
        var candidates = evidence.Select(x => x.WorkOrderNumber).Distinct(StringComparer.Ordinal).ToArray();
        if (candidates.Length != 1) { errors.Add("Relationship evidence names more than one work order."); return "AMBIGUOUS"; }
        if (evidence.Any(x => string.IsNullOrWhiteSpace(x.EvidenceId) || string.IsNullOrWhiteSpace(x.SourceRecord)) ||
            evidence.Select(x => x.EvidenceId).Distinct(StringComparer.Ordinal).Count() != evidence.Length)
            errors.Add("Relationship evidence requires distinct IDs and source-record provenance.");
        var anchored = wo.CustomerNumber == line.CustomerNumber && wo.SalesOrderNumber == line.SalesOrderNumber &&
            wo.SalesOrderLineNumber == line.LineNumber && candidates[0] == wo.WorkOrderNumber && evidence.All(x =>
                x.CustomerNumber == line.CustomerNumber && x.SalesOrderNumber == line.SalesOrderNumber &&
                x.SalesOrderLineNumber == line.LineNumber && x.WorkOrderNumber == wo.WorkOrderNumber);
        if (!anchored) { errors.Add("Relationship evidence does not match the canonical customer/SO/line/WO anchors."); return "UNRESOLVED"; }
        if (wo.ItemNumber != line.ItemNumber || wo.Revision != line.Revision || wo.ScheduledQuantity != line.QuantityOrdered ||
            evidence.Any(x => x.ItemNumber != wo.ItemNumber || x.Revision != wo.Revision || x.ScheduledQuantity != wo.ScheduledQuantity))
        { errors.Add("Item, revision or scheduled quantity does not reconcile with this exact one-line order."); return "UNRESOLVED"; }
        return "EXACT_LINE_UNIQUE";
    }

    internal async Task<SimOperationsPacketValidation> ValidatePacketAsync(SimOperationsPacket packet, SimStateMetadata runtime)
    {
        await gate.WaitAsync();
        try
        {
            EnsurePacketPath();
            EnsureHealthy();
            await using var connection = OpenReadOnly();
            await connection.OpenAsync();
            return await ValidatePacketCoreAsync(connection, null, packet, runtime);
        }
        finally { gate.Release(); }
    }

    internal async Task<SimOperationsImportReceipt?> FindReceiptAsync(string packetId)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        return await FindPacketReceiptAsync(connection, null, "PacketId", packetId);
    }

    internal async Task<SimOperationsImportReceipt?> GetBridgeReceiptAsync(string bridgeId)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly();
        await connection.OpenAsync();
        return await FindPacketReceiptAsync(connection, null, "BridgeId", bridgeId);
    }

    internal async Task<SimOperationsImportResult> ImportPacketAsync(SimOperationsPacket packet,
        SimStateMetadata runtime, string actorId, string actor)
    {
        SimOperationsImportReceipt receipt;
        bool duplicate;
        await gate.WaitAsync();
        try
        {
            EnsurePacketPath(); EnsureHealthy();
            await using var connection = OpenReadWrite();
            await connection.OpenAsync();
            await using (var pragmas = connection.CreateCommand())
            {
                pragmas.CommandText = "PRAGMA foreign_keys=ON;";
                await pragmas.ExecuteNonQueryAsync();
            }
            await using var transaction = connection.BeginTransaction();
            var validation = await ValidatePacketCoreAsync(connection, transaction, packet, runtime);
            if (validation.Status != "PASS") throw new SimOperationsPacketProblem("SIM_PACKET_BLOCKED", string.Join(" ", validation.Errors));
            var existing = await FindPacketReceiptAsync(connection, transaction, "PacketId", packet.PacketId);
            duplicate = existing is not null;
            if (existing is not null) receipt = existing;
            else
            {
                receipt = new(Guid.NewGuid().ToString(), packet.PacketId, packet.ContentHash,
                    packet.Source.BridgeId, packet.Source.BridgeRevision, packet.Source.AcceptanceId, packet.Source.AcceptedRevision,
                    validation.SalesOrderLineId, packet.OrderLine.CustomerNumber, packet.OrderLine.SalesOrderNumber,
                    packet.OrderLine.LineNumber, packet.WorkOrder.WorkOrderNumber, validation.Relationship, actorId, actor,
                    DateTimeOffset.UtcNow, packet.DevelopmentScenario, packet.RuntimeScenario, packet.RuntimeVersion, packet.Generation,
                    packet, validation);
                // Schema addition and every domain row commit together; dry runs never execute DDL.
                await ExecuteAsync(connection, transaction, """
CREATE TABLE IF NOT EXISTS SimOperationsImportReceipt(
    ReceiptId TEXT PRIMARY KEY, PacketId TEXT NOT NULL UNIQUE, ContentHash TEXT NOT NULL,
    BridgeId TEXT NOT NULL UNIQUE, AcceptanceId TEXT NOT NULL UNIQUE,
    SalesOrderLineId TEXT NOT NULL UNIQUE, WorkOrderNumber TEXT NOT NULL UNIQUE, PayloadJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SimOperationsRelationshipEvidence(
    ReceiptId TEXT NOT NULL, EvidenceId TEXT NOT NULL, PayloadJson TEXT NOT NULL,
    PRIMARY KEY(ReceiptId,EvidenceId), FOREIGN KEY(ReceiptId) REFERENCES SimOperationsImportReceipt(ReceiptId));
""");
                var lineJson = JsonSerializer.Serialize(PacketLinePayload(receipt), PacketJson);
                var workJson = JsonSerializer.Serialize(PacketWorkOrderPayload(receipt), PacketJson);
                var relationJson = JsonSerializer.Serialize(PacketRelationshipPayload(receipt), PacketJson);
                var l = packet.OrderLine; var w = packet.WorkOrder;
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SalesOrderLine VALUES(@id,@customer,@name,@po,@so,@line,@item,@ship,@qty,@json);",
                    ("@id", receipt.SalesOrderLineId), ("@customer", l.CustomerNumber), ("@name", l.CustomerName),
                    ("@po", l.PurchaseOrder), ("@so", l.SalesOrderNumber), ("@line", l.LineNumber),
                    ("@item", l.ItemNumber), ("@ship", l.EstimatedShipDate ?? ""), ("@qty", l.QuantityOrdered), ("@json", lineJson));
                await ExecuteAsync(connection, transaction, "INSERT INTO WorkOrder VALUES(@wo,@item,@status,@json);",
                    ("@wo", w.WorkOrderNumber), ("@item", w.ItemNumber), ("@status", w.WorkOrderStatus), ("@json", workJson));
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SalesOrderWorkOrderRelationship VALUES(@customer,@so,@line,@status,@wo,@json);",
                    ("@customer", l.CustomerNumber), ("@so", l.SalesOrderNumber), ("@line", l.LineNumber),
                    ("@status", validation.Relationship), ("@wo", w.WorkOrderNumber), ("@json", relationJson));
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SimOperationsImportReceipt VALUES(@id,@packet,@hash,@bridge,@acceptance,@line,@wo,@json);",
                    ("@id", receipt.ReceiptId), ("@packet", packet.PacketId), ("@hash", packet.ContentHash),
                    ("@bridge", packet.Source.BridgeId), ("@acceptance", packet.Source.AcceptanceId),
                    ("@line", receipt.SalesOrderLineId), ("@wo", w.WorkOrderNumber), ("@json", JsonSerializer.Serialize(receipt, PacketJson)));
                foreach (var evidence in packet.RelationshipEvidence)
                    await ExecuteAsync(connection, transaction, "INSERT INTO SimOperationsRelationshipEvidence VALUES(@receipt,@id,@json);",
                        ("@receipt", receipt.ReceiptId), ("@id", evidence.EvidenceId), ("@json", JsonSerializer.Serialize(evidence, PacketJson)));
            }
            await transaction.CommitAsync();
        }
        finally { gate.Release(); }
        return new(duplicate, receipt, await ReadPacketRecognitionAsync(receipt, runtime));
    }

    private async Task<SimOperationsPacketValidation> ValidatePacketCoreAsync(SqliteConnection connection,
        SqliteTransaction? transaction, SimOperationsPacket p, SimStateMetadata runtime)
    {
        var errors = new List<string>(); var warnings = new List<string>();
        if (p.Source is null || p.OrderLine is null || p.WorkOrder is null)
            throw new SimOperationsPacketProblem("SIM_PACKET_INVALID", "Packet source, order line and work order are required.");
        if (p.Environment != "SIM" || runtime.Environment != "SIM" || p.ErpSource != "SIM-VPRO5" || p.ImportType != "SIMULATED_DEVELOPMENTAL")
            errors.Add("Only SIM / SIM-VPRO5 / SIMULATED_DEVELOPMENTAL packets are permitted.");
        if (p.SchemaVersion is not (1 or 2) || !Guid.TryParse(p.PacketId, out _) || p.ContentHash != PacketHash(p))
            errors.Add("Packet identity, schema or content hash is invalid.");
        if (string.IsNullOrWhiteSpace(p.PreparedBy) || p.PreparedAt == default || string.IsNullOrWhiteSpace(p.DevelopmentScenario))
            errors.Add("Packet preparer, timestamp and development scenario are required.");
        if (p.RuntimeScenario != runtime.ScenarioId || p.RuntimeVersion != runtime.ScenarioVersion || p.Generation != runtime.Generation)
            errors.Add("Packet runtime scenario/version/generation is stale.");
        await ValidatePacketDatabaseAsync(connection, transaction, runtime);
        var l = p.OrderLine; var w = p.WorkOrder; var s = p.Source;
        if (!Digits(l.CustomerNumber, 6) || !Digits(l.SalesOrderNumber, 7) || !Digits(l.LineNumber, 3) || !Digits(w.WorkOrderNumber, 7))
            errors.Add("Canonical identifiers require six-digit customer, seven-digit SO/WO and three-digit line strings.");
        if (new[] { s.IntakeId, s.AcceptanceId, s.AcceptanceToken, s.BridgeId, s.SourceRfq, s.SourceQuote, s.AcceptedBomReference,
            s.TechnicalDefinitionReference, l.CustomerName, l.PurchaseOrder, l.ItemNumber, l.Revision, w.UnitOfMeasure }
            .Any(string.IsNullOrWhiteSpace) || s.AcceptedRevision < 1 || s.BridgeRevision < 1)
            errors.Add("Accepted source lineage and canonical order facts must be complete.");
        if (l.QuantityOrdered <= 0 || l.ErpQuantityOpen != l.QuantityOrdered || l.OpeningShippedQuantity != 0 ||
            l.UnitPrice < 0 || l.ExtendedPrice != l.QuantityOrdered * l.UnitPrice || l.Currency != "USD")
            errors.Add("This opening-order slice requires positive quantity, fully open/unshipped quantity and reconciled USD prices.");
        if (!DateOnlyValue(l.CustomerDueDate) || !OptionalDate(l.EstimatedShipDate) || !OptionalDate(l.OrderDate) || !DateOnlyValue(w.OpenedDate))
            errors.Add("Packet dates must be explicit ISO date-only values, with unknown ERP dates left unset.");
        if ((p.SchemaVersion == 1 && l.CustomerPoDate is not null) || (p.SchemaVersion == 2 && !DateOnlyValue(l.CustomerPoDate)))
            errors.Add("Schema 2 requires a separate date-only Customer PO Date; schema 1 retains its original absent field.");
        var heldTrial=p.Source.IntakeId=="RFQI-SIM-0046";
        if (heldTrial && (p.DevelopmentScenario!="ABBOTT-0046-AWAITING-RELEASE" || p.Source.AcceptedRevision!=2 ||
            p.Source.AcceptanceId!="0a15fbf0-d1f3-4123-b1af-34b1bda2410e" ||
            p.Source.AcceptanceToken!="025540756823921B23180E73AB9F27C55C63B6CC12D46CD5833D75574035FF5C"))
            errors.Add("The held trial requires the exact qualified acceptance.");
        if (w.WorkOrderType != "STANDARD" || w.WorkOrderStatus != (heldTrial?"AWAITING_RELEASE":"OPEN"))
            errors.Add("This controlled slice requires STANDARD work orders and the qualified release state; 0046 must remain AWAITING_RELEASE.");
        if (l.SimulatedFacts is null || l.SimulatedFacts.Length == 0 || l.SimulatedFacts.Any(string.IsNullOrWhiteSpace))
            errors.Add("Explicit provenance for the simulated ERP facts is required.");
        if (l.EstimatedShipDate is null) warnings.Add("Estimated ship date is not set; the reviewed customer due date remains separate.");
        if (l.OrderDate is null) warnings.Add("ERP order date is not set; customer PO date is not substituted.");
        warnings.Add("SIMULATED ERP DATA. No Kitting case, inventory or material demand is created.");
        var relationship = ResolvePacketRelationship(p, errors);
        var lineId = PacketSalesOrderLineId(p);
        var existing = await FindPacketReceiptAsync(connection, transaction, "PacketId", p.PacketId);
        if (existing is not null)
        {
            if (existing.ContentHash != p.ContentHash) errors.Add("Packet ID was already imported with different content.");
            else if (existing.Generation != runtime.Generation || existing.RuntimeScenario != runtime.ScenarioId || existing.RuntimeVersion != runtime.ScenarioVersion)
                errors.Add("Existing receipt belongs to another SIM runtime generation.");
        }
        else
        {
            if (await FindPacketReceiptAsync(connection, transaction, "BridgeId", s.BridgeId) is not null ||
                await FindPacketReceiptAsync(connection, transaction, "AcceptanceId", s.AcceptanceId) is not null)
                errors.Add("This accepted bridge already has a canonical import receipt; recover it rather than reimporting.");
            if (await PacketExistsAsync(connection, transaction, "SELECT COUNT(*) FROM SalesOrderLine WHERE SalesOrderLineId=@id OR ltrim(SalesOrderNumber,'0')=ltrim(@so,'0');", ("@id", lineId), ("@so", l.SalesOrderNumber)))
                errors.Add("Canonical Sales Order identity already exists; no overwrite is permitted.");
            // The governed WO resolver searches canonical and unpadded numeric aliases. A
            // different padding representation is therefore a collision, not a new WO.
            if (await PacketExistsAsync(connection, transaction, "SELECT COUNT(*) FROM WorkOrder WHERE ltrim(WorkOrderNumber,'0')=ltrim(@wo,'0');", ("@wo", w.WorkOrderNumber)))
                errors.Add("Canonical Work Order identity already exists; no overwrite is permitted.");
            if (await PacketExistsAsync(connection, transaction,
                "SELECT COUNT(*) FROM SalesOrderWorkOrderRelationship WHERE ltrim(SalesOrderNumber,'0')=ltrim(@so,'0') OR ltrim(ActionableWorkOrderNumber,'0')=ltrim(@wo,'0');", ("@so", l.SalesOrderNumber), ("@wo", w.WorkOrderNumber)) ||
                await PacketExistsAsync(connection, transaction, "SELECT COUNT(*) FROM RelationshipCandidate WHERE ltrim(WorkOrderNumber,'0')=ltrim(@wo,'0');", ("@wo", w.WorkOrderNumber)))
                errors.Add("Canonical relationship evidence conflicts with the proposed exact-line association.");
        }
        var action = existing is null ? "CREATE" : "EXISTING_RECEIPT";
        return new(errors.Count == 0 ? "PASS" : "BLOCKED", errors.ToArray(), warnings.ToArray(),
            [new("Sales Order line", lineId, action), new("Work Order", w.WorkOrderNumber, action),
                new("SO/WO relationship", $"{l.CustomerNumber}/{l.SalesOrderNumber}/{l.LineNumber}", action)], relationship, lineId);
    }

    private void EnsurePacketPath()
    {
        var expected = SimRuntimeOptions.ResolveStatePath(packetStateRoot, "data", "dle-os-sim.db");
        if (!string.Equals(expected, databasePath, StringComparison.OrdinalIgnoreCase) || SimRuntimeOptions.IsNetworkPath(databasePath))
            throw new SimOperationsPacketProblem("SIM_DATABASE_BOUNDARY", "Import requires the configured local SIM SQLite database.");
        // Reject junctions/symlinks throughout the resolved ancestry, not just lexical traversal.
        for (var path = Path.GetFullPath(databasePath); !string.IsNullOrEmpty(path); path = Path.GetDirectoryName(path))
            if ((File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new SimOperationsPacketProblem("SIM_DATABASE_BOUNDARY", "SIM import cannot use redirected filesystem paths.");
    }

    private static bool Digits(string? value, int length) => value is not null && Regex.IsMatch(value, $"^[0-9]{{{length}}}$");
    private static bool DateOnlyValue(string? value) => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    private static bool OptionalDate(string? value) => value is null || DateOnlyValue(value);

    private static async Task ValidatePacketDatabaseAsync(SqliteConnection connection, SqliteTransaction? transaction, SimStateMetadata runtime)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT ScenarioId,ScenarioVersion,StateGeneration,SchemaVersion FROM SimDatabaseMetadata;";
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync() || reader.GetString(0) != runtime.ScenarioId || reader.GetInt32(1) != runtime.ScenarioVersion ||
            reader.GetInt64(2) != runtime.Generation || reader.GetInt32(3) != DatabaseSchemaVersion || await reader.ReadAsync())
            throw new SimOperationsPacketProblem("SIM_DATABASE_IDENTITY", "Database identity does not match the current SIM runtime.");
    }

    private static async Task<bool> PacketExistsAsync(SqliteConnection connection, SqliteTransaction? transaction,
        string sql, params (string Name, object? Value)[] parameters)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction; command.CommandText = sql;
        foreach (var p in parameters) command.Parameters.AddWithValue(p.Name, p.Value ?? DBNull.Value);
        return Convert.ToInt64(await command.ExecuteScalarAsync()) != 0;
    }

    private static async Task<SimOperationsImportReceipt?> FindPacketReceiptAsync(SqliteConnection connection,
        SqliteTransaction? transaction, string column, string value)
    {
        if (column is not ("PacketId" or "BridgeId" or "AcceptanceId")) throw new ArgumentOutOfRangeException(nameof(column));
        if (!await PacketExistsAsync(connection, transaction, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='SimOperationsImportReceipt';")) return null;
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = $"SELECT PayloadJson FROM SimOperationsImportReceipt WHERE {column}=@value;";
        command.Parameters.AddWithValue("@value", value);
        return await command.ExecuteScalarAsync() is string json ? JsonSerializer.Deserialize<SimOperationsImportReceipt>(json, PacketJson) : null;
    }

    private static object PacketProvenance(SimOperationsImportReceipt r) => new
    {
        environment = "SIM", erpSource = "SIM-VPRO5", importType = "SIMULATED_DEVELOPMENTAL", simulated = true,
        r.DevelopmentScenario, r.RuntimeScenario, r.RuntimeVersion, r.Generation, r.ReceiptId, r.PacketId, r.ContentHash,
        r.ImportedAt, r.ActorId, r.Actor, source = r.Packet.Source, simulatedFacts = r.Packet.OrderLine.SimulatedFacts
    };

    private static object PacketLinePayload(SimOperationsImportReceipt r)
    {
        var l = r.Packet.OrderLine;
        var payload = new { salesOrderLineId = r.SalesOrderLineId, l.CustomerNumber, l.CustomerName,
            customerPurchaseOrderNumber = l.PurchaseOrder, l.SalesOrderNumber, l.LineNumber, l.ItemNumber, l.Description,
            orderDate = l.OrderDate ?? "", estimatedShipDate = l.EstimatedShipDate ?? "", l.CustomerDueDate,
            l.QuantityOrdered, l.ErpQuantityOpen, openingShippedQuantity = l.OpeningShippedQuantity,
            l.Currency, l.UnitPrice, l.ExtendedPrice, scheduledProductionQuantity = r.Packet.WorkOrder.ScheduledQuantity,
            billNumber = "", drawingNumber = "", drawingRevision = l.Revision, bomRevision = l.Revision,
            orderMemo = "SIMULATED ERP DATA — developmental Operations handoff; ERP dates may be unset.",
            simulated = true, importProvenance = PacketProvenance(r) };
        if (l.CustomerPoDate is null && r.Packet.WorkOrder.WorkOrderStatus!="AWAITING_RELEASE") return payload;
        var projection = JsonSerializer.SerializeToElement(payload, PacketJson).EnumerateObject()
            .ToDictionary(x => x.Name, x => (object?)x.Value.Clone(), StringComparer.Ordinal);
        if(l.CustomerPoDate is not null)projection["customerPoDate"] = l.CustomerPoDate;
        if(r.Packet.WorkOrder.WorkOrderStatus=="AWAITING_RELEASE")projection["releaseState"]="AWAITING_RELEASE";
        return projection;
    }

    private static object PacketWorkOrderPayload(SimOperationsImportReceipt r)
    {
        var w = r.Packet.WorkOrder;
        return new { w.WorkOrderNumber, w.WorkOrderType, w.WorkOrderStatus,
            workOrderOpenedDateIso = w.OpenedDate, workOrderClosedDateIso = (string?)null,
            w.CustomerNumber, w.SalesOrderNumber, w.SalesOrderLineNumber, w.UnitOfMeasure,
            bomRevision = w.Revision, warehouseId = "SIM", w.ItemNumber,
            itemDescription = r.Packet.OrderLine.Description, drawingNumber = "", drawingRevision = w.Revision,
            schProdQuantity = w.ScheduledQuantity, simulated = true, importProvenance = PacketProvenance(r) };
    }

    private static object PacketRelationshipPayload(SimOperationsImportReceipt r) => new
    {
        r.CustomerNumber, r.SalesOrderNumber, r.SalesOrderLineNumber,
        salesOrderItemNumber = r.Packet.OrderLine.ItemNumber, resolutionStatus = r.Relationship,
        resolutionBasis = "SIM_VERIFIED_EXACT_LINE_EVIDENCE", anchorSalesOrderLine = r.SalesOrderLineNumber,
        actionableWorkOrderNumber = r.WorkOrderNumber, candidates = Array.Empty<object>(),
        sourceEvidence = r.Packet.RelationshipEvidence, simulated = true, importProvenance = PacketProvenance(r)
    };

    internal async Task<SimOperationsRecognition> ReadPacketRecognitionAsync(SimOperationsImportReceipt receipt, SimStateMetadata runtime)
    {
        EnsurePacketPath(); EnsureHealthy();
        var errors = new List<string>();
        await using (var connection = OpenReadOnly())
        {
            await connection.OpenAsync();
            await ValidatePacketDatabaseAsync(connection, null, runtime);
            var saved = await FindPacketReceiptAsync(connection, null, "PacketId", receipt.PacketId);
            if (saved is null || JsonSerializer.Serialize(saved, PacketJson) != JsonSerializer.Serialize(receipt, PacketJson))
                errors.Add("Durable import receipt does not match the recognition request.");
            if (receipt.ContentHash != PacketHash(receipt.Packet) || receipt.Generation != runtime.Generation ||
                receipt.RuntimeScenario != runtime.ScenarioId || receipt.RuntimeVersion != runtime.ScenarioVersion)
                errors.Add("Receipt packet hash or runtime identity is invalid.");
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT PayloadJson FROM SimOperationsRelationshipEvidence WHERE ReceiptId=@receipt ORDER BY EvidenceId;";
            command.Parameters.AddWithValue("@receipt", receipt.ReceiptId);
            var actual = new List<string>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) actual.Add(reader.GetString(0));
            var expected = receipt.Packet.RelationshipEvidence.OrderBy(x => x.EvidenceId, StringComparer.Ordinal)
                .Select(x => JsonSerializer.Serialize(x, PacketJson)).ToArray();
            if (!actual.SequenceEqual(expected)) errors.Add("Durable relationship evidence differs from the imported packet.");
        }
        // These are the same services used by normal /api/canonical Operations consumers.
        var soQuery = new QueryCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
            { ["salesOrderNumber"] = receipt.SalesOrderNumber, ["customerNumber"] = receipt.CustomerNumber });
        var woQuery = new QueryCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
            { ["workOrderNumber"] = receipt.WorkOrderNumber });
        var relQuery = new QueryCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
            { ["customerNumber"] = receipt.CustomerNumber, ["salesOrderNumber"] = receipt.SalesOrderNumber,
                ["salesOrderLineNumber"] = receipt.SalesOrderLineNumber });
        var lines = await ReadSalesOrderLinesAsync(soQuery, runtime.Generation);
        var works = await ReadWorkOrdersAsync(woQuery, runtime.Generation);
        var relations = await ReadRelationshipsAsync(relQuery, runtime.Generation);
        var line = lines.Items.SingleOrDefaultIfExactlyOne();
        var work = works.Items.SingleOrDefaultIfExactlyOne();
        var relation = relations.Items.SingleOrDefaultIfExactlyOne();
        if (lines.TotalItems != 1 || line is null) errors.Add("Canonical SO line is missing or non-unique.");
        if (works.TotalItems != 1 || work is null) errors.Add("Canonical WO is missing or non-unique.");
        if (relations.TotalItems != 1 || relation is null) errors.Add("Canonical relationship is missing or non-unique.");
        // Import integrity must compare the retained import facts, not the current
        // operational projection (which can legitimately report Quality-released).
        // Keep canonical uniqueness checks and return the current projection above.
        var importedLine = await ReadRecordAsync("SalesOrderLine", "SalesOrderLineId", receipt.SalesOrderLineId);
        if (importedLine is null) errors.Add("Stored imported SO line is missing.");
        ComparePacketPayload(importedLine, PacketLinePayload(receipt), "Sales Order line", errors);
        ComparePacketPayload(work, PacketWorkOrderPayload(receipt), "Work Order", errors);
        ComparePacketPayload(relation, PacketRelationshipPayload(receipt), "Relationship", errors);
        return new(errors.Count == 0, errors.ToArray(), line, work, relation);
    }

    private static void ComparePacketPayload(object? actual, object expected, string name, List<string> errors)
    {
        if (actual is null) return;
        var a = JsonSerializer.SerializeToElement(actual, PacketJson);
        var e = JsonSerializer.SerializeToElement(expected, PacketJson);
        foreach (var property in e.EnumerateObject())
            if (!a.TryGetProperty(property.Name, out var value) || !PacketJsonEquivalent(value, property.Value))
                errors.Add($"{name} canonical readback differs for {property.Name}.");
    }

    // Canonical services parse JSON before returning it. Compare values rather than encoding choices
    // (for example '+' versus '\u002B', property order, or decimal trailing zeros).
    private static bool PacketJsonEquivalent(JsonElement left, JsonElement right)
    {
        if (left.ValueKind != right.ValueKind) return false;
        return left.ValueKind switch
        {
            JsonValueKind.Object => left.EnumerateObject().Count() == right.EnumerateObject().Count() &&
                right.EnumerateObject().All(p => left.TryGetProperty(p.Name, out var value) && PacketJsonEquivalent(value, p.Value)),
            JsonValueKind.Array => left.GetArrayLength() == right.GetArrayLength() &&
                left.EnumerateArray().Zip(right.EnumerateArray()).All(pair => PacketJsonEquivalent(pair.First, pair.Second)),
            JsonValueKind.String => left.GetString() == right.GetString(),
            JsonValueKind.Number => left.TryGetDecimal(out var l) && right.TryGetDecimal(out var r) ? l == r : left.GetDouble() == right.GetDouble(),
            JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null => true,
            _ => left.GetRawText() == right.GetRawText()
        };
    }
}

internal static class SimPacketReadbackExtensions
{
    internal static object? SingleOrDefaultIfExactlyOne(this object[] values) => values.Length == 1 ? values[0] : null;
}
