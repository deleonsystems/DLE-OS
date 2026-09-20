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
        SimUnifiedPackageRequest Request(bool complete=true, bool history=false, string? missing=null) => new(SimRfqIntakeStore.UnifiedPackageVersion, SimRfqIntakeStore.PackageReviewToken(Current()), docs, files[0].DocumentId, complete, history, missing);
        await store.WorkflowAsync(record.IntakeId, new("START"), persona);
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
        Check(!current.TechnicalReview.Workflow.HistoryReviewed && current.TechnicalReview.AssemblyHistory!.ConfirmedBy is null && current.TechnicalReview.AssemblyHistory.ConfirmedAtUtc is null && current.TechnicalReview.AssemblyHistory.AssemblyClassification == "NEW_ASSEMBLY","classification derived without false history reviewer evidence");
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
        // Row acceptance persists only one row and reuses package invalidation/version contracts.
        var rowCheckpoint=File.ReadAllText(path);
        SimUnifiedPackageRequest RowRequest(SimPackageDocument d) => new(SimRfqIntakeStore.UnifiedPackageVersion,
            SimRfqIntakeStore.PackageReviewToken(Current()), [d], null, false, AcceptDocumentId:d.DocumentId);
        var rowDoc=Current().TechnicalReview!.TechnicalPackage!.Documents[0];
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId,RowRequest(rowDoc with {PartNumberReview=new("MANUFACTURER",null)}),persona),"SIM_ROW_REVIEW");
        Check(File.ReadAllText(path)==rowCheckpoint,"row missing decision blocks atomically");
        await store.SaveUnifiedPackage(record.IntakeId,RowRequest(rowDoc),persona);
        Check(File.ReadAllText(path)==rowCheckpoint,"unchanged row acceptance has no timestamp/version churn");
        var productionDoc=Current().TechnicalReview!.TechnicalPackage!.Documents[1];
        await store.SaveUnifiedPackage(record.IntakeId,RowRequest(productionDoc with {ProductionUse="SUPPORTING_PRODUCTION"}),persona);
        Check(Current().TechnicalReview!.CandidateBom!.Id==candidate.Id,"row Production-only acceptance preserves ready candidate");
        Check(Current().TechnicalReview!.TechnicalPackage!.Documents[1].ProductionUse=="SUPPORTING_PRODUCTION","row decisions persist independently");
        rowDoc=Current().TechnicalReview!.TechnicalPackage!.Documents[0];
        await store.SaveUnifiedPackage(record.IntakeId,RowRequest(rowDoc with {PartNumberReview=new("MANUFACTURER",true)}),persona);
        Check(Current().TechnicalReview!.CandidateBom is null && Current().TechnicalReview!.CandidateBomVersions!.Any(c=>c.Id==candidate.Id),"row material change archives candidate for explicit rebuild");
        store=new SimRfqIntakeStore(root);
        Check(Current().TechnicalReview!.TechnicalPackage!.Documents[0].PartNumberReview!.ProvidesManufacturerPartNumbers==true,"accepted row survives store reopen");
        await File.WriteAllTextAsync(path,rowCheckpoint);store=new SimRfqIntakeStore(root);
        await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,null,AlternateChange:new("APPROVE",null,"SYN-APPROVED-ALT","APPROVED",0,"Synthetic maker","Synthetic review note")));
        var altRow=Current().TechnicalReview!.CandidateBom!.Rows[0];
        Check(altRow.Alternates!.Single().ReviewStatus=="APPROVED" && altRow.Alternates!.Single().ManufacturerName=="Synthetic maker","explicit alternate approval persists independently");
        await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,new(altRow.Values),PrimarySelection:new(null,"SYN-MANUAL-PRIMARY","Synthetic maker",altRow.ReviewState.Token)));
        var primaryRow=Current().TechnicalReview!.CandidateBom!.Rows[0];
        Check(primaryRow.ManufacturerIdentity!.Proposals.Single(p=>primaryRow.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED").PartNumber=="SYN-MANUAL-PRIMARY" && primaryRow.ReviewState.Reviewed,"manual primary accepted explicitly with row review");
        Check(primaryRow.Alternates!.Single().PartNumber=="SYN-APPROVED-ALT","primary remains distinct from approved alternate");
        var identity=primaryRow.ManufacturerIdentity!;
        var two=primaryRow with {ManufacturerIdentity=identity with {Proposals=identity.Proposals.Append(identity.Proposals[0] with {Id="second",PartNumber="SYN-SECOND"}).ToArray()}};
        var twoBom=Current().TechnicalReview!.CandidateBom! with {Rows=[two]};
        var chosen=SimCandidateBomProvider.Review(twoBom,new(twoBom.Id,0,new(two.Values),PrimarySelection:new("second",null,null,two.ReviewState.Token)),persona).Rows[0];
        Check(chosen.ManufacturerIdentity!.Proposals.Count(p=>chosen.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED")==1 && chosen.ManufacturerIdentity.Decision("second")=="CONFIRMED","selection explicitly confirms only one primary, never creates alternates");
        Check(chosen.ManufacturerIdentity.Decision(identity.Proposals[0].Id)=="NOT_SELECTED" && chosen.Alternates!.Length==1,"other proposals remain available with history, not automatic alternates");
        var worksheetChosen=SimCandidateBomProvider.Review(twoBom,new(twoBom.Id,0,new(two.Values){["description"]="Corrected synthetic description"},WorksheetAcceptance:new(two.ReviewState.Token,"STANDARD_COTS",ProposalId:"second")),persona).Rows[0];
        Check(worksheetChosen.ReviewState.Reviewed && worksheetChosen.Values["description"]=="Corrected synthetic description" && !worksheetChosen.Corrections.Any(c=>c.Field=="description"),"worksheet accepts field correction and chosen identity atomically");
        Check(worksheetChosen.ManufacturerIdentity!.Proposals.Select(p=>p.Id).SequenceEqual(two.ManufacturerIdentity!.Proposals.Select(p=>p.Id)) && worksheetChosen.ManufacturerIdentity.Proposals.All(p=>worksheetChosen.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED"),"corrected row reuses original identities without reaffirmation copies");
        var staleWorksheet=two with {ManufacturerIdentity=two.ManufacturerIdentity! with {Stale=true}};
        var five=two with {ManufacturerIdentity=identity with {Proposals=Enumerable.Range(1,5).Select(i=>identity.Proposals[0] with {Id="multi-"+i,PartNumber="SYN-MFG-"+i}).ToArray(),History=[]}};
        var fiveBom=twoBom with {Rows=[five]};
        var all=SimCandidateBomProvider.Review(fiveBom,new(fiveBom.Id,0,new(five.Values),WorksheetAcceptance:new(five.ReviewState.Token,"STANDARD_COTS")),persona).Rows[0];
        Check(all.ReviewState.Reviewed && all.ManufacturerIdentity!.Proposals.All(p=>all.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED"),"one Accept confirms five proposals without selecting a commercial winner");
        var rejected=SimCandidateBomProvider.Review(fiveBom,new(fiveBom.Id,0,null,ManufacturerChange:new("multi-3","REJECTED",five.ManufacturerIdentity!.Revision)),persona);
        var remaining=SimCandidateBomProvider.Review(rejected,new(fiveBom.Id,0,new(five.Values),WorksheetAcceptance:new(rejected.Rows[0].ReviewState.Token,"STANDARD_COTS")),persona).Rows[0];
        Check(remaining.ManufacturerIdentity!.Decision("multi-3")=="REJECTED" && remaining.ManufacturerIdentity.Proposals.Count(p=>remaining.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED")==4,"row Accept preserves explicit rejection and confirms remaining four");
        Check(SimRfqIntakeStore.MaterialIdentityChoices(remaining).Contains("SYN-MFG-5") && !SimRfqIntakeStore.MaterialIdentityChoices(remaining).Contains("SYN-MFG-3") && remaining.Alternates!.Length==five.Alternates!.Length,"Materials offers all approved identities; true alternates stay separate");
        var one=five with {ManufacturerIdentity=five.ManufacturerIdentity! with {Proposals=[five.ManufacturerIdentity.Proposals[0]]}};
        Check(SimCandidateBomProvider.Review(fiveBom with {Rows=[one]},new(fiveBom.Id,0,new(one.Values),WorksheetAcceptance:new(one.ReviewState.Token,"STANDARD_COTS")),persona).Rows[0].ReviewState.Reviewed,"one proposal accepts without a selection");
        var empty=five with {ManufacturerIdentity=five.ManufacturerIdentity! with {Proposals=[]}};
        try {SimCandidateBomProvider.Review(fiveBom with {Rows=[empty]},new(fiveBom.Id,0,new(empty.Values),WorksheetAcceptance:new(empty.ReviewState.Token,"STANDARD_COTS")),persona);throw new Exception("empty identity accepted");}
        catch(SimRfqIntakeProblem p){Check(p.Code=="SIM_MFG_REVIEW_INVALID","no proposal cannot fabricate identity");}
        try { SimCandidateBomProvider.Review(twoBom with {Rows=[staleWorksheet]},new(twoBom.Id,0,new(two.Values),WorksheetAcceptance:new(staleWorksheet.ReviewState.Token,"STANDARD_COTS",ProposalId:"second")),persona);throw new Exception("stale worksheet accepted"); }
        catch(SimRfqIntakeProblem p){Check(p.Code=="SIM_MFG_REVIEW_STALE","worksheet cannot accept pre-existing stale extraction");}
        await Block(()=>store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,new(primaryRow.Values),PrimarySelection:new(null,"STALE",null,altRow.ReviewState.Token))),"SIM_MFG_REVIEW_STALE");
        Check(SimRfqIntakeStore.MaterialIdentityChoices(primaryRow).Order().SequenceEqual(new[]{"SYN-APPROVED-ALT","SYN-MANUAL-PRIMARY"}),"Materials receives confirmed primary and explicitly approved alternate");
        Check(!SimRfqIntakeStore.MaterialIdentityChoices(primaryRow with {Alternates=primaryRow.Alternates!.Select(a=>a with {ReviewStatus="NOT_APPROVED"}).ToArray()}).Contains("SYN-APPROVED-ALT"),"Not Approved alternate is excluded from Materials choices");
        var multiFixture=System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!;
        multiFixture["records"]![0]!["technicalReview"]!["candidateBom"]!["rows"]![0]=JsonSerializer.SerializeToNode(remaining,json);
        await File.WriteAllTextAsync(path,multiFixture.ToJsonString());store=new SimRfqIntakeStore(root);
        foreach(var r in Current().TechnicalReview!.CandidateBom!.Rows.Skip(1)) await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,r.Index,new(r.Values)));
        await store.CompleteBomReview(record.IntakeId,new(Current().TechnicalReview!.CandidateBom!),persona);
        var approvedSnapshot=Current().TechnicalReview!.BomAcceptances!.Last().Candidate.Rows[0];
        store=new SimRfqIntakeStore(root);
        Check(approvedSnapshot.ManufacturerIdentity!.Proposals.Count(p=>approvedSnapshot.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED")==4 && SimRfqIntakeStore.MaterialIdentityChoices(approvedSnapshot).Contains("SYN-MFG-5"),"Accepted BOM preserves multiple identities for Materials after persisted reopen");
        Check(approvedSnapshot.Alternates!.Single().ReviewStatus=="APPROVED" && SimRfqIntakeStore.MaterialIdentityChoices(approvedSnapshot).Contains("SYN-APPROVED-ALT"),"Accepted BOM preserves approved alternate for Materials without approving it there");
        await File.WriteAllTextAsync(path,rowCheckpoint);store=new SimRfqIntakeStore(root);
        var worksheetRow=Current().TechnicalReview!.CandidateBom!.Rows[0];
        var worksheetValues=new Dictionary<string,string>(worksheetRow.Values){["partNumber"]="N4-554"};
        await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,worksheetValues,WorksheetAcceptance:new(worksheetRow.ReviewState.Token,"SUBASSEMBLY","N4-554 REV -")));
        var assemblyRow=Current().TechnicalReview!.CandidateBom!.Rows[0];
        Check(assemblyRow.Values["partNumber"]=="N4-554" && assemblyRow.AssemblyIdentity!.PartNumber=="N4-554 REV -" && assemblyRow.ReviewState.Reviewed,"worksheet atomically accepts distinct Assembly P/N and customer identity");
        Check(!(assemblyRow.Alternates??[]).Any(a=>a.PartNumber=="N4-554 REV -") && !(assemblyRow.ManufacturerIdentity?.Proposals??[]).Any(p=>p.PartNumber=="N4-554 REV -"),"Assembly P/N is neither alternate nor manufacturer identity");
        var assemblyMaterial=SimRfqIntakeStore.MaterialIdentityDefaults(new(0),assemblyRow);
        Check(assemblyMaterial.AssemblyPartNumber=="N4-554 REV -" && assemblyMaterial.MfgPartNumber is null,"Materials retains typed Assembly P/N without MFG relabeling");
        var persisted=File.ReadAllText(path);
        await Block(()=>store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,worksheetValues,WorksheetAcceptance:new(assemblyRow.ReviewState.Token,"SUBASSEMBLY",""))),"SIM_ASSEMBLY_IDENTITY_REQUIRED");
        Check(File.ReadAllText(path)==persisted,"invalid worksheet acceptance is atomic");
        await Block(()=>store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,0,worksheetValues,WorksheetAcceptance:new(worksheetRow.ReviewState.Token,"SUBASSEMBLY","STALE"))),"SIM_ROW_APPROVAL_STALE");
        foreach(var r in Current().TechnicalReview!.CandidateBom!.Rows.Skip(1))await store.CandidateBomAsync(record.IntakeId,persona,new(candidate.Id,r.Index,new(r.Values)));
        await store.CompleteBomReview(record.IntakeId,new(Current().TechnicalReview!.CandidateBom!),persona);
        store=new SimRfqIntakeStore(root);
        var acceptedAssembly=Current().TechnicalReview!.BomAcceptances!.Last().Candidate.Rows[0];
        Check(acceptedAssembly.AssemblyIdentity!.PartNumber=="N4-554 REV -" && acceptedAssembly.AssemblyIdentityHistory!.Length==1 && acceptedAssembly.Values["partNumber"]=="N4-554","Accepted BOM retains distinct Assembly identity and audit after reopen");
        Check(SimRfqIntakeStore.MaterialIdentityDefaults(new(0),acceptedAssembly).AssemblyPartNumber=="N4-554 REV -","Materials uses Assembly identity from immutable Accepted BOM");
        await File.WriteAllTextAsync(path,rowCheckpoint);store=new SimRfqIntakeStore(root);
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
        Check(!Current().TechnicalReview!.Workflow!.HistoryReviewed && Current().TechnicalReview!.AssemblyHistory!.ConfirmedBy is null,"even an old client acknowledgment cannot fabricate review evidence");
        // Preserve a pre-release dataset for source-change qualification, without touching the accepted snapshot.
        var saved=File.ReadAllText(path);
        var historical = current with { TechnicalReview = current.TechnicalReview! with {
            AssemblyHistory = current.TechnicalReview!.AssemblyHistory! with { ConfirmedBy = "Prior reviewer", ConfirmedAtUtc = DateTimeOffset.Parse("2026-01-01T00:00:00Z") },
            Workflow = current.TechnicalReview.Workflow! with { HistoryReviewed = true } } };
        var historicalData=System.Text.Json.Nodes.JsonNode.Parse(saved)!; historicalData["records"]![0]=JsonSerializer.SerializeToNode(historical,json);
        await File.WriteAllTextAsync(path,historicalData.ToJsonString()); store=new SimRfqIntakeStore(root);
        await store.SaveUnifiedPackage(record.IntakeId,Request(),persona);
        Check(Current().TechnicalReview!.Workflow!.HistoryReviewed && JsonSerializer.Serialize(Current().TechnicalReview!.AssemblyHistory,json)==JsonSerializer.Serialize(historical.TechnicalReview!.AssemblyHistory,json),"historical acknowledgment and snapshot preserved exactly");
        await File.WriteAllTextAsync(path,saved);store=new SimRfqIntakeStore(root);
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
        Check(JsonSerializer.Serialize(await store.ReleaseReadinessAsync(record.IntakeId)).Contains("\"ready\":true"), "release readiness passes before COMPLETE");
        await store.WorkflowAsync(record.IntakeId,new("COMPLETE"),persona);
        Check(JsonSerializer.Serialize(await store.ReleaseReadinessAsync(record.IntakeId)).Contains("\"ready\":false"), "released review remains protected");
        current=Current();
        Check(current.TechnicalReview!.Workflow!.Outputs!.Manufacturing.GoverningDocumentId==files[1].DocumentId,"Labor handoff resolves independent primary drawing");
        Check(((SimRfqIntakeRecord)(await new SimRfqIntakeStore(root).ReadAsync(record.IntakeId))!).TechnicalReview!.Workflow!.Outputs!.Manufacturing.Id==current.TechnicalReview.Workflow.Manufacturing!.Id,"completed review survives restart with stable outputs");
        await Block(()=>store.SaveUnifiedPackage(record.IntakeId,Request(),persona),"SIM_REVIEW_STATE");
        Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",originalApproved);
    }
}
