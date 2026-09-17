using System.Text.Json;
internal static class MaterialChargeChecks
{
    internal static async Task Run(string root,SimRfqIntakeRecord record,SimPersona persona)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Material charges "+label);}
        async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem){Check(true,label);return;}throw new Exception(label);}
        var path=Path.Combine(root,"data","rfq-lanes.json");var before=await File.ReadAllTextAsync(path);
        try {
            var store=new SimRfqIntakeStore(root);var v=await store.ReadMaterials(record.IntakeId);
            var originalRows=v.Plan.Rows;var versions=JsonSerializer.Serialize(v.Plan.Versions);var labor=JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote);
            SimMaterialCharge C(string treatment,decimal cost)=>new(Guid.NewGuid().ToString("D"),"Synthetic fee","OTHER",cost,treatment,"MATERIAL");
            var charges=new[]{C("BLEND",100),C("SEPARATE",50),C("NRE",250)};
            var testRows=new[]{new SimMaterialRow(0,Charges:charges)};
            var t=SimRfqIntakeStore.MaterialCommercial(500,testRows,40,25);
            Check(t.BomMaterialCost==500&&t.BlendedSupplementalCost==100&&t.RecurringMaterialCostBasis==600&&t.MaterialUnitSalePrice==33.60m&&t.SeparateCharges==70&&t.MaterialNre==350,"500 base + 100 blend at 40% yields 33.60/unit; 70 separate and 350 NRE");
            Check(t.MaterialUnitSalePrice-SimRfqIntakeStore.MaterialUnitSale(500,40,25)==5.60m,"blend contribution exactly 5.60/unit");
            var custom=charges[0] with{MarkupTreatment="CUSTOM",CustomMarkupPercent=12.5m};
            Check(SimRfqIntakeStore.MaterialCommercial(0,[new(0,Charges:[custom])],40,25).MaterialUnitSalePrice==4.50m,"custom markup independent of material markup");
            Check(SimRfqIntakeStore.MaterialCommercial(0,[new(0,Charges:[custom with{MarkupTreatment="NONE"}])],40,25).MaterialUnitSalePrice==4m,"no markup");
            Check(SimRfqIntakeStore.MaterialCommercial(0,[new(0,Charges:[C("SEPARATE",0.005m) with{MarkupTreatment="NONE"}])],40,25).SeparateCharges==0.01m,"midpoint rounds away from zero");
            var multiplied=SimRfqIntakeStore.MaterialCommercial(0,[new(0,Charges:[C("BLEND",20) with{Quantity=3},C("SEPARATE",20) with{Quantity=3},C("NRE",20) with{Quantity=3}])],40,1);
            Check(multiplied.MaterialUnitSalePrice==84 && multiplied.SeparateCharges==84 && multiplied.MaterialNre==84 && multiplied.BlendedSupplementalCost==60,"quantity scales all three pricing treatments");
            foreach(var example in new[]{(Qty:1m,Cost:200m,Mode:"MATERIAL",Rate:0m,Sell:276m),(Qty:3m,Cost:200m,Mode:"MATERIAL",Rate:0m,Sell:828m),(Qty:2m,Cost:100m,Mode:"CUSTOM",Rate:10m,Sell:220m),(Qty:5m,Cost:20m,Mode:"NONE",Rate:0m,Sell:100m)})
            foreach(var treatment in new[]{"BLEND","SEPARATE","NRE"}) {
                var totals=SimRfqIntakeStore.MaterialCommercial(0,[new(0,Charges:[C(treatment,example.Cost) with{Quantity=example.Qty,MarkupTreatment=example.Mode,CustomMarkupPercent=example.Rate}])],38,1);
                Check((treatment=="BLEND"?totals.MaterialUnitSalePrice:treatment=="SEPARATE"?totals.SeparateCharges:totals.MaterialNre)==example.Sell,"requested quantity example and "+treatment+" footer routing");
            }
            var rows=originalRows.Select((r,i)=>i==0?r with{Charges=charges}:r).ToArray();
            SimMaterialRequest Request(SimMaterialRow[] rs,bool complete=false)=>new(v.Plan.Revision,rs,complete,40,2);
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(rows) with{ChargeContractVersion=0},persona),"legacy client cannot introduce charges");
            foreach(var c in new[]{charges[0] with{Quantity=0},charges[0] with{Quantity=-1},charges[0] with{Quantity=1000001},charges[0] with{RawCost=-1},charges[0] with{Treatment="WRONG"},charges[0] with{CustomMarkupPercent=-1},charges[0] with{RawCost=0.0000001m}})
                await Block(()=>store.SaveMaterials(record.IntakeId,Request(rows.Select((r,i)=>i==0?r with{Charges=[c]}:r).ToArray()),persona),"invalid charge blocked");
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(rows.Select((r,i)=>i==0?r with{Charges=[charges[0] with{RawCost=null}]}:r).ToArray(),true),persona),"incomplete charge blocks completion");
            v=await store.SaveMaterials(record.IntakeId,Request(rows,true),persona);
            v=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
            Check(v.Plan.Rows[0].Charges!.Length==3&&v.SupplementalTotals!.SeparateCharges==70&&v.SupplementalTotals.MaterialNre==350,"save and fresh store preserve multiple children and separated totals");
            var final=await store.ReadFinalReview(record.IntakeId);
            Check(final.Summary.MaterialSupplemental!.SeparateCharges==70&&final.Summary.MaterialSupplemental.MaterialNre==350,"Final Review contract retains separate charge and material NRE identities/totals");
            var summary=final.Summary with{MaterialsComplete=true,LaborComplete=true,CombinedUnitPrice=10,Total=250,NreTotal=20};
            Check(summary.QuoteTotal==690,"grand total adds product, Labor NRE, material charge and material NRE once");
            var projection=JsonSerializer.Serialize(SimQuotationPdf.CustomerProjection(new("test",1,"token",summary,new("1 Week",null,null,null,"","","",null,""),"Fixture","fixture",DateTimeOffset.UtcNow)));
            Check(projection.Contains("materialSeparateTotal")&&projection.Contains("materialNreTotal")&&!projection.Contains("RawCost")&&!projection.Contains("MarkupTreatment"),"customer projection carries commercial sell amounts without internal costs or markup");
            var snapshot=v.Plan.Versions.Last();var count=v.Plan.Versions.Length;
            Check(snapshot.Rows[0].Quote.Charges!.Length==3&&snapshot.SupplementalTotals!.SeparateCharges==70,"completed snapshot retains charge business data and calculated amounts");
            Check(JsonSerializer.Serialize(v.Plan.Versions.Take(count-1))==versions,"prior completed history unchanged");
            v=await store.SaveMaterials(record.IntakeId,Request(v.Plan.Rows,true),persona);
            Check(v.Plan.Versions.Length==count,"unchanged re-complete idempotent");
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(originalRows) with{ChargeContractVersion=0},persona),"old client cannot erase saved charges");
            var moved=v.Plan.Rows.Select((r,i)=>i==0?r with{Charges=[]}:i==1?r with{Charges=charges}:r).ToArray();
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(moved),persona),"stable child cannot move to another parent");
            rows=v.Plan.Rows.Select((r,i)=>i==0?r with{Charges=charges.Select((c,j)=>j==0?c with{RawCost=101}:c).ToArray()}:r).ToArray();
            v=await store.SaveMaterials(record.IntakeId,Request(rows,true),persona);
            Check(v.Plan.Versions.Length==count+1&&JsonSerializer.Serialize(v.Plan.Versions[count-1])==JsonSerializer.Serialize(snapshot),"charge edit creates new version without rewriting previous snapshot");
            var priorQuantitySnapshot=JsonSerializer.Serialize(v.Plan.Versions.Last());var priorQuantityCount=v.Plan.Versions.Length;
            rows=v.Plan.Rows.Select((r,i)=>i==0?r with{Charges=r.Charges!.Select((c,j)=>j==0?c with{Quantity=3}:c).ToArray()}:r).ToArray();
            v=await store.SaveMaterials(record.IntakeId,Request(rows,true),persona);
            v=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
            Check(v.Plan.Rows[0].Charges![0].Quantity==3 && v.Plan.Versions.Length==priorQuantityCount+1 && JsonSerializer.Serialize(v.Plan.Versions[priorQuantityCount-1])==priorQuantitySnapshot,"quantity persists across fresh store and preserves historical snapshot");
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(v.Plan.Rows) with{ChargeContractVersion=1},persona),"old fee client cannot erase quantities");
            v=await store.SaveMaterials(record.IntakeId,Request(v.Plan.Rows,true),persona);
            Check(v.Plan.Versions.Length==priorQuantityCount+1,"quantity re-completion idempotent");
            Check(JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote)==labor,"Labor is untouched");
            v=await store.SaveMaterials(record.IntakeId,Request(originalRows),persona);
            Check(v.Plan.Rows.All(r=>r.Charges is null)&&v.SupplementalTotals!.SeparateCharges==0,"explicit removal clears current charges only");
        } finally {await File.WriteAllTextAsync(path,before);}
    }
}
