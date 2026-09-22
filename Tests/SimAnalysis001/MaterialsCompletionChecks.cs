internal static class MaterialsCompletionChecks
{
    internal static async Task Run(SimRfqIntakeStore store,string id,SimPersona persona)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Materials completion "+label);}
        await MaterialSourcingChecks.Run(store,id,persona);
        var v=await store.ReadMaterials(id);var count=v.Plan.Versions.Length;
        var history=System.Text.Json.JsonSerializer.Serialize(v.Plan.Versions);
        var labor=System.Text.Json.JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote);
        async Task Save(bool complete){v=await store.SaveMaterials(id,new(v.Plan.Revision,v.Plan.Rows,complete,v.Plan.MarkupPercent),persona);}
        await Save(true);await Save(true);Check(v.Plan.Versions.Length==count,"repeated Complete retains latest version");
        await Save(false);await Save(true);Check(v.Plan.Versions.Length==count&&v.Rfq.Lanes.Materials.Status=="COMPLETE","identical Save then Complete restores status without version");
        Check(System.Text.Json.JsonSerializer.Serialize(v.Plan.Versions)==history,"historical snapshots exactly unchanged");
        var snapshot=v.Plan.Versions.Last();
        Check(SimRfqIntakeStore.SameMaterialBusiness(snapshot,snapshot with{Version=999,UpdatedBy="Other",AtUtc=DateTimeOffset.UtcNow,Rows=snapshot.Rows.Reverse().ToArray(),MarkupPercent=25.000m}),"audit metadata row order and decimal scale ignored");
        var rows=v.Plan.Rows.ToArray();rows[0]=rows[0] with{UnitPrice=rows[0].UnitPrice+1};
        v=await store.SaveMaterials(id,new(v.Plan.Revision,rows,true,v.Plan.MarkupPercent),persona);
        Check(v.Plan.Versions.Length==count+1,"changed business price creates one next version");
        await Save(true);Check(v.Plan.Versions.Length==count+1,"changed version repeat is idempotent");
        Check(System.Text.Json.JsonSerializer.Serialize(v.Plan.Versions.Take(count))==history,"old versions retained after changed completion");
        Check(System.Text.Json.JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote)==labor,"Labor unchanged");
        var bad=v.Plan.Rows.ToArray();bad[0]=bad[0] with{Vendor=""};
        try{await store.SaveMaterials(id,new(v.Plan.Revision,bad,true,v.Plan.MarkupPercent),persona);throw new Exception("invalid completion accepted");}catch(SimRfqIntakeProblem){Check(true,"validation still precedes comparison");}
    }
}
