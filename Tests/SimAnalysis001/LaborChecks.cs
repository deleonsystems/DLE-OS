using System.Text.Json;
internal static class LaborChecks
{
    private static void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS: Labor "+name);}
    private static async Task Block(Func<Task> action,string name){try{await action();}catch(SimRfqIntakeProblem){Check(true,name);return;}throw new Exception(name);}
    internal static async Task Run(string root,SimRfqIntakeRecord record,SimPersona persona)
    {
        var store=new SimRfqIntakeStore(root);var id=record.IntakeId;
        var view=await store.ReadLabor(id);var original=await store.ReadRfqs();
        var sourceBytes=await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"));
        var materials=JsonSerializer.Serialize(original.Single(r=>r.IntakeId==id).Lanes.MaterialsQuote);
        var materialsStatus=JsonSerializer.Serialize(original.Single(r=>r.IntakeId==id).Lanes.Materials);
        var ops=new[]{new SimLaborOperation("first","Kitting",15,null,"Synthetic instructions",55,30),new SimLaborOperation("second","Inspection",null,null)};
        var math=SimRfqIntakeStore.CalculateLabor(ops,25,75,25);
        Check(math.TotalSeconds==1650&&math.TotalMinutes==27.5m&&math.Cost==34.38m&&math.SaleTotal==42.97m&&math.UnitSalePrice==42.97m,"55 × 0.5 = 27.5; setup excluded; deterministic rate/markup cents");
        Check(SimRfqIntakeStore.CalculateLabor([new("a","Blank")],25,75,25).TotalMinutes==0,"blank times contribute zero");
        SimLaborRequest Request(SimLaborOperation[] rows,bool complete=false)=>new(view.Plan.Revision,view.Plan.DefinitionId,view.Plan.Quantity,rows,75,25,complete,"LABOR_BATCH_ALLOCATION_V6");
        await Block(()=>store.SaveLabor(id,Request([ops[0] with{OperationQuantity=-1}]),persona),"negative time blocked");
        await Block(()=>store.SaveLabor(id,Request([ops[0] with{RunSeconds=0.0000001m}]),persona),"unsupported decimal precision blocked");
        await Block(()=>store.SaveLabor(id,Request([ops[0],ops[0]]),persona),"duplicate operation ID blocked");
        await Block(()=>store.SaveLabor(id,Request([],true),persona),"empty completion blocked");
        await Block(()=>store.SaveLabor(id,Request(ops,true) with{Rate=null},persona),"missing rate completion blocked");
        await Block(()=>store.SaveLabor(id,Request(ops) with{Quantity=view.Plan.Quantity+1},persona),"changed source quantity blocked");
        var second=SimRfqIntakeStore.CalculateLabor([ops[0] with {OperationQuantity=25,RunSeconds=90}],25,75,0);
        Check(second.TotalSeconds==2250&&second.TotalMinutes==37.5m,"25 × 90 seconds = 2250 seconds = 37.5 minutes");
        var old=view.Plan with{CalculationVersion="LABOR_OPERATION_QTY_V2",Operations=[ops[0] with{RunMinutes=0.5m,RunSeconds=null}]};
        var migrated=SimRfqIntakeStore.NormalizeLaborSeconds(old);
        Check(migrated.Operations[0].RunSeconds==30&&migrated.Operations[0].RunMinutes is null&&JsonSerializer.Serialize(old.Versions)==JsonSerializer.Serialize(migrated.Versions),"minute plans convert once without rewriting history");
        Check(SimRfqIntakeStore.NormalizeLaborSeconds(migrated)==migrated,"seconds conversion is idempotent");
        await Block(()=>store.SaveLabor(id,Request(ops) with{CalculationVersion="LABOR_OPERATION_QTY_V2"},persona),"stale minute-based client cannot save seconds plan");
        var stale=Request(ops);
        view=await store.SaveLabor(id,Request(ops,true),persona);
        await Block(()=>store.SaveLabor(id,stale,persona),"same-lane stale write blocked");
        var versions=JsonSerializer.Serialize(view.Plan.Versions);
        var reversed=new[]{ops[1],ops[0] with{Name="Edited",Instructions="Preserved routing"},new SimLaborOperation("third","Pack",1,null,OperationQuantity:1,RunSeconds:30)};
        view=await store.SaveLabor(id,Request(reversed),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.Operations[0].Id=="second"&&view.Plan.Operations[1].Instructions=="Preserved routing"&&view.Plan.Operations.Length==3,"add/reorder/edit survive store restart");
        Check(view.Rfq.Lanes.Labor.Status=="IN_PROGRESS"&&JsonSerializer.Serialize(view.Plan.Versions)==versions,"later edits reopen Labor and preserve completed versions");
        view=await store.SaveLabor(id,Request([reversed[1]]),persona);
        Check(view.Plan.Operations.Length==1&&view.Plan.Operations[0].OperationQuantity==55&&view.Plan.Operations[0].RunSeconds==30,"removed operation stays removed and Qty persists");
        var html=SimRfqIntakeEndpoints.BomReference(view.Rfq);
        Check(html.Contains("BOM Lines: "+view.Rfq.Inputs.Materials.Candidate.Rows.Length)&&html.Contains("Confirmed MFG P/N")&&!html.Contains("UnitPrice")&&!html.Contains("MaterialsQuote")&&!html.Contains("<input"),"BOM reference is technical-only, counted and read-only");
        Check(html.Contains("<th>Ref Des</th>") && html.Contains("Total Components:") && html.Contains("bom-selection") && html.Contains("/SRC/workspaces/rfqs/bom-reference.js"), "BOM reference exposes designators and local selection analysis");
        Check(SimRfqIntakeStore.CalculateLabor([ops[0] with {OperationQuantity=null}],25,75,0).TotalMinutes==0,"blank Qty contributes zero");
        Check(JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote)==materials&&JsonSerializer.Serialize(view.Rfq.Lanes.Materials)==materialsStatus,"Labor writes preserve Materials data/status exactly");
        var material=await store.ReadMaterials(id);
        var laborBytes=JsonSerializer.Serialize(view.Plan);
        await store.SaveMaterials(id,new(material.Plan.Revision,material.Plan.Rows),persona);
        view=await store.ReadLabor(id);
        Check(JsonSerializer.Serialize(view.Plan)==laborBytes,"Materials save preserves Labor plan/version/status");
        material=await store.ReadMaterials(id);
        await Task.WhenAll(store.SaveMaterials(id,new(material.Plan.Revision,material.Plan.Rows),persona),store.SaveLabor(id,Request(view.Plan.Operations),persona));
        Check((await store.ReadMaterials(id)).Plan.Revision==material.Plan.Revision+1&&(await store.ReadLabor(id)).Plan.Revision==view.Plan.Revision+1,"concurrent lane saves both retained");
        Check(await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"))==sourceBytes,"Technical Review and Accepted BOM bytes unchanged");
        view=await store.ReadLabor(id);
        var materialBeforeHierarchy=JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote);
        var p=new SimLaborOperation("parent","Kitting",OperationQuantity:55,RunSeconds:30);
        var c1=new SimLaborOperation("child1","ID / Bag Labels",Instructions:"Label bags",OperationQuantity:55,RunSeconds:8,ParentId:p.Id);
        var c2=new SimLaborOperation("child2","Kit the Job",OperationQuantity:55,RunSeconds:20,ParentId:p.Id);
        var other=new SimLaborOperation("other","Packaging",OperationQuantity:1,RunSeconds:60);
        SimLaborOperation[] tree=[p,c1,c2,other];
        Check(SimRfqIntakeStore.LaborOperationSeconds(p,tree)==1540&&SimRfqIntakeStore.CalculateLabor(tree,25,75,0).TotalSeconds==1600,"parent rolls up children; footer never double counts parent");
        Check(SimRfqIntakeStore.CalculateLabor([p,other],25,75,0).TotalSeconds==1710,"parent without children contributes its own time");
        foreach(var malformed in new[]{new[]{p,c1 with{ParentId="missing"}},new[]{p,c1 with{ParentId=c1.Id}},new[]{p,c1,c2 with{ParentId=c1.Id}},new[]{p with{ParentId=c1.Id},c1}})
            await Block(()=>store.SaveLabor(id,Request(malformed),persona),"orphan/self/cycle/nested hierarchy rejected");
        await Block(()=>store.SaveLabor(id,Request(tree) with{CalculationVersion="LABOR_SECONDS_V3"},persona),"old flat client cannot overwrite hierarchy");
        view=await store.SaveLabor(id,Request(tree,true),persona);
        var treeVersions=JsonSerializer.Serialize(view.Plan.Versions);
        Check(view.Plan.Versions.Last().CalculationVersion=="LABOR_BATCH_ALLOCATION_V6"&&view.Plan.Versions.Last().Totals.TotalSeconds==1600,"completed hierarchy snapshot has exact seconds and version metadata");
        view=await store.SaveLabor(id,Request([other,p,c2,c1]),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.Operations.Select(o=>o.Id).SequenceEqual(new[]{"other","parent","child2","child1"})&&view.Plan.Operations.Last().Instructions=="Label bags","parent/child order, stable IDs, instructions and seconds survive restart");
        Check(JsonSerializer.Serialize(view.Plan.Versions)==treeVersions&&view.Rfq.Lanes.Labor.Status=="IN_PROGRESS","hierarchy edits preserve completed versions and reopen Labor");
        Check(JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote)==materialBeforeHierarchy,"hierarchy writes preserve Materials");
        var batch = new SimLaborOperation("batch","Setup",OperationQuantity:55,RunSeconds:180,TimeBasis:"BATCH");
        Check(SimRfqIntakeStore.CalculateLabor([batch],25,75,0).TotalSeconds==396 && SimRfqIntakeStore.CalculateLabor([batch with{TimeBasis="PER_UNIT"}],25,75,0).TotalSeconds==9900,"explicit Batch versus Per Unit");
        var mixed = new[]{p,c1 with{OperationQuantity=1,RunSeconds=300,TimeBasis="BATCH"},c2 with{OperationQuantity=55,RunSeconds=180}};
        Check(SimRfqIntakeStore.CalculateLabor(mixed,25,75,0).TotalSeconds==9912,"mixed child bases roll up without counting parent");
        await Block(()=>store.SaveLabor(id,Request([batch with{TimeBasis="AUTO"}]),persona),"unknown basis rejected");
        await Block(()=>store.SaveLabor(id,Request([batch]) with{CalculationVersion="LABOR_HIERARCHY_V4"},persona),"old hierarchy client cannot erase basis");
        Check(JsonSerializer.Deserialize<SimLaborOperation>("{\"Id\":\"old\",\"Name\":\"Legacy\"}")!.TimeBasis=="PER_UNIT","legacy rows default to Per Unit");
        view=await store.SaveLabor(id,Request(mixed,true),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.Operations.Single(o=>o.Id==c1.Id).TimeBasis=="BATCH" && view.Totals.TotalSeconds==SimRfqIntakeStore.CalculateLabor(mixed,view.Plan.Quantity,75,25).TotalSeconds && view.Plan.Versions.Last().Operations.Single(o=>o.Id==c1.Id).TimeBasis=="BATCH","basis and version totals survive store restart");
        Check(JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote)==materialBeforeHierarchy,"basis changes preserve Materials");
        var allocated=SimRfqIntakeStore.CalculateLabor([batch],25,75,25);
        Check(allocated.TotalSeconds==396 && allocated.TotalMinutes==6.6m && allocated.Cost==8.25m && allocated.UnitSalePrice==10.31m,"allocated per-assembly pricing has no second quantity division");
        await Block(()=>store.SaveLabor(id,Request([batch]) with{CalculationVersion="LABOR_TIME_BASIS_V5"},persona),"old Batch interpretation client blocked");
    }
}
