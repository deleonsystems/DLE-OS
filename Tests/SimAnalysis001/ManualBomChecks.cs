using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ManualBomChecks
{
    internal static async Task Run()
    {
        var root=Path.Combine(Path.GetTempPath(),"dle-manual-bom-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root,"data"));
        var json=DleAnalysisContract.Json;
        var persona=new SimPersona("fixture","fixture","Manual BOM test","ACTIVE",[],[],true,"test");
        var path=Path.Combine(root,"data","rfq-intakes.json");
        var seed=new {
            intakeId="RFQI-SIM-MANUAL",environment="SIM",intakeType="NEW_QUOTE_REQUEST",
            requestCorrelationId=Guid.NewGuid().ToString("D"),createdBy=persona.DisplayName,
            schema="DLE_RFQ_INTAKE_V1",status="TECHNICAL_REVIEW_IN_PROGRESS",handoffTarget="Technical Review",
            customer=new{customerId="SIM-CUSTOMER-E2E-001",customerNumber="990901",customerName="Synthetic"},
            assemblies=new[]{new{lineNumber=1,assemblyNumber="TEST",revision="A",quantity=1}},
            technicalFiles=Array.Empty<object>(),
            technicalReview=new {reviewStatus="TECHNICAL_REVIEW_IN_PROGRESS",disposition="START_TECHNICAL_REVIEW",
                workflow=new{version="UNIFIED_PACKAGE_REVIEW_V2"},technicalPackage=new{documents=Array.Empty<object>()}}
        };
        var second=JsonSerializer.SerializeToNode(seed,json)!;
        second["intakeId"]="RFQI-SIM-UNTOUCHED";
        await File.WriteAllTextAsync(path,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new object[]{seed,second}},json));
        var store=new SimRfqIntakeStore(root);
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        async Task<JsonNode> Envelope()=>Node(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(seed.intakeId));
        async Task<SimCandidateBom> Bom()=> (await Envelope())["record"]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
        void Check(bool result,string name){if(!result)throw new Exception(name);Console.WriteLine("PASS: "+name);}
        async Task Denied(Func<Task> action,string name){try{await action();throw new Exception("Not blocked: "+name);}catch(SimRfqIntakeProblem){Console.WriteLine("PASS: "+name);}}
        var original=(await Envelope())["record"]!.DeepClone();
        var token=(await Envelope())["packageReviewToken"]!.GetValue<string>();
        await Denied(async()=>{await store.CreateManualBom(seed.intakeId,new("stale"),persona);},"stale package creation rejected");
        await store.CreateManualBom(seed.intakeId,new(token),persona);
        var bom=await Bom();
        Check(bom.Rows.Length==0&&bom.ManualDraft?.Kind=="DLE_AUTHORED"&&bom.GoverningDocumentId==""&&bom.Analysis is null,"zero rows, explicit authorship, no fake source or analysis");
        var saved=await File.ReadAllTextAsync(path);
        await store.CreateManualBom(seed.intakeId,new(token),persona);
        Check(saved==await File.ReadAllTextAsync(path),"repeated create is a no-write idempotent reopen");
        var rowId=Guid.NewGuid().ToString("D");
        await store.AddManualBomRow(seed.intakeId,new(bom.Id,rowId,0),persona);
        saved=await File.ReadAllTextAsync(path);
        await store.AddManualBomRow(seed.intakeId,new(bom.Id,rowId,0),persona);
        Check(saved==await File.ReadAllTextAsync(path),"repeated row operation does not duplicate");
        await Denied(async()=>{await store.AddManualBomRow(seed.intakeId,new(bom.Id,Guid.NewGuid().ToString("D"),0),persona);},"stale row addition rejected");
        bom=await Bom();var row=bom.Rows[0];
        Check(row.ComponentType=="UNKNOWN"&&row.Values.Where(v=>v.Key!="lineNumber").All(v=>v.Value=="")&&row.Extracted.Values.All(v=>v=="")&&!row.ReviewState.Reviewed,"blank row does not invent component values");
        var values=new Dictionary<string,string>(row.Values){["description"]="Manually entered test description"};
        await store.CandidateBomAsync(seed.intakeId,persona,new(bom.Id,-1,null,ProgressRows:[new(0,row.ReviewState.Token,values,"UNKNOWN")]));
        bom=await Bom();row=bom.Rows[0];
        Check(row.Values["description"]==values["description"]&&row.Values["quantity"]==""&&!row.ReviewState.Reviewed,"incomplete draft saved and reopened");
        await Denied(async()=>{await store.CandidateBomAsync(seed.intakeId,persona,new(bom.Id,0,row.Values,WorksheetAcceptance:new(row.ReviewState.Token,"UNKNOWN")));},"unresolved row acceptance blocked");
        var completeValues=new Dictionary<string,string>(row.Values){["partNumber"]="MANUAL-001",["quantity"]="2"};
        await store.CandidateBomAsync(seed.intakeId,persona,new(bom.Id,0,completeValues,WorksheetAcceptance:new(row.ReviewState.Token,"STANDARD_COTS",ManualPartNumber:"MANUAL-001")));
        bom=await Bom();
        Check(bom.Rows[0].ReviewState.Reviewed,"manual row accepts only through existing row review");
        await Denied(async()=>{await store.CompleteBomReview(seed.intakeId,new(bom),persona);},"working draft cannot bypass final qualification");
        await Denied(async()=>{await store.SubmitAnalysis(seed.intakeId,persona);},"manual draft cannot trigger extraction");
        var env=await Envelope();
        Check(JsonNode.DeepEquals(original["technicalFiles"],env["record"]!["technicalFiles"])&&
            JsonNode.DeepEquals(original["technicalReview"]!["workflow"],env["record"]!["technicalReview"]!["workflow"]),"documents and package/release state unchanged");
        var untouched=JsonNode.Parse(await File.ReadAllTextAsync(path))!["records"]![1]!;
        Check(untouched["intakeId"]!.GetValue<string>()=="RFQI-SIM-UNTOUCHED"&&untouched["technicalReview"]!["candidateBom"] is null,"unrelated record untouched");
        // A later hold/package review must not discard independently authored rows.
        var typed=env["record"]!.Deserialize<SimRfqIntakeRecord>(json)!;
        await store.SaveUnifiedPackage(seed.intakeId,new("UNIFIED_PACKAGE_REVIEW_V2",env["packageReviewToken"]!.GetValue<string>(),[],null,false,Missing:"Need engineering definition"),persona);
        Check((await Bom()).Rows.Length==1,"package hold preserves manual BOM");
        await store.AddManualBomRow(seed.intakeId,new(bom.Id,Guid.NewGuid().ToString("D"),(await Bom()).ManualDraft!.Revision),persona);
        Check((await Bom()).Rows.Length==2,"authoring remains available while package is incomplete/on hold");
        Console.WriteLine("Manual BOM fixture: "+root);
    }
}

