using System.Text.Json;
internal static class RfqChecks
{
    internal static async Task Run(string root, SimRfqIntakeRecord record, SimPersona persona)
    {
        void Check(bool value,string text){if(!value)throw new Exception("FAIL: Materials "+text);Console.WriteLine("PASS: Materials "+text);}
        async Task Block(Func<Task> action,string text){try{await action();throw new Exception("Expected rejection: "+text);}catch(SimRfqIntakeProblem){Check(true,text);}}
        var store=new SimRfqIntakeStore(root);var path=Path.Combine(root,"data","rfq-intakes.json");var before=await File.ReadAllTextAsync(path);
        var view=await store.ReadMaterials(record.IntakeId);
        var source=record.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows[0] with {Values=new(){["quantity"]="2.5"}};
        var arithmetic=SimRfqIntakeStore.CalculateMaterial(new(0,"Fixture",1.235m,10,7),source,4);
        Check(arithmetic.RequiredQuantity==10&&arithmetic.ExtendedCost==12.35m&&arithmetic.AssemblyCost==3.09m,"fractional BOM quantity and order-based rounding");
        Check(!SimRfqIntakeStore.CalculateMaterial(new(0),source with {ComponentType="REFERENCE_ONLY"},4).Required,"reference-only rows do not require purchasing quotations");
        Check(view.Plan.Revision==0&&view.Rows.Length==6,"accepted BOM initializes quotation rows");
        Check(view.Rows[0].RequiredQuantity==1,"required quantity uses BOM per assembly times RFQ quantity");
        await Block(()=>store.SaveRfqLane(record.IntakeId,"materials","COMPLETE",persona),"generic lane completion cannot bypass quotation validation");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(0,view.Plan.Rows,true),persona),"incomplete lines block completion");
        var partial=view.Plan.Rows.Select((r,i)=>i==0?r with{Vendor="Synthetic Vendor",UnitPrice=1.235m,OrderQuantity=10,LeadDays=7,Notes="Test only",MfgPartNumber="MFG-TEST",VendorPartNumber="VENDOR-TEST",Uom="FT"}:r).ToArray();
        await Task.WhenAll(store.SaveMaterials(record.IntakeId,new(0,partial),persona),store.SaveRfqLane(record.IntakeId,"labor","COMPLETE",persona));
        view=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(view.Plan.Rows[0].Vendor=="Synthetic Vendor"&&view.Plan.Rows[0].Notes=="Test only"&&view.Plan.Rows[0].MfgPartNumber=="MFG-TEST"&&view.Plan.Rows[0].VendorPartNumber=="VENDOR-TEST"&&view.Plan.Rows[0].Uom=="FT"&&view.Rows[0].ExtendedCost==12.35m,"partial save and decimal arithmetic survive store restart");
        Check(view.Rfq.Lanes.Labor.Status=="COMPLETE"&&view.Rfq.Lanes.Materials.Status=="IN_PROGRESS","concurrent save preserves independent Labor status");
        Check(view.LinesQuoted==1&&view.LongestLeadDays==7,"summary uses saved data");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(0,partial),persona),"stale revision cannot overwrite another save");
        var full=view.Plan.Rows.Select(r=>r with{Vendor="Synthetic Vendor",UnitPrice=2,OrderQuantity=10,LeadDays=14}).ToArray();
        full[0]=full[0] with{CustomerSupplied=true,Notes="Customer supplies this fixture line"};
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full,true),persona);
        Check(view.Rfq.Status=="READY_FOR_QUOTE_ASSEMBLY"&&view.Plan.Versions.Length==1&&view.TotalCost==100,"completion creates durable snapshot with customer-supplied cost zero");
        var snapshot=JsonSerializer.Serialize(view.Plan.Versions[0]);
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full),persona);
        Check(view.Rfq.Lanes.Materials.Status=="IN_PROGRESS"&&JsonSerializer.Serialize(view.Plan.Versions[0])==snapshot,"editing reopens work while preserving previous completion");
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full,true),persona);
        var restarted=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(restarted.Plan.Versions.Length==2&&restarted.Rfq.Lanes.Materials.Status=="COMPLETE","versioned completion survives restart");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full.Select(r=>r with{UnitPrice=-1}).ToArray()),persona),"negative prices rejected");
        Check(await File.ReadAllTextAsync(path)==before,"accepted BOM and Technical Review bytes unchanged");
        foreach(var excluded in new[]{record with{Status="TECHNICAL_REVIEW_IN_PROGRESS"},record with{IntakeType="NEW_ORDER"},record with{TechnicalReview=record.TechnicalReview! with{Workflow=record.TechnicalReview!.Workflow! with{Outputs=null}}}}){await File.WriteAllTextAsync(path,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{excluded}},DleAnalysisContract.Json));Check((await store.ReadRfqs()).Length==0,"ineligible source excluded");await Block(()=>store.SaveMaterials(record.IntakeId,new(0,full),persona),"ineligible source cannot save");}
        await File.WriteAllTextAsync(path,before);Console.WriteLine("RFQS_FIXTURE_ROOT="+root);
    }
}
