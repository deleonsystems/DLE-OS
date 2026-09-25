using System.Text.Json;

// Production never owns Material Status. This slice has no execution write model or commands.
internal sealed record SimTravelerReference(string DocumentId,string Name,string Type,string Url,string Sha256,string Caption="");
internal sealed record SimTravelerEstimate(decimal? OperationQuantity,decimal? RunSeconds,decimal? SetupMinutes,string TimeBasis,string CalculationVersion);
internal sealed record SimTravelerOperation(string Id,string SourceOperationId,decimal Sequence,string Name,
    string Classification,bool Enabled,string ExclusionReason,string Instructions,string ShopInstructions,
    string ManagementNotes,string InspectionRequirements,string Department,string WorkCenter,
    SimTravelerEstimate EstimatingBasis,SimLaborNote[] ProductionNotes,SimTravelerReference[] Visuals,
    SimTravelerReference[] TechnicalReferences,string ExecutionState="NOT_STARTED");
internal sealed record SimTravelerLease(Guid Id,string ActorId,string Actor,DateTimeOffset ExpiresAt);
internal sealed record SimTravelerApprovalStamp(string ActorId,string Actor,DateTimeOffset AtUtc,int Version);
internal sealed record SimTravelerDefinition(Guid Id,string WorkOrderNumber,long Generation,long WorkingVersion,
    int Version,string Status,string SourceToken,SimTravelerOperation[] Operations,SimTravelerLease? Lease,
    SimTravelerApprovalStamp? Approval,string CreatedBy,DateTimeOffset CreatedAt,JsonElement Source);
internal sealed record SimTravelerApprovedVersion(Guid DefinitionId,int Version,string SourceToken,
    SimTravelerOperation[] Operations,SimTravelerApprovalStamp Approval,JsonElement Source);
internal sealed record SimWoTraveler(Guid Id,string WorkOrderNumber,long Generation,int Version,Guid DefinitionId,
    int DefinitionVersion,string SourceToken,SimTravelerOperation[] Operations,DateTimeOffset ApprovedAt,
    string CreatedBy,DateTimeOffset CreatedAt,JsonElement FrozenPackage);
internal sealed record SimTravelerEvent(Guid Id,Guid DefinitionId,string WorkOrderNumber,long Generation,string Action,
    long WorkingVersion,string ActorId,string Actor,DateTimeOffset AtUtc,JsonElement Detail);
internal sealed record SimTravelerSeedRequest(string SourceToken,string[] MaterialsPrerequisiteSourceIds);
internal sealed record SimTravelerVersionRequest(long ExpectedWorkingVersion);
internal sealed record SimTravelerEditOperation(string Id,decimal Sequence,string? Department,string? WorkCenter,
    string? ShopInstructions,string? ManagementNotes,string? InspectionRequirements,bool Enabled,string? ExclusionReason);
internal sealed record SimTravelerDraftRequest(long ExpectedWorkingVersion,Guid LeaseId,string Reason,SimTravelerEditOperation[] Operations);
internal sealed record SimTravelerApproveRequest(long ExpectedWorkingVersion,Guid LeaseId);
internal sealed record SimTravelerBindRequest(long ExpectedWorkingVersion,int ApprovedVersion);
internal sealed record SimProductionSource(string Token,JsonElement Package,SimTravelerOperation[] Operations,
    string SourceIntakeId,string SourceCorrelationId,SimKittingCaseRecord? Case,SimKittingSubmission? Submission);
