using System.Text.Json;

// Authorization is distinct from the explicitly recorded developmental SIM departure.
// Neither is evidence of Production execution, compliance, or real-world dispatch.
internal sealed record SimShippingDeparture(string SourceMode,decimal Quantity,string ActorId,string Actor,DateTimeOffset RecordedAt);
internal sealed record SimProductionClearance(Guid Id,string WorkOrderNumber,long Generation,int Version,string State,
    decimal Quantity,string SourceMode,Guid TravelerId,Guid RevisionId,int TravelerVersion,string SourceToken,
    SimTravelerOperation Gate,SimTravelerOperation Packaging,string ActorId,string Actor,DateTimeOffset CreatedAt,
    string Reason,JsonElement Context,string[] Serials);
internal sealed record SimShipmentAuthorization(Guid Id,string WorkOrderNumber,long Generation,int Version,string State,
    decimal Quantity,Guid ClearanceId,int ClearanceVersion,string RequestedShipWindow,string ActorId,string Actor,
    DateTimeOffset CreatedAt,string Reason,JsonElement Context,SimShippingDeparture? Departure=null);
internal sealed record SimShippingEvent(Guid Id,string WorkOrderNumber,long Generation,long Sequence,Guid RequestId,
    string RequestHash,string Action,string ActorId,string Actor,DateTimeOffset AtUtc,string ExpectedToken,
    SimProductionClearance? Clearance,SimShipmentAuthorization? Authorization);
internal sealed record SimClearanceCreate(Guid RequestId,string ExpectedToken,decimal Quantity,string SourceMode,
    string GateOperationId,string PackagingOperationId,string Reason);
internal sealed record SimAuthorizationCreate(Guid RequestId,string ExpectedToken,Guid ClearanceId,decimal Quantity,
    string RequestedShipWindow,string Reason);
internal sealed record SimShippingDisposition(Guid RequestId,string ExpectedToken,int ExpectedVersion,string State,string Reason);
internal sealed record SimShippingConfirm(Guid RequestId,string ExpectedToken,int ExpectedVersion);
internal sealed record SimShippingSnapshot(string WorkOrderNumber,string Token,long Version,JsonElement Context,
    SimWoTravelerRevision Traveler,decimal RemainingFulfillment,decimal AvailableToRelease,
    SimProductionClearance[] Clearances,SimShipmentAuthorization[] Authorizations,SimShippingEvent[] History,
    bool CanCreateClearance,bool CanRelease,bool SourceCurrent,string MaterialStatus,string ProductionStatus,
    string ProductionExecution,bool CanConfirmSimDeparture=false);
