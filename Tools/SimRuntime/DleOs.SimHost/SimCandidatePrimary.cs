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
        if(accept.ComponentType=="DNP") {
            var dnpValues=request.Values is null?null:new Dictionary<string,string>(request.Values);
            if(dnpValues is not null&&original.ComponentType!="DNP")dnpValues["description"]="DO NOT POPULATE";
            var reviewed=Review(typed,request with {WorksheetAcceptance=null,Values=dnpValues},persona);
            var updated=reviewed.Rows[request.RowIndex] with {WorkingState=null};
            if(!updated.ReviewState.Reviewed)throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
            var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated with {WholeRowHistory=[new(persona.DisplayName,DateTimeOffset.UtcNow,accept.ExpectedToken)]};
            return reviewed with {Rows=rows};
        }
        if(accept.ComponentType=="SUBASSEMBLY")
        {
            var number=accept.AssemblyPartNumber?.Trim();
            if(string.IsNullOrWhiteSpace(number)||number.Length>200)
                throw SimRfqIntakeProblem.BadRequest("SIM_ASSEMBLY_IDENTITY_REQUIRED","Enter the approved Assembly P/N.");
            var reviewed=Review(typed,request with {WorksheetAcceptance=null},persona);
            var assemblyIdentity=new SimAssemblyPartIdentity(number,persona.DisplayName,DateTimeOffset.UtcNow);
            var updated=reviewed.Rows[request.RowIndex] with {WorkingState=null,AssemblyIdentity=assemblyIdentity,
                AssemblyIdentityHistory=[assemblyIdentity]};
            if(!updated.ReviewState.Reviewed)throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
            var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated with {WholeRowHistory=[new(persona.DisplayName,DateTimeOffset.UtcNow,accept.ExpectedToken)]};
            return reviewed with {Rows=rows};
        }
        if(row.IdentityBasis=="CUSTOMER_PN") {
            if(!string.IsNullOrWhiteSpace(accept.ManualPartNumber)||!string.IsNullOrEmpty(accept.ProposalId))
                throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_INVALID","Change identity basis before selecting a manufacturer P/N.");
            if(!HasCustomerIdentity(row))throw SimRfqIntakeProblem.Conflict("SIM_CUSTOMER_IDENTITY_STALE","Confirm the Customer P/N in Approved P/Ns.");
            var reviewed=Review(typed,request with {WorksheetAcceptance=null},persona);
            var updated=reviewed.Rows[request.RowIndex] with {WorkingState=null};
            if(!updated.ReviewState.Reviewed)throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
            var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated with {WholeRowHistory=[new(persona.DisplayName,DateTimeOffset.UtcNow,accept.ExpectedToken)]};
            return reviewed with {Rows=rows};
        }
        return ReviewPrimary(typed,request with {WorksheetAcceptance=null,PrimarySelection=new(accept.ProposalId,accept.ManualPartNumber,accept.ManufacturerName,row.ReviewState.Token)},persona,true);
    }
    private static SimCandidateBom ReviewPrimary(SimCandidateBom bom, SimCandidateReviewRequest request, SimPersona persona, bool worksheet = false)
    {
        var choice = request.PrimarySelection!;
        var row = bom.Rows[request.RowIndex];
        if(row.ComponentType=="DNP")throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID","Use row Accept for a DNP disposition.");
        if(row.IdentityBasis=="CUSTOMER_PN")throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_INVALID","Change identity basis before reviewing manufacturer P/Ns.");
        if (choice.ExpectedToken != row.ReviewState.Token || row.ManufacturerIdentity?.Stale == true)
            throw SimRfqIntakeProblem.Conflict("SIM_MFG_REVIEW_STALE", "The row changed. Reopen or rebuild before accepting.");
        if (request.AlternateChange is not null || request.ManufacturerChange is not null || request.ComponentChange is not null || request.WholeRowApproval is not null)
            throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Accept primary identity separately from alternate approval.");
        var reviewed = Review(bom, request with {PrimarySelection=null}, persona);
        var updated = reviewed.Rows[request.RowIndex];
        if(row.WorkingState is not null) {
            if(!worksheet)throw SimRfqIntakeProblem.Conflict("SIM_PROGRESS_REVIEW_REQUIRED","Use row Accept to review saved working changes.");
            updated=updated with {WorkingState=null};
        }
        if (updated.ManufacturerIdentity?.Stale == true && !worksheet)
            throw SimRfqIntakeProblem.Conflict("SIM_MFG_REVIEW_STALE", "Save the changed BOM fields first, then rebuild their manufacturer evidence before accepting an identity.");
        var identity = CurrentManufacturerIdentity(row.ManufacturerIdentity ?? new([], "Manually reviewed identity", []));
        var proposals = identity.Proposals.ToList();
        DleManufacturerProposal selected;
        if (worksheet && string.IsNullOrWhiteSpace(choice.PartNumber) && string.IsNullOrEmpty(choice.ProposalId))
            selected=proposals.FirstOrDefault(p=>identity.Decision(p.Id)!="REJECTED" && !string.IsNullOrWhiteSpace(p.PartNumber))
                ?? throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID","No usable manufacturer identity. Enter a manual P/N before accepting.");
        else if (!string.IsNullOrEmpty(choice.ProposalId))
            selected = proposals.SingleOrDefault(p=>p.Id==choice.ProposalId && identity.Decision(p.Id)!="REJECTED")
                ?? (row.ManufacturerIdentity?.Proposals.SingleOrDefault(p=>p.Id==choice.ProposalId&&row.ManufacturerIdentity.Decision(p.Id)!="REJECTED") is {} previous
                    ? proposals.SingleOrDefault(p=>p.PartNumber==previous.PartNumber&&p.ManufacturerName==previous.ManufacturerName&&identity.Decision(p.Id)!="REJECTED") : null)
                ?? throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Select an available manufacturer proposal.");
        else
        {
            var number=choice.PartNumber?.Trim();
            if (string.IsNullOrWhiteSpace(number) || number.Length>200 || (choice.ManufacturerName?.Length??0)>200)
                throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID", "Enter a manufacturer P/N (maximum 200 characters).");
            var evidence=new DleAnalysisEvidence(bom.GoverningDocumentId,null,null,"Manual reviewer entry; not extracted from this document");
            selected=proposals.FirstOrDefault(p=>p.PartNumber==number&&p.ManufacturerName==choice.ManufacturerName?.Trim()&&identity.Decision(p.Id)!="REJECTED") ?? new("manual-"+Guid.NewGuid().ToString("N"),choice.ManufacturerName?.Trim(),number,evidence,evidence,evidence,
                "Manual Technical Review entry",["Human-entered identity"],[],new(),"HUMAN_REVIEWED","Manual entry; no automated source match claimed.");
            if(!proposals.Any(p=>p.Id==selected.Id))proposals.Add(selected);
        }
        if (worksheet && proposals.Any(p=>identity.Decision(p.Id)!="REJECTED" && string.IsNullOrWhiteSpace(p.PartNumber)))
            throw SimRfqIntakeProblem.BadRequest("SIM_MFG_REVIEW_INVALID","A candidate has no usable P/N. Review or reject it before accepting.");
        var now=DateTimeOffset.UtcNow;
        var decisions=proposals.Select(p=>new SimManufacturerDecision(p.Id,identity.Decision(p.Id)=="REJECTED"?"REJECTED":
            worksheet||p.Id==selected.Id?"CONFIRMED":"NOT_SELECTED",persona.DisplayName,now)).ToArray();
        var identityChanged=proposals.Count!=identity.Proposals.Length||decisions.Any(d=>identity.Decision(d.ProposalId)!=d.Decision);
        identity=identity with {Proposals=proposals.ToArray(),Revision=identity.Revision+(identityChanged?1:0),Stale=false,
            History=decisions.Select(d=>identity.History.LastOrDefault(h=>h.ProposalId==d.ProposalId&&h.Decision==d.Decision)??d).ToArray()};
        updated=updated with {ManufacturerIdentity=identity};
        if (!updated.ReviewState.Reviewed)
            throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",updated.ReviewState.Reasons));
        updated=updated with {WholeRowHistory=[new(persona.DisplayName,now,choice.ExpectedToken)]};
        var rows=reviewed.Rows.ToArray();rows[request.RowIndex]=updated;
        return reviewed with {Rows=rows};
    }
}
