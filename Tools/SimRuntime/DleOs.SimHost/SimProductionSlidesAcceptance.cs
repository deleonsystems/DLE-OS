using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal sealed record SimProductionSlidesAcceptance(string Id,int Revision,string Fingerprint,string AcceptedBy,DateTimeOffset AcceptedAtUtc);
internal sealed record SimProductionSlidesAcceptanceRequest(int ExpectedRevision,string ExpectedFingerprint);
internal sealed record SimProductionSlidesState(int Revision,string Fingerprint,bool CanAccept,bool Ready,string Message,SimProductionSlidesAcceptance? Acceptance);

internal sealed partial class SimRfqIntakeStore
{
    // This fingerprints the saved input to the existing shared viewer; it does not create another deck.
    internal async Task<SimProductionSlidesState> ProductionSlidesState(SimRfqIntakeRecord record)
    {
        var draft=Presentation(record);var accepted=draft.ProductionAcceptances?.LastOrDefault();
        SimProductionSlidesState Blocked(string message)=>new(draft.Revision,"",false,false,message,accepted);
        if(record.TechnicalReview?.CandidateBom?.PreparationGroups?.Length>0)return Blocked(SimPreparation.Pending);
        if(record.Environment!="SIM")return Blocked("Production slide acceptance is available in SIM only.");
        if(record.Status=="ON_HOLD"||!string.IsNullOrWhiteSpace(record.TechnicalReview?.Workflow?.HoldReason))return Blocked("Resolve the Technical Review hold before accepting production slides.");
        if(draft.Revision<1)return Blocked("Save the draft slides before accepting them.");
        if(record.TechnicalReview?.CandidateBom?.Rows.Length is not >0)return Blocked("Save the BOM rows before accepting the production slides.");
        if(draft.TeamDocumentId is null)return Blocked("Select and save a reference before accepting the production slides.");
        var sourceId=draft.RenditionDocumentId??draft.TeamDocumentId;
        var sources=new List<object>();
        try
        {
            foreach(var id in new[]{draft.TeamDocumentId,sourceId}.Distinct())
            {
                var file=record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==id&&f.BinaryStatus=="VERIFIED");
                if(file is null)return Blocked("A selected source file is unavailable. Refresh the saved sources before accepting.");
                await documents.VerifyPresentationSource(record.RequestCorrelationId,file);
                var bytes=await documents.Bytes(record.RequestCorrelationId,id);
                int? pageCount=null;
                if(id==sourceId)
                {
                    if(file.Type!="application/pdf")return Blocked("Prepare a readable PDF rendition before accepting the production slides.");
                    pageCount=await SimPdfPagePreview.Count(bytes);
                    if(pageCount<1)return Blocked("The selected reference has no readable pages.");
                }
                sources.Add(new{file.DocumentId,file.Name,file.Type,Sha256=Convert.ToHexString(SHA256.HashData(bytes)),PageCount=pageCount});
            }
        }
        catch(Exception error) when(error is IOException or SimRfqIntakeProblem or UnauthorizedAccessException)
        {return Blocked("The selected source bytes cannot be verified. Refresh the saved sources before accepting.");}
        var content=new{
            Schema="TECHNICAL_REVIEW_PRODUCTION_SLIDES_V1",
            Traveler=new{record.Customer.CustomerName,record.Assemblies},
            BomToken=ReviewBomToken(record),
            Draft=new{draft.TeamDocumentId,draft.RenditionDocumentId,draft.ReferenceStatus,draft.Slides,draft.SlideOrder,draft.ExcludedSlideKeys},
            Sources=sources
        };
        JsonNode? Canonical(JsonNode? node)=>node switch{
            JsonObject value=>new JsonObject(value.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>KeyValuePair.Create(p.Key,Canonical(p.Value)))),
            JsonArray value=>new JsonArray(value.Select(Canonical).ToArray()),
            _=>node?.DeepClone()
        };
        var fingerprint=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(JsonSerializer.SerializeToNode(content,DleAnalysisContract.Json))!.ToJsonString())));
        var current=accepted is not null&&accepted.Revision==draft.Revision&&accepted.Fingerprint==fingerprint;
        return new(draft.Revision,fingerprint,true,current,current?"Production slides accepted. Production release remains separate.":accepted is null?"Saved production slides require acceptance.":"Production slides changed after acceptance. Review and accept the current saved deck.",accepted);
    }

    internal async Task RequireProductionSlidesAccepted(SimRfqIntakeRecord record)
    {
        var state=await ProductionSlidesState(record);
        if(!state.Ready)throw SimRfqIntakeProblem.Conflict("SIM_PRODUCTION_SLIDES_REQUIRED",state.Message);
    }

    internal async Task<object> AcceptProductionSlides(string id,SimProductionSlidesAcceptanceRequest request,SimPersona actor)
    {
        await gate.WaitAsync();
        try
        {
            var data=await ReadDatasetAsync();var index=data.Records.FindIndex(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r));
            if(index<0)throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review not found.");
            var record=data.Records[index];
            if(record.Environment!="SIM"||record.Status!="TECHNICAL_REVIEW_IN_PROGRESS"||record.TechnicalReview?.Workflow is not {Outputs:null}||!string.IsNullOrEmpty(record.TechnicalReview.DownstreamHandoffState))
                throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_READ_ONLY","This review is no longer editable.");
            var draft=Presentation(record);var state=await ProductionSlidesState(record);
            if(request.ExpectedRevision!=draft.Revision||string.IsNullOrWhiteSpace(request.ExpectedFingerprint)||request.ExpectedFingerprint!=state.Fingerprint)
                throw SimRfqIntakeProblem.Conflict("SIM_PRODUCTION_SLIDES_CHANGED","The saved deck or its sources changed. Reopen and review the current slides before accepting.");
            if(!state.CanAccept)throw SimRfqIntakeProblem.Conflict("SIM_PRODUCTION_SLIDES_REQUIRED",state.Message);
            if(!state.Ready)
            {
                var now=DateTimeOffset.UtcNow;
                var acceptance=new SimProductionSlidesAcceptance(Guid.NewGuid().ToString("D"),draft.Revision,state.Fingerprint,actor.DisplayName,now);
                data.Records[index]=record with{TechnicalReview=record.TechnicalReview with{PresentationDraft=draft with{ProductionAcceptances=(draft.ProductionAcceptances??[]).Append(acceptance).ToArray()}}};
                data.UpdatedAtUtc=now;await WriteVerifiedAsync(data);
            }
        }
        finally{gate.Release();}
        return await ReadPresentation(id);
    }
}

internal sealed partial class SimIntakeDocuments
{
    internal async Task VerifyPresentationSource(string correlation,SimRfqIntakeDocument requested)
    {
        // A generated rendition may have been staged by a different authorized reviewer.
        var manifest=await ReadManifest(correlation,requested.DocumentId!);
        await Verify(correlation,requested,manifest.Owner);
        if(manifest.Document.DocumentId!=requested.DocumentId||manifest.Document.Type!=requested.Type||manifest.Document.DocumentReference!=requested.DocumentReference||requested.BinaryStatus!="VERIFIED")
            throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_VERIFICATION_FAILED","The selected source metadata changed. Reopen the saved reference.");
    }
}