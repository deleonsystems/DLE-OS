using System.Text.Json;
internal sealed class QuoteFixture
{
 internal Fixture F=null!;internal string Id=>F.Id;internal SimRfqIntakeStore Store=>F.Store;internal SimMaterialPartBatchView Kept=null!;internal string KeptBytes="";
 internal static async Task<QuoteFixture> Create(){var q=new QuoteFixture{F=await Fixture.Create()};await q.Complete(0);var s=await q.Store.ReadMaterialPartRequests(q.Id,SimPersonaCatalog.Default);q.Kept=await q.Store.CreateMaterialPartRequest(q.Id,new(s.Token,Guid.NewGuid().ToString(),"INTERNAL_BOM_UPDATE",[1,2,3],"Fixture existing allowance",RoutingContractVersion:2),SimPersonaCatalog.Default);q.KeptBytes=await File.ReadAllTextAsync(Path.Combine(q.F.Root,"material-part-requests-v1",q.Kept.Id+".json"));return q;}
 internal async Task Complete(int index){var record=SimRfqIntakeStore.BuildLibraryRfqRecord(F.Receipts[index],F.Packages[index]);var inputs=record.TechnicalReview!.Workflow!.Outputs!;var accepted=inputs.Materials;var quantity=record.Assemblies[0].Quantity;
 var rows=accepted.Candidate.Rows.Select(s=>SimRfqIntakeStore.DefaultMaterialQuantity(SimRfqIntakeStore.MaterialIdentityDefaults(new(s.Index,Vendor:"PRIVATE_VENDOR_SENTINEL",UnitPrice:1,LeadDays:7,Notes:"PRIVATE_NOTE_SENTINEL"),s),s,quantity) with{MfgPartNumber="PROPOSED-"+s.Index,MfgPartNumberSource="MANUAL_QUOTE_ONLY",PartReviewMode="PROPOSED_PART"}).ToArray();
 var calc=rows.Select(r=>SimRfqIntakeStore.CalculateMaterial(r,accepted.Candidate.Rows.Single(s=>s.Index==r.Index),quantity)).ToArray();var total=calc.Sum(r=>r.ExtendedCost??0);
 var ms=new SimMaterialSnapshot(1,accepted.Version,accepted.Candidate.Id,quantity,calc,total,"USD","QA",F.Actor.AtUtc,0,total/quantity);var material=new SimMaterialPlan(1,accepted.Version,accepted.Candidate.Id,rows,"QA",F.Actor.AtUtc,[ms],0);
 var totals=new SimLaborTotals(0,50,50,50m/60,50,150,3,NreTotal:15);var charges=new[]{new SimLaborCharge(Guid.NewGuid().ToString(),"NRE","Fixture tooling",15)};
 var ls=new SimLaborSnapshot(1,inputs.Manufacturing.Id,quantity,[],777,222,totals,"QA",F.Actor.AtUtc,Charges:charges,ManufacturingLead:new(2,"DAYS"),PricingQuantity:25);
 var labor=new SimLaborPlan(1,inputs.Manufacturing.Id,quantity,"QA",[],777,222,"QA",F.Actor.AtUtc,[ls],Charges:charges,ManufacturingLead:new(2,"DAYS"),PricingQuantity:25);
 var path=Path.Combine(F.Root,"data/rfq-lanes.json");var lanes=File.Exists(path)?JsonSerializer.Deserialize<Dictionary<string,SimRfqLanes>>(await File.ReadAllTextAsync(path),Fixture.Json)!:new();lanes[record.IntakeId]=new(new("COMPLETE","QA",F.Actor.AtUtc),new("COMPLETE","QA",F.Actor.AtUtc),material,labor);await File.WriteAllTextAsync(path,JsonSerializer.Serialize(lanes,Fixture.Json));}
}
