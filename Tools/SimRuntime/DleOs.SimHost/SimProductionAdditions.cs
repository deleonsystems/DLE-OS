using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

// Intentionally not a slide/operation save contract: operators can only supply new content.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record SimAdditionCreate(string RequestId,string ParentJobId,string OperationId,string Title,string Body,string? FileName=null,string? ImageBase64=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record SimAdditionReview(string RequestId,int ExpectedVersion,int ExpectedDraftVersion,string Decision,string Note);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record SimAdditionSlideSave(string RequestId,int ExpectedVersion,string ParentJobId,string OperationId,SimLaborSlide Slide);
internal sealed record SimProductionAddition(string Id,int Version,string WorkOrderNumber,long Generation,string OperationId,
    string ParentJobId,int SourceRevision,string SourceOperationHash,SimLaborSlide Slide,string RequestHash,
    string AuthorId,string Author,DateTimeOffset At,string Status,string? ReviewerId=null,string? Reviewer=null,
    DateTimeOffset? ReviewedAt=null,string? Note=null,int? AcceptedDraftVersion=null,string? ReviewRequestId=null,string? ReviewRequestHash=null,
    string? EditRequestId=null,string? EditRequestHash=null,string? EditedBy=null,DateTimeOffset? EditedAt=null);

internal sealed partial class SimProductionService
{
    private static bool CanAddProduction(SimPersona actor)=>actor.Can("production.team_input");
    private static SimLaborOperation AdditionOperation(SimLaborOperation[] operations,string id){
        var op=operations.SingleOrDefault(o=>o.Id==id);
        Require(op is not null,"addition_operation","Choose a current released operation.");
        // Only physical instruction owners are eligible; never silently append into a shared source.
        Require(op!.InstructionSourceId is null&&!operations.Any(other=>other.InstructionSourceId==op.Id),"addition_shared_operation","Shared instructions cannot receive operation-only additions in this version.");
        var root=op;var seen=new HashSet<string>();
        while(root.ParentId is not null&&seen.Add(root.Id))root=operations.Single(o=>o.Id==root.ParentId);
        Require(!root.Name.Trim().Equals("Kitting",StringComparison.OrdinalIgnoreCase),"addition_materials","Production additions belong to a production operation, not Materials.");
        return op;
    }
    internal Task<object> ReadAdditions(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);var draft=await store.ReadPacketDraft(wo,r.Generation);
        var all=await store.ReadAdditions(wo,r.Generation);var packets=await store.ReadPackets(wo,r.Generation);
        var entries=all.GroupBy(a=>a.Id).Select(g=>g.MaxBy(a=>a.Version)!).Where(a=>CanReviewQuality(actor)||a.AuthorId==actor.Id).OrderBy(a=>a.At).Select(a=>{
            var publications=packets.Where(p=>p.Operations.Any(o=>(o.Slides??[]).Any(c=>c.Id==a.Slide.Id))).Select(p=>new{p.Id,p.JobRevision,p.MainRevision,p.At,p.Scope}).ToArray();
            return new{addition=a,publications,stale=a.ParentJobId!=(x.Current?.Id??x.Initial.Id.ToString()),
                canEdit=CanAddProduction(actor)&&a.AuthorId==actor.Id&&a.Status is "PENDING" or "RETURNED"};
        }).ToArray();
        return (object)new{canAdd=CanAddProduction(actor),canReview=CanReviewQuality(actor),parentJobId=x.Current?.Id??x.Initial.Id.ToString(),
            sourceRevision=x.Current?.JobRevision??1,draftVersion=draft?.Version??0,entries};
    });
    internal Task<SimJobInstructionAsset> UploadAdditionAsset(string wo,string parent,string operationId,string name,byte[] bytes,SimPersona actor){
        if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);
            Require(parent==(x.Current?.Id??x.Initial.Id.ToString()),"addition_source_changed","The released packet changed. Reopen before adding photos.");
            AdditionOperation(x.Current?.Operations??x.Initial.Operations,operationId);
            Require(bytes.Length is >0 and <=8388608,"addition_image","Choose a PNG or JPEG up to 8 MB.");
            var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
            Require(type!="","addition_image","Choose PNG or JPEG.");
            var safe=Path.GetFileName(name);var asset=new SimJobInstructionAsset(Guid.NewGuid().ToString(),Convert.ToHexString(SHA256.HashData(bytes)),safe[..Math.Min(safe.Length,200)],type,bytes);
            await store.AddInstructionAsset(wo,r.Generation,asset);return asset;
        });
    }
    internal Task<object> SaveAdditionSlide(string wo,string id,SimAdditionSlideSave request,SimPersona actor){
        if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);
            Require(Guid.TryParseExact(id,"D",out _)&&Guid.TryParseExact(request.RequestId,"D",out _)&&request.ExpectedVersion>=0,
                "addition_request","Use a valid addition and save request.");
            var hash=Hash(new{id,request,actorId=actor.Id});var history=await store.ReadAdditions(wo,r.Generation);
            var duplicate=history.FirstOrDefault(a=>a.Id==id&&a.EditRequestId==request.RequestId);
            if(duplicate is not null){Require(duplicate.EditRequestHash==hash,"addition_request_reused","This save request already refers to different content.");return (object)duplicate;}
            var prior=history.Where(a=>a.Id==id).MaxBy(a=>a.Version);
            void CheckOwner(SimProductionAddition? value){
                if(value is not null&&value.AuthorId!=actor.Id)throw new SimOrderEntryPermissionException();
                Require((value?.Version??0)==request.ExpectedVersion&&(value is null||value.Status is "PENDING" or "RETURNED"),
                    "addition_edit_changed","This addition changed or has been accepted. Reopen before editing.");
                Require(value is null||value.OperationId==request.OperationId&&value.Slide.Id==request.Slide?.Id,
                    "addition_identity","Keep this addition's operation and slide identity.");
            }
            CheckOwner(prior);
            var x=await PacketContext(wo,s,r);var parent=x.Current?.Id??x.Initial.Id.ToString();
            Require(request.ParentJobId==parent,"addition_source_changed","The released packet changed. Reopen before saving your addition.");
            var released=x.Current?.Operations??x.Initial.Operations;var op=AdditionOperation(released,request.OperationId);var card=request.Slide;
            Require(card is not null&&card.Kind is "BLANK" or "NOTE" or "IMAGE"&&card.Page==1&&card.Source is null,
                "addition_slide","Add a new canvas, text or image slide; released process pages cannot be edited here.");
            // Validate the same marks, photos and camera contract as the existing editor.
            await ValidateJobSlides(wo,r.Generation,await InstructionBaseline(s),[op with{Slides=[card!],SlidesOrganized=false,ExcludedSlideIds=[]}],s);
            IEnumerable<string> Ids(SimLaborSlide slide)=>new[]{slide.Id}.Concat(slide.Stages.SelectMany(t=>new[]{t.Id}.Concat((t.Photos??[]).Select(p=>p.Id))));
            var protectedIds=released.SelectMany(o=>o.Slides??[]).Concat(history.Where(a=>a.Id!=id).Select(a=>a.Slide)).SelectMany(Ids).ToHashSet();
            Require(!Ids(card!).Any(protectedIds.Contains),"addition_identity","Use new identities for this addition, never existing process slides.");
            return (object)await store.PacketTransaction(async(c,t)=>{
                var all=await SimProductionStore.Additions(c,t,wo,r.Generation);
                var retry=all.FirstOrDefault(a=>a.Id==id&&a.EditRequestId==request.RequestId);
                if(retry is not null){Require(retry.EditRequestHash==hash,"addition_request_reused","This save request already refers to different content.");return retry;}
                var latest=all.Where(a=>a.Id==id).MaxBy(a=>a.Version);CheckOwner(latest);
                Require(!all.Where(a=>a.Id!=id).SelectMany(a=>Ids(a.Slide)).Intersect(Ids(card!)).Any(),
                    "addition_identity","Use new identities for this addition, never existing process slides.");
                var head=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));
                Require((head?.Id??x.Initial.Id.ToString())==parent,"addition_source_changed","The released packet changed before this save.");
                var now=UtcNow();var next=latest is null
                    ?new SimProductionAddition(id,1,wo,r.Generation,op.Id,parent,x.Current?.JobRevision??1,Hash(op),card!,hash,actor.Id,actor.DisplayName,now,"PENDING")
                    :latest with{Version=latest.Version+1,ParentJobId=parent,SourceRevision=x.Current?.JobRevision??1,SourceOperationHash=Hash(op),Slide=card!,Status="PENDING",ReviewerId=null,Reviewer=null,ReviewedAt=null,Note=null,AcceptedDraftVersion=null,ReviewRequestId=null,ReviewRequestHash=null};
                next=next with{EditRequestId=request.RequestId,EditRequestHash=hash,EditedBy=actor.Id,EditedAt=now};
                await SimProductionStore.InsertAddition(c,t,next);return next;
            });
        });
    }
    internal Task<object> CreateAddition(string wo,SimAdditionCreate request,SimPersona actor){
        if(!CanAddProduction(actor))throw new SimOrderEntryPermissionException();
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);
            Require(Guid.TryParseExact(request.RequestId,"D",out _),"addition_request","Use a unique submission request.");
            Require(!string.IsNullOrWhiteSpace(request.Title)&&request.Title.Length<=100&&request.Body is not null&&request.Body.Length<=4000,
                "addition_content","Enter a title up to 100 characters and text up to 4000 characters.");
            Require((request.ImageBase64?.Length??0)<=11184812,"addition_image","Choose a PNG or JPEG up to 8 MB.");
            var hash=Hash(new{request,actor.Id});var prior=(await store.ReadAdditions(wo,r.Generation)).FirstOrDefault(a=>a.Id==request.RequestId&&a.Version==1);
            if(prior is not null){Require(prior.RequestHash==hash,"addition_request_reused","This request was already used for different content.");return (object)prior;}
            var x=await PacketContext(wo,s,r);var parent=x.Current?.Id??x.Initial.Id.ToString();
            Require(request.ParentJobId==parent,"addition_source_changed","The released packet changed. Reopen it before submitting your addition.");
            var op=AdditionOperation(x.Current?.Operations??x.Initial.Operations,request.OperationId);
            SimJobInstructionAsset? asset=null;
            if(!string.IsNullOrEmpty(request.ImageBase64)){
                byte[] bytes;try{bytes=Convert.FromBase64String(request.ImageBase64);}catch(FormatException){throw KittingCaseProblem.Conflict("addition_image","Choose a valid PNG or JPEG.");}
                Require(bytes.Length is >0 and <=8388608,"addition_image","Choose an image up to 8 MB.");
                var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
                Require(type!="","addition_image","Choose PNG or JPEG.");
                var name=Path.GetFileName(request.FileName??"image");
                asset=new(Guid.NewGuid().ToString(),Convert.ToHexString(SHA256.HashData(bytes)),name[..Math.Min(name.Length,200)],type,bytes);
            }
            Require(asset is not null||!string.IsNullOrWhiteSpace(request.Body),"addition_content","Add an image or slide text.");
            var slide=new SimLaborSlide(Guid.NewGuid().ToString(),asset is null?"NOTE":"IMAGE",request.Title.Trim(),request.Body!,1,
                [new(Guid.NewGuid().ToString(),"Stage 1",[],new(1,.5,.5,1,1),[])],null,asset?.DocumentId,asset?.Sha256);
            var next=new SimProductionAddition(request.RequestId,1,wo,r.Generation,op.Id,parent,x.Current?.JobRevision??1,Hash(op),slide,hash,actor.Id,actor.DisplayName,UtcNow(),"PENDING");
            return (object)await store.PacketTransaction(async(c,t)=>{
                var retry=(await SimProductionStore.Additions(c,t,wo,r.Generation)).FirstOrDefault(a=>a.Id==request.RequestId&&a.Version==1);
                if(retry is not null){Require(retry.RequestHash==hash,"addition_request_reused","This request was already used for different content.");return retry;}
                var current=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));
                Require((current?.Id??x.Initial.Id.ToString())==parent,"addition_source_changed","The released packet changed. Reopen before submitting.");
                if(asset is not null)await SimProductionStore.InsertAdditionAsset(c,t,wo,r.Generation,asset);
                await SimProductionStore.InsertAddition(c,t,next);return next;
            });
        });
    }
    internal Task<object> ReviewAddition(string wo,string id,SimAdditionReview request,SimPersona actor){
        QualityPermission(actor);
        return WithSource(wo,actor,false,async(s,r)=>{
            wo=SimKittingCases.Normalize(wo);
            Require(Guid.TryParseExact(request.RequestId,"D",out _)&&request.Decision is "ACCEPT" or "RETURN"&&request.Note is not null&&request.Note.Length<=1000,
                "addition_review","Choose Accept or Return and a note up to 1000 characters.");
            Require(request.Decision!="RETURN"||!string.IsNullOrWhiteSpace(request.Note),"addition_return_note","Add a short return note.");
            var x=await PacketContext(wo,s,r);var hash=Hash(new{id,request,actorId=actor.Id});
            return (object)await store.PacketTransaction(async(c,t)=>{
                var prior=(await SimProductionStore.Additions(c,t,wo,r.Generation)).Where(a=>a.Id==id).MaxBy(a=>a.Version);
                Require(prior is not null,"addition_missing","This addition does not exist.");
                if(prior!.ReviewRequestId==request.RequestId){Require(prior.ReviewRequestHash==hash,"addition_request_reused","Review request already used for different content.");return prior;}
                Require(prior.Version==request.ExpectedVersion&&prior.Status=="PENDING","addition_review_changed","This addition was already reviewed. Reopen the list.");
                int? acceptedVersion=null;
                if(request.Decision=="ACCEPT"){
                    var current=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));var parent=current?.Id??x.Initial.Id.ToString();
                    Require(prior.ParentJobId==parent,"addition_source_changed","The released packet changed. Return this addition for a fresh submission.");
                    var released=current?.Operations??x.Initial.Operations;var original=AdditionOperation(released,prior.OperationId);
                    Require(Hash(original)==prior.SourceOperationHash,"addition_source_changed","The source operation changed.");
                    var draft=await SimProductionStore.PacketDraft(c,t,wo,r.Generation);
                    Require((draft?.Version??0)==request.ExpectedDraftVersion,"packet_draft_changed","Quality's draft changed. Reopen and review before accepting.");
                    var consumed=draft is not null&&await SimProductionStore.PacketConsumed(c,t,wo,r.Generation,draft.Version);
                    Require(draft is null||consumed||draft.ParentJobId==parent&&draft.Identity==x.Identity,"packet_parent_changed","Quality's draft requires source review before acceptance.");
                    var ops=draft is not null&&!consumed?draft.Operations:released;
                    var target=AdditionOperation(ops,prior.OperationId);var slides=(target.Slides??[]).ToList();
                    Require(slides.Count<80&&ops.Sum(o=>o.Slides?.Length??0)<500,"addition_limit","The draft has reached its slide limit.");
                    Require(!ops.Any(o=>(o.Slides??[]).Any(card=>card.Id==prior.Slide.Id)),"addition_duplicate","This slide already exists in Quality's draft.");
                    // Add before an organized End boundary; existing cards and their order are unchanged.
                    var at=target.SlidesOrganized==true?slides.Count-1:slides.Count;
                    Require(at>=0&&(target.SlidesOrganized!=true||slides[^1].Kind=="END"),"addition_boundary","The operation's End boundary needs review.");
                    slides.Insert(at,prior.Slide);
                    var merged=ops.Select(o=>o.Id==target.Id?o with{Slides=slides.ToArray()}:o).ToArray();
                    acceptedVersion=(draft?.Version??0)+1;
                    var main=await SimProductionStore.PacketHead(c,t,x.Identity.Key);
                    await SimProductionStore.InsertPacketDraft(c,t,new(wo,r.Generation,acceptedVersion.Value,parent,
                        draft is not null&&!consumed?draft.ParentMainId:main?.Id,x.Identity,merged,actor.Id,actor.DisplayName,UtcNow()));
                }
                var next=prior with{Version=prior.Version+1,Status=request.Decision=="ACCEPT"?"ACCEPTED":"RETURNED",ReviewerId=actor.Id,Reviewer=actor.DisplayName,
                    ReviewedAt=UtcNow(),Note=request.Note!.Trim(),AcceptedDraftVersion=acceptedVersion,ReviewRequestId=request.RequestId,ReviewRequestHash=hash};
                await SimProductionStore.InsertAddition(c,t,next);return next;
            });
        });
    }
}

