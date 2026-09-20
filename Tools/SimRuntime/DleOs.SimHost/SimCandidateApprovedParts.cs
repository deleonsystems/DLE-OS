internal sealed record SimApprovedPartChange(string? Id, string PartNumber, string? ManufacturerName, string ExpectedToken);
internal static partial class SimCandidateBomProvider
{
    private static SimCandidateBom ReviewApprovedPart(SimCandidateBom bom, int index, SimApprovedPartChange change, SimPersona persona)
    {
        var original=bom.Rows[index];
        if(original.ComponentType=="DNP")throw SimRfqIntakeProblem.BadRequest("SIM_APPROVED_PART_TYPE","DNP needs no approved P/N.");
        if(original.IdentityBasis=="CUSTOMER_PN")throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_INVALID","Change identity basis before editing manufacturer P/Ns.");
        if(original.ComponentType=="SUBASSEMBLY")throw SimRfqIntakeProblem.BadRequest("SIM_APPROVED_PART_TYPE","Use Assembly P/N for a Subassembly row.");
        if(change.ExpectedToken!=original.ReviewState.Token||original.ManufacturerIdentity?.Stale==true)
            throw SimRfqIntakeProblem.Conflict("SIM_APPROVED_PART_STALE","This row changed. Reopen before saving its approved P/Ns.");
        var number=change.PartNumber?.Trim();var maker=change.ManufacturerName?.Trim();
        if(string.IsNullOrWhiteSpace(number)||number.Length>200||(maker?.Length??0)>200)
            throw SimRfqIntakeProblem.BadRequest("SIM_APPROVED_PART_INVALID","Enter a P/N and keep P/N and manufacturer within 200 characters.");
        var identity=CurrentManufacturerIdentity(original.ManufacturerIdentity??new([],"Manually reviewed identities",[]));
        var proposals=identity.Proposals.ToList();
        var old=change.Id is null?null:original.ManufacturerIdentity?.Proposals.FirstOrDefault(p=>p.Id==change.Id);
        var target=change.Id is null?null:proposals.FirstOrDefault(p=>p.Id==change.Id)??proposals.FirstOrDefault(p=>old is not null&&p.PartNumber==old.PartNumber&&p.ManufacturerName==old.ManufacturerName);
        if(change.Id is not null&&(target is null||identity.Decision(target.Id) is not ("CONFIRMED" or "PROPOSED")))
            throw SimRfqIntakeProblem.Conflict("SIM_APPROVED_PART_STALE","That P/N is no longer current. Reopen the row.");
        var duplicate=proposals.FirstOrDefault(p=>p.Id!=target?.Id&&p.PartNumber.Trim()==number&&(p.ManufacturerName??"").Trim()==(maker??"")&&identity.Decision(p.Id) is "CONFIRMED" or "PROPOSED");
        if(duplicate is not null)throw SimRfqIntakeProblem.Conflict("SIM_APPROVED_PART_DUPLICATE","That P/N and manufacturer are already listed.");
        if(target is not null&&target.PartNumber==number&&(target.ManufacturerName??"")== (maker??""))return bom;
        var evidence=new DleAnalysisEvidence(bom.GoverningDocumentId,null,null,"Reviewer saved approved P/N; source transcription is unchanged");
        var part=new DleManufacturerProposal(target?.Id??"manual-"+Guid.NewGuid().ToString("N"),maker,number,evidence,evidence,evidence,
            "Manual Technical Review entry",["Human-edited approved identity"],[],new(),"HUMAN_REVIEWED","Human-reviewed P/N; no automated source match claimed.");
        if(target is null)proposals.Add(part);else proposals[proposals.IndexOf(target)]=part;
        var now=DateTimeOffset.UtcNow;
        identity=identity with {Proposals=proposals.ToArray(),History=identity.History.Where(h=>h.ProposalId!=part.Id).Append(new(part.Id,"CONFIRMED",persona.DisplayName,now)).ToArray(),Revision=identity.Revision+1};
        var rows=bom.Rows.ToArray();rows[index]=original with {ManufacturerIdentity=identity,Confirmed=false,WorkingState=original.WorkingState is {} working?working with {ManualPartNumber=null,ManufacturerName=null}:new(false,null,null,null)};
        return bom with {Rows=rows};
    }
}
