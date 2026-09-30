using System.Text.Json;

// WO revisions are separate from the immutable source definition and original binding.
internal sealed record SimWoRevisionHead(string WorkOrderNumber,long Generation,Guid TravelerId,long WorkingVersion,Guid EffectiveRevisionId,int EffectiveVersion);
internal sealed record SimWoSequenceChange(string OperationId,string SourceOperationId,string Name,decimal SourceSequence,
    int PreviousPosition,int ProposedPosition,decimal PreviousSequence,decimal ProposedSequence,bool Changed);
internal sealed record SimWoClarification(Guid Id,Guid RevisionId,string OperationId,string SourceOperationId,string Text,
    string CreatedBy,DateTimeOffset CreatedAt,int AddedInVersion,string UpdatedBy,DateTimeOffset UpdatedAt,bool Removed=false,
    string Type="PRODUCTION_CLARIFICATION",SimTeamSource? TeamSource=null);
internal sealed record SimWoClarificationInput(Guid Id,string OperationId,string Text,SimTeamSource? TeamSource=null);
internal sealed record SimWoClarificationChange(Guid Id,string OperationId,string Name,string Action,string? Before,string? After);
internal sealed record SimWoRevisionDiff(Guid BaselineRevisionId,int BaselineVersion,string Summary,SimWoSequenceChange[] Operations,
    SimWoClarificationChange[]? Clarifications=null,SimWoContentChange[]? Content=null);
internal sealed record SimWoRevisionWarning(string OperationId,string Name,string Concern,string Evidence);
internal sealed record SimWoTravelerRevision(Guid Id,Guid TravelerId,string WorkOrderNumber,long Generation,int Version,
    Guid? PreviousRevisionId,Guid DefinitionId,int DefinitionVersion,string SourceToken,string Status,string ChangeBasis,
    string Reason,SimTravelerOperation[] Operations,Dictionary<string,decimal> SourceSequences,Dictionary<string,string?> SourceParents,
    JsonElement FrozenPackage,string CreatedBy,DateTimeOffset CreatedAt,string RevisedBy,DateTimeOffset RevisedAt,
    SimTravelerApprovalStamp? Approval,SimTravelerLease? Lease,SimWoRevisionDiff[] Differences,SimWoRevisionWarning[] Warnings,
    SimWoClarification[]? Clarifications=null,SimWoSubstep[]? Substeps=null,SimWoVisual[]? Visuals=null,SimWoOperationContent[]? OperationContent=null);
internal sealed record SimWoRevisionEvent(Guid Id,Guid TravelerId,Guid RevisionId,string WorkOrderNumber,long Generation,
    string Action,long WorkingVersion,string ActorId,string Actor,DateTimeOffset AtUtc,JsonElement Detail);
internal sealed record SimWoRevisionState(SimWoRevisionHead? Head,SimWoTravelerRevision? Draft,SimWoTravelerRevision[] Approved,SimWoRevisionEvent[] History,SimTravelerApprovalStamp? SourceApproval=null);
internal sealed record SimWoRevisionBeginRequest(long ExpectedWorkingVersion,Guid EffectiveRevisionId);
internal sealed record SimWoRevisionSaveRequest(long ExpectedWorkingVersion,Guid RevisionId,Guid LeaseId,string Reason,string[] OrderedOperationIds,
    SimWoClarificationInput[]? Clarifications=null,SimWoSubstepInput[]? Substeps=null,SimWoVisualInput[]? Visuals=null,SimWoOperationContentInput[]? OperationContent=null);
internal sealed record SimWoRevisionApproveRequest(long ExpectedWorkingVersion,Guid RevisionId,Guid LeaseId,bool WarningsReviewed,
    bool TechnicalConsistencyReviewed=false);

// WO overlays leave the frozen source operation immutable. Absence inherits source without a migration.
internal sealed record SimWoOperationContent(Guid Id,Guid RevisionId,string OperationId,string Instructions,string WorkCenter,string Department,string CreatedBy,DateTimeOffset CreatedAt,string UpdatedBy,DateTimeOffset UpdatedAt);
internal sealed record SimWoOperationContentInput(string OperationId,string Instructions,string WorkCenter,string Department);
