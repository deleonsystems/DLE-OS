internal sealed record SimMaterialCharge(string Id, string Description, string Category, decimal? RawCost,
    string Treatment, string MarkupTreatment, decimal? CustomMarkupPercent = null, string Notes = "",
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] decimal? Quantity = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialEvidence? Evidence = null);
internal sealed record SimMaterialChargeAmount(int ParentIndex, string Id, string Description, string Category,
    string Treatment, decimal RawCost, decimal SellAmount);
internal sealed record SimMaterialCommercialTotals(decimal BomMaterialCost, decimal BlendedSupplementalCost,
    decimal RecurringMaterialCostBasis, decimal MaterialUnitSalePrice, decimal SeparateCharges, decimal MaterialNre,
    SimMaterialChargeAmount[] Charges);
internal sealed partial class SimRfqIntakeStore
{
    internal static SimMaterialCommercialTotals MaterialCommercial(decimal bom, SimMaterialRow[] rows, decimal markup, int quantity)
    {
        var charges=rows.SelectMany(r=>(r.Charges ?? []).Select(c=>new SimMaterialChargeAmount(r.Index,c.Id,c.Description,c.Category,c.Treatment,(c.RawCost ?? 0)*(c.Quantity ?? 1),
            decimal.Round((c.RawCost ?? 0)*(c.Quantity ?? 1)*(1+(c.MarkupTreatment=="MATERIAL"?markup:c.MarkupTreatment=="CUSTOM"?c.CustomMarkupPercent ?? 0:0)/100),2,MidpointRounding.AwayFromZero)))).ToArray();
        var blended=charges.Where(c=>c.Treatment=="BLEND").Sum(c=>c.RawCost);
        var sale=decimal.Round((bom*(1+markup/100)+charges.Where(c=>c.Treatment=="BLEND").Sum(c=>c.SellAmount))/quantity,2,MidpointRounding.AwayFromZero);
        return new(bom,blended,bom+blended,sale,charges.Where(c=>c.Treatment=="SEPARATE").Sum(c=>c.SellAmount),charges.Where(c=>c.Treatment=="NRE").Sum(c=>c.SellAmount),charges);
    }
    private static void ValidateMaterialCharges(SimMaterialRequest request,SimMaterialPlan previous)
    {
        var all=request.Rows.SelectMany(r=>r.Charges ?? []).ToArray();
        if(request.ChargeContractVersion is not (1 or 2) && (all.Length>0 || previous.Rows.Any(r=>r.Charges?.Length>0)))
            throw SimRfqIntakeProblem.Conflict("MATERIAL_CHARGE_CLIENT","Reopen Materials with a current client to preserve supplemental charges.");
        if(request.ChargeContractVersion<2 && (all.Any(c=>c is not null && (c.Quantity ?? 1)!=1) || previous.Rows.Any(r=>(r.Charges ?? []).Any(c=>(c.Quantity ?? 1)!=1))))
            throw SimRfqIntakeProblem.Conflict("MATERIAL_CHARGE_CLIENT","Reopen Materials with a current client to preserve fee quantities.");
        if(all.Length>200 || all.Any(c=>c is null) || all.Select(c=>c.Id).Distinct().Count()!=all.Length)
            throw SimRfqIntakeProblem.Conflict("MATERIAL_CHARGES","Use at most 200 uniquely identified charges.");
        var existing=previous.Rows.Concat(previous.Versions.SelectMany(v=>v.Rows.Select(r=>r.Quote)))
            .SelectMany(r=>(r.Charges ?? []).Select(c=>(c.Id,r.Index))).ToArray();
        foreach(var row in request.Rows) foreach(var c in row.Charges ?? [])
        {
            if(!Guid.TryParse(c.Id,out _) || existing.Any(e=>e.Id==c.Id && e.Index!=row.Index) ||
                c.Description is null || c.Description.Length>200 || c.Notes is null || c.Notes.Length>2000 ||
                c.Category is not ("TARIFF" or "FREIGHT" or "COD" or "SETUP" or "TOOLING" or "OTHER") ||
                c.Treatment is not ("BLEND" or "SEPARATE" or "NRE") || c.MarkupTreatment is not ("MATERIAL" or "CUSTOM" or "NONE") ||
                c.Quantity is <=0 or >1000000 || (c.Quantity.HasValue && decimal.Round(c.Quantity.Value,6)!=c.Quantity.Value) ||
                c.RawCost is <0 or >1000000000 || (c.RawCost.HasValue && decimal.Round(c.RawCost.Value,6)!=c.RawCost.Value) ||
                c.CustomMarkupPercent is <0 or >10000 || (c.CustomMarkupPercent.HasValue && decimal.Round(c.CustomMarkupPercent.Value,6)!=c.CustomMarkupPercent.Value) ||
                (request.Complete && (string.IsNullOrWhiteSpace(c.Description) || c.RawCost is null || (c.MarkupTreatment=="CUSTOM" && c.CustomMarkupPercent is null))))
                throw SimRfqIntakeProblem.Conflict("MATERIAL_CHARGE_VALUES","Charges require a stable parent, valid category/treatment, nonnegative cost and markup; complete description and amounts before completion.");
        }
    }
}
