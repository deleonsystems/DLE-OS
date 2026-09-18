internal static partial class SimCandidateBomProvider
{
    private static SimCandidateBom ReviewWorksheet(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona persona)
    {
        var accept=request.WorksheetAcceptance!;var original=bom.Rows[request.RowIndex];
        if(accept.ExpectedToken!=original.ReviewState.Token)
            throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_STALE","This row changed. Reopen before accepting.");
        if(request.AlternateChange is not null || request.ManufacturerChange is not null || request.ComponentChange is not null || request.WholeRowApproval is not null || request.PrimarySelection is not null)
            throw SimRfqIntakeProblem.BadRequest("SIM_ROW_APPROVAL_INVALID","Accept the worksheet row independently.");
        var typed=Review(bom,new(bom.Id,request.RowIndex,null,ComponentChange:new(accept.ComponentType,original.ComponentTypeRevision)),persona);
        var row=typed.Rows[request.RowIndex];
        if(accept.ComponentType=="SUBASSEMBLY")
        {
            var number=accept.AssemblyPartNumber?.Trim();
            if(string.IsNullOrWhiteSpace(number)||number.Length>200)
                throw SimRfqIntakeProblem.BadRequest("SIM_ASSEMBLY_IDENTITY_REQUIRED","Enter the approved Assembly P/N.");
            var reviewed=Review(typed,request with {WorksheetAcceptance=null},persona);
            var assemblyIdentity=new SimAssemblyPartIdentity(number,persona.DisplayName,DateTimeOffset.UtcNow);
            var updated=reviewed.Rows[request.RowIndex] with {AssemblyIdentity=assemblyIdentity,
                AssemblyIdentityHistory=(original.AssemblyIdentityHistory??(original.AssemblyIdentity is {} prior ? [prior] : [])).Append(assemblyIdentity).ToArray()};
            if(!updated.ReviewState.Reviewed)throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
            var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated with {WholeRowHistory=(original.WholeRowHistory??[]).Append(new(persona.DisplayName,DateTimeOffset.UtcNow,accept.ExpectedToken)).ToArray()};
            return reviewed with {Rows=rows};
        }
        return ReviewPrimary(typed,request with {WorksheetAcceptance=null,PrimarySelection=new(accept.ProposalId,accept.ManualPartNumber,accept.ManufacturerName,row.ReviewState.Token)},persona,true);
    }
    private static SimCandidateBom ReviewPrimary(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona persona, bool worksheet = false)
    {
        var choice = request.PrimarySelection!;
        var row = bom.Rows[request.RowIndex];
        if (choice.ExpectedToken != row.ReviewState.Token || row.ManufacturerIdentity?.Stale == true)
            throw SimRfqIntakeProblem.Conflict("SIM_MFG_REVIEW_STALE", "The row changed. Reopen or rebuild before accepting.");
        if (request.AlternateChange is not null || request.ManufacturerChange is not null || request.ComponentChange is not null || request.WholeRowApproval is not null)
            throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Accept primary identity separately from alternate approval.");
        var reviewed = Review(bom, request with {PrimarySelection=null}, persona);
        var updated = reviewed.Rows[request.RowIndex];
        if (updated.ManufacturerIdentity?.Stale == true && !worksheet)
            throw SimRfqIntakeProblem.Conflict("SIM_MFG_REVIEW_STALE", "Save the changed BOM fields first, then rebuild their manufacturer evidence before accepting an identity.");
        var identity = row.ManufacturerIdentity ?? new([], "Manually reviewed identity", []);
        var proposals = identity.Proposals.ToList();
        DleManufacturerProposal selected;
        if (worksheet && string.IsNullOrWhiteSpace(choice.PartNumber) && string.IsNullOrEmpty(choice.ProposalId))
            selected=proposals.FirstOrDefault(p=>identity.Decision(p.Id)!="REJECTED" && !string.IsNullOrWhiteSpace(p.PartNumber))
                ?? throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID","No usable manufacturer identity. Enter a manual P/N before accepting.");
        else if (!string.IsNullOrEmpty(choice.ProposalId))
            selected = proposals.SingleOrDefault(p=>p.Id==choice.ProposalId && identity.Decision(p.Id)!="REJECTED")
                ?? throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Select an available manufacturer proposal.");
        else
        {
            var number=choice.PartNumber?.Trim();
            if (string.IsNullOrWhiteSpace(number) || number.Length>200 || (choice.ManufacturerName?.Length??0)>200)
                throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Enter a manufacturer P/N (maximum 200 characters).");
            var evidence=new DleAnalysisEvidence(bom.GoverningDocumentId,null,null,"Manual reviewer entry; not extracted from this document");
            selected=new("manual-"+Guid.NewGuid().ToString("N"),choice.ManufacturerName?.Trim(),number,evidence,evidence,evidence,
                "Manual Technical Review entry",["Human-entered identity"],[],new(),"HUMAN_REVIEWED","Manual entry; no automated source match claimed.");
            proposals.Add(selected);
        }
        // An atomic worksheet correction is an explicit human reaffirmation, never
        // a claim that the old extraction matches the corrected fields. Keep the
        // original proposals/evidence and record a separate human identity.
        var reaffirmed=new HashSet<string>();
        if (updated.ManufacturerIdentity?.Stale == true)
        {
            var reaffirm=worksheet?proposals.Where(p=>identity.Decision(p.Id)!="REJECTED").ToArray():[selected];
            foreach(var proposal in reaffirm)
            {
            var evidence=new DleAnalysisEvidence(bom.GoverningDocumentId,null,null,"Reviewer reaffirmed identity while correcting BOM fields; not extracted from corrected fields");
            selected=new("manual-"+Guid.NewGuid().ToString("N"),proposal.ManufacturerName,proposal.PartNumber,evidence,evidence,evidence,
                "Manual Technical Review correction",["Human reaffirmation after BOM field correction"],[],new(),"HUMAN_REVIEWED","Original extraction retained for history; this identity is human-reviewed.");
            proposals.Add(selected);
            reaffirmed.Add(selected.Id);
            }
        }
        if (worksheet && proposals.Any(p=>identity.Decision(p.Id)!="REJECTED" && string.IsNullOrWhiteSpace(p.PartNumber)))
            throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID","A candidate has no usable P/N. Review or reject it before accepting.");
        var now=DateTimeOffset.UtcNow;
        identity=identity with {Proposals=proposals.ToArray(),Revision=Math.Max(identity.Revision,updated.ManufacturerIdentity?.Revision??0)+1,
            History=identity.History.Concat(proposals.Select(p=>new SimManufacturerDecision(p.Id,identity.Decision(p.Id)=="REJECTED"?"REJECTED":
                worksheet ? (reaffirmed.Count==0||reaffirmed.Contains(p.Id)?"CONFIRMED":"NOT_SELECTED") : p.Id==selected.Id?"CONFIRMED":"NOT_SELECTED",persona.DisplayName,now))).ToArray()};
        updated=updated with {ManufacturerIdentity=identity};
        if (!updated.ReviewState.Reviewed)
            throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
        updated=updated with {WholeRowHistory=(row.WholeRowHistory??[]).Append(new(persona.DisplayName,now,choice.ExpectedToken)).ToArray()};
        var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated;
        return reviewed with {Rows=rows};
    }
}
