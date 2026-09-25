using System.Text.Json;
using System.Text.Json.Serialization;

// Operational arrival/acceptance evidence only. VPRO owns accounting receipts.
internal sealed record SimReceivingRequirements(bool? CocRequired, bool? MaterialCertRequired,
    bool PoTraceabilityRequired, bool? InspectionRequired, Guid? ReviewId);
internal sealed record SimReceivingRequirementLine([property: JsonRequired] Guid PurchaseId,
    [property: JsonRequired] bool CocRequired, [property: JsonRequired] bool MaterialCertRequired,
    [property: JsonRequired] bool PoTraceabilityRequired, [property: JsonRequired] bool InspectionRequired);
internal sealed record SimReceivingRequirementsRequest([property: JsonRequired] long ExpectedVersion, Guid RequestId,
    string Reason, SimReceivingRequirementLine[] Lines);
internal sealed record SimReceivingRequirementReview(Guid ReviewId, string PoKey,
    SimReceivingRequirementLine[] Lines, string Reason, string Reviewer, string ActorId,
    DateTimeOffset AtUtc, long ExpectedVersion, long ResultingVersion);
internal sealed record SimReceivingCoverageRequest(string DemandId, decimal Quantity,
    decimal ReceivedQuantity, decimal HoldQuantity, decimal RejectedQuantity);
internal sealed record SimReceivingCoverage(string DemandId, decimal Quantity, decimal ReceivedQuantity,
    decimal HoldQuantity, decimal RejectedQuantity, string WorkOrderNumber, string SalesOrderNumber,
    string SalesOrderLineNumber);
internal sealed record SimReceiveLineRequest(Guid PurchaseId, decimal PackingSlipQuantity,
    decimal CountedQuantity, decimal AcceptedQuantity, decimal HoldQuantity, decimal RejectedQuantity,
    string? ObservedPartNumber, string? DiscrepancyReason, Dictionary<string,string> Checks,
    SimReceivingCoverageRequest[]? Coverage = null, string[]? EvidenceDocumentIds = null);
internal sealed record SimReceiveRequest([property: JsonRequired] long ExpectedVersion, Guid RequestId, string PackingSlipNumber,
    string PackingSlipDate, string? Carrier, string? TrackingNumber, string? Notes, string? DocumentId,
    SimReceiveLineRequest[] Lines);
internal sealed record SimStageMaterialRequest([property: JsonRequired] long ExpectedVersion, Guid RequestId, string Location);
internal sealed record SimReceivingDocument(string DocumentId, Guid PurchaseId, string PoKey, string Kind,
    SimRfqIntakeDocument Document, string Sha256, string AddedBy, string ActorId, DateTimeOffset AddedAtUtc);
internal sealed record SimReceivingDelivery(Guid DeliveryId, string PoKey, string Supplier, string PoNumber,
    string PackingSlipNumber, string PackingSlipDate, string Carrier, string TrackingNumber,
    string Notes, SimReceivingDocument? PackingSlipDocument, string ReceivedBy, string ActorId,
    DateTimeOffset ReceivedAtUtc, string[] ReceiptLineIds, long Version);
internal sealed record SimAcceptedMaterial(string ReceiptLineId, Guid PurchaseId, Guid ExpectedReceiptId,
    Guid DeliveryId, string Supplier, string PoNumber, string PoLine, string PartNumber,
    string ApprovedPartNumber, string VendorPartNumber, string Description, string PurchasingUom,
    string PackingSlipNumber, decimal PackingSlipQuantity, string ObservedPartNumber, string DiscrepancyReason,
    decimal ReceivedQuantity, decimal AcceptedQuantity, decimal HoldQuantity, decimal RejectedQuantity,
    decimal AvailableQuantity, SimReceivingCoverage[] Coverage, string ReceivedBy, string AcceptedBy,
    string ActorId, DateTimeOffset ReceivedAtUtc, DateTimeOffset? AcceptedAtUtc, string StagingLocation,
    DateTimeOffset? StagedAtUtc, long Version, string? VproReceiptId,
    Dictionary<string,string> Checks, SimReceivingRequirements Requirements,
    SimReceivingDocument[] EvidenceDocuments, string Provenance = "SIM_OPERATIONAL_ACCEPTANCE");
internal sealed record SimReceivingStage(Guid StageId, string ReceiptLineId, string Location,
    string ActorId, string Actor, DateTimeOffset AtUtc, long ExpectedVersion, long ResultingVersion);
internal sealed record SimReceivingEvent(Guid EventId, string EventType, string PoKey, string EntityId,
    string ActorId, string Actor, DateTimeOffset AtUtc, long ExpectedVersion, long ResultingVersion,
    JsonElement Detail);
internal sealed record SimReceivingSnapshot(SimReceivingDelivery[] Deliveries, SimAcceptedMaterial[] Materials,
    SimReceivingRequirementReview[] Reviews, SimReceivingStage[] Stages, SimReceivingDocument[] Documents,
    SimReceivingEvent[] Events);
internal sealed record SimReceivingPoLine(SimPurchaseLine Purchase, decimal ReceivedQuantity,
    decimal AcceptedQuantity, decimal HoldQuantity, decimal RejectedQuantity, decimal AvailableQuantity,
    decimal OpenQuantity, SimReceivingRequirements Requirements);
internal sealed record SimReceivingPoView(string Environment, long Generation, bool CanReceive,
    long Version, string Supplier, string PoNumber, SimReceivingPoLine[] Lines,
    SimReceivingDelivery[] Deliveries, SimAcceptedMaterial[] AcceptedMaterials, SimReceivingDocument[] Documents);
internal sealed record SimReceivingChange<T>(T Result, SimReceivingDelivery? Delivery = null,
    SimAcceptedMaterial[]? Materials = null, SimReceivingRequirementReview? Review = null,
    SimReceivingStage? Stage = null, SimReceivingDocument? Document = null, SimReceivingEvent? Event = null);
