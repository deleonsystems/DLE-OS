using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record SimKittingReleasedRequirements(string WorkOrderNumber, string AssemblyItemNumber,
    string Revision, decimal BuildQuantity, string ReleasedBomIdentity, int ReleasedBomVersion,
    JsonElement Draft, JsonElement Lineage, bool PoTraceabilityRequired, SimQualityRelease? QualityRelease = null);

internal sealed partial class SimRfqIntakeStore
{
    // Start must bind the source checked here before an operator can reopen, hold or
    // correct its bridge. The callback is read-only with respect to Intake data.
    internal async Task<T> WithKittingSource<T>(Func<Task<T>> action)
    {
        await gate.WaitAsync();
        try { return await action(); }
        finally { gate.Release(); }
    }
}

// Adapter from a verified, imported accepted-order snapshot to the existing Kitting draft contract.
// This provider is read-only and is called inside the caller's stable-runtime boundary.
internal sealed partial class SimKittingRequirementsProvider(SimRfqIntakeStore intakes, SimOperationsDataStore operations)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions AcceptanceJson = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    // Match Operations import lock order: stable runtime, then Intake, then Operations.
    // ResolveAsync's Intake read does not acquire the gate again.
    internal Task<T> WithReleasedRequirements<T>(string workOrderNumber, SimStateMetadata runtime,
        Func<SimKittingReleasedRequirements, Task<T>> action) =>
        intakes.WithKittingSource(async () => await action(await ResolveAsync(workOrderNumber, runtime)));

    internal Task<T> WithPacketAuthoringRequirements<T>(string wo, SimStateMetadata runtime,
        Func<SimKittingReleasedRequirements, Task<T>> action) =>
        intakes.WithKittingSource(async () => await action(await ResolveCore(wo, runtime, true)));

    internal Task<SimKittingReleasedRequirements> ResolveAsync(string workOrderNumber, SimStateMetadata runtime)
        => ResolveCore(workOrderNumber, runtime, false);

    private async Task<SimKittingReleasedRequirements> ResolveCore(string workOrderNumber, SimStateMetadata runtime, bool packetAuthoring)
    {
        var wo = (workOrderNumber ?? "").Trim();
        Require(Regex.IsMatch(wo, "^[0-9]{7}$"), "WORK_ORDER", "Select a canonical seven-digit work order.");
        Require(runtime.Environment == "SIM", "ENVIRONMENT", "This requirements adapter is available only in SIM.");
        var canonical = await operations.ReadRecordAsync("WorkOrder", "WorkOrderNumber", wo);
        Require(canonical is not null, "WORK_ORDER", "The selected canonical work order was not found.");
        var canonicalJson = JsonSerializer.SerializeToElement(canonical, Json);
        Require(canonicalJson.TryGetProperty("importProvenance", out var provenance) &&
            provenance.TryGetProperty("packetId", out var packetId) && packetId.ValueKind == JsonValueKind.String,
            "PROVENANCE", "This work order has no governed SIM import provenance.");
        var receipt = await operations.FindReceiptAsync(provenance.GetProperty("packetId").GetString()!);
        Require(receipt is not null, "RECEIPT", "The work order's durable import receipt was not found.");
        var r = receipt!;
        var p = r.Packet;
        var held = p.WorkOrder.WorkOrderStatus == "AWAITING_RELEASE";
        var qualityRelease = held ? await new SimProductionStore(operations.DatabasePath).ReadQualityRelease(wo, runtime.Generation) : null;
        Require(packetAuthoring || !held || qualityRelease is not null, "AWAITING_RELEASE",
            "Awaiting Release. Quality packet review has not been completed; Kitting and production are blocked.");
        var source = p.Source;
        var line = p.OrderLine;
        var work = p.WorkOrder;
        Require(p.Environment == "SIM" && p.ErpSource == "SIM-VPRO5" && p.ImportType == "SIMULATED_DEVELOPMENTAL" &&
            p.Generation == runtime.Generation && p.RuntimeScenario == runtime.ScenarioId && p.RuntimeVersion == runtime.ScenarioVersion &&
            r.Generation == runtime.Generation && r.RuntimeScenario == runtime.ScenarioId && r.RuntimeVersion == runtime.ScenarioVersion &&
            r.ContentHash == p.ContentHash && p.ContentHash == SimOperationsDataStore.PacketHash(p),
            "RUNTIME", "The imported requirements provenance is stale or does not match this SIM runtime.");
        Require(r.WorkOrderNumber == wo && work.WorkOrderNumber == wo && r.PacketId == p.PacketId &&
            r.ReceiptId == String(provenance, "receiptId") && r.ContentHash == String(provenance, "contentHash") &&
            r.Relationship == "EXACT_LINE_UNIQUE" && r.Validation.Status == "PASS",
            "RELATIONSHIP", "An exact, verified work-order relationship is required.");
        var relationErrors = new List<string>();
        Require(SimOperationsDataStore.ResolvePacketRelationship(p, relationErrors) == "EXACT_LINE_UNIQUE" && relationErrors.Count == 0 &&
            r.SalesOrderLineId == SimOperationsDataStore.PacketSalesOrderLineId(p) &&
            r.CustomerNumber == line.CustomerNumber && r.SalesOrderNumber == line.SalesOrderNumber && r.SalesOrderLineNumber == line.LineNumber &&
            r.AcceptanceId == source.AcceptanceId && r.AcceptedRevision == source.AcceptedRevision && r.BridgeId == source.BridgeId &&
            r.BridgeRevision == source.BridgeRevision,
            "RELATIONSHIP", "The imported customer, SO line and work order do not reconcile.");
        Require(work.WorkOrderType == "STANDARD" && (held ? packetAuthoring || qualityRelease is not null : !packetAuthoring && work.WorkOrderStatus == "OPEN") && line.QuantityOrdered > 0 &&
            line.ErpQuantityOpen > 0 && work.ScheduledQuantity == line.QuantityOrdered,
            "ELIGIBILITY", "Only an open standard work order with a positive exact-line build quantity is supported.");
        // The governed import currently declares EA. Never guess a component UOM from its name.
        Require(work.UnitOfMeasure == "EA", "UOM", "This governed requirements adapter requires the explicit EA packet policy.");
        var readback = await operations.ReadPacketRecognitionAsync(r, runtime);
        Require(readback.Verified, "READBACK", "Canonical imported order facts no longer match the durable receipt: " + string.Join(" ", readback.Errors));

        var intake = await intakes.ReadAsync(source.IntakeId) as SimRfqIntakeRecord;
        Require(intake is { Environment: "SIM", IntakeType: "NEW_ORDER", OrderEntry: not null } &&
            intake.Generation == runtime.Generation && intake.ScenarioId == runtime.ScenarioId,
            "ACCEPTANCE", "The imported work order has no accepted New Order in this SIM generation.");
        var record = intake!;
        Require(!held || SimOperationsHandoffService.TrialScope(record) == "ABBOTT-0046-AWAITING-RELEASE",
            "QUALITY_PACKET_SCOPE", "Quality packet authoring is limited to the verified held 0046 trial.");
        var entry = record.OrderEntry!;
        var acceptance = entry.Acceptance;
        var package = acceptance.Package;
        Require(record.IntakeId == source.IntakeId && acceptance.Id == source.AcceptanceId && acceptance.PackageRevision == source.AcceptedRevision &&
            acceptance.PackageRevision == package.Revision && acceptance.SourceToken == source.AcceptanceToken &&
            entry.Bridge.Id == source.BridgeId && entry.Bridge.AcceptanceId == acceptance.Id && entry.Bridge.Revision >= source.BridgeRevision,
            "ACCEPTANCE", "The imported acceptance identity or revision differs from the frozen accepted package.");
        // Reuse the exact acceptance-token contract against the frozen package, not mutable OrderIntake.
        var acceptanceToken = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            { record.IntakeId, record.Customer, record.RequestCorrelationId, OrderIntake = package }, AcceptanceJson)));
        Require(acceptanceToken == acceptance.SourceToken, "ACCEPTANCE_TOKEN", "The frozen accepted package or customer identity changed after acceptance.");
        var ids = entry.Bridge.State.Identifiers;
        var recognized = entry.OperationsRecognition;
        Require(ids is not null && ids.Namespace == "SIM-VPRO5" && ids.OrderLineKey == record.IntakeId + ":1" && ids.SalesOrder == line.SalesOrderNumber &&
            ids.SalesOrderLine == line.LineNumber && ids.WorkOrder == wo &&
            recognized is not null && recognized.ReceiptId == r.ReceiptId && recognized.PacketId == r.PacketId &&
            recognized.PacketHash == r.ContentHash && recognized.Generation == runtime.Generation &&
            recognized.SalesOrderLineId == r.SalesOrderLineId && recognized.WorkOrderNumber == wo && recognized.Relationship == "EXACT_LINE_UNIQUE",
            "RECOGNITION", "The accepted bridge does not retain this exact canonical Operations recognition.");
        Require(entry.Bridge.State.Status is "READY_FOR_OPERATIONS_SYNC" or "RELEASED_TO_OPERATIONS" &&
            string.IsNullOrWhiteSpace(entry.Bridge.State.HoldReason) &&
            SimRfqIntakeStore.BridgeChecklist.All(entry.Bridge.State.Completed.Contains),
            "BRIDGE_NOT_READY", "The accepted bridge was reopened, is on hold or no longer retains its completed setup review.");
        Require(package.Facts.Lines.Length == 1 && package.TechnicalSource is { Status: "QUOTED_DEFINITION_LINKED", Baseline: not null },
            "TECHNICAL_SOURCE", "This adapter requires a single accepted order line and its frozen quoted technical definition.");
        var orderLine = package.Facts.Lines[0];
        var baseline = package.TechnicalSource!.Baseline!;
        var acceptedBom = baseline.Definition.Materials;
        var candidate = acceptedBom.Candidate;
        Require(record.Customer.CustomerNumber == line.CustomerNumber && record.Customer.CustomerName == line.CustomerName &&
            package.PoNumber == line.PurchaseOrder && orderLine.Assembly == work.ItemNumber && orderLine.Revision == work.Revision &&
            orderLine.Quantity == work.ScheduledQuantity && orderLine.CustomerDueDate == line.CustomerDueDate &&
            orderLine.Currency == line.Currency && orderLine.UnitPrice == line.UnitPrice && orderLine.ExtendedValue == line.ExtendedPrice &&
            (line.CustomerPoDate is null || package.Facts.PoDate == line.CustomerPoDate),
            "ORDER_FACTS", "The frozen customer, PO, assembly, revision, quantity or commercial facts differ from the imported order.");
        Require(baseline.Quote.IntakeId == source.SourceRfq && baseline.Quote.QuoteNumber == source.SourceQuote &&
            package.Quote?.Reference == baseline.Quote && baseline.SourceToken == source.TechnicalDefinitionReference &&
            candidate.Id == source.AcceptedBomReference && acceptedBom.Version == baseline.Materials.BomVersion &&
            candidate.Id == baseline.Materials.CandidateId && !string.IsNullOrWhiteSpace(baseline.Definition.Manufacturing.Id) &&
            (candidate.GoverningDocumentId == acceptedBom.Package.GoverningBomDocumentId || (held && acceptedBom.Package.Documents.Any(d => d.DocumentId == candidate.GoverningDocumentId && d.IdentityReview?.Type == "VPRO5_BOM_EXPORT"))) &&
            !string.IsNullOrWhiteSpace(candidate.GoverningSha256),
            "BASELINE", "The accepted BOM, quote and technical baseline lineage do not reconcile.");
        Require(candidate.Rows.Length > 0 && candidate.Rows.All(row => row.Confirmed && row.ReviewState.Reviewed) &&
            candidate.Rows.Select(row => row.Index).Distinct().Count() == candidate.Rows.Length &&
            candidate.Rows.Select(row => row.Values.GetValueOrDefault("lineNumber")).Distinct().Count() == candidate.Rows.Length,
            "BOM_ACCEPTANCE", "Every requirement must retain a distinct, fully accepted BOM row.");

        var supplyLines=package.CustomerSupplyReview is null ? [] : SimCustomerSupply.Lines(baseline,package.Facts,package.PoNumber,package.PoEvidence.Select(e=>e.Document).ToArray());
        var groups = candidate.Rows.OrderBy(row => row.Index).Select(row => ProjectGroup(row, work.ScheduledQuantity, work.UnitOfMeasure,supplyLines.SingleOrDefault(l=>l.SourceRowId==row.RowId && l.QuotedCustomerSupplied))).ToArray();
        var poTraceability = package.Questionnaire?.TraceabilityRequired == true;
        var lineage = JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 1, provider = "SIM_ACCEPTED_ORDER_REQUIREMENTS_V1", environment = runtime.Environment,
            runtime.ScenarioId, runtime.ScenarioVersion, runtime.Generation,
            r.ReceiptId, r.PacketId, packetHash = r.ContentHash, r.ImportedAt, r.DevelopmentScenario,
            source, record.Customer, purchaseOrder = package.PoNumber,
            r.SalesOrderLineId, r.SalesOrderNumber, r.SalesOrderLineNumber, workOrderNumber = wo,
            assemblyItemNumber = work.ItemNumber, revision = work.Revision, buildQuantity = work.ScheduledQuantity,
            acceptance = new { acceptance.Id, acceptance.PackageRevision, acceptance.SourceToken, acceptance.ActorId, acceptance.Actor, acceptance.At,
                packageHash = Hash(JsonSerializer.SerializeToElement(package, Json)) },
            baseline = new { baseline.Quote, baseline.SourceToken, manufacturingDefinitionId = baseline.Definition.Manufacturing.Id,
                acceptedBomVersion = acceptedBom.Version, candidateId = candidate.Id,
                candidate.GoverningDocumentId, candidate.GoverningSha256, candidate.Parser, candidate.ExtractedAtUtc,
                acceptedBom.ReviewedBy, acceptedBom.ReviewedAtUtc,
                package = acceptedBom.Package, manufacturing = baseline.Definition.Manufacturing,
                materialVersion = baseline.Materials.Version, laborVersion = baseline.Labor.Version },
            uomPolicy = new { value = work.UnitOfMeasure, source = "VERIFIED_SIM_OPERATIONS_PACKET", policy = "EA_COMPONENT_REQUIREMENTS_V1" },
            poTraceabilityRequired = poTraceability,
            contractRequirements = package.Questionnaire,
            traceabilityDeliverables = package.Questionnaire?.TraceabilityDeliverables ?? [],
            rows = candidate.Rows.Select(row => new { row.Index, row.RowId, row.Values, row.ComponentType, row.IdentityBasis,
                row.Confirmed, row.Reviewer, row.ReviewedAtUtc, row.PrimaryIdentity, row.AssemblyIdentity, row.ManufacturerIdentity,
                row.Alternates, row.SourcePartNumberReview, row.WholeRowHistory, row.Corrections }).ToArray()
        }, Json);
        if(package.CustomerSupplyReview is not null) {
            var node=System.Text.Json.Nodes.JsonNode.Parse(lineage.GetRawText())!.AsObject();
            node["customerSupplyReview"]=JsonSerializer.SerializeToNode(package.CustomerSupplyReview,Json);
            node["customerSupplyLines"]=JsonSerializer.SerializeToNode(supplyLines.Where(l=>l.QuotedCustomerSupplied),Json);
            lineage=JsonSerializer.SerializeToElement(node,Json);
        }
        var header = new
        {
            workOrder = wo, billNumber = work.ItemNumber, revision = work.Revision,
            scheduledProduction = work.ScheduledQuantity, unitOfMeasure = work.UnitOfMeasure,
            customer = record.Customer.CustomerName, customerNumber = record.Customer.CustomerNumber,
            salesOrder = line.SalesOrderNumber, salesOrderLine = line.LineNumber, customerPurchaseOrder = package.PoNumber
        };
        var draft = JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 2, persistenceState = "GOVERNED_SIM_DRAFT", workOrder = wo, enteredWorkOrder = wo,
            state = "KITTING_IN_PROGRESS", header, assemblyInstructions = Array.Empty<object>(), groups,
            poTraceabilityRequired = poTraceability
        }, Json);
        var identity = "SIM-KITTING-V1:" + Hash(JsonSerializer.SerializeToElement(new { lineage, draft }, Json));
        // Read only the persisted job correction; never consult the mutable quote here.
        var saved = wo == SimProductionBomRecovery.WorkOrder ? await operations.ReadSimKittingCase(wo, runtime) : null;
        if (saved?.ProductionBomCorrection is {} correction)
        {
            SimProductionBomRecovery.Require(correction.BaseReleasedBomIdentity == identity, "The correction belongs to a different released baseline.");
            draft = SimProductionBomRecovery.Annotate(draft, lineage, correction);
            lineage = SimProductionBomRecovery.AnnotateLineage(lineage, correction);
        }
        if(qualityRelease is not null) {
            Require(qualityRelease.WorkOrderNumber == wo && qualityRelease.Generation == runtime.Generation &&
                qualityRelease.RequirementsHash == SimProductionService.Hash(lineage) && qualityRelease.BaselineToken == SimProductionService.Hash(baseline.Labor) &&
                qualityRelease.ContentHash == SimProductionService.Hash(qualityRelease.Operations),
                "QUALITY_RELEASE_CHANGED", "The retained Quality release no longer matches the accepted source.");
        }
        return new(wo, work.ItemNumber, work.Revision, work.ScheduledQuantity, identity, 1, draft, lineage, poTraceability, qualityRelease);
    }

    internal static object ProjectGroup(SimCandidateRow row, decimal buildQuantity, string uom, SimCustomerSupplyLine? customerSupply = null)
    {
        var sequence = row.Values.GetValueOrDefault("lineNumber") ?? "";
        var dnp = row.ComponentType == "DNP";
        var quantityText = (row.Values.GetValueOrDefault("quantity") ?? "").Trim();
        Require(Regex.IsMatch(quantityText, @"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$") &&
            decimal.TryParse(quantityText, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _),
            "QUANTITY", $"BOM line {sequence} has no valid nonnegative decimal quantity.");
        var each = decimal.Parse(quantityText, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        Require(dnp || each > 0, "QUANTITY", $"BOM line {sequence} needs a positive quantity or explicit DNP disposition.");
        decimal required;
        try { required = dnp ? 0 : checked(each * buildQuantity); }
        catch (OverflowException) { throw Problem("QUANTITY", $"BOM line {sequence} exceeds the supported decimal quantity range."); }
        var approved = SimApprovedPartIdentities.Resolve(row);
        var primary = approved.FirstOrDefault() ?? row.Values.GetValueOrDefault("partNumber") ?? "";
        Require(dnp || approved.Length > 0, "IDENTITY", $"BOM line {sequence} has no unambiguous accepted part identity.");
        var description = row.Values.GetValueOrDefault("description") ?? "";
        object Part(string number) => new { sequence, itemNumber = number, description, unitOfMeasure = uom,
            requiredEach = each, totalWorkOrderUnits = required };
        var references = Regex.Split(row.Values.GetValueOrDefault("designators") ?? "", @"[\s,;]+").Where(x => x.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
        var group = new
        {
            groupId = "G" + (row.Index + 1).ToString("D3", CultureInfo.InvariantCulture),
            primaryPart = Part(primary),
            relatedParts = approved.Skip(1).Select(number => new { row = Part(number), reason = "Accepted approved identity / alternate" }).ToArray(),
            messageRows = Array.Empty<object>(), sourceSequences = new[] { sequence },
            findNumber = int.TryParse(sequence, NumberStyles.None, CultureInfo.InvariantCulture, out var find) ? (int?)find : null,
            references, notes = customerSupply is null ? Array.Empty<string>() : new[]{SimCustomerSupply.Description(customerSupply)}, sequence, partNumber = primary, eligibleParts = approved,
            description, unitOfMeasure = uom, requiredEach = each, requiredQuantity = required,
            classification = dnp ? "DNP" : each % 1 != 0 ? "FRACTIONAL" : "STANDARD",
            actionable = !dnp && required > 0, entry = (object?)null, rowState = "EDITING", revisionNumber = 0,
            sourceRowId = row.RowId, sourceRowIndex = row.Index, componentType = row.ComponentType,
            sourcePartNumber = row.Values.GetValueOrDefault("partNumber"), sourceDesignators = row.Values.GetValueOrDefault("designators")
        };
        if(customerSupply is null) return group;
        var node=System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(group,Json))!.AsObject();
        node["customerSupply"]=JsonSerializer.SerializeToNode(customerSupply,Json);
        return node;
    }

    private static string? String(JsonElement element, string name) => element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static void Require(bool condition, string code, string message) { if (!condition) throw Problem(code, message); }
    private static SimRfqIntakeProblem Problem(string code, string message) => SimRfqIntakeProblem.Conflict("SIM_KITTING_REQUIREMENTS_" + code, message);
    private static string Hash(JsonElement value)
    {
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer)) Canonical(writer, value);
        return Convert.ToHexString(SHA256.HashData(buffer.WrittenSpan));
    }
    private static void Canonical(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                { writer.WritePropertyName(property.Name); Canonical(writer, property.Value); }
                writer.WriteEndObject(); break;
            case JsonValueKind.Array:
                writer.WriteStartArray(); foreach (var element in value.EnumerateArray()) Canonical(writer, element); writer.WriteEndArray(); break;
            case JsonValueKind.Number when value.TryGetDecimal(out var number):
                writer.WriteRawValue(number.ToString("G29", CultureInfo.InvariantCulture)); break;
            default: value.WriteTo(writer); break;
        }
    }
}
