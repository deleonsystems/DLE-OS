using System.Text.Json;
using Microsoft.Data.Sqlite;

// SIM-owned packet storage. No external filesystem/share is consulted. A later
// storage adapter must preserve immutable IDs and the atomic publication boundary.
internal interface ISimMainPacketReader { Task<SimInstructionPacket?> ReadMainPacket(string key); }
internal sealed record SimPacketIdentity(string Key,string Compatibility,string Customer,string Assembly,string Revision);
internal sealed record SimPacketDraft(string WorkOrderNumber,long Generation,int Version,string ParentJobId,string? ParentMainId,
    SimPacketIdentity Identity,SimLaborOperation[] Operations,string ActorId,string Actor,DateTimeOffset At);
internal sealed record SimInstructionPacket(string Id,string WorkOrderNumber,long Generation,int DraftVersion,string RequestId,string RequestHash,
    string Scope,string Reason,string ParentJobId,string? ParentMainId,int? JobRevision,int? MainRevision,SimPacketIdentity Identity,
    SimLaborOperation[] Operations,SimJobInstructionAsset[] Assets,string ActorId,string Actor,DateTimeOffset At);
internal sealed record SimPacketSave(int ExpectedVersion,string ParentJobId,string? ParentMainId,SimLaborOperation[] Operations);
internal sealed record SimPacketPublish(int ExpectedVersion,string RequestId,string Scope,string Reason);

