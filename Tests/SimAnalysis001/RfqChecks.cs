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
        var defaultRow=SimRfqIntakeStore.DefaultMaterialQuantity(new(0),source with{Values=new(){["quantity"]="3"}},25);
        Check(defaultRow.OrderQuantity==75&&defaultRow.OrderQuantityMode=="AUTO","3 per unit times 25 defaults to 75");
        Check(SimRfqIntakeStore.DefaultMaterialQuantity(defaultRow,source with{Values=new(){["quantity"]="4"}},25).OrderQuantity==100,"automatic quantity follows changed requirement");
        Check(SimRfqIntakeStore.DefaultMaterialQuantity(defaultRow with{OrderQuantity=100,OrderQuantityMode="MANUAL"},source,100).OrderQuantity==100,"manual quantity survives requirement change");
        Check(SimRfqIntakeStore.DefaultMaterialQuantity(new(0,OrderQuantity:100),source,100).OrderQuantity==100,"legacy saved quantity stays manual");
        Check(SimRfqIntakeStore.DefaultMaterialQuantity(new(0,CustomerSupplied:true),source,25).OrderQuantity is null,"customer supply exempt from automatic purchasing quantity");
        Check(SimRfqIntakeStore.DefaultMaterialQuantity(defaultRow with{OrderQuantity=null,OrderQuantityMode="MANUAL"},source,25).OrderQuantity is null,"manual blank is preserved");
        var arithmetic=SimRfqIntakeStore.CalculateMaterial(new(0,"Fixture",1.235m,10,7),source,4);
        Check(arithmetic.RequiredQuantity==10&&arithmetic.ExtendedCost==12.35m&&arithmetic.AssemblyCost==3.09m,"fractional BOM quantity and order-based rounding");
        Check(!SimRfqIntakeStore.CalculateMaterial(new(0),source with {ComponentType="REFERENCE_ONLY"},4).Required,"reference-only rows do not require purchasing quotations");
        Check(view.Plan.Revision==0&&view.Rows.Length==6,"accepted BOM initializes quotation rows");
        Check(view.Rows[0].RequiredQuantity==1,"required quantity uses BOM per assembly times RFQ quantity");
        await Block(()=>store.SaveRfqLane(record.IntakeId,"materials","COMPLETE",persona),"generic lane completion cannot bypass quotation validation");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(0,view.Plan.Rows,true),persona),"incomplete lines block completion");
        var partial=view.Plan.Rows.Select((r,i)=>i==0?r with{Vendor="Synthetic Vendor",UnitPrice=1.235m,OrderQuantity=10,OrderQuantityMode="MANUAL",LeadDays=7,Notes="Test only",MfgPartNumber="MFG-TEST",VendorPartNumber="VENDOR-TEST",Uom="FT"}:r).ToArray();
        var labor=await store.ReadLabor(record.IntakeId);
        Check(labor.Plan.Template=="PCB Assembly — SMT / Thru-Hole"&&labor.Plan.Operations.Any(o=>o.Name=="SMT Placement")&&labor.Plan.Operations.Any(o=>o.Name=="Thru-Hole Assembly"),"PCB and legacy default labor template contains editable SMT/Thru-Hole operations");
        await Block(()=>store.SaveRfqLane(record.IntakeId,"labor","COMPLETE",persona),"generic Labor completion cannot bypass quotation validation");
        await Task.WhenAll(store.SaveMaterials(record.IntakeId,new(0,partial),persona),store.SaveLabor(record.IntakeId,new(labor.Plan.Revision,labor.Plan.DefinitionId,labor.Plan.Quantity,labor.Plan.Operations,75,0,true,"LABOR_BATCH_ALLOCATION_V6"),persona));
        view=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(view.Plan.Rows[0].OrderQuantityMode=="MANUAL"&&view.Plan.Rows[0].OrderQuantity==10&&view.Plan.Rows[0].Vendor=="Synthetic Vendor"&&view.Plan.Rows[0].Notes=="Test only"&&view.Plan.Rows[0].MfgPartNumber=="MFG-TEST"&&view.Plan.Rows[0].VendorPartNumber=="VENDOR-TEST"&&view.Plan.Rows[0].Uom=="FT"&&view.Rows[0].ExtendedCost==12.35m,"partial save and decimal arithmetic survive store restart");
        Check(view.Rfq.Lanes.Labor.Status=="COMPLETE"&&view.Rfq.Lanes.Materials.Status=="IN_PROGRESS","concurrent save preserves independent Labor status");
        Check(view.LinesQuoted==1&&view.LongestLeadDays==7,"summary uses saved data");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(0,partial),persona),"stale revision cannot overwrite another save");
        var full=view.Plan.Rows.Select(r=>r with{Vendor="Synthetic Vendor",UnitPrice=2,OrderQuantity=10,OrderQuantityMode="MANUAL",LeadDays=14}).ToArray();
        full[0]=full[0] with{CustomerSupplied=true,Notes="Customer supplies this fixture line"};
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full,true),persona);
        Check(view.Rfq.Status=="READY_FOR_QUOTE_ASSEMBLY"&&view.Plan.Versions.Length==1&&view.TotalCost==100,"completion creates durable snapshot with customer-supplied cost zero");
        var snapshot=JsonSerializer.Serialize(view.Plan.Versions[0]);
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full),persona);
        Check(view.Rfq.Lanes.Materials.Status=="IN_PROGRESS"&&JsonSerializer.Serialize(view.Plan.Versions[0])==snapshot,"editing reopens work while preserving previous completion");
        view=await store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full,true),persona);
        var restarted=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(restarted.Plan.Versions.Length==1&&restarted.Rfq.Lanes.Materials.Status=="COMPLETE"&&JsonSerializer.Serialize(restarted.Plan.Versions[0])==snapshot,"unchanged completion retains immutable version through restart");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(view.Plan.Revision,full.Select(r=>r with{UnitPrice=-1}).ToArray()),persona),"negative prices rejected");
        Check(await File.ReadAllTextAsync(path)==before,"accepted BOM and Technical Review bytes unchanged");
        foreach(var excluded in new[]{record with{Status="TECHNICAL_REVIEW_IN_PROGRESS"},record with{IntakeType="NEW_ORDER"},record with{TechnicalReview=record.TechnicalReview! with{Workflow=record.TechnicalReview!.Workflow! with{Outputs=null}}}}){await File.WriteAllTextAsync(path,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{excluded}},DleAnalysisContract.Json));Check((await store.ReadRfqs()).Length==0,"ineligible source excluded");await Block(()=>store.SaveMaterials(record.IntakeId,new(0,full),persona),"ineligible source cannot save");}
        await File.WriteAllTextAsync(path,before);
        var identityData=System.Text.Json.Nodes.JsonNode.Parse(before)!;
        var identityRow=identityData["records"]![0]!["technicalReview"]!["workflow"]!["outputs"]!["materials"]!["candidate"]!["rows"]![1]!;
        identityRow["manufacturerIdentity"]=System.Text.Json.Nodes.JsonNode.Parse("""{"proposals":[{"id":"p","partNumber":"PENDING"},{"id":"a","partNumber":"MFG-A"},{"id":"b","partNumber":"MFG-B"},{"id":"r","partNumber":"REJECTED"}],"history":[{"proposalId":"a","decision":"CONFIRMED"},{"proposalId":"b","decision":"CONFIRMED"},{"proposalId":"r","decision":"REJECTED"}]}""");
        await File.WriteAllTextAsync(path,identityData.ToJsonString());
        var identityView=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(identityView.Plan.Rows[1].MfgPartNumber=="MFG-A","first confirmed accepted identity defaults; pending and rejected excluded");
        var priorVersions=JsonSerializer.Serialize(identityView.Plan.Versions);
        var identityBytes=await File.ReadAllTextAsync(path);
        await store.SaveMaterials(record.IntakeId,new(identityView.Plan.Revision,identityView.Plan.Rows.Select(r=>r.Index==1?r with {MfgPartNumber="MFG-B"}:r).ToArray()),persona);
        var identityReopen=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(identityReopen.Plan.Rows[1].MfgPartNumber=="MFG-B" && JsonSerializer.Serialize(identityReopen.Plan.Versions)==priorVersions,"explicit manufacturer selection survives reopen without rewriting historical versions");
        Check(await File.ReadAllTextAsync(path)==identityBytes,"manufacturer quotation choice leaves Accepted BOM and review history unchanged");
        Check(identityReopen.Plan.Rows[1].MfgPartNumberSource=="CONFIRMED_ACCEPTED_BOM","confirmed selection source survives reopen");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(identityReopen.Plan.Revision,identityReopen.Plan.Rows.Select(r=>r.Index==1?r with {MfgPartNumber="PENDING"}:r).ToArray()),persona),"unconfirmed P/N cannot claim Accepted BOM source");
        await store.SaveMaterials(record.IntakeId,new(identityReopen.Plan.Revision,identityReopen.Plan.Rows.Select(r=>r.Index==1?r with {MfgPartNumber="MFG-A",MfgPartNumberSource="MANUAL_QUOTE_ONLY"}:r).ToArray()),persona);
        var manualReopen=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(manualReopen.Plan.Rows[1].MfgPartNumber=="MFG-A" && manualReopen.Plan.Rows[1].MfgPartNumberSource=="MANUAL_QUOTE_ONLY" && JsonSerializer.Serialize(manualReopen.Plan.Versions)==priorVersions,"matching manual text stays quote-only across restart with history unchanged");
        var structured=manualReopen.Plan.Rows.Select((r,i)=>r with {Uom=i==0?"FT":null,LeadTimeMode=i==0?"STOCK":i==1?"DAYS":"WEEKS",LeadTimeValue=i==0?null:i==1?5:6}).ToArray();
        await store.SaveMaterials(record.IntakeId,new(manualReopen.Plan.Revision,structured),persona);
        var leadReopen=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(leadReopen.Plan.Rows[0].Uom=="FT"&&leadReopen.Plan.Rows[1].Uom=="EA","UoM defaults and explicit FT survive restart without conversion");
        Check(leadReopen.Plan.Rows[0].LeadTimeMode=="STOCK"&&leadReopen.Plan.Rows[0].LeadTimeValue is null&&leadReopen.Plan.Rows[2].LeadTimeValue==6&&leadReopen.Plan.Rows[2].LeadTimeMode=="WEEKS"&&leadReopen.Plan.Rows[2].LeadDays is null&&leadReopen.LongestLeadDays==42,"quoted lead units survive restart; summary normalizes only for comparison");
        Check(JsonSerializer.Serialize(leadReopen.Plan.Versions)==priorVersions,"structured edits preserve historical completed snapshots");
        foreach(var bad in new int?[]{null,0,-1,36501}) await Block(()=>store.SaveMaterials(record.IntakeId,new(leadReopen.Plan.Revision,structured.Select(r=>r with{LeadTimeMode="DAYS",LeadTimeValue=bad}).ToArray()),persona),"invalid structured lead rejected");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(leadReopen.Plan.Revision,structured.Select(r=>r with{LeadTimeMode="STOCK",LeadTimeValue=5}).ToArray()),persona),"Stock numeric value rejected");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(leadReopen.Plan.Revision,structured.Select(r=>r with{Uom="KG"}).ToArray()),persona),"new unsupported UoM rejected");
        var vendors=leadReopen.Plan.Rows.Select((r,i)=>i==0?r with{Vendor="Digi-Key",VendorSource="SIM_LIST"}:r with{Vendor="Synthetic Vendor",VendorSource="MANUAL_QUOTE_ONLY",Notes="Synthetic vendor note"}).ToArray();
        await store.SaveMaterials(record.IntakeId,new(leadReopen.Plan.Revision,vendors),persona);
        var vendorRestart=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(vendorRestart.Plan.Rows[0].VendorSource=="SIM_LIST"&&vendorRestart.Plan.Rows[1].VendorSource=="MANUAL_QUOTE_ONLY"&&vendorRestart.Plan.Rows[1].Notes=="Synthetic vendor note","vendor source and shared Notes survive restart");
        Check(JsonSerializer.Serialize(vendorRestart.Plan.Versions)==priorVersions,"vendor edits preserve completed history");
        Check(SimRfqIntakeStore.MaterialUnitSale(1500m,25m,25)==75m&&SimRfqIntakeStore.MaterialUnitSale(1500m,25.5m,25)==75.30m,"exact markup calculation and decimal percent");
        var markupSaved=await store.SaveMaterials(record.IntakeId,new(vendorRestart.Plan.Revision,vendorRestart.Plan.Rows,true,25.5m),persona);
        var markupRestart=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
        Check(markupRestart.Plan.MarkupPercent==25.5m&&markupRestart.Plan.Versions.Last().MarkupPercent==25.5m&&markupRestart.Plan.Versions.Last().MaterialUnitSalePrice==SimRfqIntakeStore.MaterialUnitSale(markupRestart.TotalCost,25.5m,markupRestart.Rfq.Assemblies[0].Quantity),"markup and sale snapshot survive restart");
        Check(JsonSerializer.Serialize(markupRestart.Plan.Versions.Take(vendorRestart.Plan.Versions.Length))==priorVersions,"markup preserves historical versions");
        await Block(()=>store.SaveMaterials(record.IntakeId,new(markupRestart.Plan.Revision,markupRestart.Plan.Rows,false,-1),persona),"negative markup rejected");
        await File.WriteAllTextAsync(path,before);
        await MaterialChargeChecks.Run(root, record, persona);
        await MaterialEvidenceChecks.Run(root, record, persona);
        await LaborChecks.Run(root, record, persona);
        Console.WriteLine("RFQS_FIXTURE_ROOT="+root);
    }
}
