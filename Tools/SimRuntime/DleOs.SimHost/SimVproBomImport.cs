using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

internal sealed record SimVproRequest(string DocumentId, string ExpectedReviewToken);
internal sealed record SimVproSourceNote(string Sequence,string Kind,string Text,string? ComponentSequence=null);
internal sealed record SimVproSourceIdentity(string Header,string Drawing,SimVproSourceNote[] Notes);
internal sealed record SimVproIdentityConfirmation(string DocumentId,string Sha256,string SourceDrawing,string Assembly,string Revision,string Reason,string Reviewer,DateTimeOffset AtUtc);
internal sealed record SimVproImport(string DocumentId, string Sha256, string Header, string[] Headers, string[][] RawRows, string[] Concerns, SimVproBaselineDecision? BaselineDecision = null, SimVproDiscrepancyDecision? DiscrepancyDecision = null, SimVproBaselineDecision[]? BaselineHistory = null, SimVproDiscrepancyDecision[]? DiscrepancyHistory = null, SimVproIdentityConfirmation? IdentityConfirmation = null, SimVproSourceNote[]? SourceNotes = null);

internal static class SimVproParser
{
    internal static readonly string[] Headers = ["SEQ", "ITEM#", "DESCRIPTION", "SYNONYM", "DIVISOR", "QTY REQD", "UOM", "ALT FACT", "SCRAP FACT", "UNIT COST", "TOT COST", "PURCH or MFD"];
    internal static SimVproSourceIdentity Describe(byte[] bytes)
    {
        if(bytes.Length>1024*1024||bytes.Any(b=>b>127||(b<32&&b is not (9 or 10 or 13))))throw Invalid("Use an ASCII tab-delimited VPRO5 TXT export of at most 1 MB.");
        var lines=Encoding.ASCII.GetString(bytes).Split('\n').Select(l=>l.TrimEnd('\r')).Where(l=>!string.IsNullOrWhiteSpace(l)).ToArray();
        if(lines.Length<3||lines.Length>2001)throw Invalid("Export row count is unsupported.");
        var h=lines[0].Split('\t');if(h.Length!=13||!h.Take(12).SequenceEqual(Headers))throw Invalid("The TXT columns do not match the supported VPRO5 export.");
        var m=Regex.Match(h[12],@"(?:^|/)\s*DRAW#=(?<drawing>[^/]+)");if(!m.Success)throw Invalid("The source drawing identity is missing.");
        var rows=lines.Skip(1).Select(l=>l.Split('\t')).ToArray();if(rows.Any(r=>r.Length!=13))throw Invalid("Incomplete source columns require review.");
        return new(h[12],m.Groups["drawing"].Value.Trim(),rows.Where(r=>string.IsNullOrWhiteSpace(r[1])&&!Regex.IsMatch(r[2],@"^\((?:\d+(?:\.\d+)?|NOB)\)")).Select(r=>new SimVproSourceNote(r[0],string.IsNullOrWhiteSpace(r[2])?"SEPARATOR":"SOURCE_NOTE",r[2])).ToArray());
    }
    private static SimRfqIntakeProblem Invalid(string message) => SimRfqIntakeProblem.BadRequest("VPRO_FORMAT", message);
    internal static SimCandidateBom Parse(byte[] bytes, string documentId, string assembly, string revision, string reviewer, SimVproIdentityConfirmation? confirmation = null, bool libraryOptionalNob = false)
    {
        if(bytes.Length>1024*1024 || bytes.Any(b=>b>127 || (b<32 && b is not (9 or 10 or 13))))throw Invalid("Use an ASCII tab-delimited VPRO5 BOM export of at most 1 MB.");
        var lines=Encoding.ASCII.GetString(bytes).Split('\n').Select(l=>l.TrimEnd('\r')).Where(l=>!string.IsNullOrWhiteSpace(l)).ToArray();
        if(lines.Length<3 || lines.Length>2001)throw Invalid("Export row count is unsupported.");
        var header=lines[0].Split('\t');
        if(header.Length!=13 || !header.Take(12).SequenceEqual(Headers))throw Invalid("The VPRO5 export header does not match the supported TSV format.");
        var match=Regex.Match(header[12],@"(?:^|/)\s*DRAW#=(?<drawing>[^/]+)");
        if(!match.Success)throw Invalid("The source drawing identity is missing.");
        var literal=match.Groups["drawing"].Value.Trim();
        if(!string.Equals(literal,assembly+" REV "+revision,StringComparison.OrdinalIgnoreCase) &&
            !(confirmation is not null && confirmation.DocumentId==documentId && confirmation.Sha256==DleAnalysisContract.Hash(bytes) && confirmation.SourceDrawing==literal && confirmation.Assembly==assembly && confirmation.Revision==revision && !string.IsNullOrWhiteSpace(confirmation.Reason) && !string.IsNullOrWhiteSpace(confirmation.Reviewer)))
            throw Invalid("Export drawing/revision does not match this RFQ. Explicit source-identity reconciliation is required; no draft created.");
        var raw=lines.Skip(1).Select(l=>l.Split('\t')).ToArray();
        if(raw.Any(r=>r.Length!=13 || r[12].Trim().Length>0 || r.Any(v=>v.Length>2000)) || raw.Select(r=>r[0]).Distinct().Count()!=raw.Length)throw Invalid("Incomplete columns, duplicate sequences or unsupported trailing values require manual review.");
        decimal Number(string value) => decimal.TryParse(value,NumberStyles.AllowDecimalPoint|NumberStyles.AllowLeadingSign,CultureInfo.InvariantCulture,out var n)&&n>=0?n:throw Invalid("Invalid numeric source value.");
        foreach(var r in raw) {
            if(!Regex.IsMatch(r[0],@"^\d+$"))throw Invalid("Invalid sequence.");
            foreach(var i in new[]{4,5,7,8,9,10})Number(r[i]);
        }
        var sourceNotes=new List<SimVproSourceNote>();
        var rows=new List<SimCandidateRow>();var pending=new List<string[]>();var finds=new HashSet<string>();
        var hash=DleAnalysisContract.Hash(bytes);
        var concerns=new List<string>{"Legacy export is not customer approval. Confirm source freshness; export has no revision date. Source identity must match or have an explicit recorded reconciliation; customer documents have not been compared.","ITEM# and SYNONYM are preserved legacy identifiers, not verified manufacturer identities. Confirm each part-number basis and alternate approval.","Quantity per assembly is proposed from primary QTY REQD with divisor 1. Explicit DNP placeholders retain their literal suppressed quantity as evidence, not material demand. Confirm the export is a one-assembly basis and review all units, particularly solder. No RFQ quantity multiplication applied.","Alternates use supported legacy suppression patterns and same trailing Find message; pairing remains proposed. No PDF corroboration is asserted. BOM acceptance requires explicit baseline approval, row review and current customer-document discrepancy review."};
        if(libraryOptionalNob)concerns.Add("Library optional NOB: the exact single-item divisor 10 / quantity .0001 suppression pattern maps to zero required demand, with raw factors retained. Explicit nonnegative NOB quantities stay meaningful; positive quantities require a unit. No automatic approval or kitting integration is implied.");
        foreach(var r in raw) {
            if(r[1].Trim().Length>0){pending.Add(r);continue;}
            if(pending.Count==0 && Number(r[5])==0){
                if(Regex.IsMatch(r[2],@"^\((?:\d+(?:\.\d+)?|NOB)\)"))throw Invalid("A Find note has no preceding component; review the source grouping.");
                sourceNotes.Add(new(r[0],string.IsNullOrWhiteSpace(r[2])?"SEPARATOR":r[2].Contains("DRAWING:",StringComparison.OrdinalIgnoreCase)?"DRAWING_NOTE":"SOURCE_NOTE",r[2]));continue;
            }
            var m=Regex.Match(r[2],@"^\((\d+(?:\.\d+)?|NOB)\)\s*(.+)$");
            if(!m.Success || pending.Count is <1 or >3 || !finds.Add(m.Groups[1].Value=="NOB"?"NOB:"+r[0]:m.Groups[1].Value)||Number(r[5])!=0)throw Invalid("Ambiguous Find/message grouping. No draft created; review source sequence and continuation lines.");
            var primary=pending[0];
            var optionalNob=libraryOptionalNob && m.Groups[1].Value=="NOB";
            // Only this explicit Library NOB convention is mapped. Raw factors stay in source evidence.
            var suppressedNob=optionalNob && pending.Count==1 && Number(primary[4])==10 && Number(primary[5])==.0001m && Number(primary[7])==1 && Number(primary[8])==0;
            var zeroNob=optionalNob && Number(primary[4])==1 && Number(primary[5])==0 && Number(primary[7])==1 && Number(primary[8])==0;
            var dnp=primary[1]=="DO NOT POPULATE" && primary[2]=="PLACE HOLDER FOR DNP PARTS" && primary[3]=="DO NOT POPULATE" && pending.Count==1 && Number(primary[4])==10 && Number(primary[5])==.0001m && Number(primary[7])==1 && Number(primary[8])==0;
            if(!dnp && !suppressedNob && !zeroNob && (Number(primary[4])!=1 || Number(primary[5])<=0 || Number(primary[7])!=1 || Number(primary[8])!=0 || string.IsNullOrWhiteSpace(primary[6])))throw Invalid("Primary quantity factors require manual mapping. No draft created.");
            if(suppressedNob)sourceNotes.Add(new(primary[0],"OPTIONAL_NOB_SUPPRESSION","Optional NOB: mapped to zero required demand from literal QTY REQD "+primary[5]+", DIVISOR "+primary[4]+", UOM ["+primary[6]+"]. Not an approval or unit conversion.",primary[0]));
            if(dnp)sourceNotes.Add(new(primary[0],"DNP_PLACEHOLDER",primary[1]+"; literal suppressed quantity "+primary[5]+"; "+r[2],primary[0]));
            var alt=pending.Skip(1).ToArray();
            if(alt.Any(a=>Number(a[4])!=10 || Number(a[5])!=.0001m || (Number(a[7])!=1 && Number(a[7])!=.0001m) || Number(a[8])!=0 || (!string.IsNullOrWhiteSpace(a[6]) && a[6]!=primary[6])))throw Invalid("Additional component in a Find group does not match the confirmed suppression convention. Do not infer an alternate from quantity alone.");
            var find=m.Groups[1].Value;var note=m.Groups[2].Value.Trim();
            sourceNotes.Add(new(r[0],find=="NOB"?"NOB_INSTALLATION":"FIND_NOTE",r[2],primary[0]));
            var refs=Regex.IsMatch(note,@"^[A-Za-z]+\d+(?:[,\s-]+(?:[A-Za-z]+)?\d+)*$")?note:"";
            var values=new Dictionary<string,string>{{"lineNumber",find},{"partNumber",primary[1]},{"quantity",suppressedNob?"0":primary[5]},{"description",primary[2]},{"designators",refs},{"unit",primary[6]}};
            DleAnalysisEvidence Evidence(string seq)=>new(documentId,null,null,"VPRO5 sequence "+seq+"; trailing Find message "+r[0]+": "+r[2]);
            var fields=values.ToDictionary(p=>p.Key,p=>new DleAnalysisField(p.Value,Evidence(primary[0]),"Unreviewed legacy source; customer comparison required.","NOT_COMPARED",null,null));
            var alternates=alt.Select(a=>new SimCandidateAlternate("vpro-"+a[0],a[1],a[1],"SOURCE","PROPOSED","Suppressed legacy alternate candidate; confirm pairing and approval. TXT evidence only.",Evidence(a[0]),"Find "+find+"; quantity "+a[5]+"; divisor "+a[4]+"; unit literal ["+a[6]+"] ; alternate factor "+a[7]+"; alias "+a[3],null,null,[],Note:"TXT-only evidence; no PDF corroboration asserted.")).ToArray();
            var extracted=new Dictionary<string,string>(values);
            if(optionalNob){extracted["optionalNob"]="true";extracted["sourceQuantityRaw"]=primary[5];extracted["sourceDivisorRaw"]=primary[4];extracted["sourceUnitRaw"]=primary[6];extracted["quantityMapping"]=suppressedNob?"LEGACY_SUPPRESSED_NOB_TO_ZERO":"EXPLICIT_NOB_QUANTITY";}
            rows.Add(new(rows.Count,extracted,values,[],values.ToDictionary(p=>p.Key,_=>"NOT_COMPARED"),false,null,null,[],"vpro-"+primary[0],fields,alternates,
                ComponentType:dnp?"DNP":"STANDARD_COTS",
                ManufacturerIdentity:new([],"Legacy ITEM# requires identity review; aliases retained in source evidence.",[]),
                SourcePartNumberReview:new(new("UNRESOLVED",primary[1],documentId,hash,"VPRO5 sequence "+primary[0],"UNRESOLVED","VPRO5_IMPORT",reviewer,DateTimeOffset.UtcNow,null,"UNRESOLVED"),[])));
            pending.Clear();
        }
        if(pending.Count>0 || rows.Count==0)throw Invalid("Component rows without a trailing Find message require manual mapping.");
        return new(Guid.NewGuid().ToString("D"),"VPRO5 BOM working draft",documentId,hash,1,"VPRO5_TSV_V1",false,DateTimeOffset.UtcNow,reviewer,[],string.Join(" ",concerns),rows.ToArray(),ContractVersion:SimCandidateBomProvider.ContractVersion,
            VproImport:new(documentId,hash,header[12],[..Headers,"Header metadata"],raw,concerns.ToArray(),IdentityConfirmation:confirmation,SourceNotes:sourceNotes.ToArray()));
    }
}

