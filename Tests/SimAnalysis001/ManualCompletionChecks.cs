using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ManualCompletionChecks
{
    internal static async Task Run(string sourceRoot,string root)
    {
        if(Directory.Exists(root))throw new Exception("Use a new isolated fixture directory.");
        var json=DleAnalysisContract.Json;var sourcePath=Path.Combine(sourceRoot,"data","rfq-intakes.json");
        var live=await File.ReadAllBytesAsync(sourcePath);var data=JsonNode.Parse(live)!;
        var record=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0047")!.DeepClone();
        var second=record.DeepClone();second["intakeId"]="RFQI-SIM-UNTOUCHED";
        var path=Path.Combine(root,"data","rfq-intakes.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        data["records"]=new JsonArray(record,second);await File.WriteAllTextAsync(path,data.ToJsonString());
        var correlation=record["requestCorrelationId"]!.GetValue<string>();var files=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(files);
        var hashes=new Dictionary<string,string>();
        foreach(var doc in record["technicalFiles"]!.AsArray())foreach(var ext in new[]{".bin",".json"})
        {
            var name=doc!["documentId"]!.GetValue<string>()+ext;var bytes=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,name));
            hashes[name]=Convert.ToHexString(SHA256.HashData(bytes));await File.WriteAllBytesAsync(Path.Combine(files,name),bytes);
        }
        var store=new SimRfqIntakeStore(root);var actor=new SimPersona("fixture","fixture","Manual qualification fixture reviewer","ACTIVE",[],[],true,"test");
        const string id="RFQI-SIM-0047";
        JsonNode Node(object? value)=>JsonSerializer.SerializeToNode(value,json)!;
        string Serialize(object? value)=>JsonSerializer.Serialize(value,json);
        async Task<SimRfqIntakeRecord> Read()=>Node(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(id))["record"]!.Deserialize<SimRfqIntakeRecord>(json)!;
        async Task<SimCandidateBom> Bom()=>(await Read()).TechnicalReview!.CandidateBom!;
        void Check(bool good,string message){if(!good)throw new Exception(message);Console.WriteLine("PASS: "+message);}
        async Task Reject(Func<Task> action,string code,string name)
        {
            var before=await File.ReadAllBytesAsync(path);
            try{await action();throw new Exception("Expected rejection: "+name);}catch(SimRfqIntakeProblem e) when(e.Code==code){}
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(path)),name+" rejected without writes");
        }
        SimManualSourceRequest Source(SimManualCompletionInfo info)=>new(true,info.ExpectedReviewToken,info.EvidenceFingerprint,
            "Synthetic optional note: AWG/TBD remains open for the RFQ stage.");
        async Task<SimBomCompletionRequest> Request()=>new(await Bom(),Source(await store.ReadManualCompletionInfo(id)));
        var beforeInfo=await File.ReadAllBytesAsync(path);var info=await store.ReadManualCompletionInfo(id);var initial=await Read();var initialBom=initial.TechnicalReview!.CandidateBom!;
        Check(beforeInfo.SequenceEqual(await File.ReadAllBytesAsync(path))&&info.Documents.Length==2&&info.Documents.Count(d=>d.IsRendition)==1,"completion info is read-only and distinguishes original from linked rendition");
        var receivedOriginal=initial.TechnicalReview.TechnicalPackage!.Documents.Single();
        var rendition=info.Documents.Single(d=>d.IsRendition);
        var unacceptedClientDraft=new SimPackageDocument(rendition.DocumentId,rendition.Name,"ASSEMBLY_DRAWING","UNRESOLVED","PARENT_ASSEMBLY",null,
            IdentityReview:new("DRAWING"),PartNumberReview:new(null,false),ProductionUse:"PRIMARY_DRAWING",BomUse:"NO_BOM_ROLE");
        await store.SaveUnifiedPackage(id,new(SimRfqIntakeStore.UnifiedPackageVersion,SimRfqIntakeStore.PackageReviewToken(initial),[receivedOriginal,unacceptedClientDraft],null,false,AcceptDocumentId:receivedOriginal.DocumentId),actor);
        var inventoried=await Read();var inventoriedDocs=inventoried.TechnicalReview!.TechnicalPackage!.Documents;
        var pendingRendition=inventoriedDocs.Single(d=>d.DocumentId==rendition.DocumentId);
        Check(inventoriedDocs.Length==2&&Serialize(inventoriedDocs.Single(d=>d.DocumentId==receivedOriginal.DocumentId))==Serialize(receivedOriginal)&&
            pendingRendition.DocumentType=="UNKNOWN"&&pendingRendition.IdentityReview is null&&pendingRendition.ProductionUse=="NOT_FOR_PRODUCTION"&&pendingRendition.BomUse=="NO_BOM_ROLE",
            "row Accept accounts for added rendition without copying authority or leaking another client draft");
        var reviewedRendition=pendingRendition with{DocumentType="SUPPORTING_DOCUMENT",IdentityReview=new("OTHER","Linked local viewing rendition of the preserved original"),PartNumberReview=new(null,false)};
        var renditionManifestPath=Path.Combine(files,rendition.DocumentId+".json");var renditionManifestBytes=await File.ReadAllBytesAsync(renditionManifestPath);
        var renditionManifest=JsonNode.Parse(renditionManifestBytes)!;renditionManifest["owner"]="Different authorized fixture reviewer";await File.WriteAllTextAsync(renditionManifestPath,renditionManifest.ToJsonString());
        await store.SaveUnifiedPackage(id,new(SimRfqIntakeStore.UnifiedPackageVersion,SimRfqIntakeStore.PackageReviewToken(inventoried),[reviewedRendition],null,false,AcceptDocumentId:rendition.DocumentId),actor);
        Check((await store.ReadManualCompletionInfo(id)).Documents.Length==2,"bound rendition staged by another reviewer remains verifiable without changing source ownership");
        await File.WriteAllBytesAsync(renditionManifestPath,renditionManifestBytes);
        var reviewedInventory=await Read();
        Check(reviewedInventory.TechnicalReview!.TechnicalPackage!.Documents.Single(d=>d.DocumentId==rendition.DocumentId).IdentityReview?.Type=="OTHER"&&
            Serialize(reviewedInventory.TechnicalReview.TechnicalPackage.Documents.Single(d=>d.DocumentId==receivedOriginal.DocumentId))==Serialize(receivedOriginal)&&
            Serialize(reviewedInventory.TechnicalFiles)==Serialize(initial.TechnicalFiles)&&Serialize(reviewedInventory.TechnicalReview.PresentationDraft)==Serialize(initial.TechnicalReview.PresentationDraft),
            "explicit rendition row review preserves original classification, attachment identities and slide linkage");
        Check(info.RowBlockers.Length==0&&initialBom.Rows.All(r=>r.ReviewState.Reviewed)&&initialBom.Rows[5].Values["description"]=="TWISTED PAIR WIRE - AWG/TBD"&&initialBom.Rows[5].Values["quantity"]=="30",
            "original AWG/TBD description and quantity 30 are eligible unchanged after structured row acceptance");
        var freeTextBaseline=await File.ReadAllBytesAsync(path);
        foreach(var text in new[]{"TBD","tbd","TBC / UNKNOWN / UNRESOLVED","tBc / UnKnOwN / uNrEsOlVeD","Unknown vendor wording remains free text",""})
        {
            var currentBom=await Bom();var currentRow=currentBom.Rows[5];
            var values=new Dictionary<string,string>(currentRow.Values){["description"]=text,["designators"]="TBD unknown / TBC"};
            await store.CandidateBomAsync(id,actor,new(currentBom.Id,-1,null,ProgressRows:[new(5,currentRow.ReviewState.Token,values,currentRow.ComponentType)]));
            currentBom=await Bom();currentRow=currentBom.Rows[5];
            Check(!currentRow.ReviewState.Reviewed,"ordinary free-text edit still requires explicit row acceptance: "+(text.Length==0?"empty":text));
            await store.CandidateBomAsync(id,actor,new(currentBom.Id,5,new(currentRow.Values),WorksheetAcceptance:new(currentRow.ReviewState.Token,currentRow.ComponentType)));
            var textInfo=await store.ReadManualCompletionInfo(id);var textReady=Node(await store.BomCompletionReadiness(id,await Request()));
            Check(textInfo.RowBlockers.Length==0&&textReady["ready"]!.GetValue<bool>()&&(await Bom()).Rows[5].Values["description"]==text,
                "free-text keywords/casing do not create qualification blockers: "+(text.Length==0?"empty":text));
        }
        await File.WriteAllBytesAsync(path,freeTextBaseline);
        async Task StructuredBlock(Action<JsonNode> mutation,string label)
        {
            var before=await File.ReadAllBytesAsync(path);var fixture=JsonNode.Parse(before)!;
            mutation(fixture["records"]![0]!["technicalReview"]!["candidateBom"]!["rows"]![5]!);
            await File.WriteAllTextAsync(path,fixture.ToJsonString());
            await Reject(async()=>{await store.CompleteBomReview(id,await Request(),actor);},"SIM_BOM_UNRESOLVED",label);
            await File.WriteAllBytesAsync(path,before);
        }
        await StructuredBlock(r=>r["values"]!["partNumber"]="","missing required part number");
        await StructuredBlock(r=>r["values"]!["lineNumber"]="0","invalid structured line number");
        foreach(var invalidQuantity in new[]{"","0","-1","not-a-number"})
            await StructuredBlock(r=>r["values"]!["quantity"]=invalidQuantity,"invalid structured quantity '"+invalidQuantity+"'");
        await StructuredBlock(r=>r["componentType"]="UNKNOWN","unresolved structured component type");
        await StructuredBlock(r=>r["confirmed"]=false,"unaccepted structured row state");
        await StructuredBlock(r=>r["manufacturerIdentity"]!["stale"]=true,"stale manufacturer identity");
        await StructuredBlock(r=>r["sourcePartNumberReview"]!["current"]!["status"]="UNRESOLVED","unresolved source identity decision");
        await StructuredBlock(r=>r["manufacturerIdentity"]!["history"]!.AsArray().Clear(),"pending manufacturer identity decision");
        var rowForStale=(await Bom()).Rows[5];
        await Reject(async()=>{await store.CandidateBomAsync(id,actor,new(initialBom.Id,5,new(rowForStale.Values),WorksheetAcceptance:new("stale",rowForStale.ComponentType)));},"SIM_ROW_APPROVAL_STALE","stale row acceptance token");
        var request=await Request();info=await store.ReadManualCompletionInfo(id);
        Check(Serialize(request.Candidate.Rows)==Serialize(initialBom.Rows),"keyword and structured negative fixtures restore all original row values and acceptance history before qualification");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=null},actor);},"SIM_MANUAL_AUTHORITY_REQUIRED","missing manual source authority");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=request.ManualSource! with{Confirm=false}},actor);},"SIM_MANUAL_AUTHORITY_REQUIRED","missing explicit source review confirmation");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=request.ManualSource! with{ReviewNotes=new string('x',4001)}},actor);},"SIM_MANUAL_REVIEW_NOTES_INVALID","oversized optional review notes");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{Candidate=request.Candidate with{Id="stale"}},actor);},"SIM_BOM_CHANGED","stale exact candidate");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=request.ManualSource! with{ExpectedReviewToken="stale"}},actor);},"SIM_PACKAGE_CHANGED","stale review token");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=request.ManualSource! with{EvidenceFingerprint="stale"}},actor);},"SIM_MANUAL_SOURCE_CHANGED","stale source fingerprint");
        var originalId=info.Documents.Single(d=>!d.IsRendition).DocumentId;
        var preAcceptanceBytes=await File.ReadAllBytesAsync(path);
        var blankRequest=request with{ManualSource=request.ManualSource! with{ReviewNotes=null}};
        await store.CompleteBomReview(id,blankRequest,actor);
        var blankAccepted=(await Read()).TechnicalReview!.BomAcceptances!.Single().ManualSource!;
        Check(blankAccepted.ReviewNotes is null&&blankAccepted.Rationale==""&&blankAccepted.QuantityBasis=="","blank optional notes require no source or quantity narratives");
        var blankAcceptedBytes=await File.ReadAllBytesAsync(path);
        await store.CompleteBomReview(id,blankRequest with{ManualSource=blankRequest.ManualSource! with{ReviewNotes="   "}},actor);
        Check(blankAcceptedBytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"blank and whitespace-only notes normalize to the same idempotent decision");
        await File.WriteAllBytesAsync(path,preAcceptanceBytes);

        // A manually authored BOM need not pretend to have received document source authority.
        var noFiles=JsonNode.Parse(preAcceptanceBytes)!;
        noFiles["records"]![0]!["technicalFiles"]=new JsonArray();
        noFiles["records"]![0]!["technicalReview"]!["technicalPackage"]!["documents"]=new JsonArray();
        await File.WriteAllTextAsync(path,noFiles.ToJsonString());
        var noFilesInfo=await store.ReadManualCompletionInfo(id);
        Check(noFilesInfo.Documents.Length==0&&noFilesInfo.Blockers.Length==0,"valid manually authored BOM has no invented original-attachment requirement");
        await store.CompleteBomReview(id,await Request(),actor);
        var noFilesAccepted=await Read();
        Check(noFilesAccepted.TechnicalReview!.BomAcceptances!.Single().ManualSource!.Sources.Length==0&&
            await store.HasCurrentManualAcceptance(noFilesAccepted,noFilesAccepted.TechnicalReview.BomAcceptances!.Single()),"zero linked references remain truthfully empty and current after explicit acceptance");
        await File.WriteAllBytesAsync(path,preAcceptanceBytes);
        var missingTarget=JsonNode.Parse(preAcceptanceBytes)!;missingTarget["records"]![0]!["assemblies"]![0]!["revision"]="";
        await File.WriteAllTextAsync(path,missingTarget.ToJsonString());
        await Reject(async()=>{await store.CompleteBomReview(id,await Request(),actor);},"SIM_MANUAL_TARGET_CHANGED","missing structured assembly revision");
        await File.WriteAllBytesAsync(path,preAcceptanceBytes);
        var ready=Node(await store.BomCompletionReadiness(id,request));Check(ready["ready"]!.GetValue<bool>(),"explicit clean fixture can qualify materials without claiming package or drawing approval");
        var beforeAcceptance=await Read();await store.CompleteBomReview(id,request,actor);var acceptedRecord=await Read();var acceptance=acceptedRecord.TechnicalReview!.BomAcceptances!.Single();
        var afterFirstAcceptance=await File.ReadAllBytesAsync(path);
        await store.CompleteBomReview(id,request,actor);
        Check(afterFirstAcceptance.SequenceEqual(await File.ReadAllBytesAsync(path)),"exact retry after a lost qualification response reuses the recorded token without a second write");
        await Reject(async()=>{await store.CompleteBomReview(id,request with{ManualSource=request.ManualSource! with{ReviewNotes="Changed decision"}},actor);},"SIM_BOM_ACCEPTED","old token cannot change the accepted source decision");
        Check(acceptance.ManualSource is {Authority:"DLE_AUTHORED_REVIEWER",Reviewer:"Manual qualification fixture reviewer",AcceptanceScope:"RFQ_PREPARATION",SourceReferenceBasis:"LINKED_REFERENCES_ONLY",Authorship:"DLE_AUTHORED"}&&
            acceptance.ManualSource.ReviewNotes==request.ManualSource!.ReviewNotes&&acceptance.ManualSource.Rationale==""&&acceptance.ManualSource.QuantityBasis==""&&
            acceptance.ManualSource.Sources.Length==2&&acceptance.ManualSource.Sources.Count(s=>s.IsRendition)==1&&
            acceptance.ManualSource.Sources.Single(s=>s.DocumentId==originalId).Sha256==DleAnalysisContract.Hash(await File.ReadAllBytesAsync(Path.Combine(files,originalId+".bin")))&&
            acceptance.ManualSource.CandidateId==initialBom.Id&&acceptance.ManualSource.CandidateRevision==initialBom.ManualDraft!.Revision&&
            acceptance.ManualSource.AssemblyNumber==initial.Assemblies[0].AssemblyNumber&&acceptance.ManualSource.AssemblyRevision==initial.Assemblies[0].Revision&&acceptance.ManualSource.AtUtc>initialBom.ManualDraft.CreatedAtUtc,
            "acceptance automatically records version, target, reviewer, time, manual authorship and all linked source hashes without attachment-inspection claims");
        var legacySource=acceptance.ManualSource! with{Sources=acceptance.ManualSource.Sources.Where(s=>!s.IsRendition).ToArray(),Rationale="Historical explicit source inspection rationale",QuantityBasis="Historical quantity basis",ReviewNotes=null,AcceptanceScope=null,SourceReferenceBasis=null,Authorship=null};
        var legacyAcceptance=acceptance with{ManualSource=legacySource};
        var legacyJson=Serialize(legacyAcceptance);var legacyDecoded=JsonSerializer.Deserialize<SimBomAcceptance>(legacyJson,json)!;
        Check(!legacyJson.Contains("acceptanceScope")&&!legacyJson.Contains("sourceReferenceBasis")&&legacyDecoded.ManualSource!.Rationale==legacySource.Rationale&&legacyDecoded.ManualSource.QuantityBasis==legacySource.QuantityBasis&&
            await store.HasCurrentManualAcceptance(acceptedRecord,legacyDecoded),"legacy acceptance remains readable/current with its original selected-source evidence and no retroactive scope metadata");
        var currentAcceptedBytes=await File.ReadAllBytesAsync(path);var legacyFixture=JsonNode.Parse(currentAcceptedBytes)!;
        legacyFixture["records"]![0]!["technicalReview"]!["bomAcceptances"]=Node(new[]{legacyDecoded});
        await File.WriteAllTextAsync(path,legacyFixture.ToJsonString());
        var legacyBytes=await File.ReadAllBytesAsync(path);var legacyRequest=await Request();
        await store.CompleteBomReview(id,legacyRequest with{ManualSource=legacyRequest.ManualSource! with{ReviewNotes=null}},actor);
        Check(legacyBytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"compact retry of historical acceptance preserves every legacy evidence field without writing");
        await File.WriteAllBytesAsync(path,currentAcceptedBytes);
        Check(Serialize(acceptance.Candidate)==Serialize(request.Candidate)&&Serialize(acceptedRecord.TechnicalReview.CandidateBom)==Serialize(beforeAcceptance.TechnicalReview!.CandidateBom),"accepted snapshot and current candidate retain exact reviewed row values and histories");
        Check(acceptance.Candidate.Rows[5].Values["description"]==initialBom.Rows[5].Values["description"]&&acceptance.Candidate.Rows[5].Values["quantity"]=="30",
            "qualification preserves original AWG/TBD wording and quantity 30 without rewriting or inferring values");
        var normalized=acceptedRecord with{TechnicalReview=acceptedRecord.TechnicalReview with{BomAcceptances=beforeAcceptance.TechnicalReview!.BomAcceptances,MaterialsReviewStatus=beforeAcceptance.TechnicalReview.MaterialsReviewStatus,NextReviewPhase=beforeAcceptance.TechnicalReview.NextReviewPhase}};
        Check(Serialize(normalized)==Serialize(beforeAcceptance)&&acceptedRecord.TechnicalReview.MaterialsReviewStatus=="QUALIFIED"&&acceptedRecord.TechnicalReview.Workflow!.Outputs is null&&!acceptedRecord.TechnicalReview.Workflow.PackageConfirmed,"qualification changes only material acceptance/status; drawing, workflow, slides and original attachments remain unchanged");
        Check(await store.HasCurrentManualAcceptance(acceptedRecord,acceptance),"fresh manual acceptance validates against current source bytes and target");
        using(var unavailable=new FileStream(Path.Combine(files,originalId+".bin"),FileMode.Open,FileAccess.Read,FileShare.None))
        {
            var unavailableInfo=await store.ReadManualCompletionInfo(id);
            Check(!unavailableInfo.CurrentAcceptance&&unavailableInfo.Blockers.Any(b=>b.Contains("temporarily unavailable")),"temporary source access failure returns specific manual-readiness blocker");
            var unavailableRelease=(SimReviewCompletionState)await store.ReleaseReadinessAsync(id);
            Check(!unavailableRelease.Ready&&unavailableRelease.Blockers.Any(b=>b.Contains("accepted BOM source evidence is temporarily unavailable")),"temporary accepted-source access failure blocks submission without an unhandled error");
        }
        var completeInventoryBytes=await File.ReadAllBytesAsync(path);var incompleteInventory=JsonNode.Parse(completeInventoryBytes)!;
        incompleteInventory["records"]![0]!["technicalReview"]!["technicalPackage"]!["documents"]!.AsArray().RemoveAt(1);
        await File.WriteAllTextAsync(path,incompleteInventory.ToJsonString());
        var missingInventory=(SimReviewCompletionState)await store.ReleaseReadinessAsync(id);
        Check(!missingInventory.Ready&&missingInventory.Blockers.Any(b=>b.Contains("complete current document inventory")),"added rendition missing from package review independently blocks submission");
        await File.WriteAllBytesAsync(path,completeInventoryBytes);
        var package=acceptedRecord.TechnicalReview.TechnicalPackage!;var changedDocuments=package.Documents.ToArray();changedDocuments[0]=changedDocuments[0] with{Name="changed-package-label"};
        Check(!await store.HasCurrentManualAcceptance(acceptedRecord with{TechnicalReview=acceptedRecord.TechnicalReview with{TechnicalPackage=package with{Documents=changedDocuments}}},acceptance),"changed material package invalidates acceptance");
        var target=acceptedRecord.Assemblies[0] with{Revision="changed"};Check(!await store.HasCurrentManualAcceptance(acceptedRecord with{Assemblies=[target]},acceptance),"changed assembly revision invalidates acceptance");
        var mutatedRows=acceptance.Candidate.Rows.ToArray();mutatedRows[0]=mutatedRows[0] with{Values=new(mutatedRows[0].Values){["quantity"]="999"}};
        Check(!await store.HasCurrentManualAcceptance(acceptedRecord with{TechnicalReview=acceptedRecord.TechnicalReview with{CandidateBom=acceptance.Candidate with{Rows=mutatedRows}}},acceptance),"changed accepted row snapshot invalidates acceptance");
        var originalBytes=await File.ReadAllBytesAsync(Path.Combine(files,originalId+".bin"));await File.WriteAllBytesAsync(Path.Combine(files,originalId+".bin"),[1,2,3]);
        Check(!await store.HasCurrentManualAcceptance(acceptedRecord,acceptance),"tampered source bytes invalidate acceptance");await File.WriteAllBytesAsync(Path.Combine(files,originalId+".bin"),originalBytes);
        var unchanged=await File.ReadAllBytesAsync(path);var readView=await store.CandidateBomAsync(id,actor);Check(readView is not null&&unchanged.SequenceEqual(await File.ReadAllBytesAsync(path)),"accepted manual BOM remains readable without writes");
        var acceptedBom=await Bom();await Reject(async()=>{await store.CandidateBomAsync(id,actor,new(acceptedBom.Id,0,acceptedBom.Rows[0].Values));},"SIM_BOM_ACCEPTED","accepted manual BOM remains edit-locked");
        await store.CompleteBomReview(id,await Request(),actor);Check(unchanged.SequenceEqual(await File.ReadAllBytesAsync(path)),"repeat qualification with fresh review token preserves acceptance without writing");
        await Reject(async()=>{await store.StartManualBomRevision(id,new(acceptedBom.Id,-1,"Fixture revision"),actor);},"SIM_MANUAL_BOM_CHANGED","stale manual revision");
        await Reject(async()=>{await store.StartManualBomRevision(id,new(acceptedBom.Id,acceptedBom.ManualDraft!.Revision,""),actor);},"SIM_MANUAL_REVISION_REASON","missing revision reason");
        var revisionRequest=new SimManualRevisionRequest(acceptedBom.Id,acceptedBom.ManualDraft!.Revision,"Synthetic fixture change requiring fresh material review");
        await store.StartManualBomRevision(id,revisionRequest,actor);var revisedRecord=await Read();var revised=revisedRecord.TechnicalReview!.CandidateBom!;
        Check(revised.Id!=acceptedBom.Id&&revised.ManualDraft?.PreviousCandidateId==acceptedBom.Id&&revised.ManualDraft.Revision==0&&revised.Rows.All(r=>!r.ReviewState.Reviewed&&!r.Confirmed),"new revision receives new identity and requires fresh row acceptance");
        Check(revised.Rows.Zip(acceptedBom.Rows).All(p=>p.First.RowId==p.Second.RowId&&Serialize(p.First.Values)==Serialize(p.Second.Values)&&Serialize(p.First.WholeRowHistory)==Serialize(p.Second.WholeRowHistory)&&Serialize(p.First.SourcePartNumberReview)==Serialize(p.Second.SourcePartNumberReview)),"new revision preserves stable rows, entered values, prior acceptance audit and identity decisions");
        Check(Serialize(revisedRecord.TechnicalReview.CandidateBomVersions!.Last())==Serialize(acceptedBom)&&Serialize(revisedRecord.TechnicalReview.BomAcceptances)==Serialize(acceptedRecord.TechnicalReview.BomAcceptances)&&Serialize(revisedRecord.TechnicalReview.PresentationDraft)==Serialize(acceptedRecord.TechnicalReview.PresentationDraft)&&revisedRecord.TechnicalReview.MaterialsReviewStatus is null,"revision archives exact accepted BOM and preserves acceptance/presentation history while clearing qualification");
        unchanged=await File.ReadAllBytesAsync(path);await store.StartManualBomRevision(id,revisionRequest,actor);Check(unchanged.SequenceEqual(await File.ReadAllBytesAsync(path)),"retrying new revision is idempotent without another candidate");
        await Reject(async()=>{await store.CompleteBomReview(id,await Request(),actor);},"SIM_BOM_UNRESOLVED","new revision cannot reuse prior row acceptance");
        Check(JsonNode.DeepEquals(JsonNode.Parse(await File.ReadAllBytesAsync(path))!["records"]![1],second),"unrelated saved fixture scenario unchanged");
        foreach(var item in hashes)
        {
            var copiedHash=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(files,item.Key))));
            var originalHash=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,item.Key))));
            Check(copiedHash==item.Value&&originalHash==item.Value,"original/rendition byte and metadata hash retained: "+item.Key);
        }
        Check(live.SequenceEqual(await File.ReadAllBytesAsync(sourcePath)),"live SIM data and all saved scenarios remain byte-for-byte unchanged");
        Console.WriteLine("Fixture: "+root);
    }
}
