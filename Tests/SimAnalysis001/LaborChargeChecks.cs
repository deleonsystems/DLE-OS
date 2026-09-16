using System.Text.Json;
internal static class LaborChargeChecks
{
    internal static async Task Run(string root, SimRfqIntakeRecord record, SimPersona persona)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Labor charges "+label);}
        async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem){Check(true,label);return;}throw new Exception(label);}
        SimLaborCharge Charge(string kind,string label,decimal? amount)=>new(Guid.NewGuid().ToString("D"),kind,label,amount);
        var charges=new[]{Charge("RECURRING","Reflow",1m),Charge("RECURRING","Cleaning / Washing",0.5m),Charge("RECURRING","Packing Material",0.25m),Charge("NRE","SMT Programming",150m),Charge("NRE","Tooling",250m)};
        SimLaborOperation[] ops=[new("supplemental-test","Synthetic base",OperationQuantity:1,RunSeconds:13690.8m)];
        var math=SimRfqIntakeStore.CalculateLabor(ops,25,60,25,charges);
        Check(math.BaseLaborCost==228.18m&&math.ConsumablesPerUnit==1.75m&&math.Cost==229.93m&&math.UnitSalePrice==287.41m&&math.NreTotal==400m,"228.18 + 1.75 = 229.93; markup 25% = 287.41; NRE separate 400");
        var onlyRecurring=SimRfqIntakeStore.CalculateLabor(ops,25,60,25,charges.Where(c=>c.Kind=="RECURRING").ToArray());
        Check(onlyRecurring.UnitSalePrice==math.UnitSalePrice&&onlyRecurring.Cost==math.Cost,"NRE does not change recurring cost or unit sale");
        Check(SimRfqIntakeStore.CalculateLabor(ops,250,60,25,charges).NreTotal==400m,"NRE never divided by quoted quantity");
        Check(SimRfqIntakeStore.CalculateLabor(ops,25,120,25,charges).UnitSalePrice==572.64m,"rate and markup apply to recurring cost");
        Check(SimRfqIntakeStore.CalculateLabor([new("tiny","Tiny",OperationQuantity:1,RunSeconds:0.004m)],1,3600,0,[Charge("RECURRING","Fraction",0.001m)]).UnitSalePrice==0.01m,"unrounded base plus recurring amount rounded once at final cent");
        var store=new SimRfqIntakeStore(root);var view=await store.ReadLabor(record.IntakeId);
        var materials=JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote);var source=await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"));
        var priorVersions=JsonSerializer.Serialize(view.Plan.Versions);
        SimLaborRequest Request(SimLaborCharge[]? rows,bool complete=false)=>new(view.Plan.Revision,view.Plan.DefinitionId,view.Plan.Quantity,view.Plan.Operations,60,25,complete,view.Plan.CalculationVersion,1,1,rows,1);
        foreach(var bad in new[]{charges[0] with{Amount=-1},charges[0] with{Amount=1000001},charges[0] with{Amount=0.0000001m},charges[0] with{Kind="OTHER"},charges[0] with{Label=new string('x',121)}})
            await Block(()=>store.SaveLabor(record.IntakeId,Request([bad]),persona),"invalid amount/kind/label blocked");
        await Block(()=>store.SaveLabor(record.IntakeId,Request([charges[0],charges[0]]),persona),"duplicate charge IDs blocked");
        await Block(()=>store.SaveLabor(record.IntakeId,Request([charges[0] with{Amount=null}],true),persona),"incomplete amount blocks completion");
        await Block(()=>store.SaveLabor(record.IntakeId,Request([charges[0] with{Label=" "}],true),persona),"incomplete label blocks completion");
        view=await store.SaveLabor(record.IntakeId,Request(charges,true),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(record.IntakeId);
        Check(JsonSerializer.Serialize(view.Plan.Charges)==JsonSerializer.Serialize(charges)&&view.Plan.Rate==60&&view.Plan.Markup==25&&view.Totals.NreTotal==400,"charges labels amounts rate markup survive restart");
        Check(JsonSerializer.Serialize(view.Plan.Versions.Take(view.Plan.Versions.Length-1))==priorVersions&&view.Plan.Versions.Last().Totals.NreTotal==400&&view.Plan.Versions.Last().Charges!.Length==5,"completed snapshot captures charges and separate NRE; prior history untouched");
        var history=JsonSerializer.Serialize(view.Plan.Versions);
        await Block(()=>store.SaveLabor(record.IntakeId,Request(null) with{ChargeContractVersion=0},persona),"older client cannot erase supplemental charges");
        var edited=charges.Select(c=>c.Id==charges[0].Id?c with{Label="Manual consumable",Amount=2.25m}:c).ToArray();
        view=await store.SaveLabor(record.IntakeId,Request(edited),persona);
        Check(view.Plan.Charges![0].Label=="Manual consumable"&&view.Totals.ConsumablesPerUnit==3m&&JsonSerializer.Serialize(view.Plan.Versions)==history,"edit manual label and amount without rewriting completed history");
        view=await store.SaveLabor(record.IntakeId,Request(edited.Where(c=>c.Kind=="RECURRING").ToArray()),persona);
        Check(view.Totals.NreTotal==0&&view.Totals.ConsumablesPerUnit==3m,"remove NRE independently");
        view=await store.SaveLabor(record.IntakeId,Request([]),persona);
        Check(view.Plan.Charges is null&&view.Totals.NreTotal is null&&JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote)==materials,"remove all charges restores base pricing and preserves Materials");
        Check(await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"))==source,"Intake and Technical Review remain unchanged");
    }
}
