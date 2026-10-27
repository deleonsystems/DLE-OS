using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimReviewSlide(string Id,string Kind,string SourceToken,string? DocumentId,int Page,string Title,string Body,SimLaborSlideStage Stage);
internal sealed record SimReviewPresentation(int Revision,string? TeamDocumentId,string? RenditionDocumentId,string ReferenceStatus,SimReviewSlide[] Slides,string? UpdatedBy=null,DateTimeOffset? UpdatedAtUtc=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? SlideOrder=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? ExcludedSlideKeys=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimProductionSlidesAcceptance[]? ProductionAcceptances=null);
internal sealed record SimReviewPresentationRequest(int ExpectedRevision,string ExpectedBomToken,SimReviewPresentation Draft);
internal sealed partial class SimRfqIntakeStore
{
    private static string ReviewBomToken(SimRfqIntakeRecord r) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new{r.Assemblies,BomId=r.TechnicalReview?.CandidateBom?.Id,Rows=r.TechnicalReview?.CandidateBom?.Rows.Select(row=>new{row.RowId,row.Values,row.ComponentType,row.ReviewState.Reviewed,Primary=row.PrimaryIdentity?.PartNumber,Assembly=row.AssemblyIdentity?.PartNumber,Confirmed=row.ManufacturerIdentity?.Proposals.Where(p=>row.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED").Select(p=>p.PartNumber)})},DleAnalysisContract.Json)));
    private static SimReviewPresentation Presentation(SimRfqIntakeRecord r)=>r.TechnicalReview?.PresentationDraft??new(0,null,null,"UNKNOWN",[]);
    internal async Task<object> ReadPresentation(string id)
    {
        var r=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r))??throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review not found.");
        var draft=Presentation(r);var sourceId=draft.RenditionDocumentId??draft.TeamDocumentId;
        object? reference=null;string? warning=null;
        if(sourceId is not null){var file=r.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==sourceId);
            if(file?.Type=="application/pdf") {try{var doc=await OpenDocument(id,sourceId);var hash=Convert.ToHexString(SHA256.HashData(doc.Bytes));reference=new{documentId=sourceId,name=file.Name,sha256=hash,pageCount=await SimPdfPagePreview.Count(doc.Bytes),token=sourceId+":"+hash};}catch(Exception e) when(e is IOException or SimRfqIntakeProblem){warning="PDF pages are unavailable. Original files and saved annotations are retained.";}}
            else warning="Add a PDF rendition using Add Technical Document, then select it below. The original Word/reference document stays unchanged.";
        }
        else warning="Select the team drawing or reference first.";
        return new{record=r,draft,bomToken=ReviewBomToken(r),reference,warning,productionSlides=await ProductionSlidesState(r)};
    }
    internal async Task<object> SavePresentation(string id,SimReviewPresentationRequest request,SimPersona actor)
    {
        await gate.WaitAsync();try{
            var data=await ReadDatasetAsync();var index=data.Records.FindIndex(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r));
            if(index<0)throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review not found.");
            var r=data.Records[index];if(r.Environment!="SIM"||r.Status is not ("TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD")||r.TechnicalReview?.Workflow is not {Outputs:null}||!string.IsNullOrEmpty(r.TechnicalReview.DownstreamHandoffState))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_READ_ONLY","This review is no longer editable.");
            var old=Presentation(r);var d=request.Draft;
            if(old.Revision!=request.ExpectedRevision||request.ExpectedBomToken!=ReviewBomToken(r))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_CHANGED","The saved draft or BOM changed. Reopen the draft before saving. Your current edits are retained.");
            bool Has(string? doc)=>doc is null||r.TechnicalFiles.Any(f=>f.DocumentId==doc);
            if(!Has(d.TeamDocumentId)||!Has(d.RenditionDocumentId)||d.RenditionDocumentId is not null&&(d.TeamDocumentId is null||!r.TechnicalFiles.Any(f=>f.DocumentId==d.RenditionDocumentId&&f.Type=="application/pdf"))||d.ReferenceStatus is not ("UNKNOWN" or "PRELIMINARY" or "CUSTOMER_RELEASED"))throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_REFERENCE","Choose files from this request and an explicit reference status. A rendition must be a PDF.");
            if(d.Slides is null||d.Slides.Length>100||d.Slides.Select(s=>s.Id).Distinct().Count()!=d.Slides.Length||old.Slides.Any(s=>!d.Slides.Any(n=>n.Id==s.Id)))throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_SLIDES","Retain existing draft slides; use up to 100 unique slides.");
            // Layout and visibility are separate from immutable source-bound annotation identities.
            // Older clients omit these fields; their saves must retain the existing presentation.
            var order=d.SlideOrder??old.SlideOrder;
            var excluded=d.ExcludedSlideKeys??old.ExcludedSlideKeys;
            bool Page(string value)=>int.TryParse(value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out var page)&&page is >=1 and <=500&&value==page.ToString(System.Globalization.CultureInfo.InvariantCulture);
            bool ValidKey(string key,bool includeRequired,string[]? retained){
                var parts=key.Split(':');
                if(parts.Length==2&&parts[0]=="TRAVELER")return includeRequired&&parts[1]=="1";
                if(parts.Length==2&&parts[0]=="BOM")return includeRequired&&Page(parts[1]);
                if(parts.Length==2&&parts[0]=="NOTE")return Guid.TryParseExact(parts[1],"D",out _)&&d.Slides.Any(s=>s.Kind=="NOTE"&&s.Id==parts[1]);
                if(parts.Length==3&&parts[0]=="REFERENCE"&&Guid.TryParseExact(parts[1],"D",out _)&&Page(parts[2]))
                    return r.TechnicalFiles.Any(f=>f.DocumentId==parts[1]&&f.Type=="application/pdf")||(retained?.Contains(key)==true);
                return false;
            }
            bool ValidKeys(string[]? keys,bool includeRequired,string[]? retained)=>keys is null||
                keys.Length<=1100&&!keys.Any(key=>string.IsNullOrWhiteSpace(key)||key.Length>100)&&keys.Distinct().Count()==keys.Length&&keys.All(key=>ValidKey(key,includeRequired,retained));
            if(!ValidKeys(order,true,old.SlideOrder))
                throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_ORDER","Use unique draft slide positions tied to this request's pages and instruction slides.");
            if(!ValidKeys(excluded,false,old.ExcludedSlideKeys))
                throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_EXCLUSIONS","Only reference pages and instruction slides from this request can be removed from the draft slideshow. Traveler and BOM pages are required.");
            foreach(var s in d.Slides){
                if(!Guid.TryParseExact(s.Id,"D",out _)||s.Kind is not ("NOTE" or "REFERENCE" or "BOM")||s.Page is <1 or >500||s.Title is null||s.Title.Length>100||s.Body is null||s.Body.Length>4000||s.Stage is null||s.Stage.Marks is null||s.Stage.SavedView is null||s.Stage.Photos?.Length>0||s.Stage.Name is null||s.Stage.Name.Length>100)throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_SLIDE","Invalid draft slide.");
                var previous=old.Slides.SingleOrDefault(x=>x.Id==s.Id);
                if(previous is not null&&(previous.Kind!=s.Kind||previous.SourceToken!=s.SourceToken||previous.DocumentId!=s.DocumentId||previous.Page!=s.Page))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_SOURCE","A saved annotation cannot move to another source. Preserve it and create a new annotation.");
                if(s.Kind=="BOM"&&previous is null&&s.SourceToken!=ReviewBomToken(r))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_SOURCE","BOM changed. Reopen preview.");
                if(s.Kind=="REFERENCE"&&previous is null){if(s.DocumentId!=(d.RenditionDocumentId??d.TeamDocumentId))throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_SOURCE","Select this reference first.");var doc=await OpenDocument(id,s.DocumentId!);if(doc.Document.Type!="application/pdf"||s.SourceToken!=s.DocumentId+":"+Convert.ToHexString(SHA256.HashData(doc.Bytes))||s.Page>await SimPdfPagePreview.Count(doc.Bytes))throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_SOURCE","Reference page changed or is unavailable.");}
                ValidateDrawingNotes(s.Stage.Marks,s.Stage.SavedView);
                if(s.Stage.SavedView.Page!=s.Page||s.Stage.Marks.Any(m=>m.Page!=s.Page))throw SimRfqIntakeProblem.BadRequest("SIM_DRAFT_PAGE","Annotations must stay on their source page.");
            }
            var now=DateTimeOffset.UtcNow;data.Records[index]=r with{TechnicalReview=r.TechnicalReview with{PresentationDraft=d with{ProductionAcceptances=old.ProductionAcceptances,SlideOrder=order,ExcludedSlideKeys=excluded,Revision=old.Revision+1,UpdatedBy=actor.DisplayName,UpdatedAtUtc=now}}};data.UpdatedAtUtc=now;await WriteVerifiedAsync(data);
        }finally{gate.Release();}
        return await ReadPresentation(id);
    }
}