internal sealed partial class SimProductionService
{
    private async Task<SimPacketIdentity> PacketIdentity(SimProductionSource source,long gen){
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(Text(source.Package.GetProperty("source"),"acceptedIntakeId")))!;
        var context=source.Package.GetProperty("context");var baseline=await InstructionBaseline(source);
        return new("M:"+gen+":"+Hash(new{record.Customer.CustomerId,assembly=Text(context,"assembly"),revision=Text(context,"revision")}),
            Hash(baseline),record.Customer.CustomerName,Text(context,"assembly"),Text(context,"revision"));
    }
    private static string JobPacketKey(string wo,long gen)=>"W:"+gen+":"+SimKittingCases.Normalize(wo);
    private Task<T> WithPacket<T>(string wo,SimPersona actor,bool write,Func<SimProductionSource,SimStateMetadata,Task<T>> action)=>
        WithInstructionSource(wo,actor,false,true,async(s,r)=>{if(write)QualityPermission(actor);return await action(s,r);});
    private async Task<SimInstructionPacket?> CompatibleMain(SimProductionSource source,long gen){
        var identity=await PacketIdentity(source,gen);var main=await store.ReadMainPacket(identity.Key);
        return main?.Identity.Compatibility==identity.Compatibility?main:null;
    }
    private async Task<(SimQualityRelease Initial,SimInstructionPacket? Current,SimInstructionPacket? Main,SimPacketIdentity Identity)> PacketContext(string wo,SimProductionSource s,SimStateMetadata r){
        var initial=await store.ReadQualityRelease(wo,r.Generation);
        Require(initial is not null,"packet_initial_release","Complete the initial Quality packet review and release before creating an amendment.");
        var identity=await PacketIdentity(s,r.Generation);var current=await store.ReadPacketHead(JobPacketKey(wo,r.Generation));
        Require(current is null||current.Identity==identity,"packet_source_changed","The accepted technical source changed. Review its lineage before editing this packet.");
        return(initial!,current,await store.ReadMainPacket(identity.Key),identity);
    }
    internal Task<object> ReadPacketDraft(string wo,SimPersona actor)=>WithPacket(wo,actor,false,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);var d=await store.ReadPacketDraft(wo,r.Generation);
        var consumed=d is not null&&await store.PacketDraftConsumed(wo,r.Generation,d.Version);
        var parent=x.Current?.Id??x.Initial.Id.ToString();var ops=d is not null&&!consumed?d.Operations:x.Current?.Operations??x.Initial.Operations;
        var baseline=await InstructionBaseline(s);var stale=d is not null&&!consumed&&(d.ParentJobId!=parent||d.Identity!=x.Identity);
        return (object)new{inspectionLinksSupported=true,inspectionSymbolsSupported=true,markerOpacitySupported=true,packetContractVersion=1,editingDraft=true,released=true,version=x.Initial.InstructionVersion,
            baselineToken=Hash(baseline),baselineVersion=baseline.Version,baseline.DefinitionId,baseline.Quantity,operations=ops,
            draftVersion=d?.Version??0,hasSavedDraft=d is not null&&!consumed,parentJobId=d is not null&&!consumed?d.ParentJobId:parent,
            parentMainId=d is not null&&!consumed?d.ParentMainId:x.Main?.Id,travelerRevision=x.Current?.JobRevision??1,
            canEdit=CanReviewQuality(actor)&&!stale,stale,
            mainPacket=new{x.Identity.Customer,x.Identity.Assembly,x.Identity.Revision,id=x.Main?.Id,packetRevision=x.Main?.MainRevision,
                compatible=x.Main is null||x.Main.Identity.Compatibility==x.Identity.Compatibility},
            scopeDefault="WO_ONLY",updatedBy=d?.Actor,updatedAt=d?.At};
    });
    private async Task ValidatePacketOperations(string wo,SimProductionSource s,SimStateMetadata r,SimLaborOperation[] incoming){
        var baseline=await InstructionBaseline(s);var original=InstructionOperations(baseline);
        Require(incoming is not null&&incoming.Length==original.Length&&incoming.All(o=>o is not null)&&incoming.Select(o=>o.Id).SequenceEqual(original.Select(o=>o.Id)),
            "packet_operation_scope","Keep the accepted operations and their identities. This editor changes instructions and slides only.");
        for(int i=0;i<original.Length;i++){
            var o=incoming![i];var b=original[i];
            Require(Hash(o with{Slides=b.Slides,SlidesOrganized=b.SlidesOrganized,ExcludedSlideIds=b.ExcludedSlideIds,Instructions=b.Instructions})==Hash(b),
                "packet_operation_scope","Only instruction text and slide content may change; keep routing, roles and estimating values unchanged.");
            Require(o.Instructions is not null&&o.Instructions.Length<=4000,"packet_instruction_size","Use instruction text up to 4000 characters.");
        }
        await ValidateJobSlides(wo,r.Generation,baseline,incoming!,s);
    }
    internal Task<object> SavePacketDraft(string wo,SimPacketSave request,SimPersona actor)=>WithPacket(wo,actor,true,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);
        await ValidatePacketOperations(wo,s,r,request.Operations);
        var parent=x.Current?.Id??x.Initial.Id.ToString();
        Require(request.ParentJobId==parent,"packet_parent_changed","The released packet changed. Reopen before saving your draft.");
        var saved=await store.PacketTransaction(async(c,t)=>{
            var head=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));
            Require((head?.Id??x.Initial.Id.ToString())==parent,"packet_parent_changed","The released packet changed. Reopen before saving.");
            var prior=await SimProductionStore.PacketDraft(c,t,wo,r.Generation);
            Require((prior?.Version??0)==request.ExpectedVersion,"packet_draft_changed","Another session saved this draft. Reopen before saving; your local edits have not been published.");
            var consumed=prior is not null&&await SimProductionStore.PacketConsumed(c,t,wo,r.Generation,prior.Version);
            Require(prior is null||consumed||prior.ParentJobId==request.ParentJobId&&prior.ParentMainId==request.ParentMainId,"packet_parent_changed","Keep the saved draft's original release references.");
            // A new draft captures the currently observed main head; it cannot nominate an arbitrary baseline.
            if(prior is null||consumed)Require(request.ParentMainId==x.Main?.Id,"packet_main_changed","The Main Assembly Packet changed. Reopen before saving a new draft.");
            var next=new SimPacketDraft(wo,r.Generation,request.ExpectedVersion+1,parent,request.ParentMainId,x.Identity,request.Operations,actor.Id,actor.DisplayName,UtcNow());
            await SimProductionStore.InsertPacketDraft(c,t,next);return next;
        });
        return (object)new{version=saved.Version,draftVersion=saved.Version,updatedBy=saved.Actor,updatedAt=saved.At,travelerRevision=x.Current?.JobRevision??1};
    });
    private static void PreserveCompletedMaterials(SimProductionSource source,SimLaborOperation[] before,SimLaborOperation[] after){
        if(source.Case is null)return;
        foreach(var op in before){var root=op;var seen=new HashSet<string>();while(root.ParentId is not null&&seen.Add(root.Id))root=before.Single(x=>x.Id==root.ParentId);
            if(root.Name.Trim().Equals("Kitting",StringComparison.OrdinalIgnoreCase)){
                var owner=op.InstructionSourceId is null?op:before.Single(o=>o.Id==op.InstructionSourceId);
                Require(Hash(op)==Hash(after.Single(x=>x.Id==op.Id))&&Hash(owner)==Hash(after.Single(x=>x.Id==owner.Id)),"packet_materials_used",
                    "This work order already has kitting activity. Keep its Materials instructions unchanged, or release the change to the Main Assembly Packet only.");
            }
        }
    }
    internal Task<object> ReleasePacket(string wo,SimPacketPublish request,SimPersona actor)=>WithPacket(wo,actor,true,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);
        Require(Guid.TryParse(request.RequestId,out _)&&request.Scope is "WO_ONLY" or "MAIN_ONLY" or "BOTH"&&!string.IsNullOrWhiteSpace(request.Reason)&&request.Reason.Trim().Length<=1000,
            "packet_release_details","Choose a release scope and enter a change reason of 1 to 1000 characters.");
        var requestHash=Hash(new{request.ExpectedVersion,request.Scope,reason=request.Reason.Trim(),actor.Id});
        var duplicate=await store.ReadPacketRequest(wo,r.Generation,request.RequestId);
        if(duplicate is not null){Require(duplicate.RequestHash==requestHash,"packet_request_reused","This release request was already used for different content.");return (object)duplicate;}
        var x=await PacketContext(wo,s,r);var draft=await store.ReadPacketDraft(wo,r.Generation);
        Require(draft is not null&&draft.Version==request.ExpectedVersion,"packet_draft_changed","Save and review the latest draft before releasing.");
        Require(draft!.Identity==x.Identity,"packet_source_changed","The accepted technical source changed. Review it before release.");
        await ValidatePacketOperations(wo,s,r,draft.Operations);
        var job=request.Scope!="MAIN_ONLY";var main=request.Scope!="WO_ONLY";
        if(job)PreserveCompletedMaterials(s,x.Current?.Operations??x.Initial.Operations,draft.Operations);
        var assets=await CollectPacketAssets(wo,s,r,draft.Operations);
        return (object)await store.PacketTransaction(async(c,t)=>{
            var retry=await SimProductionStore.PacketRequest(c,t,wo,r.Generation,request.RequestId);
            if(retry is not null){Require(retry.RequestHash==requestHash,"packet_request_reused","This release request was already used for different content.");return retry;}
            var latest=await SimProductionStore.PacketDraft(c,t,wo,r.Generation);
            Require(latest?.Version==draft.Version&&!await SimProductionStore.PacketConsumed(c,t,wo,r.Generation,draft.Version),"packet_draft_changed","The draft changed or was already released. Reopen before releasing.");
            var current=await SimProductionStore.PacketHead(c,t,JobPacketKey(wo,r.Generation));var master=await SimProductionStore.PacketHead(c,t,x.Identity.Key);
            Require((current?.Id??x.Initial.Id.ToString())==draft.ParentJobId,"packet_parent_changed","The work order's released packet changed. Review a fresh draft before release.");
            if(main){Require(master?.Id==draft.ParentMainId,"packet_main_changed","The Main Assembly Packet changed after this draft began. Reopen and review it before updating the main packet.");
                Require(master is null||master.Identity.Compatibility==x.Identity.Compatibility,"packet_main_incompatible","The Main Assembly Packet has a different technical baseline. It needs a separate compatibility review before replacement.");}
            if(job){
                await SimProductionStore.RequirePacketUnbound(c,t,wo,r.Generation);await ValidateCase(c,t,s,r);
                Require(Hash(current?.Operations??x.Initial.Operations)!=Hash(draft.Operations)||main,"packet_no_change","This draft does not change the released work-order instructions.");
            }
            var next=new SimInstructionPacket(Guid.NewGuid().ToString(),wo,r.Generation,draft.Version,request.RequestId,requestHash,request.Scope,request.Reason.Trim(),draft.ParentJobId,draft.ParentMainId,
                job?(current?.JobRevision??1)+1:null,main?(master?.MainRevision??0)+1:null,x.Identity,draft.Operations,assets,actor.Id,actor.DisplayName,UtcNow());
            await SimProductionStore.InsertPacket(c,t,next);
            if(job)await SimProductionStore.SetPacketHead(c,t,JobPacketKey(wo,r.Generation),next.Id);
            if(main)await SimProductionStore.SetPacketHead(c,t,x.Identity.Key,next.Id);
            return next;
        });
    });
    internal Task<object> ReadPacketHistory(string wo,SimPersona actor)=>WithPacket(wo,actor,false,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);var x=await PacketContext(wo,s,r);
        return (object)new{initial=x.Initial,effectivePacketId=x.Current?.Id??x.Initial.Id.ToString(),packets=await store.ReadPackets(wo,r.Generation)};
    });
    internal Task<object> ReadMainAssemblyPacket(string wo,SimPersona actor)=>WithPacket(wo,actor,false,async(s,r)=>{
        var identity=await PacketIdentity(s,r.Generation);var main=await store.ReadMainPacket(identity.Key);
        Require(main is not null,"packet_main_missing","No Main Assembly Packet has been released for this customer, assembly and revision.");
        Require(main!.Identity.Compatibility==identity.Compatibility,"packet_main_incompatible","The Main Assembly Packet uses a different technical definition, quantity or source documents. Compatibility review is required.");
        return (object)main;
    });
    internal Task<SimJobInstructionAsset> UploadPacketAsset(string wo,string token,string name,byte[] bytes,SimPersona actor)=>WithPacket(wo,actor,true,async(s,r)=>{
        wo=SimKittingCases.Normalize(wo);await PacketContext(wo,s,r);
        Require(token==Hash(await InstructionBaseline(s)),"packet_source_changed","The accepted baseline changed.");
        Require(bytes.Length is >0 and <=8388608,"instructions_asset_size","Choose an image up to 8 MB.");
        var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
        Require(type!="","instructions_asset_type","Choose PNG or JPEG.");
        var safe=Path.GetFileName(name);var asset=new SimJobInstructionAsset(Guid.NewGuid().ToString(),Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)),safe[..Math.Min(safe.Length,200)],type,bytes);
        await store.AddInstructionAsset(wo,r.Generation,asset);return asset;
    });
    private async Task<SimJobInstructionAsset?> SharedPacketAsset(SimProductionSource source,long gen,string? id,string? hash=null){
        if(id is null)return null;var identity=await PacketIdentity(source,gen);
        var packets=await store.ReadCompatiblePackets(identity);
        var asset=packets.Where(p=>p.WorkOrderNumber==Text(source.Package,"workOrderNumber")||p.MainRevision is not null).SelectMany(p=>p.Assets).FirstOrDefault(a=>a.DocumentId==id&&(hash is null||a.Sha256==hash));
        if(asset is not null)Require(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(asset.Bytes))==asset.Sha256,"packet_asset_integrity","A retained instruction image failed verification.");
        return asset;
    }
    private async Task<SimJobInstructionAsset[]> CollectPacketAssets(string wo,SimProductionSource source,SimStateMetadata r,SimLaborOperation[] operations){
        var refs=operations.SelectMany(o=>o.Slides??[]).SelectMany(c=>c.Stages.SelectMany(s=>s.Photos??[]).Select(p=>(p.DocumentId,p.Sha256)).Concat(c.ImageDocumentId is {} id?new[]{(id,c.ImageSha256!)}:Array.Empty<(string,string)>())).Distinct().ToArray();
        var assets=new List<SimJobInstructionAsset>();
        foreach(var (id,hash) in refs){var asset=await store.InstructionAsset(wo,r.Generation,id)??await SharedPacketAsset(source,r.Generation,id,hash);
            if(asset is null){var bytes=await documents.Bytes(source.SourceCorrelationId,id);asset=new(id,hash,id,bytes.AsSpan().StartsWith(new byte[]{137,80,78,71})?"image/png":"image/jpeg",bytes);}
            Require(asset.Sha256==hash&&Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(asset.Bytes))==hash,"packet_asset_integrity","A retained instruction image failed verification.");assets.Add(asset);}
        return assets.ToArray();
    }
}

