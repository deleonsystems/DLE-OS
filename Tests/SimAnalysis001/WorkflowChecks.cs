using System.Text.Json;

internal static class WorkflowChecks
{
    internal static async Task Run(byte[] bytes)
    {
        var json = DleAnalysisContract.Json;
        var persona = new SimPersona("fixture", "fixture", "Workflow Fixture Reviewer", "ACTIVE", [], [], true, "test");
        void Check(bool ok, string name) { if (!ok) throw new Exception("FAIL: " + name); Console.WriteLine("PASS: unified " + name); }
        async Task Block(Func<Task> action, string name) { try { await action(); } catch (SimRfqIntakeProblem) { Check(true,name); return; } throw new Exception("FAIL: did not block " + name); }
        foreach (var (assembly, revision) in new[] { ("B11283-17","B"), ("B11283-17","C"), ("NEW-ASSEMBLY","A") })
        {
            var root = Path.Combine(Path.GetTempPath(), "dle-unified-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root,"data"));
            var store = new SimRfqIntakeStore(root); var stage = new SimIntakeDocuments(root);
            var draft = Guid.NewGuid().ToString("D");
            var file = await stage.Stage(draft,"synthetic-governing.pdf",0,new MemoryStream(bytes),persona.DisplayName);
            var review = new SimTechnicalReviewResult("RFQ_REVIEW","","","",false,[],[],"",[],false,"READY_FOR_RFQ_QUALIFICATION","READY_FOR_RFQ_QUALIFICATION",null,null,"",DateTimeOffset.UtcNow,"");
            var record = new SimRfqIntakeRecord("RFQI-SIM-0001",draft,"DLE_RFQ_INTAKE_V1","Technical Review","READY_FOR_RFQ_QUALIFICATION","NEW_QUOTE_REQUEST",new("SIM-CUSTOMER-ABBOTT","990100","Abbott","fixture"),1,[new(1,assembly,revision,1)],"MATERIAL_AND_LABOR",true,[file],"BINARIES_VERIFIED_SIM",["PRICE"],persona.DisplayName,DateTimeOffset.UtcNow,"fixture",1,"SIM",review);
            var path = Path.Combine(root,"data","rfq-intakes.json");
            await File.WriteAllTextAsync(path,JsonSerializer.Serialize(new {schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{record}},json));
            SimRfqIntakeRecord Current() => JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("records")[0].Deserialize<SimRfqIntakeRecord>(json)!;
            await store.WorkflowAsync(record.IntakeId,new("START"),persona);
            Check(Current().TechnicalReview!.Workflow is {PackageConfirmed:false}, "Start enters package before history: " + assembly + " " + revision);
            var docs = new[]{new SimPackageDocument(file.DocumentId!,file.Name,"ASSEMBLY_DRAWING","GOVERNING","PARENT_ASSEMBLY",null,true)};
            await store.ReviewMaterialsAsync(record.IntakeId,persona,new(docs,null),true);
            Check(Current().TechnicalReview!.Workflow!.PackageConfirmed,"package confirms without build history");
            await store.WorkflowAsync(record.IntakeId,new("HOLD","Gerbers needed"),persona);
            Check(Current().Status=="ON_HOLD" && Current().TechnicalReview!.Workflow!.Events!.Last().Detail=="Gerbers needed","hold persists reason and audit");
            await Block(()=>store.WorkflowAsync(record.IntakeId,new("COMPLETE"),persona),"hold blocks final release");
            await Block(()=>store.SubmitAnalysis(record.IntakeId,persona),"hold blocks analysis");
            await Block(()=>store.WorkflowAsync(record.IntakeId,new("SUFFICIENT"),persona),"hold cannot be bypassed");
            store = new SimRfqIntakeStore(root);
            Check(((SimRfqIntakeRecord)(await store.ReadAsync(record.IntakeId))!).Status=="ON_HOLD","hold survives store restart");
            await store.WorkflowAsync(record.IntakeId,new("RESUME"),persona);
            await store.WorkflowAsync(record.IntakeId,new("SUFFICIENT"),persona);
            await store.WorkflowAsync(record.IntakeId,new("HISTORY"),persona);
            await Block(()=>store.WorkflowAsync(record.IntakeId,new("MANUFACTURING",GoverningDocumentId:file.DocumentId),persona),"manufacturing needs explicit missing-information confirmation");
            await store.WorkflowAsync(record.IntakeId,new("MANUFACTURING",GoverningDocumentId:file.DocumentId,NothingMissing:true),persona);
            Check(Current().TechnicalReview!.Workflow!.Manufacturing is not null,"manufacturing completes for history branch " + revision);
            await Block(()=>store.WorkflowAsync(record.IntakeId,new("COMPLETE"),persona),"missing accepted BOM blocks release");
            await store.ReviewMaterialsAsync(record.IntakeId,persona,new(docs,file.DocumentId),true);
            Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",DleAnalysisContract.Hash(bytes));
            var job=await store.SubmitAnalysis(record.IntakeId,persona); await store.ClaimAnalysisJob();
            var result=new DleAnalysisResult(DleAnalysisContract.ResultVersion,"EXTRACTED","PARTIAL","Six synthetic fixture rows",Enumerable.Range(1,6).Select(i=>new DleAnalysisRow(SimCandidateBomProvider.Fields.ToDictionary(f=>f,f=>new DleAnalysisField(f=="lineNumber"?i.ToString():f=="quantity"?"1":"fixture",new(file.DocumentId!,2,null,"row "+i),"Review fixture","NOT_COMPARED",null,null)))).ToArray());
            await store.SetAnalysisState(job.Input.JobId,"VALIDATING");
            await store.PublishAnalysis(job.Input.JobId,new(result,"UNIT_TEST_OFFLINE","1","none"));
            var candidate=Current().TechnicalReview!.CandidateBom!;
            foreach(var row in candidate.Rows) await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,row.Index,new(row.Values)));
            candidate=Current().TechnicalReview!.CandidateBom!;
            await store.CompleteBomReview(record.IntakeId,new(candidate),persona);
            var accepted=JsonSerializer.Serialize(Current().TechnicalReview!.BomAcceptances,json);
            await store.WorkflowAsync(record.IntakeId,new("COMPLETE"),persona);
            var done=Current();
            await RfqChecks.Run(root, done, persona);
            Check(done.Status=="READY_FOR_RFQ_WORKING_QUEUE" && done.TechnicalReview!.Workflow!.Outputs is {Status:"READY"},"both durable quotation inputs released");
            Check(JsonSerializer.Serialize(done.TechnicalReview!.BomAcceptances,json)==accepted,"acceptance unchanged by overall release");
            await Block(()=>store.WorkflowAsync(record.IntakeId,new("START"),persona),"completed review cannot restart");
            await Block(()=>store.ReviewMaterialsAsync(record.IntakeId,persona,new(docs,null),true),"completed package immutable");
            store=new SimRfqIntakeStore(root);
            Check(((SimRfqIntakeRecord)(await store.ReadAsync(record.IntakeId))!).TechnicalReview!.Workflow!.Outputs!.Manufacturing.Id==done.TechnicalReview!.Workflow!.Manufacturing!.Id,"handoff survives restart with stable artifact IDs");
        }
    }
}
