// A primary identity decision is independent of manufacturer evidence and supply responsibility.
internal sealed record SimCandidatePrimaryIdentity(string Basis, string? PartNumber, string? CustomerBomPartNumber,
    string Reviewer, DateTimeOffset ReviewedAtUtc);
internal sealed record SimIdentityBasisChange(string Basis, string? PartNumber, string ExpectedToken);

internal static partial class SimCandidateBomProvider
{
    internal static bool HasCustomerIdentity(SimCandidateRow row) => row.IdentityBasis == "CUSTOMER_PN" &&
        row.PrimaryIdentity is { PartNumber.Length: > 0 and <= 200, Reviewer.Length: > 0 } identity &&
        !string.IsNullOrWhiteSpace(identity.PartNumber) && identity.ReviewedAtUtc != default &&
        identity.CustomerBomPartNumber == row.Values.GetValueOrDefault("partNumber");

    private static SimCandidateBom ReviewIdentityBasis(SimCandidateBom bom, int index, SimIdentityBasisChange change, SimPersona persona)
    {
        var row=bom.Rows[index];
        if(row.ComponentType=="DNP")throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_TYPE","DNP is a disposition and needs no primary identity.");
        if(row.ComponentType=="SUBASSEMBLY")throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_TYPE","Use Assembly P/N for a Subassembly row.");
        if(change.ExpectedToken!=row.ReviewState.Token)
            throw SimRfqIntakeProblem.Conflict("SIM_IDENTITY_BASIS_STALE","This row changed. Reopen before saving identity basis.");
        var number=change.PartNumber?.Trim();
        if(change.Basis is not ("CUSTOMER_PN" or "MANUFACTURER_PN") ||
            (change.Basis=="CUSTOMER_PN" && (string.IsNullOrWhiteSpace(number)||number.Length>200||string.IsNullOrWhiteSpace(row.Values.GetValueOrDefault("partNumber")))))
            throw SimRfqIntakeProblem.BadRequest("SIM_IDENTITY_BASIS_INVALID","Choose a valid identity basis and Customer P/N (maximum 200 characters).");
        var identity=new SimCandidatePrimaryIdentity(change.Basis,change.Basis=="CUSTOMER_PN"?number:null,
            change.Basis=="CUSTOMER_PN"?row.Values["partNumber"]:null,persona.DisplayName,DateTimeOffset.UtcNow);
        var rows=bom.Rows.ToArray();
        rows[index]=row with {PrimaryIdentity=identity,Confirmed=false,WorkingState=new(row.WorkingState?.ValuesChanged??false,null,null,null)};
        return bom with {Rows=rows};
    }
}
