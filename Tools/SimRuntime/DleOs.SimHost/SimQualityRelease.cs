using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

internal sealed record SimQualityReleaseRequest(string ReviewToken);
internal sealed record SimQualityRelease(Guid Id,string WorkOrderNumber,long Generation,string ReviewToken,
    string RequirementsHash,int InstructionVersion,string BaselineToken,string ContentHash,SimLaborOperation[] Operations,
    string ActorId,string Actor,DateTimeOffset At,JsonElement References);
internal sealed partial class SimProductionService
{
    private async Task<(string Token,int Version,string BaselineToken,SimLaborOperation[] Operations,JsonElement References)> QualityReview(
        string wo,SimStateMetadata runtime,SimKittingReleasedRequirements requirements,SimProductionSource source)
    {
        var baseline=await InstructionBaseline(source);var baselineToken=Hash(baseline);
        var saved=await store.ReadInstructions(wo,runtime.Generation);
        Require(saved is null||saved.BaselineToken==baselineToken,"instructions_baseline_changed","The saved instructions need baseline review.");
        var ops=saved?.Operations??InstructionOperations(baseline);
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(requirements.Lineage.GetProperty("source").GetProperty("intakeId").GetString()!))!;
        var po=new List<object>();
        foreach(var evidence in record.OrderEntry!.Acceptance.Package.PoEvidence){
            var bytes=await documents.Bytes(record.RequestCorrelationId,evidence.Document.DocumentId!);
            var hash=Convert.ToHexString(SHA256.HashData(bytes));
            Require(string.Equals(hash,evidence.Sha256,StringComparison.OrdinalIgnoreCase),"quality_po_integrity","The accepted PO attachment failed verification.");
            po.Add(new{evidence.Document.DocumentId,evidence.Document.Name,sha256=hash});
        }
        var references=JsonSerializer.SerializeToElement(new{requirements.Lineage,source=source.Package.GetProperty("source"),
            purchaseOrderDocuments=po,baselineToken,instructionVersion=saved?.Version??0,contentHash=Hash(ops)},Json);
        // Source contains the release stamp after approval. Exclude that stamp from the original review fingerprint.
        var node=System.Text.Json.Nodes.JsonNode.Parse(references.GetRawText())!.AsObject();
        node["source"]?.AsObject().Remove("qualityRelease");
        references=JsonSerializer.SerializeToElement(node,Json);
        return(Hash(references),saved?.Version??0,baselineToken,ops,references);
    }
    internal Task<object> ReadQualityReview(string wo,SimPersona actor)=>state.WithStableRuntime(async runtime=>{
        Permission(actor,false);if(!actor.Can("order_entry.view"))throw new SimOrderEntryPermissionException();wo=SimKittingCases.Normalize(wo);
        return await provider.WithPacketAuthoringRequirements<object>(wo,runtime,async requirements=>{
            var source=await Source(wo,runtime,requirements);var review=await QualityReview(wo,runtime,requirements,source);
            var released=requirements.QualityRelease;
            var ownership=await store.Read(wo,runtime.Generation);
            return new{reviewToken=review.Token,instructionVersion=review.Version,baselineToken=review.BaselineToken,contentHash=Hash(review.Operations),
                canApprove=actor.Can("production.manage")&&released is null&&source.Case is null&&ownership.Definition is null&&ownership.Bound is null&&!ownership.Execution,
                release=released is null?null:ReleaseEvidence(released)};
        });
    });
    private static object ReleaseEvidence(SimQualityRelease r)=>new{r.Id,r.WorkOrderNumber,r.Generation,r.ReviewToken,r.InstructionVersion,r.BaselineToken,r.ContentHash,r.ActorId,r.Actor,r.At,r.References};
    internal Task<object> ApproveQualityRelease(string wo,SimQualityReleaseRequest request,SimPersona actor)=>state.WithStableRuntime(async runtime=>{
        Permission(actor,true);if(!actor.Can("order_entry.view"))throw new SimOrderEntryPermissionException();wo=SimKittingCases.Normalize(wo);
        return await provider.WithPacketAuthoringRequirements<object>(wo,runtime,async requirements=>{
            if(requirements.QualityRelease is {} prior){
                Require(prior.ReviewToken==request.ReviewToken,"quality_release_conflict","This job was already released against another review.");
                return ReleaseEvidence(prior);
            }
            var source=await Source(wo,runtime,requirements);var review=await QualityReview(wo,runtime,requirements,source);
            Require(!string.IsNullOrWhiteSpace(request.ReviewToken)&&request.ReviewToken==review.Token,"quality_review_changed","The reviewed packet changed. Reopen and review its current saved version before approving.");
            var ownership=await store.Read(wo,runtime.Generation);
            Require(source.Case is null&&ownership.Definition is null&&ownership.Bound is null&&!ownership.Execution,
                "quality_activity_exists","This job already has downstream activity. Resolve it before release.");
            await ValidateJobSlides(wo,runtime.Generation,await InstructionBaseline(source),review.Operations,source);
            var release=new SimQualityRelease(Guid.NewGuid(),wo,runtime.Generation,review.Token,Hash(requirements.Lineage),review.Version,
                review.BaselineToken,Hash(review.Operations),review.Operations,actor.Id,actor.DisplayName,UtcNow(),review.References);
            return ReleaseEvidence(await store.SaveQualityRelease(release));
        });
    });
    internal Task<object> ReadQualityQueue(string wo,SimPersona actor)=>state.WithStableRuntime(async runtime=>{
        if(!actor.Can("kitting.view"))throw new SimOrderEntryPermissionException();wo=SimKittingCases.Normalize(wo);
        return await provider.WithPacketAuthoringRequirements<object>(wo,runtime,async r=>{
            var c=await operations.ReadSimKittingCase(wo,runtime);
            return new{workOrderNumber=wo,awaitingQualityRelease=r.QualityRelease is null,
                materialStatus=c?.State??"NEEDS_KITTING",header=r.Draft.GetProperty("header"),
                release=r.QualityRelease is {} qr?ReleaseEvidence(qr):null};
        });
    });
}
internal sealed partial class SimProductionStore
{
    internal async Task<SimQualityRelease?> ReadQualityRelease(string wo,long gen){
        await using var c=Open(false);await c.OpenAsync();return await QualityRelease(c,null,wo,gen);
    }
    private static async Task<SimQualityRelease?> QualityRelease(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimQualityRelease"))return null;
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimQualityRelease WHERE WorkOrderNumber=@wo AND Generation=@gen";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);
        return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimQualityRelease>(text,Json):null;
    }
    internal async Task<SimQualityRelease> SaveQualityRelease(SimQualityRelease release){
        await gate.WaitAsync();try{await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
            var prior=await QualityRelease(c,t,release.WorkOrderNumber,release.Generation);
            if(prior is not null){if(prior.ReviewToken!=release.ReviewToken)throw KittingCaseProblem.Conflict("quality_release_conflict","A different packet was already released.");return prior;}
            var latest=await Instructions(c,t,release.WorkOrderNumber,release.Generation);
            if((latest?.Version??0)!=release.InstructionVersion)throw KittingCaseProblem.Conflict("quality_review_changed","Instructions changed during review.");
            await Exec(c,t,"CREATE TABLE IF NOT EXISTS SimQualityRelease(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation))");
            await Exec(c,t,"CREATE TRIGGER IF NOT EXISTS SimQualityReleaseNoUpdate BEFORE UPDATE ON SimQualityRelease BEGIN SELECT RAISE(ABORT,'Quality releases are immutable'); END; CREATE TRIGGER IF NOT EXISTS SimQualityReleaseNoDelete BEFORE DELETE ON SimQualityRelease BEGIN SELECT RAISE(ABORT,'Quality releases are immutable'); END;");
            await Exec(c,t,"INSERT INTO SimQualityRelease VALUES(@wo,@gen,@json)",("@wo",release.WorkOrderNumber),("@gen",release.Generation),("@json",JsonSerializer.Serialize(release,Json)));
            await t.CommitAsync();return release;
        }finally{gate.Release();}
    }
}
