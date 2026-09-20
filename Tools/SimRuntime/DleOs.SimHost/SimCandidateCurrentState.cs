internal static partial class SimCandidateBomProvider
{
    // Ordinary working fields have one current value; identity/type decisions retain their own guards.
    private static bool IsWorkingField(string field) => field is "description" or "designators" or "quantity" or "lineNumber";
    private static SimCandidateCorrection[] CurrentCorrections(SimCandidateRow row, Dictionary<string,string> values, SimPersona persona, DateTimeOffset now) =>
        row.Corrections.Where(c=>!IsWorkingField(c.Field)).Concat(Fields.Where(f=>!IsWorkingField(f)&&row.Values.GetValueOrDefault(f)!=values[f])
            .Select(f=>new SimCandidateCorrection(f,row.Values.GetValueOrDefault(f)??"",values[f],persona.DisplayName,now))).ToArray();

    // Repair only copies created by the old reaffirmation path. Genuine source proposals,
    // distinct manufacturers, and explicitly rejected choices are never merged.
    private static SimManufacturerIdentity CurrentManufacturerIdentity(SimManufacturerIdentity identity)
    {
        bool Copy(DleManufacturerProposal p) => p.SourceLabel=="Manual Technical Review correction" &&
            p.MatchBasis.Contains("Human reaffirmation after BOM field correction");
        var aliases=new Dictionary<string,string>();
        foreach(var group in identity.Proposals.GroupBy(p=>(p.PartNumber,p.ManufacturerName))) {
            var members=group.ToArray();var originals=members.Where(p=>!Copy(p)).ToArray();
            if(originals.Length>1||members.Any(p=>identity.Decision(p.Id)=="REJECTED"))continue;
            var keep=originals.SingleOrDefault()??members[0];
            foreach(var copy in members.Where(p=>Copy(p)&&p.Id!=keep.Id))aliases[copy.Id]=keep.Id;
        }
        var proposals=identity.Proposals.Where(p=>!aliases.ContainsKey(p.Id)).ToArray();
        var history=identity.History.Select(h=>aliases.TryGetValue(h.ProposalId,out var keep)?h with{ProposalId=keep}:h)
            .GroupBy(h=>h.ProposalId).Select(g=>g.OrderBy(h=>h.AtUtc).ThenBy(h=>h.Decision=="CONFIRMED"?1:0).Last()).ToArray();
        return identity with {Proposals=proposals,History=history,Revision=identity.Revision+(aliases.Count>0?1:0)};
    }
}