internal sealed partial class SimRfqIntakeStore
{
    private async Task RequireVproDraft(SimRfqIntakeRecord record)
    {
        var bom=record.TechnicalReview?.CandidateBom;
        if(record.Environment!="SIM" || record.Status!="TECHNICAL_REVIEW_IN_PROGRESS" || record.TechnicalReview?.Workflow?.Outputs is not null ||
            !string.IsNullOrEmpty(record.TechnicalReview?.DownstreamHandoffState) || bom?.VproImport is null || (record.TechnicalReview?.BomAcceptances??[]).Any(a=>a.Candidate.Id==bom.Id))
            throw SimRfqIntakeProblem.Conflict("VPRO_READ_ONLY","Only an active, unaccepted legacy draft can be edited.");
        var file=record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==bom.VproImport.DocumentId&&f.BinaryStatus=="VERIFIED") ?? throw SimRfqIntakeProblem.Conflict("VPRO_SOURCE","Source unavailable.");
        await documents.Verify(record.RequestCorrelationId,file,file.ReviewOrigin?.AddedBy??record.CreatedBy);
        if(DleAnalysisContract.Hash(await documents.Bytes(record.RequestCorrelationId,file.DocumentId!))!=bom.VproImport.Sha256)
            throw SimRfqIntakeProblem.Conflict("VPRO_SOURCE_CHANGED","Legacy source changed. Existing draft preserved.");
    }
    internal async Task<object> BuildVproDraft(string intakeId, SimVproRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            var data=await ReadDatasetAsync();
            var record=data.Records.SingleOrDefault(r=>r.IntakeId==intakeId&&IsTechnicalReviewRecord(r))??throw SimRfqIntakeProblem.NotFound("VPRO_REVIEW","Review not found.");
            var review=record.TechnicalReview;
            if(record.Environment!="SIM"||record.Status!="TECHNICAL_REVIEW_IN_PROGRESS"||review?.Workflow is null||review.Workflow.Outputs is not null||!string.IsNullOrEmpty(review.DownstreamHandoffState))throw SimRfqIntakeProblem.Conflict("VPRO_STATE","Start an active Technical Review first.");
            if(review.CandidateBom is not null||(review.CandidateBomVersions?.Length??0)>0||(review.BomAcceptances?.Length??0)>0)throw SimRfqIntakeProblem.Conflict("VPRO_EXISTING_DRAFT","A BOM draft or prior review exists. Nothing was replaced.");
            if(request.ExpectedReviewToken!=PackageReviewToken(record))throw SimRfqIntakeProblem.Conflict("VPRO_STALE","Review changed. Reopen before generating a draft.");
            if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==intakeId&&DleAnalysisContract.Active(j.Status)))throw SimRfqIntakeProblem.Conflict("VPRO_BUSY","Wait for the existing analysis.");
            var file=record.TechnicalFiles.SingleOrDefault(f=>f.DocumentId==request.DocumentId&&f.BinaryStatus=="VERIFIED"&&f.Name.EndsWith(".txt",StringComparison.OrdinalIgnoreCase))??throw SimRfqIntakeProblem.BadRequest("VPRO_FILE","Select a verified attached TXT export.");
            var package=review.TechnicalPackage??throw SimRfqIntakeProblem.Conflict("VPRO_PACKAGE","Open package review first.");
            if(package.Documents.SingleOrDefault(d=>d.DocumentId==file.DocumentId) is not {RowAssociation:null} selected)throw SimRfqIntakeProblem.BadRequest("VPRO_SCOPE","Select a package-level export.");
            await documents.Verify(record.RequestCorrelationId,file,file.ReviewOrigin?.AddedBy??record.CreatedBy);
            var assembly=record.Assemblies.Single();
            var candidate=SimVproParser.Parse(await documents.Bytes(record.RequestCorrelationId,file.DocumentId!),file.DocumentId!,assembly.AssemblyNumber,assembly.Revision,persona.DisplayName);
            var updated=selected with {DocumentType="SUPPORTING_DOCUMENT",IdentityReview=new("VPRO5_BOM_EXPORT",null,"CORRECTED",persona.DisplayName,DateTimeOffset.UtcNow)};
            data.Records[data.Records.IndexOf(record)]=record with {TechnicalReview=review with {CandidateBom=candidate,TechnicalPackage=package with {Documents=package.Documents.Select(d=>d.DocumentId==selected.DocumentId?updated:d).ToArray()}}};
            data.UpdatedAtUtc=DateTimeOffset.UtcNow;await WriteVerifiedAsync(data);
        } finally {gate.Release();}
        return (await ReadTechnicalReviewAsync(intakeId))!;
    }
}

