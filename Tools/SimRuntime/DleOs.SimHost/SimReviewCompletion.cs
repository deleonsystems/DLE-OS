using System.Text.Json;

internal sealed record SimReviewCompletionState(bool Ready,string Message,string[] Blockers,string SubmissionToken,
    SimProductionSlidesState Slides,int? BomVersion,SimReviewRequirement[] Requirements,bool PackageAcceptanceRequired,
    bool EngineeringReference,bool BomAccepted,bool SlidesAccepted);

internal sealed partial class SimRfqIntakeStore
{
    private async Task<SimReviewCompletionState> ReviewCompletionState(SimRfqIntakeRecord record,SimRfqIntakeDataset dataset)
    {
        var requirements=new List<SimReviewRequirement>();
        void Add(string code,string message,string action)=>requirements.Add(new(code,message,action));
        var review=record.TechnicalReview;var workflow=review?.Workflow;
        if(review?.CandidateBom?.PreparationGroups?.Length>0)Add("SIM_PREPARATION_PENDING",SimPreparation.Pending,"ACCEPT_BOM");
        var engineering=await EngineeringPackageState(record);
        if(record.Environment!="SIM"||record.IntakeType!="NEW_QUOTE_REQUEST")Add("REVIEW_SCOPE","Use a SIM quotation request.","REVIEW_DOCUMENTS");
        if(record.Status!="TECHNICAL_REVIEW_IN_PROGRESS")Add("REVIEW_STATE",record.Status=="ON_HOLD"?"Resume Technical Review.":"Start Technical Review.","RESUME_REVIEW");
        if(workflow is null)Add("REVIEW_REQUIRED","Start Technical Review.","RESUME_REVIEW");
        else
        {
            if(workflow.Outputs is not null||!string.IsNullOrEmpty(review!.DownstreamHandoffState))Add("REVIEW_CLOSED","This review has already been submitted.","REVIEW_DOCUMENTS");
            if(workflow.HoldReason is not null)Add("REVIEW_HELD","Resolve the package hold: "+workflow.HoldReason,"RESUME_REVIEW");
            if(!engineering.Applicable)
            {
                if(!workflow.PackageConfirmed||!workflow.Sufficient)Add("PACKAGE_REVIEW","Confirm the technical package is sufficient for RFQ.","REVIEW_DOCUMENTS");
                if(workflow.Version!=UnifiedPackageVersion&&!workflow.HistoryReviewed)Add("ASSEMBLY_CONTEXT","Review the assembly context.","REVIEW_DOCUMENTS");
                if(workflow.Manufacturing is null)Add("PRODUCTION_REFERENCE","Select and accept the Main Production Drawing.","REVIEW_DOCUMENTS");
            }
        }
        var package=review?.TechnicalPackage;
        if(engineering.Applicable)
        {
            requirements.AddRange(engineering.Requirements);
            if(!engineering.Accepted)Add("RFQ_PACKAGE_CONFIRMATION","Confirm the package is sufficient for this RFQ.","CONFIRM_RFQ_PACKAGE");
        }
        else if(package is null)Add("PACKAGE_REQUIRED","Review the received technical package.","REVIEW_DOCUMENTS");
        else
        {
            var received=SimTechnicalPackageProvider.Inventory(record).Documents;
            if(package.Documents.Length!=received.Length||package.Documents.Select(d=>d.DocumentId).Distinct().Count()!=received.Length||
                received.Any(file=>!package.Documents.Any(d=>d.DocumentId==file.DocumentId&&d.Name==file.Name)))
                Add("DOCUMENT_INVENTORY","Review the added or changed documents.","REVIEW_DOCUMENTS");
            foreach(var doc in package.Documents.Where(d=>d.RowAssociation is null&&d.DocumentType=="UNKNOWN"))Add("DOCUMENT_IDENTITY","Review document identity: "+doc.Name+".","REVIEW_DOCUMENTS");
            if(package.Documents.Any(d=>d.IdentityReview is not null||d.PartNumberReview is not null))
                try{SimTechnicalPackageProvider.RequirePartNumberReview(package.Documents);}catch(SimRfqIntakeProblem e){Add("DOCUMENT_PART_NUMBERS",e.Message,"REVIEW_DOCUMENTS");}
        }
        if(dataset.AnalysisJobs.Any(j=>j.Input.IntakeId==record.IntakeId&&DleAnalysisContract.Active(j.Status)))Add("ANALYSIS_ACTIVE","Wait for BOM analysis to finish.","WAIT_ANALYSIS");
        var accepted=review?.BomAcceptances?.LastOrDefault(a=>a.Candidate.Id==review.CandidateBom?.Id);
        var bomAccepted=review?.MaterialsReviewStatus=="QUALIFIED"&&accepted is not null;
        if(!bomAccepted)Add("BOM_ACCEPTANCE","Accept the current saved BOM.","ACCEPT_BOM");
        if(accepted is not null)
        {
            try
            {
                if(accepted.Candidate.ManualDraft is not null)await RequireCurrentManualAcceptance(record,accepted);
                else
                {
                    if(package is null||!(workflow?.Version==UnifiedPackageVersion?SameMaterialPackage(accepted.Package,package):
                        JsonSerializer.Serialize(accepted.Package.Documents,jsonOptions)==JsonSerializer.Serialize(package.Documents,jsonOptions))||
                        accepted.Package.GoverningBomDocumentId!=package.GoverningBomDocumentId)
                        throw SimRfqIntakeProblem.Conflict("SIM_DEFINITIONS_REQUIRED","The accepted BOM's source package changed. Review the current BOM.");
                    var sources=await AnalysisDocuments(record,accepted.Candidate.Analysis?.SourceSnapshot.SourceSelectionVersion);
                    RequireCurrentScanCandidate(record,accepted.Candidate);
                    if(accepted.Candidate.Analysis is {} analysis&&!SameAnalysisSources(analysis.SourceSnapshot,record,sources))
                        throw SimRfqIntakeProblem.Conflict("SIM_BOM_SOURCE_CHANGED","The accepted BOM sources changed. Review the current BOM.");
                }
            }catch(SimRfqIntakeProblem e){bomAccepted=false;Add("BOM_CHANGED",e.Message,"ACCEPT_BOM");}
            catch(Exception e) when(e is IOException or UnauthorizedAccessException)
            {bomAccepted=false;Add("BOM_SOURCE_UNAVAILABLE","Restore or verify the accepted BOM's source files.","REVIEW_DOCUMENTS");}
        }
        if(!engineering.Applicable&&workflow?.Manufacturing is {} manufacturing)
        {
            foreach(var id in new[]{manufacturing.GoverningDocumentId}.Concat(manufacturing.SupportingDocumentIds).Concat(manufacturing.SubassemblyDocumentIds).Concat(manufacturing.TechnicalDocumentIds).Distinct())
            {
                try
                {
                    var file=record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==id&&f.BinaryStatus=="VERIFIED")
                        ??throw SimRfqIntakeProblem.Conflict("SIM_MANUFACTURING_BINARY","A required manufacturing reference is unavailable.");
                    await documents.VerifyPresentationSource(record.RequestCorrelationId,file);
                }catch(Exception e) when(e is IOException or SimRfqIntakeProblem or UnauthorizedAccessException)
                {Add("PRODUCTION_SOURCE_UNAVAILABLE","Restore or verify the required production reference.","REVIEW_DOCUMENTS");}
            }
        }
        var slides=await ProductionSlidesState(record);
        if(!slides.Ready)Add("SLIDE_ACCEPTANCE",slides.Acceptance is null?"Accept the saved production slides.":"Review and accept the changed production slides.","ACCEPT_SLIDES");
        var distinct=requirements.Distinct().ToArray();var blockers=distinct.Select(r=>r.Message).Distinct().ToArray();
        var token=DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new{Review=PackageReviewToken(record),slides.Fingerprint,BomVersion=accepted?.Version,EngineeringFingerprint=engineering.Fingerprint},DleAnalysisContract.Json));
        return new(distinct.Length==0,string.Join(" ",blockers),blockers,token,slides,accepted?.Version,distinct,
            engineering.Applicable&&!engineering.Accepted,engineering.Applicable,bomAccepted,slides.Ready);
    }
}
