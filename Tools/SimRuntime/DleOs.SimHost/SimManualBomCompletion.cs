using System.Text.Json;

internal sealed record SimManualSourceRequest(bool Confirm,string ExpectedReviewToken,string EvidenceFingerprint,string? ReviewNotes=null);
internal sealed record SimManualSourceDocument(string DocumentId,string Name,string DocumentReference,string Sha256,bool IsRendition);
internal sealed record SimManualSourceAcceptance(string Authority,string Rationale,string QuantityBasis,string AssemblyNumber,string AssemblyRevision,
    SimManualSourceDocument[] Sources,string EvidenceFingerprint,string CandidateId,int CandidateRevision,string Reviewer,DateTimeOffset AtUtc,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? RequestToken=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ReviewNotes=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? AcceptanceScope=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? SourceReferenceBasis=null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Authorship=null);
internal sealed record SimManualCompletionRowBlocker(string? RowId,int RowIndex,string LineNumber,string? Field,string Message);
internal sealed record SimManualCompletionInfo(string CandidateId,int Revision,string ExpectedReviewToken,string EvidenceFingerprint,string AssemblyNumber,string AssemblyRevision,
    SimManualSourceDocument[] Documents,SimManualCompletionRowBlocker[] RowBlockers,string[] Blockers,bool Accepted,bool CurrentAcceptance);
internal sealed record SimManualRevisionRequest(string CandidateId,int ExpectedRevision,string Reason);