internal sealed partial class SimProductionStore
{
    internal Task<SimProductionAddition[]> ReadAdditions(string wo,long gen)=>PacketRead(c=>Additions(c,null,wo,gen));
    internal static async Task<SimProductionAddition[]> Additions(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimProductionAddition"))return [];
        return await Many<SimProductionAddition>(c,t!,"SimProductionAddition",wo,gen);
    }
    internal static async Task InsertAddition(SqliteConnection c,SqliteTransaction t,SimProductionAddition a){
        await Exec(c,t,"""
            CREATE TABLE IF NOT EXISTS SimProductionAddition(Id TEXT NOT NULL,Version INTEGER NOT NULL,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(Id,Version));
            CREATE TRIGGER IF NOT EXISTS SimProductionAdditionNoUpdate BEFORE UPDATE ON SimProductionAddition BEGIN SELECT RAISE(ABORT,'Addition history is immutable'); END;
            CREATE TRIGGER IF NOT EXISTS SimProductionAdditionNoDelete BEFORE DELETE ON SimProductionAddition BEGIN SELECT RAISE(ABORT,'Addition history is immutable'); END;
            """);
        await Exec(c,t,"INSERT INTO SimProductionAddition VALUES(@id,@v,@wo,@g,@j)",("@id",a.Id),("@v",a.Version),("@wo",a.WorkOrderNumber),("@g",a.Generation),("@j",JsonSerializer.Serialize(a,Json)));
    }
    internal static async Task InsertAdditionAsset(SqliteConnection c,SqliteTransaction t,string wo,long gen,SimJobInstructionAsset asset){
        await Exec(c,t,"CREATE TABLE IF NOT EXISTS SimJobInstructionAsset(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,DocumentId TEXT NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation,DocumentId))");
        await Exec(c,t,"INSERT INTO SimJobInstructionAsset VALUES(@wo,@g,@id,@j)",("@wo",wo),("@g",gen),("@id",asset.DocumentId),("@j",JsonSerializer.Serialize(asset,Json)));
    }
}
