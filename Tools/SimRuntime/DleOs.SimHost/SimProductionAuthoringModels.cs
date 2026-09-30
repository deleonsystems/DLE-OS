using System.Text.Json;

internal sealed record SimProductionTeamInput(Guid Id,int Version,string WorkOrderNumber,long Generation,Guid TravelerId,string OperationId,
    string Kind,string Scope,string Text,string Audience,bool Active,string AuthorId,string Author,DateTimeOffset CreatedAt,
    string UpdatedBy,DateTimeOffset UpdatedAt,string Reason,string? DocumentId=null,string? Sha256=null,string? Name=null,string? MimeType=null,
    long Size=0,Guid? DraftRevisionId=null);
internal sealed record SimProductionTeamSave(Guid Id,int ExpectedVersion,Guid TravelerId,string OperationId,string Text,string Audience="TEAM_VISIBLE",bool Active=true,string Reason="");
internal sealed record SimProductionVisualUpload(Guid TravelerId,string OperationId,string Caption,string Audience="TEAM_VISIBLE",string Scope="TEAM_INPUT",
    long ExpectedWorkingVersion=0,Guid? RevisionId=null,Guid? LeaseId=null);
internal sealed record SimTeamSource(Guid Id,int Version);
internal sealed record SimWoSubstep(Guid Id,Guid RevisionId,string OperationId,int Order,string Text,string CreatedBy,DateTimeOffset CreatedAt,
    string UpdatedBy,DateTimeOffset UpdatedAt,bool Removed=false);
internal sealed record SimWoSubstepInput(Guid Id,string OperationId,int Order,string Text);
internal sealed record SimWoVisual(Guid Id,Guid RevisionId,string OperationId,Guid AssetId,string DocumentId,string Sha256,string Name,string MimeType,
    string Caption,string Source,string CreatedBy,DateTimeOffset CreatedAt,string UpdatedBy,DateTimeOffset UpdatedAt,bool Removed=false,
    SimTeamSource? TeamSource=null,Guid? SupersedesId=null);
internal sealed record SimWoVisualInput(Guid Id,string OperationId,Guid AssetId,string Caption,SimTeamSource? TeamSource=null,Guid? SupersedesId=null);
internal sealed record SimWoContentChange(Guid Id,string OperationId,string Name,string Kind,string Action,string? Before,string? After);
