using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;

internal sealed record SimProductionProposal(string Id,int Version,string WorkOrderNumber,long Generation,
    string ParentJobId,string? ParentMainId,SimPacketIdentity Identity,SimLaborOperation[] BaseOperations,SimLaborOperation[] Operations,
    string AuthorId,string Author,DateTimeOffset At,DateTimeOffset UpdatedAt,string Status,string SaveRequestId,string SaveRequestHash,
    string? ReviewerId=null,string? Reviewer=null,string? Note=null,int? AcceptedDraftVersion=null,string? ReviewRequestId=null,string? ReviewRequestHash=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record SimProposalSave(string RequestId,int ExpectedVersion,string ParentJobId,SimLaborOperation[] Operations);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record SimProposalReview(string RequestId,int ExpectedVersion,int ExpectedDraftVersion,string Decision,string Note);

internal sealed partial class SimProductionService
{
    private static object ProposalSaved(SimProductionProposal p)=>new{version=p.Version,draftVersion=p.Version,proposalId=p.Id,status=p.Status,updatedBy=p.Author,updatedAt=p.UpdatedAt};
    internal Task<object> ReadProductionProposal(string wo,string? id,SimPersona actor)=>WithSource(wo,actor,false,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);var all=await store.ReadProposals(wo,r.Generation);
        SimProductionProposal? p;
        if(id is not null){p=all.Where(v=>v.Id==id).MaxBy(v=>v.Version);Require(p is not null,"proposal_missing","This proposal does not exist.");
            if(!CanReviewQuality(actor)&&p!.AuthorId!=actor.Id)throw new SimOrderEntryPermissionException();}
        else {if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
            p=all.GroupBy(v=>v.Id).Select(g=>g.MaxBy(v=>v.Version)!).SingleOrDefault(v=>v.AuthorId==actor.Id&&v.Status is "PENDING" or "RETURNED");}
        var baseline=await InstructionBaseline(s);var parent=x.Current?.Id??x.Initial.Id.ToString();var stale=p is not null&&(p.ParentJobId!=parent||p.Identity!=x.Identity);
        return (object)new{inspectionLinksSupported=true,inspectionSymbolsSupported=true,markerOpacitySupported=true,packetContractVersion=1,editingDraft=true,released=true,version=x.Initial.InstructionVersion,
            baselineToken=Hash(baseline),baselineVersion=baseline.Version,baseline.DefinitionId,baseline.Quantity,
            operations=p?.Operations??x.Current?.Operations??x.Initial.Operations,draftVersion=p?.Version??0,hasSavedDraft=p is not null,
            parentJobId=p?.ParentJobId??parent,parentMainId=p is null?x.Main?.Id:p.ParentMainId,travelerRevision=x.Current?.JobRevision??1,
            proposalId=p?.Id??Guid.NewGuid().ToString(),proposalStatus=p?.Status??"NEW",authorId=p?.AuthorId??actor.Id,author=p?.Author??actor.DisplayName,note=p?.Note,
            canEdit=id is null&&CanAddProduction(actor)&&!stale,stale,updatedBy=p?.Author,updatedAt=p?.UpdatedAt};
    });
    internal Task<object> ListProductionProposals(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(s,r)=>{
        QualityPermission(actor);wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);var all=await store.ReadProposals(wo,r.Generation);var draft=await store.ReadPacketDraft(wo,r.Generation);
        return (object)new{draftVersion=draft?.Version??0,entries=all.GroupBy(v=>v.Id).Select(g=>g.MaxBy(v=>v.Version)!).OrderByDescending(p=>p.UpdatedAt).Select(p=>new{
            p.Id,p.Version,p.Author,p.Status,p.Note,p.UpdatedAt,p.AcceptedDraftVersion,stale=p.ParentJobId!=(x.Current?.Id??x.Initial.Id.ToString()),
            changedOperations=p.Operations.Where((op,i)=>Hash(op)!=Hash(p.BaseOperations[i])).Select(op=>op.Name).ToArray()}).ToArray()};
    });
    internal Task<object> SaveProductionProposal(string wo,string id,SimProposalSave request,SimPersona actor){
        if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);Require(Guid.TryParseExact(id,"D",out _)&&Guid.TryParseExact(request.RequestId,"D",out _)&&request.ExpectedVersion>=0,"proposal_request","Use a valid proposal save request.");
            var x=await PacketContext(wo,s,r);await ValidatePacketOperations(wo,s,r,request.Operations);var hash=Hash(new{id,request,actorId=actor.Id});
            return await store.PacketTransaction<object>(async(c,t)=>{
                var all=await SimProductionStore.Proposals(c,t,wo,r.Generation);var prior=all.Where(p=>p.Id==id).MaxBy(p=>p.Version);
                if(prior is not null&&prior.AuthorId!=actor.Id)throw new SimOrderEntryPermissionException();
                var retry=all.FirstOrDefault(p=>p.Id==id&&p.SaveRequestId==request.RequestId);
                if(retry is not null){Require(retry.SaveRequestHash==hash,"proposal_request_reused","This save request refers to different content.");return ProposalSaved(retry);}
                Require((prior?.Version??0)==request.ExpectedVersion&&(prior is null||prior.Status is "PENDING" or "RETURNED"),"proposal_changed","The proposal was edited or reviewed. Reopen before saving; local changes are retained.");
                Require(prior is not null||!all.GroupBy(p=>p.Id).Select(g=>g.MaxBy(p=>p.Version)!).Any(p=>p.AuthorId==actor.Id&&p.Status is "PENDING" or "RETURNED"),"proposal_changed","You already have a pending proposal. Reopen it before saving.");
                var head=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));var parent=head?.Id??x.Initial.Id.ToString();
                Require(parent==request.ParentJobId&&(prior is null||prior.ParentJobId==parent&&prior.Identity==x.Identity),"proposal_source_changed","The released source changed. This proposal is retained for review; do not overwrite the new source.");
                var now=UtcNow();var next=new SimProductionProposal(id,request.ExpectedVersion+1,wo,r.Generation,parent,prior is null?x.Main?.Id:prior.ParentMainId,x.Identity,
                    prior?.BaseOperations??head?.Operations??x.Initial.Operations,request.Operations,actor.Id,actor.DisplayName,prior?.At??now,now,"PENDING",request.RequestId,hash);
                await SimProductionStore.InsertProposal(c,t,next);return ProposalSaved(next);
            });
        });
    }
    // Merge only independent instruction-text / complete slide-set changes. Never silently choose a side of a conflict.
    private static SimLaborOperation[] MergeProposal(SimProductionProposal p,SimLaborOperation[] current){
        Require(current.Select(o=>o.Id).SequenceEqual(p.BaseOperations.Select(o=>o.Id)),"proposal_conflict","The Quality routing differs from this proposal.");
        object Slides(SimLaborOperation o)=>new{o.Slides,o.SlidesOrganized,o.ExcludedSlideIds};
        return current.Select((q,i)=>{
            var b=p.BaseOperations[i];var proposed=p.Operations[i];var result=q;
            if(proposed.Instructions!=b.Instructions){Require(q.Instructions==b.Instructions||q.Instructions==proposed.Instructions,"proposal_conflict","Both Quality and Production changed instruction text for "+q.Name+". Return the proposal for reconciliation.");result=result with{Instructions=proposed.Instructions};}
            if(Hash(Slides(proposed))!=Hash(Slides(b))){Require(Hash(Slides(q))==Hash(Slides(b))||Hash(Slides(q))==Hash(Slides(proposed)),"proposal_conflict","Both Quality and Production changed slides for "+q.Name+". Return the proposal for reconciliation.");result=result with{Slides=proposed.Slides,SlidesOrganized=proposed.SlidesOrganized,ExcludedSlideIds=proposed.ExcludedSlideIds};}
            return result;
        }).ToArray();
    }
    internal Task<object> ReviewProductionProposal(string wo,string id,SimProposalReview request,SimPersona actor){
        QualityPermission(actor);
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);Require(Guid.TryParseExact(request.RequestId,"D",out _)&&request.Decision is "ACCEPT" or "RETURN"&&(request.Decision!="RETURN"||!string.IsNullOrWhiteSpace(request.Note)),"proposal_review","Choose Accept or Return; include a note for Return.");
            var x=await PacketContext(wo,s,r);var hash=Hash(new{id,request,actorId=actor.Id});
            return (object)await store.PacketTransaction(async(c,t)=>{
                var all=await SimProductionStore.Proposals(c,t,wo,r.Generation);var p=all.Where(v=>v.Id==id).MaxBy(v=>v.Version);Require(p is not null,"proposal_missing","This proposal does not exist.");
                var retry=all.FirstOrDefault(v=>v.Id==id&&v.ReviewRequestId==request.RequestId);if(retry is not null){Require(retry.ReviewRequestHash==hash,"proposal_request_reused","This review request refers to a different decision.");return retry;}
                Require(p!.Version==request.ExpectedVersion&&p.Status=="PENDING","proposal_changed","The proposal changed or was already reviewed. Reopen before reviewing.");int? accepted=null;
                if(request.Decision=="ACCEPT"){
                    var head=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));var parent=head?.Id??x.Initial.Id.ToString();
                    Require(parent==p.ParentJobId&&p.Identity==x.Identity,"proposal_source_changed","The published source changed. Return the retained proposal for reconciliation.");
                    var draft=await SimProductionStore.PacketDraft(c,t,wo,r.Generation);
                    Require((draft?.Version??0)==request.ExpectedDraftVersion,"packet_draft_changed","Quality's draft changed. Reopen before accepting.");
                    var consumed=draft is not null&&await SimProductionStore.PacketConsumed(c,t,wo,r.Generation,draft.Version);
                    Require(draft is null||consumed||draft.ParentJobId==parent&&draft.Identity==x.Identity,"proposal_source_changed","Quality's draft has a different source.");
                    var current=draft is not null&&!consumed?draft.Operations:head?.Operations??x.Initial.Operations;
                    var merged=MergeProposal(p,current);await ValidatePacketOperations(wo,s,r,merged);accepted=(draft?.Version??0)+1;
                    await SimProductionStore.InsertPacketDraft(c,t,new(wo,r.Generation,accepted.Value,parent,draft is not null&&!consumed?draft.ParentMainId:x.Main?.Id,x.Identity,merged,actor.Id,actor.DisplayName,UtcNow()));
                }
                var next=p with{Version=p.Version+1,Status=request.Decision=="ACCEPT"?"ACCEPTED":"RETURNED",ReviewerId=actor.Id,Reviewer=actor.DisplayName,Note=request.Note,UpdatedAt=UtcNow(),AcceptedDraftVersion=accepted,ReviewRequestId=request.RequestId,ReviewRequestHash=hash,SaveRequestId="",SaveRequestHash=""};
                await SimProductionStore.InsertProposal(c,t,next);return next;
            });
        });
    }
    internal Task<SimJobInstructionAsset> UploadProposalAsset(string wo,string parent,string name,byte[] bytes,SimPersona actor){
        if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
        return WithSource(wo,actor,false,async(s,r)=>{
            var x=await PacketContext(wo,s,r);Require(parent==(x.Current?.Id??x.Initial.Id.ToString()),"proposal_source_changed","The source changed. Reopen before uploading.");
            Require(bytes.Length is >0 and <=8388608,"proposal_image","Choose a PNG/JPEG up to 8 MB.");
            var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";Require(type!="","proposal_image","Choose a PNG or JPEG.");
            var safe=Path.GetFileName(name);var asset=new SimJobInstructionAsset(Guid.NewGuid().ToString(),Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)),safe[..Math.Min(200,safe.Length)],type,bytes);
            await store.AddInstructionAsset(SimKittingCases.Normalize(wo),r.Generation,asset);return asset;
        });
    }
}
internal sealed partial class SimProductionStore
{
    internal Task<SimProductionProposal[]> ReadProposals(string wo,long gen)=>PacketRead(c=>Proposals(c,null,wo,gen));
    internal static async Task<SimProductionProposal[]> Proposals(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimProductionProposal"))return [];return await Many<SimProductionProposal>(c,t!,"SimProductionProposal",wo,gen);
    }
    internal static async Task InsertProposal(SqliteConnection c,SqliteTransaction t,SimProductionProposal p){
        await Exec(c,t,"""
            CREATE TABLE IF NOT EXISTS SimProductionProposal(Id TEXT NOT NULL,Version INTEGER NOT NULL,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(Id,Version));
            CREATE TRIGGER IF NOT EXISTS SimProductionProposalNoUpdate BEFORE UPDATE ON SimProductionProposal BEGIN SELECT RAISE(ABORT,'Proposal history is immutable'); END;
            CREATE TRIGGER IF NOT EXISTS SimProductionProposalNoDelete BEFORE DELETE ON SimProductionProposal BEGIN SELECT RAISE(ABORT,'Proposal history is immutable'); END;
            """);
        await Exec(c,t,"INSERT INTO SimProductionProposal VALUES(@id,@v,@wo,@g,@j)",("@id",p.Id),("@v",p.Version),("@wo",p.WorkOrderNumber),("@g",p.Generation),("@j",System.Text.Json.JsonSerializer.Serialize(p,Json)));
    }
}