// Explicit decisions for the installed standalone importer. No source merging or extraction.
internal sealed record SimVproBaselineDecision(string DocumentId,string Sha256,string Assembly,string Revision,string Reason,string Reviewer,DateTimeOffset AtUtc);
internal sealed record SimVproReviewDocument(string DocumentId,string Name,string Sha256);
internal sealed record SimVproDiscrepancyDecision(string EvidenceFingerprint,string CandidateFingerprint,SimVproReviewDocument[] Documents,string Notes,string Reviewer,DateTimeOffset AtUtc);
internal sealed record SimVproDecisionRequest(string CandidateId,string ExpectedToken,string Action,bool Confirm,string Notes);
internal sealed record SimVproDecisionState(string CandidateId,string Token,string Assembly,string Revision,SimVproReviewDocument[] Documents,string EvidenceFingerprint,string CandidateFingerprint,bool BaselineCurrent,bool DiscrepanciesCurrent,bool RowsReviewed);

internal sealed partial class SimRfqIntakeStore
{
    private async Task<SimVproDecisionState> VproDecisionState(SimRfqIntakeRecord record)
    {
        await RequireVproDraft(record);
        var bom=record.TechnicalReview!.CandidateBom!;var import=bom.VproImport!;
        if(record.Assemblies.Length!=1)throw SimRfqIntakeProblem.Conflict("VPRO_TARGET","A single matching assembly is required.");
        var target=record.Assemblies[0];
        var bytes=await documents.Bytes(record.RequestCorrelationId,import.DocumentId);
        // Re-validate the actual preserved bytes against the CURRENT target, not just the import header.
        SimVproParser.Parse(bytes,import.DocumentId,target.AssemblyNumber,target.Revision,"validation",import.IdentityConfirmation);
        if(bom.GoverningDocumentId!=import.DocumentId||bom.GoverningSha256!=import.Sha256)
            throw SimRfqIntakeProblem.Conflict("VPRO_SOURCE_CHANGED","The candidate and VPRO source do not match.");
        var refs=new List<SimVproReviewDocument>();
        foreach(var file in record.TechnicalFiles.OrderBy(f=>f.DocumentId,StringComparer.Ordinal)) {
            if(file.BinaryStatus!="VERIFIED"||string.IsNullOrEmpty(file.DocumentId))throw SimRfqIntakeProblem.Conflict("VPRO_EVIDENCE_UNVERIFIED","Verify all attached review evidence before recording these decisions.");
            await documents.Verify(record.RequestCorrelationId,file,file.ReviewOrigin?.AddedBy??record.CreatedBy);
            refs.Add(new(file.DocumentId,file.Name,DleAnalysisContract.Hash(await documents.Bytes(record.RequestCorrelationId,file.DocumentId))));
        }
        string Hash(object value)=>DleAnalysisContract.Hash(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(value,DleAnalysisContract.Json));
        var evidence=Hash(new {Documents=refs,record.Assemblies,record.TechnicalReview.TechnicalPackage,record.TechnicalReview.ScannedBomSetup,record.TechnicalReview.ScannedBomReview});
        if(record.ReviewSourceSetup is {} setup){var c=setup.Current;evidence=Hash(new{evidence,c.DrawingDocumentId,c.DrawingSha256,c.BomDocumentId,c.BomSha256});}
        var candidate=Hash(new {bom.Id,Rows=bom.Rows.Select(r=>r.ReviewState.Token).ToArray()});
        var approved=import.BaselineDecision is {} a && a.DocumentId==import.DocumentId && a.Sha256==import.Sha256 && a.Assembly==target.AssemblyNumber && a.Revision==target.Revision;
        var compared=approved&&import.DiscrepancyDecision is {} d&&d.EvidenceFingerprint==evidence&&d.CandidateFingerprint==candidate;
        var token=Hash(new {Review=PackageReviewToken(record),evidence,candidate,record.Assemblies});
        return new(bom.Id,token,target.AssemblyNumber,target.Revision,refs.ToArray(),evidence,candidate,approved,compared,bom.Rows.Length>0&&bom.Rows.All(r=>r.ReviewState.Reviewed));
    }
    internal async Task<SimVproDecisionState> ReadVproDecisions(string intakeId)
    {
        await gate.WaitAsync();try {
            var data=await ReadDatasetAsync();var record=data.Records.SingleOrDefault(r=>r.IntakeId==intakeId)??throw SimRfqIntakeProblem.NotFound("VPRO_REVIEW","Review not found.");
            return await VproDecisionState(record);
        } finally {gate.Release();}
    }
    internal async Task<object?> SaveVproDecision(string intakeId,SimVproDecisionRequest request,SimPersona persona)
    {
        await gate.WaitAsync();try {
            var data=await ReadDatasetAsync();var record=data.Records.SingleOrDefault(r=>r.IntakeId==intakeId)??throw SimRfqIntakeProblem.NotFound("VPRO_REVIEW","Review not found.");
            if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==intakeId&&DleAnalysisContract.Active(j.Status)))throw SimRfqIntakeProblem.Conflict("VPRO_BUSY","Wait for the current analysis.");
            var state=await VproDecisionState(record);var bom=record.TechnicalReview!.CandidateBom!;var import=bom.VproImport!;
            if(request.CandidateId!=bom.Id||request.ExpectedToken!=state.Token)throw SimRfqIntakeProblem.Conflict("VPRO_DECISION_STALE","The target, evidence or review changed. Reload the decision panel.");
            if(!request.Confirm||string.IsNullOrWhiteSpace(request.Notes)||request.Notes.Length>4000)throw SimRfqIntakeProblem.BadRequest("VPRO_DECISION_REQUIRED","Explicit confirmation and a reason or discrepancy-review record are required.");
            if(request.Action=="APPROVE_BASELINE") {
                import=import with {BaselineDecision=new(import.DocumentId,import.Sha256,state.Assembly,state.Revision,request.Notes.Trim(),persona.DisplayName,DateTimeOffset.UtcNow),
                    BaselineHistory=import.BaselineDecision is {} prior?(import.BaselineHistory??[]).Append(prior).ToArray():import.BaselineHistory,
                    DiscrepancyHistory=import.DiscrepancyDecision is {} old?(import.DiscrepancyHistory??[]).Append(old).ToArray():import.DiscrepancyHistory,DiscrepancyDecision=null};
            } else if(request.Action=="COMPLETE_DISCREPANCIES") {
                if(!state.BaselineCurrent||!state.RowsReviewed)throw SimRfqIntakeProblem.Conflict("VPRO_REVIEW_INCOMPLETE","Approve the exact baseline and explicitly review every row before completing discrepancy review.");
                import=import with {DiscrepancyDecision=new(state.EvidenceFingerprint,state.CandidateFingerprint,state.Documents,request.Notes.Trim(),persona.DisplayName,DateTimeOffset.UtcNow),
                    DiscrepancyHistory=import.DiscrepancyDecision is {} prior?(import.DiscrepancyHistory??[]).Append(prior).ToArray():import.DiscrepancyHistory};
            } else throw SimRfqIntakeProblem.BadRequest("VPRO_DECISION_ACTION","Unknown decision.");
            data.Records[data.Records.IndexOf(record)]=record with {TechnicalReview=record.TechnicalReview with {CandidateBom=bom with {VproImport=import}}};
            data.UpdatedAtUtc=DateTimeOffset.UtcNow;await WriteVerifiedAsync(data);
        } finally {gate.Release();}
        return await ReadTechnicalReviewAsync(intakeId);
    }
    private async Task RequireVproAcceptance(SimRfqIntakeDataset data,SimRfqIntakeRecord record)
    {
        var state=await VproDecisionState(record);
        if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==record.IntakeId&&DleAnalysisContract.Active(j.Status)))throw SimRfqIntakeProblem.Conflict("VPRO_BUSY","Wait for the current analysis.");
        if(record.ReviewSourceSetup is {} savedSetup && record.TechnicalReview?.CandidateBom is {} savedCandidate && savedSetup.BuiltCandidateId==savedCandidate.Id){
            var c=savedSetup.Current;var drawing=await SetupFile(record,c.DrawingDocumentId,true);var bomSource=await SetupFile(record,c.BomDocumentId,false);
            if(drawing is null||bomSource is null||drawing.Value.Hash!=c.DrawingSha256||bomSource.Value.Hash!=c.BomSha256||bomSource.Value.File.DocumentId!=savedCandidate.GoverningDocumentId)
                throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_CHANGED","Saved source choices changed. Review the candidate sources again.");
        }else RequireWorkflowMaterials(record);
        if(!state.BaselineCurrent)throw SimRfqIntakeProblem.Conflict("VPRO_DRAFT_ONLY","The exact matching VPRO source has not been explicitly approved as the baseline.");
        if(!state.RowsReviewed)throw SimRfqIntakeProblem.Conflict("SIM_BOM_UNRESOLVED","Explicitly review every row, identity, alternate and conflict before accepting the BOM.");
        if(!state.DiscrepanciesCurrent)throw SimRfqIntakeProblem.Conflict("VPRO_DISCREPANCIES_REQUIRED","Complete customer-document discrepancy review against the current evidence and reviewed candidate.");
    }
}