internal sealed partial class SimProductionStore : ISimMainPacketReader
{
    internal async Task<T> PacketTransaction<T>(Func<SqliteConnection,SqliteTransaction,Task<T>> action){
        await gate.WaitAsync();try{await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
            await Exec(c,t,"""
                CREATE TABLE IF NOT EXISTS SimInstructionPacketDraft(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,Version INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation,Version));
                CREATE TABLE IF NOT EXISTS SimInstructionPacket(Id TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,DraftVersion INTEGER NOT NULL,RequestId TEXT NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(WorkOrderNumber,Generation,RequestId),UNIQUE(WorkOrderNumber,Generation,DraftVersion));
                CREATE TABLE IF NOT EXISTS SimInstructionPacketHead(PacketKey TEXT PRIMARY KEY,PacketId TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS SimInstructionPacketNoUpdate BEFORE UPDATE ON SimInstructionPacket BEGIN SELECT RAISE(ABORT,'Released instruction packets are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimInstructionPacketNoDelete BEFORE DELETE ON SimInstructionPacket BEGIN SELECT RAISE(ABORT,'Released instruction packets are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimInstructionDraftNoUpdate BEFORE UPDATE ON SimInstructionPacketDraft BEGIN SELECT RAISE(ABORT,'Saved draft versions are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimInstructionDraftNoDelete BEFORE DELETE ON SimInstructionPacketDraft BEGIN SELECT RAISE(ABORT,'Saved draft versions are immutable'); END;
                """);
            var result=await action(c,t);await t.CommitAsync();return result;
        }finally{gate.Release();}
    }
    private async Task<T> PacketRead<T>(Func<SqliteConnection,Task<T>> f){await using var c=Open(false);await c.OpenAsync();return await f(c);}
    public Task<SimInstructionPacket?> ReadMainPacket(string key)=>ReadPacketHead(key);
    internal Task<SimInstructionPacket?> ReadPacketHead(string key)=>PacketRead(c=>PacketHead(c,null,key));
    internal static async Task<SimInstructionPacket?> PacketHead(SqliteConnection c,SqliteTransaction? t,string key){
        if(!await Exists(c,t,"SimInstructionPacketHead"))return null;
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT p.PayloadJson FROM SimInstructionPacket p JOIN SimInstructionPacketHead h ON p.Id=h.PacketId WHERE h.PacketKey=@key";q.Parameters.AddWithValue("@key",key);
        return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimInstructionPacket>(text,Json):null;
    }
    internal Task<SimPacketDraft?> ReadPacketDraft(string wo,long gen)=>PacketRead(c=>PacketDraft(c,null,wo,gen));
    internal static async Task<SimPacketDraft?> PacketDraft(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimInstructionPacketDraft"))return null;await using var q=c.CreateCommand();q.Transaction=t;
        q.CommandText="SELECT PayloadJson FROM SimInstructionPacketDraft WHERE WorkOrderNumber=@wo AND Generation=@gen ORDER BY Version DESC LIMIT 1";q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);
        return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimPacketDraft>(text,Json):null;
    }
    internal Task<bool> PacketDraftConsumed(string wo,long gen,int version)=>PacketRead(c=>PacketConsumed(c,null,wo,gen,version));
    internal static async Task<bool> PacketConsumed(SqliteConnection c,SqliteTransaction? t,string wo,long gen,int version){
        if(!await Exists(c,t,"SimInstructionPacket"))return false;await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT COUNT(*) FROM SimInstructionPacket WHERE WorkOrderNumber=@wo AND Generation=@gen AND DraftVersion=@v";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);q.Parameters.AddWithValue("@v",version);return Convert.ToInt32(await q.ExecuteScalarAsync())>0;
    }
    internal Task<SimInstructionPacket?> ReadPacketRequest(string wo,long gen,string id)=>PacketRead(c=>PacketRequest(c,null,wo,gen,id));
    internal static async Task<SimInstructionPacket?> PacketRequest(SqliteConnection c,SqliteTransaction? t,string wo,long gen,string id){
        if(!await Exists(c,t,"SimInstructionPacket"))return null;await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimInstructionPacket WHERE WorkOrderNumber=@wo AND Generation=@gen AND RequestId=@id";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);q.Parameters.AddWithValue("@id",id);return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimInstructionPacket>(text,Json):null;
    }
    internal Task<SimInstructionPacket[]> ReadPackets(string wo,long gen)=>PacketRead(async c=>{
        if(!await Exists(c,null,"SimInstructionPacket"))return [];return await Many<SimInstructionPacket>(c,null!,"SimInstructionPacket",wo,gen);
    });
    internal Task<SimInstructionPacket[]> ReadCompatiblePackets(SimPacketIdentity identity)=>PacketRead(async c=>{
        if(!await Exists(c,null,"SimInstructionPacket"))return [];await using var q=c.CreateCommand();q.CommandText="SELECT PayloadJson FROM SimInstructionPacket";var found=new List<SimInstructionPacket>();await using var reader=await q.ExecuteReaderAsync();
        while(await reader.ReadAsync()){var p=JsonSerializer.Deserialize<SimInstructionPacket>(reader.GetString(0),Json)!;if(p.Identity.Key==identity.Key&&p.Identity.Compatibility==identity.Compatibility)found.Add(p);}return found.ToArray();
    });
    internal static Task InsertPacketDraft(SqliteConnection c,SqliteTransaction t,SimPacketDraft d)=>Exec(c,t,"INSERT INTO SimInstructionPacketDraft VALUES(@wo,@g,@v,@j)",("@wo",d.WorkOrderNumber),("@g",d.Generation),("@v",d.Version),("@j",JsonSerializer.Serialize(d,Json)));
    internal static Task InsertPacket(SqliteConnection c,SqliteTransaction t,SimInstructionPacket p)=>Exec(c,t,"INSERT INTO SimInstructionPacket VALUES(@id,@wo,@g,@v,@request,@j)",("@id",p.Id),("@wo",p.WorkOrderNumber),("@g",p.Generation),("@v",p.DraftVersion),("@request",p.RequestId),("@j",JsonSerializer.Serialize(p,Json)));
    internal static Task SetPacketHead(SqliteConnection c,SqliteTransaction t,string key,string id)=>Exec(c,t,"INSERT INTO SimInstructionPacketHead VALUES(@key,@id) ON CONFLICT(PacketKey) DO UPDATE SET PacketId=excluded.PacketId",("@key",key),("@id",id));
    internal static async Task RequirePacketUnbound(SqliteConnection c,SqliteTransaction t,string wo,long gen){
        if(await ExecutionExists(c,t,wo))throw KittingCaseProblem.Conflict("packet_execution_exists","This work order has production execution records. Its instructions cannot be replaced here; release to the Main Assembly Packet only.");
        foreach(var table in new[]{"SimTravelerDefinition","SimWoTraveler","SimWoTravelerRevisionHead"})if(await Exists(c,t,table)&&await One<JsonElement?>(c,t,table,wo,gen) is not null)
            throw KittingCaseProblem.Conflict("packet_traveler_exists","This work order already has a reviewed or bound production traveler. Its instructions need an impact review; release to the Main Assembly Packet only.");
    }
}
