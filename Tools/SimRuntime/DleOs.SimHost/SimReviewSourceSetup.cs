using System.Text.Json;

internal sealed record SimReviewSourceChoice(string? DrawingDocumentId,string? DrawingSha256,string? BomDocumentId,string? BomSha256,string Action,string Reviewer,DateTimeOffset AtUtc);
internal sealed record SimReviewSourceSetup(SimReviewSourceChoice Current,SimReviewSourceChoice[] History,string? BuiltCandidateId=null);
internal sealed record SimReviewSourceRequest(string ExpectedToken,string? DrawingDocumentId,string? BomDocumentId,string Action,
    string? ExpectedSourceToken=null,bool ConfirmIdentity=false,string? IdentityReason=null,bool ReplaceCandidate=false);
internal sealed partial class SimRfqIntakeStore
{
    private static bool EditableSources(SimRfqIntakeRecord r)=>r.Environment=="SIM"&&r.IntakeType=="NEW_QUOTE_REQUEST"&&
        r.Status is "TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD"&&r.TechnicalReview?.Workflow is {Outputs:null}&&string.IsNullOrEmpty(r.TechnicalReview.DownstreamHandoffState);
    private static string SourceSetupToken(SimRfqIntakeDataset data,SimRfqIntakeRecord r)=>DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new{r,jobs=data.AnalysisJobs.Where(j=>j.Input.IntakeId==r.IntakeId)},DleAnalysisContract.Json));
    private async Task<(SimRfqIntakeDocument File,byte[] Bytes,string Hash)?> SetupFile(SimRfqIntakeRecord r,string? id,bool drawing)
    {
        if(string.IsNullOrEmpty(id))return null;
        var f=r.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==id&&f.BinaryStatus=="VERIFIED")??throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_FILE","Choose a saved file from this review.");
        if(r.TechnicalReview?.TechnicalPackage?.Documents.Any(d=>d.DocumentId==id&&d.RowAssociation is not null)==true)
            throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_SCOPE","Choose an assembly-level file, not a component attachment.");
        if(drawing?f.Type!="application/pdf":!f.Name.EndsWith(".txt",StringComparison.OrdinalIgnoreCase))
            throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_FORMAT",drawing?"Choose a PDF production drawing. Other drawing formats remain available in the existing review workflow.":"Choose a VPRO5 TXT export. Use the existing workflow for other BOM formats.");
        await documents.Verify(r.RequestCorrelationId,f,f.ReviewOrigin?.AddedBy??r.CreatedBy);
        var bytes=await documents.Bytes(r.RequestCorrelationId,id);return(f,bytes,DleAnalysisContract.Hash(bytes));
    }
    internal async Task<object> ReadReviewSources(string id,string? drawingId,string? bomId)
    {
        var data=await ReadDatasetAsync();var r=data.Records.SingleOrDefault(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r))??throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Review not found.");
        var drawing=await SetupFile(r,drawingId,true);var bom=await SetupFile(r,bomId,false);
        var target=r.Assemblies.Length==1?r.Assemblies[0]:null;
        SimVproSourceIdentity? identity=null;string? problem=null;
        if(bom is {} source){try{identity=SimVproParser.Describe(source.Bytes);}catch(SimRfqIntakeProblem e){problem=e.Message;}}
        var expected=target is null?null:target.AssemblyNumber+" REV "+target.Revision;
        var sourceToken=DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new{drawingId,drawingHash=drawing?.Hash,bomId,bomHash=bom?.Hash,r.Assemblies},DleAnalysisContract.Json));
        return new{token=SourceSetupToken(data,r),sourceToken,canEdit=EditableSources(r),setup=r.ReviewSourceSetup,
            source=identity,sourceProblem=problem,target=expected,sourceMatches=identity is not null&&string.Equals(identity.Drawing,expected,StringComparison.OrdinalIgnoreCase),
            bomSha256=bom?.Hash,candidateId=r.TechnicalReview?.CandidateBom?.Id,accepted=(r.TechnicalReview?.BomAcceptances?.Length??0)>0};
    }
    internal async Task<object> SaveReviewSources(string id,SimReviewSourceRequest request,SimPersona actor)
    {
        await gate.WaitAsync();try{
            var data=await ReadDatasetAsync();var index=data.Records.FindIndex(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r));
            if(index<0)throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Review not found.");
            var r=data.Records[index];var review=r.TechnicalReview!;
            if(!EditableSources(r)||!actor.Can("technical_review.disposition"))throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_READ_ONLY","An editable review and disposition permission are required.");
            if(request.ExpectedToken!=SourceSetupToken(data,r))throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_STALE","The review changed. Reload source status; your choices have not been saved.");
            if(request.Action is not ("SAVE_DRAFT" or "BUILD"))throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_ACTION","Choose Save Draft or Save & Build Candidate.");
            if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==id&&DleAnalysisContract.Active(j.Status)))throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_BUSY","Wait for the current analysis before changing sources.");
            var drawing=await SetupFile(r,request.DrawingDocumentId,true);var bom=await SetupFile(r,request.BomDocumentId,false);var now=DateTimeOffset.UtcNow;
            var choice=new SimReviewSourceChoice(drawing?.File.DocumentId,drawing?.Hash,bom?.File.DocumentId,bom?.Hash,request.Action,actor.DisplayName,now);
            var same=r.ReviewSourceSetup?.Current is {} prior&&prior.DrawingDocumentId==choice.DrawingDocumentId&&prior.DrawingSha256==choice.DrawingSha256&&prior.BomDocumentId==choice.BomDocumentId&&prior.BomSha256==choice.BomSha256;
            var history=(r.ReviewSourceSetup?.History??[]).Append(choice).ToArray();
            var setup=new SimReviewSourceSetup(choice,history,same?r.ReviewSourceSetup?.BuiltCandidateId:null);
            if(request.Action=="BUILD"){
                if(drawing is not {} selectedDrawing||bom is not {} source||r.Assemblies.Length!=1)throw SimRfqIntakeProblem.BadRequest("SIM_SOURCE_REQUIRED","Choose one production PDF and one VPRO5 TXT for this assembly.");
                var target=r.Assemblies[0];var sourceIdentity=SimVproParser.Describe(source.Bytes);
                var sourceToken=DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new{drawingId=request.DrawingDocumentId,drawingHash=drawing?.Hash,bomId=request.BomDocumentId,bomHash=bom?.Hash,r.Assemblies},DleAnalysisContract.Json));
                if(request.ExpectedSourceToken!=sourceToken)throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_CHANGED","Source bytes or job identity changed. Review the source identity again.");
                SimVproIdentityConfirmation? confirmation=null;
                if(!string.Equals(sourceIdentity.Drawing,target.AssemblyNumber+" REV "+target.Revision,StringComparison.OrdinalIgnoreCase)){
                    if(!request.ConfirmIdentity||string.IsNullOrWhiteSpace(request.IdentityReason)||request.IdentityReason.Length>2000)
                        throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_IDENTITY","The source and job identities differ. Review both identities and the source notes, then explicitly confirm applicability with a reason. No candidate was created.");
                    confirmation=new(source.File.DocumentId!,source.Hash,sourceIdentity.Drawing,target.AssemblyNumber,target.Revision,request.IdentityReason.Trim(),actor.DisplayName,now);
                }
                if((review.BomAcceptances?.Length??0)>0)throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_ACCEPTED","An accepted BOM exists. Its sources cannot be replaced through draft setup.");
                var current=review.CandidateBom;
                if(current is not null&&setup.BuiltCandidateId==current.Id)return (await ReadTechnicalReviewAsync(id))!;
                if(current is not null&&!request.ReplaceCandidate)throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_REPLACE","A working candidate already exists. Explicitly confirm replacing it; its prior version will be retained.");
                var presentation=Presentation(r);
                if((presentation.ProductionAcceptances?.Length??0)>0)throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_SLIDES_ACCEPTED","Accepted production slides exist. Keep their source history; use the established revision workflow.");
                if(presentation.TeamDocumentId!=selectedDrawing.File.DocumentId&&(presentation.Slides.Length>0||presentation.ExcludedSlideKeys?.Length>0))throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_ANNOTATIONS","Saved drawing annotations exist. Change the drawing deliberately in its existing reference workflow first.");
                var candidate=SimVproParser.Parse(source.Bytes,source.File.DocumentId!,target.AssemblyNumber,target.Revision,actor.DisplayName,confirmation);
                var draft=presentation with{TeamDocumentId=selectedDrawing.File.DocumentId,RenditionDocumentId=null,Revision=presentation.Revision+1,UpdatedBy=actor.DisplayName,UpdatedAtUtc=now};
                review=review with{CandidateBom=candidate,CandidateBomVersions=current is null?review.CandidateBomVersions:(review.CandidateBomVersions??[]).Append(current).ToArray(),PresentationDraft=draft,
                    Workflow=review.Workflow! with{HoldReason=null,Events=(review.Workflow!.Events??[]).Append(new("SOURCE_CANDIDATE_BUILT","Explicit production drawing and VPRO TXT; no acceptance or release",actor.DisplayName,now)).ToArray()},
                    MaterialsReviewStatus="IN_PROGRESS",ReviewStatus="TECHNICAL_REVIEW_IN_PROGRESS"};
                r=r with{Status="TECHNICAL_REVIEW_IN_PROGRESS",TechnicalReview=review};setup=setup with{BuiltCandidateId=candidate.Id};
            }
            data.Records[index]=r with{ReviewSourceSetup=setup};data.UpdatedAtUtc=now;await WriteVerifiedAsync(data);
        }finally{gate.Release();}
        return (await ReadTechnicalReviewAsync(id))!;
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapReviewSourceSetup(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Guard(HttpContext c,bool write,Func<Task<object>> action){var denied=DeniedTechnicalReview(c,state,personas,write?"technical_review.disposition":"technical_review.view");if(denied is not null)return denied;
            c.Response.Headers["Cache-Control"]="private, no-store";try{return Results.Json(await action());}catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}catch(Exception e)when(e is IOException or UnauthorizedAccessException){return Results.Json(new{message="Saved source storage is unavailable. Your source files and review have not been replaced."},statusCode:503);}}
        app.MapGet("/api/sim/technical-reviews/{id}/source-setup",(string id,string? drawingId,string? bomId,HttpContext c)=>Guard(c,false,()=>store.ReadReviewSources(id,drawingId,bomId)));
        app.MapPost("/api/sim/technical-reviews/{id}/source-setup",(string id,SimReviewSourceRequest request,HttpContext c)=>Guard(c,true,()=>store.SaveReviewSources(id,request,personas.Resolve(c))));
    }
}