internal sealed partial class SimRfqIntakeStore
{
    private static void RequireManualCompletionState(SimRfqIntakeRecord record,SimRfqIntakeDataset data)
    {
        if(record.Environment!="SIM"||record.IntakeType!="NEW_QUOTE_REQUEST"||record.Status!="TECHNICAL_REVIEW_IN_PROGRESS"||
            record.TechnicalReview?.Workflow is not {Outputs:null,HoldReason:null}||!string.IsNullOrEmpty(record.TechnicalReview.DownstreamHandoffState))
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_STATE","Use an active, unheld Technical Review before qualifying the DLE-authored BOM.");
        if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==record.IntakeId&&DleAnalysisContract.Active(j.Status)))
            throw SimRfqIntakeProblem.Conflict("SIM_BOM_ANALYZING","Wait for analysis to finish before qualifying the BOM.");
        if(record.TechnicalReview.CandidateBom?.ManualDraft is not {Kind:"DLE_AUTHORED"}||record.TechnicalReview.TechnicalPackage is null)
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_REQUIRED","Open the current DLE-authored BOM and source package.");
    }
    private async Task<SimManualSourceDocument[]> ManualSourceDocuments(SimRfqIntakeRecord record)
    {
        var result=new List<SimManualSourceDocument>();
        foreach(var file in record.TechnicalFiles.OrderBy(f=>f.DocumentId,StringComparer.Ordinal))
        {
            if(file.BinaryStatus!="VERIFIED"||string.IsNullOrEmpty(file.DocumentId))
                throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_SOURCE_UNVERIFIED","A linked file has not passed stored-file integrity verification. Restore or verify that file before accepting this BOM.");
            await documents.VerifyPresentationSource(record.RequestCorrelationId,file);
            result.Add(new(file.DocumentId,file.Name,file.DocumentReference??"",DleAnalysisContract.Hash(await documents.Bytes(record.RequestCorrelationId,file.DocumentId)),
                record.TechnicalReview?.PresentationDraft?.RenditionDocumentId==file.DocumentId));
        }
        return result.ToArray();
    }
    private static string ManualEvidenceFingerprint(SimRfqIntakeRecord record,SimManualSourceDocument[] sources)=>DleAnalysisContract.Hash(
        JsonSerializer.SerializeToUtf8Bytes(new{record.Assemblies,Sources=sources.Select(s=>new{s.DocumentId,s.Name,s.DocumentReference,s.Sha256}),
            MaterialPackage=MaterialPackageSignature(record.TechnicalReview?.TechnicalPackage)},DleAnalysisContract.Json));
    private static SimManualCompletionRowBlocker[] ManualCompletionRowBlockers(SimCandidateBom bom)
    {
        var blockers=new List<SimManualCompletionRowBlocker>();
        foreach(var row in bom.Rows)
        {
            void Add(string message,string? field=null)=>blockers.Add(new(row.RowId,row.Index,row.Values.GetValueOrDefault("lineNumber")??(row.Index+1).ToString(),field,message));
            if(!row.Confirmed||!row.ReviewState.Reviewed)
                foreach(var reason in row.ReviewState.Reasons.DefaultIfEmpty("Explicitly Accept this row before qualification."))Add(reason);
            if(row.ComponentType!="DNP"&&row.IdentityBasis=="MANUFACTURER_PN"&&
                (row.ManufacturerIdentity is not {} identity||identity.Stale||!identity.Proposals.Any(p=>identity.Decision(p.Id)=="CONFIRMED"&&!string.IsNullOrWhiteSpace(p.PartNumber))||
                 identity.Proposals.Any(p=>identity.Decision(p.Id)=="PROPOSED")))
                Add("Resolve and confirm the Manufacturer P/N identity before qualification.");
            // RFQ acceptance validates review decisions, not engineering completeness inferred from free text.
        }
        return blockers.ToArray();
    }
    internal async Task<SimManualCompletionInfo> ReadManualCompletionInfo(string intakeId)
    {
        await gate.WaitAsync();try
        {
            var data=await ReadDatasetAsync();var record=data.Records.SingleOrDefault(r=>r.IntakeId==intakeId&&IsTechnicalReviewRecord(r))
                ??throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review was not found.");
            var bom=record.TechnicalReview?.CandidateBom;
            if(bom?.ManualDraft is null)throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_REQUIRED","Open a DLE-authored BOM first.");
            var blockers=new List<string>();
            try{RequireManualCompletionState(record,data);}catch(SimRfqIntakeProblem e){blockers.Add(e.Message);}
            var sources=Array.Empty<SimManualSourceDocument>();
            try{sources=await ManualSourceDocuments(record);}catch(SimRfqIntakeProblem e){blockers.Add(e.Message);}
            catch(Exception e) when(e is IOException or UnauthorizedAccessException){blockers.Add("Source evidence is temporarily unavailable. Verify access to the preserved files and reopen qualification.");}
            if(record.Assemblies.Length!=1||string.IsNullOrWhiteSpace(record.Assemblies[0].AssemblyNumber)||string.IsNullOrWhiteSpace(record.Assemblies[0].Revision))blockers.Add("BOM acceptance requires one assembly number and revision.");
            if(bom.Rows.Length==0)blockers.Add("Add and review BOM rows before qualification.");
            var accepted=record.TechnicalReview!.BomAcceptances?.LastOrDefault(a=>a.Candidate.Id==bom.Id);
            return new(bom.Id,bom.ManualDraft.Revision,PackageReviewToken(record),ManualEvidenceFingerprint(record,sources),
                record.Assemblies.FirstOrDefault()?.AssemblyNumber??"",record.Assemblies.FirstOrDefault()?.Revision??"",sources,
                ManualCompletionRowBlockers(bom),blockers.ToArray(),accepted is not null,accepted is not null&&await HasCurrentManualAcceptance(record,accepted));
        }finally{gate.Release();}
    }
    private async Task<SimManualSourceAcceptance> RequireManualAcceptance(SimRfqIntakeDataset data,SimRfqIntakeRecord record,SimBomCompletionRequest request,SimPersona? persona)
    {
        RequireManualCompletionState(record,data);
        var bom=record.TechnicalReview!.CandidateBom!;var input=request.ManualSource;
        if(input is null||!input.Confirm)
            throw SimRfqIntakeProblem.BadRequest("SIM_MANUAL_AUTHORITY_REQUIRED","Confirm acceptance of this BOM for the RFQ stage.");
        if(input.ReviewNotes?.Length>4000)
            throw SimRfqIntakeProblem.BadRequest("SIM_MANUAL_REVIEW_NOTES_INVALID","Optional review notes must be 4000 characters or fewer.");
        var notes=string.IsNullOrWhiteSpace(input.ReviewNotes)?null:input.ReviewNotes.Trim();
        if(record.TechnicalReview.BomAcceptances?.LastOrDefault(a=>a.Candidate.Id==bom.Id) is {} accepted)
        {
            await RequireCurrentManualAcceptance(record,accepted);
            var saved=accepted.ManualSource!;
            // Retries reuse only an identical RFQ decision; historical evidence is never rewritten.
            if(saved.ReviewNotes==notes&&input.EvidenceFingerprint==saved.EvidenceFingerprint&&
                (input.ExpectedReviewToken==PackageReviewToken(record)||input.ExpectedReviewToken==saved.RequestToken))return saved;
            throw SimRfqIntakeProblem.Conflict("SIM_BOM_ACCEPTED","The accepted BOM is read-only. Reopen the saved acceptance or start a new revision.");
        }
        if(input.ExpectedReviewToken!=PackageReviewToken(record))throw SimRfqIntakeProblem.Conflict("SIM_PACKAGE_CHANGED","The review changed. Reopen BOM acceptance before confirming.");
        if(record.Assemblies.Length!=1||string.IsNullOrWhiteSpace(record.Assemblies[0].AssemblyNumber)||string.IsNullOrWhiteSpace(record.Assemblies[0].Revision))
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_TARGET_CHANGED","BOM acceptance requires one assembly number and revision.");
        var sources=await ManualSourceDocuments(record);
        var fingerprint=ManualEvidenceFingerprint(record,sources);
        if(input.EvidenceFingerprint!=fingerprint)throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_SOURCE_CHANGED","Linked source files or material-package decisions changed. Reopen BOM acceptance.");
        var blockers=ManualCompletionRowBlockers(bom);
        if(blockers.Length>0)throw SimRfqIntakeProblem.Conflict("SIM_BOM_UNRESOLVED",string.Join("; ",blockers.Select(b=>"Row "+b.LineNumber+": "+b.Message)));
        // Linked references document provenance only; linking does not attest to inspection, catalog matching or production release.
        return new("DLE_AUTHORED_REVIEWER","","",record.Assemblies[0].AssemblyNumber,record.Assemblies[0].Revision,
            sources,fingerprint,bom.Id,bom.ManualDraft!.Revision,persona?.DisplayName??"readiness",DateTimeOffset.UtcNow,input.ExpectedReviewToken,
            notes,"RFQ_PREPARATION","LINKED_REFERENCES_ONLY","DLE_AUTHORED");
    }
    internal async Task RequireCurrentManualAcceptance(SimRfqIntakeRecord record,SimBomAcceptance accepted)
    {
        var bom=record.TechnicalReview?.CandidateBom;var source=accepted.ManualSource;
        if(bom?.ManualDraft is null||source is null||source.Authority!="DLE_AUTHORED_REVIEWER"||source.CandidateId!=bom.Id||source.CandidateRevision!=bom.ManualDraft.Revision||
            !System.Text.Json.Nodes.JsonNode.DeepEquals(ComparableSnapshot(JsonSerializer.SerializeToNode(accepted.Candidate,jsonOptions)),ComparableSnapshot(JsonSerializer.SerializeToNode(bom,jsonOptions)))||
            !SameMaterialPackage(accepted.Package,record.TechnicalReview?.TechnicalPackage)||record.Assemblies.Length!=1||
            source.AssemblyNumber!=record.Assemblies[0].AssemblyNumber||source.AssemblyRevision!=record.Assemblies[0].Revision||ManualCompletionRowBlockers(bom).Length>0)
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_ACCEPTANCE_STALE","The accepted manual BOM, target or package changed. Start a new revision and accept it for the RFQ stage before submission.");
        var documentsNow=await ManualSourceDocuments(record);
        var linkedReferences=source.SourceReferenceBasis=="LINKED_REFERENCES_ONLY";
        if(source.EvidenceFingerprint!=ManualEvidenceFingerprint(record,documentsNow)||
            (linkedReferences?(source.AcceptanceScope!="RFQ_PREPARATION"||source.Authorship!="DLE_AUTHORED"||source.Sources.Length!=documentsNow.Length):source.Sources.Length==0)||
            source.Sources.Select(s=>s.DocumentId).Distinct().Count()!=source.Sources.Length||
            source.Sources.Any(s=>!documentsNow.Any(d=>d.DocumentId==s.DocumentId&&d.Name==s.Name&&d.DocumentReference==s.DocumentReference&&d.Sha256==s.Sha256&&(!linkedReferences||d.IsRendition==s.IsRendition))))
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_SOURCE_CHANGED","The accepted manual source evidence changed. Start a new revision and review the current sources.");
    }
    internal async Task<bool> HasCurrentManualAcceptance(SimRfqIntakeRecord record,SimBomAcceptance accepted)
    {
        try{await RequireCurrentManualAcceptance(record,accepted);return true;}catch(Exception e) when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException){return false;}
    }
    internal async Task<object> StartManualBomRevision(string intakeId,SimManualRevisionRequest request,SimPersona persona)
    {
        await gate.WaitAsync();try
        {
            var data=await ReadDatasetAsync();var index=data.Records.FindIndex(r=>r.IntakeId==intakeId&&IsTechnicalReviewRecord(r));
            if(index<0)throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review was not found.");
            var record=data.Records[index];RequireManualWork(record,data,allowAccepted:true);
            var review=record.TechnicalReview!;var bom=review.CandidateBom;
            if(string.IsNullOrWhiteSpace(request.Reason)||request.Reason.Length>1000)throw SimRfqIntakeProblem.BadRequest("SIM_MANUAL_REVISION_REASON","Explain the new BOM revision in 1–1000 characters.");
            if(bom?.ManualDraft?.PreviousCandidateId==request.CandidateId&&(review.CandidateBomVersions??[]).Any(b=>b.Id==request.CandidateId&&b.ManualDraft?.Revision==request.ExpectedRevision))return WorkflowEnvelope(record);
            if(bom?.ManualDraft is null||bom.Id!=request.CandidateId||bom.ManualDraft.Revision!=request.ExpectedRevision)
                throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_CHANGED","The manual BOM changed. Reopen it before starting a revision.");
            if(!(review.BomAcceptances??[]).Any(a=>a.Candidate.Id==bom.Id))throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_REVISION_ACCEPTED","Continue editing this working BOM. A new revision is available after qualification.");
            var now=DateTimeOffset.UtcNow;
            var revised=bom with{Id=Guid.NewGuid().ToString("D"),ExtractedAtUtc=now,RequestedBy=persona.DisplayName,
                Rows=bom.Rows.Select(r=>r with{Confirmed=false,Reviewer=null,ReviewedAtUtc=null,WorkingState=new(true,null,null,null)}).ToArray(),
                ManualDraft=new("DLE_AUTHORED",persona.DisplayName,now,0,bom.Id,request.Reason.Trim()),Progress=new(persona.DisplayName,now)};
            record=record with{TechnicalReview=review with{CandidateBom=revised,CandidateBomVersions=(review.CandidateBomVersions??[]).Append(bom).ToArray(),MaterialsReviewStatus=null,NextReviewPhase=null}};
            data.Records[index]=record;data.UpdatedAtUtc=now;await WriteVerifiedAsync(data);return WorkflowEnvelope(record);
        }finally{gate.Release();}
    }
}
