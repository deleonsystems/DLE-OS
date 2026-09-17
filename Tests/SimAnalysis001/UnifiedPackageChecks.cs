using System.Text.Json;

internal static class UnifiedPackageChecks
{
    internal static async Task Run(byte[] bytes)
    {
        var json = DleAnalysisContract.Json;
        var persona = new SimPersona("fixture", "fixture", "Unified Package Fixture", "ACTIVE", [], [], true, "test");
        void Check(bool ok, string name) { if (!ok) throw new Exception("FAIL: " + name); Console.WriteLine("PASS: combined package " + name); }
        async Task Block(Func<Task> action, string code) { try { await action(); } catch (SimRfqIntakeProblem p) { Check(p.Code == code, code); return; } throw new Exception("FAIL: did not block " + code); }
        var root = Path.Combine(Path.GetTempPath(), "dle-combined-package-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "data"));
        var stage = new SimIntakeDocuments(root); var store = new SimRfqIntakeStore(root); var draft = Guid.NewGuid().ToString("D");
        var files = new List<SimRfqIntakeDocument>();
        foreach (var name in new[] { "governing.pdf", "production.pdf", "manufacturer.pdf", "subassembly.pdf" })
            files.Add(await stage.Stage(draft, name, 0, new MemoryStream(bytes), persona.DisplayName));
        var review = new SimTechnicalReviewResult("RFQ_REVIEW", "", "", "", false, [], [], "", [], false, "READY_FOR_RFQ_QUALIFICATION", "READY_FOR_RFQ_QUALIFICATION", null, null, "", DateTimeOffset.UtcNow, "");
        var record = new SimRfqIntakeRecord("RFQI-SIM-0001", draft, "DLE_RFQ_INTAKE_V1", "Technical Review", "READY_FOR_RFQ_QUALIFICATION", "NEW_QUOTE_REQUEST", new("SIM-CUSTOMER-ABBOTT", "990100", "Synthetic", "fixture"), 1, [new(1, "SYNTHETIC-COMBINED", "A", 10)], "MATERIAL_AND_LABOR", true, files.ToArray(), "BINARIES_VERIFIED_SIM", ["PRICE"], persona.DisplayName, DateTimeOffset.UtcNow, "fixture", 1, "SIM", review);
        var path = Path.Combine(root, "data", "rfq-intakes.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { schema = "DLE_RFQ_INTAKE_DATASET_V1", records = new[] { record } }, json));
        SimRfqIntakeRecord Current() => JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("records")[0].Deserialize<SimRfqIntakeRecord>(json)!;
        var docs = files.Select((f,i) => new SimPackageDocument(f.DocumentId!, f.Name, "ASSEMBLY_DRAWING", i==0?"GOVERNING":"UNRESOLVED", i==3?"SUBASSEMBLY":"PARENT_ASSEMBLY", i==3?"SYN-SUB":null, i==0,
            new(i==0?"DRAWING_AND_BOM":"DRAWING"), new(i==0?"MANUFACTURER":null, i==2), ProductionUse:i==0?"PRIMARY_DRAWING":"NOT_FOR_PRODUCTION", BomUse:i==0?"GOVERNING_BOM":"NO_BOM_ROLE")).ToArray();
        SimUnifiedPackageRequest Request(bool complete=true, bool history=true, string? missing=null) => new(SimRfqIntakeStore.UnifiedPackageVersion, SimRfqIntakeStore.PackageReviewToken(Current()), docs, files[0].DocumentId, complete, history, missing);
        await store.WorkflowAsync(record.IntakeId, new("START"), persona);
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId, Request(history:false), persona), "SIM_HISTORY_REQUIRED");
        var before=File.ReadAllText(path);
        docs[0]=docs[0] with {PartNumberReview=new("UNKNOWN",false)};
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId, Request(), persona), "SIM_PN_BASIS_UNKNOWN");
        Check(File.ReadAllText(path)==before,"failed combined save is atomic");
        await store.SaveUnifiedPackage(record.IntakeId, Request(false,false,"Need P/N evidence"), persona);
        Check(Current().Status=="ON_HOLD" && Current().TechnicalReview!.TechnicalPackage!.Documents[0].PartNumberReview!.Basis=="UNKNOWN","hold saves incomplete document decisions and reason");
        await Block(()=>store.SubmitAnalysis(record.IntakeId,persona),"SIM_REVIEW_GATE");
        docs[0]=docs[0] with {PartNumberReview=new("CUSTOMER_INTERNAL",false)};
        docs[2]=docs[2] with {Applicability="SUBASSEMBLY",SubassemblyPartNumber="SYN-SUB"};
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId,Request(),persona),"SIM_MANUFACTURER_SOURCE_SCOPE");
        docs[2]=docs[2] with {Applicability="PARENT_ASSEMBLY",SubassemblyPartNumber=null};
        await store.SaveUnifiedPackage(record.IntakeId, Request(), persona);
        var current=Current(); docs=current.TechnicalReview!.TechnicalPackage!.Documents;
        var manufacturingId=current.TechnicalReview.Workflow!.Manufacturing!.Id;
        Check(current.TechnicalReview.Workflow.Manufacturing.GoverningDocumentId==files[0].DocumentId && current.TechnicalReview.TechnicalPackage.GoverningBomDocumentId==files[0].DocumentId,"same PDF serves both authorities");
        Check(current.TechnicalReview.Workflow.HistoryReviewed && current.TechnicalReview.AssemblyHistory!.ConfirmedBy==persona.DisplayName,"history acknowledged with reviewer evidence");
        Check(SimAnalysisSourceSelection.Select(current.TechnicalReview.TechnicalPackage,DleAnalysisContract.SourceSelectionVersion).Select(d=>d.DocumentId).SequenceEqual(new[]{files[0].DocumentId,files[2].DocumentId}),"parent manufacturer source included, subassembly excluded");
        before=File.ReadAllText(path); var stale=Request();
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        Check(File.ReadAllText(path)==before,"unchanged save is byte-idempotent, including evidence and manufacturing ID");
        await Block(()=>store.WorkflowAsync(record.IntakeId,new("MANUFACTURING",GoverningDocumentId:files[0].DocumentId,NothingMissing:true),persona),"SIM_COMBINED_PACKAGE_REQUIRED");
        await Block(()=>store.ReviewMaterialsAsync(record.IntakeId,persona,new(docs,files[0].DocumentId),true),"SIM_COMBINED_PACKAGE_REQUIRED");
        var originalApproved=Environment.GetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256");
        Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",DleAnalysisContract.Hash(bytes));
        var job=await store.SubmitAnalysis(record.IntakeId,persona); await store.ClaimAnalysisJob();
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        var result=new DleAnalysisResult(job.Input.ResultVersion,"EXTRACTED",job.Input.ResultVersion==DleAnalysisContract.EnrichedResultVersion?"TABLES_COMPLETE":"PARTIAL","Synthetic rows",Enumerable.Range(1,6).Select(i=>new DleAnalysisRow(SimCandidateBomProvider.Fields.ToDictionary(f=>f,f=>new DleAnalysisField(f=="lineNumber"?i.ToString():f=="quantity"?"1":"SYNTHETIC",new(files[0].DocumentId!,2,null,"row "+i),"Review fixture","NOT_COMPARED",null,null)))).ToArray());
        await store.SetAnalysisState(job.Input.JobId,"VALIDATING"); await store.PublishAnalysis(job.Input.JobId,new(result,"UNIT_TEST_OFFLINE","1","none"));
        var candidate=Current().TechnicalReview!.CandidateBom!;
        Check(candidate.Rows.Length==6,"Candidate BOM lifecycle works after combined save and no-op during analysis");
        foreach(var row in candidate.Rows) await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,row.Index,new(row.Values)));
        candidate=Current().TechnicalReview!.CandidateBom!;
        await store.CompleteBomReview(record.IntakeId,new(candidate),persona);
        var accepted=JsonSerializer.Serialize(Current().TechnicalReview!.BomAcceptances,json);
        docs[0]=docs[0] with {ProductionUse="NOT_FOR_PRODUCTION"}; docs[1]=docs[1] with {ProductionUse="PRIMARY_DRAWING"};
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId,stale,persona),"SIM_PACKAGE_CHANGED");
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        current=Current();
        Check(current.TechnicalReview!.Workflow!.Manufacturing!.GoverningDocumentId==files[1].DocumentId && current.TechnicalReview.TechnicalPackage!.GoverningBomDocumentId==files[0].DocumentId,"separate Production and BOM authority persisted");
        Check(current.TechnicalReview.Workflow.Manufacturing.Id!=manufacturingId && current.TechnicalReview.CandidateBom!.Id==candidate.Id && current.TechnicalReview.MaterialsReviewStatus=="QUALIFIED","Production change replaces only manufacturing identity; accepted candidate stays qualified");
        Check(JsonSerializer.Serialize(current.TechnicalReview.BomAcceptances,json)==accepted,"Accepted BOM snapshot remains immutable");
        await store.SaveUnifiedPackage(record.IntakeId,Request(false,true,"Missing production clarification"),persona);
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        Check(Current().TechnicalReview!.Workflow!.Manufacturing!.Id==current.TechnicalReview.Workflow.Manufacturing.Id,"hold/resume reuses unchanged manufacturing identity");
        // Preserve a pre-release dataset for source-change qualification, without touching the accepted snapshot.
        var saved=File.ReadAllText(path);
        var legacy=current with {TechnicalReview=current.TechnicalReview with {
            TechnicalPackage=current.TechnicalReview.TechnicalPackage! with {Documents=current.TechnicalReview.TechnicalPackage!.Documents.Select(d=>d with {ProductionUse=null,BomUse=null}).ToArray()},
            Workflow=current.TechnicalReview.Workflow with {Version="PACKAGE_REVIEW_V1",Manufacturing=current.TechnicalReview.Workflow.Manufacturing with {
                Package=current.TechnicalReview.Workflow.Manufacturing.Package with {Documents=current.TechnicalReview.Workflow.Manufacturing.Package.Documents.Select(d=>d with {ProductionUse=null,BomUse=null}).ToArray()}}}}};
        var legacyData=System.Text.Json.Nodes.JsonNode.Parse(saved)!;legacyData["records"]![0]=JsonSerializer.SerializeToNode(legacy,json);
        await File.WriteAllTextAsync(path,legacyData.ToJsonString());store=new SimRfqIntakeStore(root);
        docs=legacy.TechnicalReview!.TechnicalPackage!.Documents.Select(d=>d with {ProductionUse=SimRfqIntakeStore.ProductionUse(d,legacy.TechnicalReview.Workflow!.Manufacturing),BomUse=SimRfqIntakeStore.BomUse(legacy.TechnicalReview.TechnicalPackage,d)}).ToArray();
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        Check(Current().TechnicalReview!.Workflow!.Manufacturing!.Id==current.TechnicalReview.Workflow.Manufacturing.Id && Current().TechnicalReview!.CandidateBom!.Id==candidate.Id,"legacy projection upgrades without replacing manufacturing or candidate IDs");
        await File.WriteAllTextAsync(path,saved);store=new SimRfqIntakeStore(root);docs=Current().TechnicalReview!.TechnicalPackage!.Documents;
        docs[2]=docs[2] with {PartNumberReview=new(null,false)}; docs[0]=docs[0] with {PartNumberReview=new("MANUFACTURER",false)};
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        Check(Current().TechnicalReview!.CandidateBom is null && Current().TechnicalReview!.CandidateBomVersions!.Any(c=>c.Id==candidate.Id),"source change archives candidate and clears current qualification");
        Check(Current().TechnicalReview!.Workflow!.Manufacturing!.Id==current.TechnicalReview.Workflow.Manufacturing.Id,"BOM metadata change preserves Labor source identity");
        Check(JsonSerializer.Serialize(Current().TechnicalReview!.BomAcceptances,json)==accepted,"source change does not rewrite old acceptance");
        // A standalone BOM can be authoritative independently of Production, but extraction remains unsupported.
        docs[0]=docs[0] with {BomUse="NO_BOM_ROLE"};
        docs[2]=docs[2] with {DocumentType="BOM",EmbeddedBom=false,IdentityReview=new("BOM_ONLY"),PartNumberReview=new("MANUFACTURER",false),BomUse="GOVERNING_BOM"};
        await store.SaveUnifiedPackage(record.IntakeId,Request() with {GoverningBomDocumentId=files[2].DocumentId},persona);
        Check(Current().TechnicalReview!.TechnicalPackage!.GoverningBomSourceKind=="STANDALONE_BOM" && Current().TechnicalReview!.Workflow!.Manufacturing!.GoverningDocumentId==files[1].DocumentId,"standalone authority represented without claiming extraction support");
        await Block(()=>store.SubmitAnalysis(record.IntakeId,persona),"ANALYSIS_SOURCE_REQUIRED");
        await File.WriteAllTextAsync(path,saved);store=new SimRfqIntakeStore(root);docs=Current().TechnicalReview!.TechnicalPackage!.Documents;
        var staleJob=await store.SubmitAnalysis(record.IntakeId,persona);await store.ClaimAnalysisJob();
        docs[0]=docs[0] with {PartNumberReview=new("MANUFACTURER",false)};
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        await store.SetAnalysisState(staleJob.Input.JobId,"VALIDATING");
        await store.PublishAnalysis(staleJob.Input.JobId,new(result,"UNIT_TEST_OFFLINE","1","none"));
        Check(Current().TechnicalReview!.CandidateBom is null,"result from changed sources cannot replace current candidate");
        await File.WriteAllTextAsync(path,saved);store=new SimRfqIntakeStore(root);
        await store.WorkflowAsync(record.IntakeId,new("COMPLETE"),persona);
        current=Current();
        Check(current.TechnicalReview!.Workflow!.Outputs!.Manufacturing.GoverningDocumentId==files[1].DocumentId,"Labor handoff resolves independent primary drawing");
        Check(((SimRfqIntakeRecord)(await new SimRfqIntakeStore(root).ReadAsync(record.IntakeId))!).TechnicalReview!.Workflow!.Outputs!.Manufacturing.Id==current.TechnicalReview.Workflow.Manufacturing!.Id,"completed review survives restart with stable outputs");
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId,Request(),persona),"SIM_REVIEW_STATE");
        Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",originalApproved);
    }
}
