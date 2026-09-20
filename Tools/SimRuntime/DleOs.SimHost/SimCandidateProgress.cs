// Working values remain in Candidate.Values; this holds only pending identity inputs/review intent.
internal sealed record SimCandidateWorkingState(bool ValuesChanged, string? AssemblyPartNumber, string? ManualPartNumber, string? ManufacturerName);
internal sealed record SimCandidateProgressStamp(string SavedBy, DateTimeOffset SavedAtUtc);
internal sealed record SimCandidateProgressRow(int RowIndex, string ExpectedToken, Dictionary<string,string> Values,
    string ComponentType, string? AssemblyPartNumber = null, string? ManualPartNumber = null, string? ManufacturerName = null, SimApprovedPartChange? ApprovedPartChange = null, SimIdentityBasisChange? IdentityBasisChange = null);
internal static partial class SimCandidateBomProvider
{
    private static SimCandidateBom SaveProgress(SimCandidateBom bom, SimCandidateProgressRow[] edits, SimPersona persona)
    {
        if(edits.Length>bom.Rows.Length || edits.Select(e=>e.RowIndex).Distinct().Count()!=edits.Length)
            throw SimRfqIntakeProblem.BadRequest("SIM_PROGRESS_INVALID","Each Candidate row may appear once.");
        var rows=bom.Rows.ToArray();var now=DateTimeOffset.UtcNow;
        foreach(var edit in edits)
        {
            if(edit.RowIndex<0||edit.RowIndex>=rows.Length)throw SimRfqIntakeProblem.BadRequest("SIM_PROGRESS_INVALID","Choose an existing Candidate row.");
            var row=rows[edit.RowIndex];
            if(edit.ExpectedToken!=row.ReviewState.Token)throw SimRfqIntakeProblem.Conflict("SIM_PROGRESS_STALE","A row changed. Reopen before saving progress.");
            if(edit.Values is null || edit.Values.Count!=Fields.Length || Fields.Any(f=>!edit.Values.TryGetValue(f,out var v)||v is null||v.Length>2000) ||
                edit.ComponentType is not ("STANDARD_COTS" or "SUBASSEMBLY" or "DNP" or "REFERENCE_ONLY" or "OTHER") ||
                new[]{edit.AssemblyPartNumber,edit.ManualPartNumber,edit.ManufacturerName}.Any(v=>v?.Length>200))
                throw SimRfqIntakeProblem.BadRequest("SIM_PROGRESS_INVALID","Review the Candidate field values before saving progress.");
            if(edit.IdentityBasisChange is not null) {
                if(edit.ApprovedPartChange is not null||edit.ComponentType is "SUBASSEMBLY" or "DNP"||edit.Values["partNumber"]!=row.Values["partNumber"]||!string.IsNullOrWhiteSpace(edit.ManualPartNumber))
                    throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_INVALID","Save BOM P/N or type changes before changing identity basis.");
                row=ReviewIdentityBasis(bom with {Rows=rows},edit.RowIndex,edit.IdentityBasisChange,persona).Rows[edit.RowIndex];
            }
            if(edit.ApprovedPartChange is not null)
                row=ReviewApprovedPart(bom with {Rows=rows},edit.RowIndex,edit.ApprovedPartChange,persona).Rows[edit.RowIndex];
            var changed=Fields.Where(f=>row.Values.GetValueOrDefault(f)!=edit.Values[f]).ToArray();
            var corrections=CurrentCorrections(row,edit.Values,persona,now);
            var typeChanged=row.ComponentType!=edit.ComponentType;
            if(typeChanged)corrections=corrections.Append(new("componentType",row.ComponentType,edit.ComponentType,persona.DisplayName,now)).ToArray();
            var values=new Dictionary<string,string>(row.Values);foreach(var field in edit.Values)values[field.Key]=field.Value;
            if(typeChanged&&edit.ComponentType=="DNP")values["description"]="DO NOT POPULATE";
            rows[edit.RowIndex]=row with {Values=values,Corrections=corrections,ManufacturerIdentity=row.ManufacturerIdentity is {} identity?CurrentManufacturerIdentity(identity):null,Confirmed=false,ComponentType=edit.ComponentType,
                ComponentTypeRevision=row.ComponentTypeRevision+(typeChanged?1:0),
                WorkingState=new(changed.Length>0||row.WorkingState?.ValuesChanged==true,edit.AssemblyPartNumber,edit.ApprovedPartChange is null&&edit.IdentityBasisChange is null?edit.ManualPartNumber:null,edit.ApprovedPartChange is null&&edit.IdentityBasisChange is null?edit.ManufacturerName:null)};
        }
        return bom with {Rows=rows,Progress=new(persona.DisplayName,now)};
    }
}
