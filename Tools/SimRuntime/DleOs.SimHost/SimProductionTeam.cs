using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal sealed partial class SimProductionService
{
    private static bool CanTeam(SimPersona a)=>a.Can("production.team_input")||a.Can("production.manage");
    private static bool CanSeeTeam(SimProductionTeamInput n,SimPersona a)=>n.Audience=="TEAM_VISIBLE"||a.Can("production.manage");
    private static void TeamPermission(SimPersona a){if(!a.Can("production.view")||!CanTeam(a))throw new SimOrderEntryPermissionException();}
    private static void TeamScope(SimWoTraveler b,Guid traveler,string op){Require(b.Id==traveler&&b.Operations.Any(o=>o.Id==op&&Active(o)),"team_operation_scope","Select an active operation on this WO Traveler.");}
    private static void Audience(string audience,SimPersona a){Require(audience is "TEAM_VISIBLE" or "MANAGEMENT_ONLY","team_audience","Choose a supported audience.");if(audience=="MANAGEMENT_ONLY"&&!a.Can("production.manage"))throw new SimOrderEntryPermissionException();}
    internal Task<JsonElement> SaveTeamInput(string wo,SimProductionTeamSave r,SimPersona actor){
        wo=SimKittingCases.Normalize(wo);TeamPermission(actor);return WithSource(wo,actor,false,async(source,runtime)=>{
            await store.TeamChange(wo,runtime.Generation,async(c,t,b,all)=>{
                TeamScope(b,r.TravelerId,r.OperationId);Audience(r.Audience,actor);
                var old=all.Where(n=>n.Id==r.Id).OrderByDescending(n=>n.Version).FirstOrDefault();
                Require(r.Id!=Guid.Empty&&(old?.Version??0)==r.ExpectedVersion,"team_version_changed","Team Input changed. Refresh before saving.");
                Require(old is null||old.Scope=="TEAM_INPUT"&&old.OperationId==r.OperationId,"team_operation_scope","Team Input cannot move between operations.");
                if(old is not null&&(!CanSeeTeam(old,actor)||old.AuthorId!=actor.Id&&!actor.Can("production.manage")))throw new SimOrderEntryPermissionException();
                Require(old is null||!string.IsNullOrWhiteSpace(r.Reason)&&r.Reason.Length<=2000,"team_correction_reason","Explain the correction; earlier evidence will remain in history.");
                Require(!string.IsNullOrWhiteSpace(r.Text)&&r.Text.Length<=(old?.Kind=="VISUAL"?500:4000),"team_text","Enter note text (up to 4000 characters), or a visual caption (up to 500).");
                var now=UtcNow();var next=old is null?new SimProductionTeamInput(r.Id,1,wo,runtime.Generation,b.Id,r.OperationId,"NOTE","TEAM_INPUT",r.Text.Trim(),r.Audience,r.Active,actor.Id,actor.DisplayName,now,actor.DisplayName,now,"Added"):
                    old with{Version=old.Version+1,Text=r.Text.Trim(),Audience=r.Audience,Active=r.Active,UpdatedBy=actor.DisplayName,UpdatedAt=now,Reason=r.Reason.Trim()};
                await SimProductionStore.AddTeamInput(c,t,next);
            });return await View(source,runtime,actor);
        });
    }
    internal Task<SimProductionTeamInput> UploadProductionVisual(string wo,SimProductionVisualUpload r,string name,Stream input,SimPersona actor){
        wo=SimKittingCases.Normalize(wo);TeamPermission(actor);return WithSource(wo,actor,false,async(source,runtime)=>{
            Require(r.Scope is "TEAM_INPUT" or "DRAFT_VISUAL","team_visual_scope","Choose Team Input or a controlled draft visual.");
            if(r.Scope=="DRAFT_VISUAL"&&!actor.Can("production.manage"))throw new SimOrderEntryPermissionException();
            Audience(r.Audience,actor);Require(r.Caption is not null&&r.Caption.Length<=500,"team_caption","Use a caption up to 500 characters.");
            using var memory=new MemoryStream();var buffer=new byte[81920];int read;
            while((read=await input.ReadAsync(buffer))>0){Require(memory.Length+read<=8*1024*1024,"team_visual_size","Choose an image up to 8 MB.");memory.Write(buffer,0,read);}
            var bytes=memory.ToArray();var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
            Require(type!="","team_visual_type","Choose or paste a PNG or JPEG image.");
            SimProductionTeamInput? result=null;string? staged=null;
            try{await store.TeamChange(wo,runtime.Generation,async(c,t,b,all)=>{
                TeamScope(b,r.TravelerId,r.OperationId);
                if(r.Scope=="DRAFT_VISUAL"){
                    Require(!await SimProductionStore.ExecutionExists(c,t,wo),"traveler_execution_exists","Pre-start authoring is unavailable after execution.");
                    var revisions=await SimProductionStore.ReadRevisions(c,t,wo,runtime.Generation);
                    Require(revisions.Head?.WorkingVersion==r.ExpectedWorkingVersion,"wo_revision_version_changed","Refresh the Traveler before uploading.");
                    EditableWo(revisions,r.RevisionId??Guid.Empty,r.LeaseId??Guid.Empty,actor,UtcNow());
                }
                memory.Position=0;var doc=await documents.Stage(b.Id.ToString(),name,0,memory,actor.DisplayName);staged=doc.DocumentId;
                var now=UtcNow();result=new(Guid.NewGuid(),1,wo,runtime.Generation,b.Id,r.OperationId,"VISUAL",r.Scope,r.Caption!.Trim(),r.Scope=="DRAFT_VISUAL"?"MANAGEMENT_ONLY":r.Audience,true,
                    actor.Id,actor.DisplayName,now,actor.DisplayName,now,"Image added",doc.DocumentId,Convert.ToHexString(SHA256.HashData(bytes)),doc.Name,type,bytes.Length,r.Scope=="DRAFT_VISUAL"?r.RevisionId:null);
                await SimProductionStore.AddTeamInput(c,t,result);
            });}catch{if(staged is not null)await documents.Remove(r.TravelerId.ToString(),staged,actor.DisplayName);throw;}
            return result!;
        });
    }
    internal Task<(byte[] Bytes,string Type)> OpenProductionVisual(string wo,Guid id,SimPersona actor){wo=SimKittingCases.Normalize(wo);return WithSource(wo,actor,false,async(source,runtime)=>{
        var all=await store.TeamInputs(wo,runtime.Generation);var asset=all.Where(n=>n.Id==id).OrderByDescending(n=>n.Version).FirstOrDefault();
        Require(asset is not null&&asset.Kind=="VISUAL","team_visual_missing","This visual is not available on this WO.");
        var retained=await store.Read(wo,runtime.Generation);var revisions=RevisionView(retained.Bound,retained.Revisions,source);
        var published=revisions.All.Any(r=>(r.Visuals??[]).Any(v=>v.AssetId==id&&!v.Removed));
        if(!published&&!(asset!.Scope=="TEAM_INPUT"&&CanSeeTeam(asset,actor))&&!actor.Can("production.manage"))throw new SimOrderEntryPermissionException();
        var bytes=await documents.Bytes(asset!.TravelerId.ToString(),asset.DocumentId!);
        Require(Convert.ToHexString(SHA256.HashData(bytes))==asset.Sha256&&bytes.Length==asset.Size,"team_visual_integrity","The verified visual failed integrity checks.");
        return(bytes,asset.MimeType!);
    });}
    private async Task ProjectTeam(JsonObject package,string wo,long gen,SimPersona actor,SimWoRevisionState state,SimWoTravelerRevision[] approved){
        var all=await store.TeamInputs(wo,gen);var latest=all.GroupBy(n=>n.Id).Select(g=>g.MaxBy(n=>n.Version)!).Where(n=>n.Scope=="TEAM_INPUT"&&CanSeeTeam(n,actor));
        package["teamInputs"]=JsonSerializer.SerializeToNode(latest.Select(n=>new{n.Id,n.Version,n.OperationId,n.Kind,n.Text,n.Audience,n.Active,n.Author,n.CreatedAt,n.UpdatedBy,n.UpdatedAt,
            n.Name,n.DocumentId,n.Sha256,url=n.Kind=="VISUAL"?$"/api/production/v1/work-orders/{wo}/production-visuals/{n.Id}":null,
            canCorrect=CanTeam(actor)&&(actor.Can("production.manage")||actor.Id==n.AuthorId),
            history=all.Where(x=>x.Id==n.Id&&CanSeeTeam(x,actor)).Select(x=>new{x.Version,x.Text,x.Audience,x.Active,x.Reason,x.UpdatedBy,x.UpdatedAt}),
            promotions=approved.Concat(state.Draft is null?[]:[state.Draft]).Where(r=>(r.Clarifications??[]).Any(c=>c.TeamSource?.Id==n.Id&&!c.Removed)||(r.Visuals??[]).Any(v=>v.TeamSource?.Id==n.Id&&!v.Removed)).Select(r=>new{r.Version,r.Status})}),Json);
        package["canAddTeamInput"]=CanTeam(actor);package["canManageTeamInput"]=actor.Can("production.manage");
    }
}
