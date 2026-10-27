using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PrototypeRfqCompletionChecks
{
    internal static async Task Run(string sourceRoot,string root)
    {
        if(Directory.Exists(root))throw new Exception("Use a new isolated prototype fixture directory.");
        const string id="RFQI-SIM-0047";var json=DleAnalysisContract.Json;
        var livePath=Path.Combine(sourceRoot,"data","rfq-intakes.json");var live=await File.ReadAllBytesAsync(livePath);
        var data=JsonNode.Parse(live)!;var original=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()==id)!.DeepClone();
        var correlation=original["requestCorrelationId"]!.GetValue<string>();
        data["records"]=new JsonArray(original.DeepClone());
        var path=Path.Combine(root,"data","rfq-intakes.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path,data.ToJsonString());
        var docs=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(docs);
        var attachments=new Dictionary<string,byte[]>();
        foreach(var f in original["technicalFiles"]!.AsArray())foreach(var ext in new[]{".json",".bin"}){
            var name=f!["documentId"]!.GetValue<string>()+ext;attachments[name]=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,name));
            await File.WriteAllBytesAsync(Path.Combine(docs,name),attachments[name]);
        }
        var actor=new SimPersona("prototype-reviewer","prototype-reviewer","Isolated prototype reviewer","ACTIVE",[],["technical_review.view","technical_review.disposition"],false,"test");
        var denied=actor with{Permissions=["technical_review.view"]};
        SimRfqIntakeStore Store()=>new(root);
        string Serialize(object? o)=>JsonSerializer.Serialize(o,json);
        JsonNode Node(object? o)=>JsonSerializer.SerializeToNode(o,json)!;
        async Task<SimRfqIntakeRecord> Record()=>Node(await Store().ReadTechnicalReviewAsync(id))["record"]!.Deserialize<SimRfqIntakeRecord>(json)!;
        async Task<SimReviewCompletionState> State()=>(SimReviewCompletionState)await Store().ReleaseReadinessAsync(id);
        int checks=0;
        void Check(bool ok,string label){if(!ok)throw new Exception("FAIL: "+label);checks++;Console.WriteLine("PASS: "+label);}
        async Task Reject(Func<Task> action,string code,string label){var before=await File.ReadAllBytesAsync(path);try{await action();throw new Exception("Expected rejection: "+label);}catch(SimRfqIntakeProblem e)when(e.Code==code){}Check(before.SequenceEqual(await File.ReadAllBytesAsync(path)),label+" rejects without writing");}
        async Task Seed(Action<JsonNode> action){var n=JsonNode.Parse(await File.ReadAllBytesAsync(path))!;action(n["records"]![0]!);await File.WriteAllTextAsync(path,n.ToJsonString());}
        async Task Confirm(){var state=await State();await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:state.SubmissionToken),actor);}
        var baseline=await Record();var initial=await File.ReadAllBytesAsync(path);var review=baseline.TechnicalReview!;
        var selected=review.PresentationDraft!;var bom=review.BomAcceptances!.Last();
        Check(selected.ReferenceStatus=="PRELIMINARY"&&selected.TeamDocumentId is not null&&selected.RenditionDocumentId is not null,"copied engineering reference and rendition retained");
        var before=await State();
        Check(before.EngineeringReference&&before.BomAccepted&&before.SlidesAccepted,"existing BOM and slide acceptances are current on fresh copied 0047");
        Check(!before.Ready&&before.PackageAcceptanceRequired&&before.Requirements.Length==1&&before.Requirements[0].Action=="CONFIRM_RFQ_PACKAGE","only genuine package-for-RFQ decision remains; auto PDF/history/Main Drawing do not block");
        Check(initial.SequenceEqual(await File.ReadAllBytesAsync(path)),"readiness is read-only");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("COMPLETE",ExpectedSubmissionToken:before.SubmissionToken),actor);},"SIM_REVIEW_GATE","submission before package confirmation");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:"old"),actor);},"SIM_SUBMISSION_STALE","stale package confirmation");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:before.SubmissionToken),denied);},"SIM_REVIEW_PERMISSION","unauthorized package confirmation");
        await Confirm();var confirmed=await Record();var ready=await State();
        Check(ready.Ready&&!ready.PackageAcceptanceRequired&&ready.Requirements.Length==0,"explicit package sufficiency enables final submission");
        Check(confirmed.TechnicalReview!.Workflow!.RfqPackageAcceptance is {Scope:"RFQ_PREPARATION",ReferenceStatus:"PRELIMINARY"} evidence&&evidence.Reviewer==actor.DisplayName&&evidence.AtUtc!=default,"package decision records scope reviewer and timestamp");
        Check(Serialize(confirmed.TechnicalReview.BomAcceptances)==Serialize(review.BomAcceptances)&&Serialize(confirmed.TechnicalReview.CandidateBom)==Serialize(review.CandidateBom),"confirmation preserves BOM acceptance and all six rows exactly");
        Check(Serialize(confirmed.TechnicalReview.PresentationDraft)==Serialize(selected),"confirmation preserves deck revision acceptance annotations order and exclusions exactly");
        Check(Serialize(confirmed.TechnicalReview.TechnicalPackage)==Serialize(review.TechnicalPackage)&&Serialize(confirmed.TechnicalFiles)==Serialize(baseline.TechnicalFiles),"confirmation preserves original reviewed package and attachments exactly");
        Check(!confirmed.TechnicalReview.Workflow.PackageConfirmed&&!confirmed.TechnicalReview.Workflow.HistoryReviewed&&confirmed.TechnicalReview.Workflow.Manufacturing is null,"confirmation fabricates no legacy package history or manufacturing reviews");
        var confirmedBytes=await File.ReadAllBytesAsync(path);await Confirm();Check(confirmedBytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"repeating current package confirmation is an idempotent no-op");
        Check((await new SimRfqIntakeStore(root).ReleaseReadinessAsync(id) as SimReviewCompletionState)!.Ready,"confirmed readiness survives reopen");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("COMPLETE",ExpectedSubmissionToken:before.SubmissionToken),actor);},"SIM_SUBMISSION_STALE","submission with pre-confirmation token");

        // Each mutation below is made only in this disposable copy and reset before the next check.
        await Seed(r=>r["technicalReview"]!["candidateBom"]!["rows"]![5]!["values"]!["quantity"]="31");
        var changed=await State();Check(!changed.Ready&&!changed.BomAccepted&&!changed.SlidesAccepted,"changed BOM values invalidate both saved acceptances");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("COMPLETE",ExpectedSubmissionToken:ready.SubmissionToken),actor);},"SIM_REVIEW_GATE","submission after BOM change");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        await Seed(r=>r["technicalReview"]!["presentationDraft"]!["excludedSlideKeys"]=new JsonArray());
        changed=await State();Check(!changed.Ready&&changed.BomAccepted&&!changed.SlidesAccepted,"changed slide exclusions require slide acceptance again without invalidating BOM");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        await Seed(r=>r["technicalReview"]!["technicalPackage"]!["documents"]![0]!["identityReview"]!["otherDescription"]="Changed engineering reference identity");
        changed=await State();Check(changed.PackageAcceptanceRequired&&!changed.BomAccepted&&!changed.Ready,"changed document decisions invalidate package evidence and accepted BOM");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:ready.SubmissionToken),actor);},"SIM_SUBMISSION_STALE","confirmation after changed source decision");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        await Seed(r=>r["technicalReview"]!["technicalPackage"]!["documents"]![0]!["identityReview"]=null);
        changed=await State();Check(changed.Requirements.Any(r=>r.Code=="DOCUMENT_IDENTITY"&&r.Action=="REVIEW_DOCUMENTS"),"unaccepted original document identity remains a named blocker");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:(await State()).SubmissionToken),actor);},"SIM_RFQ_PACKAGE_REQUIRED","confirmation cannot fabricate document identity");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        var extra=await new SimIntakeDocuments(root).Stage(correlation,"isolated-extra-reference.pdf",0,new MemoryStream(attachments[selected.RenditionDocumentId+".bin"]),actor.DisplayName);
        await Seed(r=>r["technicalFiles"]!.AsArray().Add(Node(extra)));
        changed=await State();Check(changed.Requirements.Any(r=>r.Code=="DOCUMENT_INVENTORY")&&!changed.Ready,"additional non-rendition customer document still requires inventory review");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:(await State()).SubmissionToken),actor);},"SIM_RFQ_PACKAGE_REQUIRED","confirmation with unreviewed new document");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        var pdfPath=Path.Combine(docs,selected.RenditionDocumentId+".bin");
        await File.WriteAllBytesAsync(pdfPath,[1,2,3]);changed=await State();
        Check(!changed.Ready&&!changed.BomAccepted&&!changed.SlidesAccepted&&changed.Requirements.Any(r=>r.Code=="SOURCE_UNAVAILABLE"),"corrupt linked PDF remains a file-integrity blocker");
        await Reject(async()=>{await Store().WorkflowAsync(id,new("CONFIRM_RFQ_PACKAGE",ExpectedSubmissionToken:(await State()).SubmissionToken),actor);},"SIM_RFQ_PACKAGE_REQUIRED","confirmation with corrupt PDF bytes");
        await File.WriteAllBytesAsync(pdfPath,attachments[selected.RenditionDocumentId+".bin"]);
        await Seed(r=>r["technicalReview"]!["presentationDraft"]!["referenceStatus"]="CUSTOMER_RELEASED");
        changed=await State();Check(!changed.EngineeringReference&&changed.Requirements.Any(r=>r.Code=="PRODUCTION_REFERENCE"),"released/normal route retains its production definition gate");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        await Seed(r=>{r["technicalReview"]!["workflow"]!["rfqPackageAcceptance"]=null;r["technicalReview"]!["workflow"]!["packageConfirmed"]=true;r["technicalReview"]!["workflow"]!["sufficient"]=true;});
        Check((await State()).Ready,"equivalent existing package sufficiency is reused without duplicate confirmation");
        await File.WriteAllBytesAsync(path,confirmedBytes);
        await Seed(r=>r["technicalReview"]!["workflow"]!["version"]=SimRfqIntakeStore.UnifiedPackageVersion);
        await Confirm();Check((await State()).Ready,"RFQ confirmation is supported with the unified package workflow");
        await File.WriteAllBytesAsync(path,confirmedBytes);

        await Store().WorkflowAsync(id,new("HOLD",Needed:"Isolated substantive package question"),actor);
        await Store().WorkflowAsync(id,new("RESUME"),actor);changed=await State();
        Check(changed.PackageAcceptanceRequired&&changed.BomAccepted&&changed.SlidesAccepted&&!changed.Ready,"hold/resume requires package confirmation again while preserving BOM and slides");
        await File.WriteAllBytesAsync(path,confirmedBytes);

        ready=await State();await Store().WorkflowAsync(id,new("COMPLETE",ExpectedSubmissionToken:ready.SubmissionToken),actor);
        var submitted=await Record();var output=submitted.TechnicalReview!.Workflow!.Outputs!;
        Check(submitted.Status=="READY_FOR_RFQ_WORKING_QUEUE"&&output.Status=="READY","explicit isolated final submission enters RFQs");
        Check(output.Manufacturing is {Scope:"RFQ_PREPARATION",ReferenceStatus:"PRELIMINARY",NothingMissing:false}&&output.Manufacturing.OriginalDocumentId==selected.TeamDocumentId&&output.Manufacturing.GoverningDocumentId==selected.RenditionDocumentId,"quotation retains RFQ-only engineering status and original-to-view-PDF provenance");
        Check(Serialize(submitted.TechnicalReview.PresentationDraft)==Serialize(selected)&&Serialize(submitted.TechnicalReview.BomAcceptances)==Serialize(review.BomAcceptances),"submission reuses exact saved BOM and slide acceptance objects");
        Check(Serialize(submitted.TechnicalReview.TechnicalPackage)==Serialize(review.TechnicalPackage)&&submitted.TechnicalReview.Workflow.Manufacturing is null,"submission does not relabel stored source or manufacture production drawing acceptance");
        Check(submitted.TechnicalReview.CandidateBom!.Rows[5].Values["description"]=="TWISTED PAIR WIRE - AWG/TBD"&&submitted.TechnicalReview.CandidateBom.Rows[5].Values["quantity"]=="30","AWG/TBD and quantity30 survive RFQ submission unchanged");
        Check((await Store().ReadRfqs()).Single().Inputs.Manufacturing.Scope=="RFQ_PREPARATION","existing RFQ list recognizes the scoped quotation inputs");
        var materials=await Store().ReadMaterials(id);var labor=await Store().ReadLabor(id);
        Check(materials.Rows.Length==6&&labor.Plan.DefinitionId==output.Manufacturing.Id,"existing Materials and Labor workspaces open from the same scoped inputs");
        var drawing=await Store().ReadDrawingNotes(id,actor);Check(drawing.Source.DocumentId==selected.RenditionDocumentId,"existing Labor drawing editor opens the linked PDF");
        Check(SimRfqIntakeStore.RfqOnlyDefinition(output.Manufacturing)&&!SimRfqIntakeStore.RfqOnlyDefinition(output.Manufacturing with{Scope=null}),"scope distinguishes RFQ-only definition from unchanged legacy production definitions");
        var acceptedMaterial=new SimMaterialSnapshot(1,bom.Version,bom.Candidate.Id,1,[],0,"USD",actor.DisplayName,DateTimeOffset.UtcNow);
        var technical=new SimOrderTechnicalBaseline(new(id,"FIXTURE-QUOTE","fixture-approval",1),"fixture-token",output,acceptedMaterial,null!);
        var order=new SimNewOrderPackage("FIXTURE-PO",new("2026-10-20",[new("SD TEST HARNESS","NC",1,"USD",1,1)],null,null,null),true,null,[],[],null,[],"READY_FOR_CONTRACT_REVIEW",1,1,[],new("QUOTED_DEFINITION","QUOTED_DEFINITION_LINKED",technical,[],[]));
        var method=typeof(SimRfqIntakeStore).GetMethod("OrderAcceptanceBlockers",BindingFlags.NonPublic|BindingFlags.Static)!;
        var blockers=(string[])method.Invoke(null,[order])!;
        Check(blockers.Any(s=>s.Contains("accepted for RFQ only")),"order acceptance cannot treat engineering RFQ acceptance as production authority");
        Check(attachments.All(f=>f.Value.SequenceEqual(File.ReadAllBytes(Path.Combine(docs,f.Key)))),"all copied original attachment and rendition bytes/manifests remain unchanged");
        Check(live.SequenceEqual(await File.ReadAllBytesAsync(livePath)),"actual MichaelDesk saved dataset remains byte-for-byte untouched");
        Console.WriteLine($"Prototype RFQ completion: {checks} checks passed in isolated fixture {root}");
    }
}
