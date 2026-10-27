using System.Text.Json;

internal sealed record SimRfqPackageAcceptance(string Fingerprint,string ReferenceDocumentId,string? RenditionDocumentId,
    string ReferenceStatus,string Reviewer,DateTimeOffset AtUtc,string Scope="RFQ_PREPARATION");
internal sealed record SimReviewRequirement(string Code,string Message,string Action);
internal sealed record SimEngineeringPackageState(bool Applicable,bool Accepted,string Fingerprint,SimReviewRequirement[] Requirements);

internal sealed partial class SimRfqIntakeStore
{
    internal static bool EngineeringReference(SimRfqIntakeRecord record)=>record.TechnicalReview?.PresentationDraft?.ReferenceStatus=="PRELIMINARY";
    internal static bool RfqOnlyDefinition(SimManufacturingDefinition? definition)=>definition?.Scope=="RFQ_PREPARATION";

    private async Task<SimEngineeringPackageState> EngineeringPackageState(SimRfqIntakeRecord record)
    {
        if(!EngineeringReference(record))return new(false,false,"",[]);
        var requirements=new List<SimReviewRequirement>();
        void Add(string code,string message,string action)=>requirements.Add(new(code,message,action));
        var review=record.TechnicalReview!;var draft=review.PresentationDraft!;var package=review.TechnicalPackage;
        var selected=record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==draft.TeamDocumentId);
        var rendition=draft.RenditionDocumentId is not null&&draft.RenditionDocumentId!=draft.TeamDocumentId
            ?record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==draft.RenditionDocumentId):null;
        if(selected is null)Add("REFERENCE_REQUIRED","Select and save the reference for this RFQ.","REVIEW_REFERENCE");
        if(draft.RenditionDocumentId is not null&&(draft.RenditionDocumentId==draft.TeamDocumentId?selected?.Type!="application/pdf":rendition?.Type!="application/pdf"))
            Add("RENDITION_REQUIRED","Restore the linked PDF rendition or save the reference again.","REVIEW_REFERENCE");
        var targetIssues=new List<string>();
        if(record.Assemblies.Length!=1)targetIssues.Add("one assembly is required");
        else{
            if(string.IsNullOrWhiteSpace(record.Assemblies[0].AssemblyNumber))targetIssues.Add("assembly number is missing");
            if(string.IsNullOrWhiteSpace(record.Assemblies[0].Revision))targetIssues.Add("revision is missing");
            if(record.Assemblies[0].Quantity<=0)targetIssues.Add("RFQ quantity must be positive");
        }
        if(targetIssues.Count>0)Add("ASSEMBLY_REQUIRED","Saved intake details need correction: "+string.Join("; ",targetIssues)+".","REVIEW_INTAKE");
        // A linked viewing rendition is not a second customer document. It retains its own
        // verified bytes and reference identity, without inheriting document-review evidence.
        var originals=record.TechnicalFiles.Where(f=>f.DocumentId!=rendition?.DocumentId).ToArray();
        var docs=package?.Documents.Where(d=>d.DocumentId!=rendition?.DocumentId).ToArray()??[];
        if(package is null||docs.Length!=originals.Length||docs.Select(d=>d.DocumentId).Distinct().Count()!=originals.Length||
            originals.Any(f=>!docs.Any(d=>d.DocumentId==f.DocumentId&&d.Name==f.Name)))
            Add("DOCUMENT_INVENTORY","Review the added or changed customer documents.","REVIEW_DOCUMENTS");
        foreach(var doc in docs.Where(d=>d.RowAssociation is null))
        {
            if(doc.DocumentType=="UNKNOWN"||doc.IdentityReview is not {Type:not "UNKNOWN",Decision:"CONFIRMED" or "CORRECTED",ReviewedBy:not null,ReviewedAtUtc:not null}||
                string.IsNullOrWhiteSpace(doc.IdentityReview.ReviewedBy))
                Add("DOCUMENT_IDENTITY","Review document identity: "+doc.Name+".","REVIEW_DOCUMENTS");
        }
        if(selected is not null&&!docs.Any(d=>d.DocumentId==selected.DocumentId))
            Add("REFERENCE_IDENTITY","Review the selected reference's document identity.","REVIEW_DOCUMENTS");
        try{SimTechnicalPackageProvider.RequirePartNumberReview(docs);}catch(SimRfqIntakeProblem e)
        {Add("DOCUMENT_PART_NUMBERS",e.Message,"REVIEW_DOCUMENTS");}
        var sources=new List<SimManualSourceDocument>();
        foreach(var file in record.TechnicalFiles.OrderBy(f=>f.DocumentId,StringComparer.Ordinal))
        {
            try{
                if(file.BinaryStatus!="VERIFIED"||string.IsNullOrWhiteSpace(file.DocumentId))throw new IOException("Unverified source.");
                await documents.VerifyPresentationSource(record.RequestCorrelationId,file);
                sources.Add(new(file.DocumentId,file.Name,file.DocumentReference??"",DleAnalysisContract.Hash(await documents.Bytes(record.RequestCorrelationId,file.DocumentId)),
                    draft.RenditionDocumentId==file.DocumentId));
            }catch(Exception e) when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException)
            {Add("SOURCE_UNAVAILABLE","Restore or verify source file: "+file.Name+".","RESTORE_SOURCE");}
        }
        var fingerprint=DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new{
            Scope="RFQ_PREPARATION",record.Assemblies,Package=package,
            Reference=new{draft.TeamDocumentId,draft.RenditionDocumentId,draft.ReferenceStatus},Sources=sources
        },DleAnalysisContract.Json));
        var saved=review.Workflow?.RfqPackageAcceptance;
        var accepted=review.Workflow is {PackageConfirmed:true,Sufficient:true,HoldReason:null}||
            saved is {Scope:"RFQ_PREPARATION"}&&saved.Fingerprint==fingerprint&&saved.ReferenceDocumentId==draft.TeamDocumentId&&
            saved.RenditionDocumentId==draft.RenditionDocumentId&&saved.ReferenceStatus==draft.ReferenceStatus;
        return new(true,accepted&&requirements.Count==0,fingerprint,requirements.Distinct().ToArray());
    }

    private static SimManufacturingDefinition EngineeringQuotationDefinition(SimRfqIntakeRecord record,SimPersona actor,DateTimeOffset now)
    {
        var draft=record.TechnicalReview!.PresentationDraft!;var package=record.TechnicalReview.TechnicalPackage!;
        var sourceId=draft.RenditionDocumentId??draft.TeamDocumentId!;
        // This output snapshot serves the existing quotation viewer. The saved customer
        // package and its accepted BOM evidence remain unchanged.
        if(!package.Documents.Any(d=>d.DocumentId==sourceId))
        {
            var file=record.TechnicalFiles.Single(f=>f.DocumentId==sourceId);
            package=package with{Documents=package.Documents.Append(new SimPackageDocument(file.DocumentId!,file.Name,"SUPPORTING_DOCUMENT",
                "REFERENCED","SUPPORTING_REFERENCE",null,ProductionUse:"NOT_FOR_PRODUCTION",BomUse:"NO_BOM_ROLE")).ToArray()};
        }
        return new(Guid.NewGuid().ToString("D"),sourceId,package.Documents.Where(d=>d.DocumentId!=sourceId).Select(d=>d.DocumentId).ToArray(),[],[],
            package,false,actor.DisplayName,now,"RFQ_PREPARATION",draft.ReferenceStatus,draft.TeamDocumentId);
    }
}
