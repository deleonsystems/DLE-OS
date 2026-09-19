using System.Text.Json;

internal sealed record SimScanCandidateRequest(string Id, int ExpectedVersion, string ExpectedReviewToken);
internal sealed record SimReviewedScanSource(string Fingerprint, string PackageSignature, SimScannedBomReview Worksheet);
internal sealed record SimScanCandidateState(string Status, bool CanSubmit, string? Blocker);

internal sealed partial class SimRfqIntakeStore
{
    private static string ScanFingerprint(SimScannedBomReview sheet) => DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(sheet, DleAnalysisContract.Json));
    private static bool ScanCandidateCurrent(SimRfqIntakeRecord record, SimCandidateBom candidate) => candidate.ReviewedScanSource is not { } source ||
        (record.TechnicalReview?.ScannedBomReview is { } sheet && source.Fingerprint == ScanFingerprint(sheet) &&
         source.PackageSignature == MaterialPackageSignature(record.TechnicalReview.TechnicalPackage));
    private static string? ScanBuildBlocker(SimRfqIntakeRecord record)
    {
        var review = record.TechnicalReview;
        var sheet = review?.ScannedBomReview;
        if (record.Environment != "SIM" || record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || review?.Workflow?.Outputs is not null)
            return "Start an active Technical Review before submitting.";
        try { RequireWorkflowMaterials(record); } catch (SimRfqIntakeProblem e) { return e.Message; }
        if (sheet is null || review!.ScannedBomSetup is null || sheet.Version < 2) return "Save the reviewed worksheet first.";
        if (review.TechnicalPackage?.GoverningBomDocumentId != sheet.Setup.DocumentId) return "The governing source changed. Reopen Technical Review.";
        var governing=review.TechnicalPackage.Documents.SingleOrDefault(d=>d.DocumentId==sheet.Setup.DocumentId);
        if (EffectiveAssemblyClassification(record) is not ("EXISTING_ASSEMBLY" or "NEW_ASSEMBLY") ||
            governing is not {DocumentType:"ASSEMBLY_DRAWING",EmbeddedBom:true,Applicability:"PARENT_ASSEMBLY",Role:"GOVERNING"})
            return "Confirm assembly history and the governing parent assembly drawing before submitting.";
        string[] required = ["FIND_NUMBER", "CUSTOMER_PART_NUMBER", "REFERENCE_DESIGNATORS", "QUANTITY", "UNIT", "DESCRIPTION"];
        var fields = sheet.Setup.Columns.Select(c => c.Field).ToHashSet();
        if (sheet.Rows.Length == 0 || !required.All(fields.Contains) || sheet.Rows.Select(r=>r.Position).Distinct().Count()!=sheet.Rows.Length ||
            sheet.Rows.Any(r=>r.Page<sheet.Setup.StartPage || r.Page>sheet.Setup.EndPage || !fields.SetEquals(r.Cells.Keys) ||
                r.RowType is not ("COMPONENT" or "NOT_USED" or "BLANK" or "CONTINUATION" or "OTHER"))) return "The worksheet structure is invalid. Check its saved setup and rows.";
        if (sheet.Rows.Any(r=>!r.Reviewed)) return "Accept every transcription row, including excluded rows, then Save Review.";
        // An accepted, emptied continuation is retained as source evidence only. Never infer a merge.
        if (sheet.Rows.Any(r=>r.RowType=="CONTINUATION" && r.Cells.Any(c=>c.Key is not ("FIND_NUMBER" or "IGNORE") && !string.IsNullOrWhiteSpace(c.Value.Value))))
            return "A continuation row still contains transcription content. Resolve that content in the reviewed worksheet before building.";
        if (sheet.Rows.Any(r=>r.Cells.Any(c=>c.Key.StartsWith("MANUFACTURER_IDENTITY_") && !string.IsNullOrWhiteSpace(c.Value.Value))))
            return "Separate combined manufacturer identities into manufacturer and part-number columns before submitting.";
        if (!sheet.Rows.Any(r=>r.RowType=="COMPONENT")) return "No component rows are available to build.";
        return null;
    }
    private static SimScanCandidateState ScanCandidateState(SimRfqIntakeRecord record)
    {
        var candidate=record.TechnicalReview?.CandidateBom;
        var current=candidate?.ReviewedScanSource is not null && ScanCandidateCurrent(record,candidate);
        var blocker=ScanBuildBlocker(record);
        return new(current?"READY":candidate is not null || record.TechnicalReview?.CandidateBomVersions?.Length>0?"NEEDS_REBUILD":"NOT_BUILT", !current && blocker is null, blocker);
    }
    private static void RequireCurrentScanCandidate(SimRfqIntakeRecord record, SimCandidateBom candidate)
    {
        if (!ScanCandidateCurrent(record,candidate)) throw SimRfqIntakeProblem.Conflict("SIM_BOM_SOURCE_CHANGED", "The reviewed scanned worksheet changed. Rebuild Candidate BOM before reviewing or accepting it.");
    }
    internal async Task<object?> BuildScannedCandidate(string intakeId, SimScanCandidateRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var data=await ReadDatasetAsync();
            var record=data.Records.SingleOrDefault(r=>r.IntakeId==intakeId && IsTechnicalReviewRecord(r)) ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING","Review not found.");
            var review=record.TechnicalReview!;
            var sheet=review.ScannedBomReview;
            if(sheet is null || sheet.Id!=request.Id || sheet.Version!=request.ExpectedVersion)
                throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_STALE","The saved worksheet changed. Reopen it before submitting.");
            await RequirePreservedScanSource(record,sheet);
            var blocker=ScanBuildBlocker(record);
            if(blocker is not null) throw SimRfqIntakeProblem.Conflict("SCAN_CANDIDATE_BLOCKED",blocker);
            if(data.AnalysisJobs.Any(j=>j.Input.IntakeId==intakeId && DleAnalysisContract.Active(j.Status)))
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_ANALYZING","Wait for the current analysis to finish.");
            // Identical retries reuse the published snapshot, even if its publication changed the review token.
            if(review.CandidateBom?.ReviewedScanSource is null || !ScanCandidateCurrent(record,review.CandidateBom))
            {
                if(PackageReviewToken(record)!=request.ExpectedReviewToken) throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_STALE","Technical Review changed. Reopen before submitting.");
                var rows=sheet.Rows.Where(r=>r.RowType=="COMPONENT").Select((r,index)=>{
                    string Value(string field)=>r.Cells.GetValueOrDefault(field)?.Value??"";
                    DleAnalysisEvidence Evidence(string field)=>new(sheet.Setup.DocumentId,r.Page,null,$"Reviewed worksheet {sheet.Id} v{sheet.Version}, source row {r.Position}, {field}");
                    var mapping=new Dictionary<string,string>{{"lineNumber","FIND_NUMBER"},{"partNumber","CUSTOMER_PART_NUMBER"},{"quantity","QUANTITY"},{"designators","REFERENCE_DESIGNATORS"},{"description","DESCRIPTION"},{"unit","UNIT"}};
                    var values=mapping.ToDictionary(p=>p.Key,p=>Value(p.Value));
                    var analysis=mapping.ToDictionary(p=>p.Key,p=>new DleAnalysisField(Value(p.Value),Evidence(p.Value),"Technical review required.","GOVERNING",null,null));
                    var proposals=Enumerable.Range(1,3).Where(n=>!string.IsNullOrWhiteSpace(Value("MANUFACTURER_PART_NUMBER_"+n))).Select(n=>new DleManufacturerProposal(
                        $"scan-{r.Position}-mfg-{n}",Value("MANUFACTURER_"+n),Value("MANUFACTURER_PART_NUMBER_"+n),Evidence("MANUFACTURER_PART_NUMBER_"+n),Evidence("CUSTOMER_PART_NUMBER"),Evidence("MANUFACTURER_PART_NUMBER_"+n),
                        "Reviewed scanned BOM",["SAME_SOURCE_ROW"],[],new(){{"manufacturer",Value("MANUFACTURER_"+n)},{"partNumber",Value("MANUFACTURER_PART_NUMBER_"+n)}},"REVIEWED_TRANSCRIPTION","Technical identity requires review.")).ToArray();
                    return new SimCandidateRow(index,values,new(values),[],mapping.ToDictionary(p=>p.Key,_=>"GOVERNING"),false,null,null,[], $"scan-{sheet.Id}-{r.Position}",analysis,ManufacturerIdentity:new(proposals,"Review manufacturer identities from the saved transcription.",[]));
                }).ToArray();
                var candidate=new SimCandidateBom(Guid.NewGuid().ToString("D"),"Candidate BOM",sheet.Setup.DocumentId,sheet.Setup.Sha256,sheet.Setup.StartPage,
                    "SAVED_REVIEWED_SCANNED_BOM",false,DateTimeOffset.UtcNow,persona.DisplayName,[],
                    "Built locally from saved reviewed transcription. Non-component rows and all original cell evidence are retained in the worksheet snapshot. Supporting documents were not re-extracted.",rows,
                    ContractVersion:SimCandidateBomProvider.ContractVersion,ReviewedScanSource:new(ScanFingerprint(sheet),MaterialPackageSignature(review.TechnicalPackage),sheet));
                data.Records[data.Records.IndexOf(record)]=record with {TechnicalReview=review with {CandidateBom=candidate,
                    CandidateBomVersions=review.CandidateBom is null?review.CandidateBomVersions:(review.CandidateBomVersions??[]).Append(review.CandidateBom).ToArray(),MaterialsReviewStatus=null,NextReviewPhase=null}};
                data.UpdatedAtUtc=DateTimeOffset.UtcNow;
                await WriteVerifiedAsync(data);
            }
        }
        finally {gate.Release();}
        return await ReadTechnicalReviewAsync(intakeId);
    }
}
