using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ReviewCompletionChecks
{
    internal static async Task Run(string sourceRoot, string root)
    {
        if (Directory.Exists(root)) throw new Exception("Use a new isolated completion fixture directory.");
        const string id = "RFQI-SIM-0047";
        var json = DleAnalysisContract.Json;
        var livePath = Path.Combine(sourceRoot, "data", "rfq-intakes.json");
        var liveBytes = await File.ReadAllBytesAsync(livePath);
        var sourceData = JsonNode.Parse(liveBytes)!;
        var originalNode = sourceData["records"]!.AsArray().Single(r => r!["intakeId"]!.GetValue<string>() == id)!.DeepClone();
        var correlation = originalNode["requestCorrelationId"]!.GetValue<string>();
        var path = Path.Combine(root, "data", "rfq-intakes.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var data = sourceData.DeepClone();
        data["records"] = new JsonArray(originalNode.DeepClone());
        await File.WriteAllTextAsync(path, data.ToJsonString());
        var fixtureDocuments = Path.Combine(root, "intake-documents", correlation);
        Directory.CreateDirectory(fixtureDocuments);
        var attachmentBytes = new Dictionary<string, byte[]>();
        foreach (var document in originalNode["technicalFiles"]!.AsArray())
        foreach (var extension in new[] { ".bin", ".json" })
        {
            var name = document!["documentId"]!.GetValue<string>() + extension;
            var bytes = await File.ReadAllBytesAsync(Path.Combine(sourceRoot, "intake-documents", correlation, name));
            attachmentBytes[name] = bytes;
            await File.WriteAllBytesAsync(Path.Combine(fixtureDocuments, name), bytes);
        }

        var actor = new SimPersona("completion-fixture", "completion-fixture", "Synthetic completion test reviewer", "ACTIVE", [], [], true, "test");
        SimRfqIntakeStore Store() => new(root);
        JsonNode Node(object? value) => JsonSerializer.SerializeToNode(value, json)!;
        string Serialize(object? value) => JsonSerializer.Serialize(value, json);
        async Task<SimRfqIntakeRecord> Record() => Node(await Store().ReadTechnicalReviewAsync(id))["record"]!.Deserialize<SimRfqIntakeRecord>(json)!;
        void Check(bool condition, string label)
        {
            if (!condition) throw new Exception("FAIL: " + label);
            Console.WriteLine("PASS: " + label);
        }
        async Task Reject(Func<Task> action, string label, string? expectedCode = null)
        {
            var before = await File.ReadAllBytesAsync(path);
            try { await action(); throw new Exception("Expected rejection: " + label); }
            catch (SimRfqIntakeProblem problem) when (expectedCode is null || problem.Code == expectedCode) { }
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(path)), label + " rejects without writing");
        }
        async Task<JsonNode> Readiness() => Node(await Store().ReleaseReadinessAsync(id));
        async Task CheckBlocked(string label)
        {
            var result = await Readiness();
            Check(result["ready"]?.GetValue<bool>() == false && !string.IsNullOrWhiteSpace(result["message"]?.GetValue<string>()), label);
        }
        SimWorkflowRequest Submit(string? token) => new JsonObject { ["action"] = "COMPLETE", ["expectedSubmissionToken"] = token }.Deserialize<SimWorkflowRequest>(json)!;
        async Task AcceptSlides()
        {
            var state = await Store().ProductionSlidesState(await Record());
            Check(state.CanAccept, "saved shared-viewer deck is eligible for explicit acceptance");
            await Store().AcceptProductionSlides(id, new(state.Revision, state.Fingerprint), actor);
        }
        async Task<SimBomCompletionRequest> CompletionRequest()
        {
            var record = await Record();
            var info = await Store().ReadManualCompletionInfo(id);
            return new(record.TechnicalReview!.CandidateBom!, new(true,info.ExpectedReviewToken,info.EvidenceFingerprint));
        }
        async Task SavePackage(bool complete, string? missing = null)
        {
            var record = await Record();
            await Store().SaveUnifiedPackage(id, new(SimRfqIntakeStore.UnifiedPackageVersion, SimRfqIntakeStore.PackageReviewToken(record),
                record.TechnicalReview!.TechnicalPackage!.Documents, null, complete, Missing: missing), actor);
        }
        async Task SaveDraft(SimReviewPresentation draft)
        {
            var view = Node(await Store().ReadPresentation(id));
            await Store().SavePresentation(id, new(view["draft"]!["revision"]!.GetValue<int>(), view["bomToken"]!.GetValue<string>(), draft), actor);
        }
        async Task Seed(Action<JsonNode> mutation)
        {
            var fixture = JsonNode.Parse(await File.ReadAllBytesAsync(path))!;
            mutation(fixture);
            await File.WriteAllTextAsync(path, fixture.ToJsonString());
        }

        var baseline = await Record();
        var initialBom = baseline.TechnicalReview!.CandidateBom!;
        var originalPresentation = baseline.TechnicalReview.PresentationDraft!;
        var originalDocumentId = originalPresentation.TeamDocumentId!;
        Check(initialBom.Rows.Length == 6 && initialBom.Rows.All(r => r.Confirmed && r.ReviewState.Reviewed), "fresh copied 0047 has six explicitly accepted rows");
        Check(initialBom.Rows[5].Values["description"] == "TWISTED PAIR WIRE - AWG/TBD" && initialBom.Rows[5].Values["quantity"] == "30", "original row 6 free-text description and quantity are retained for full completion");
        var info = await Store().ReadManualCompletionInfo(id);
        Check(info.RowBlockers.Length == 0, "AWG/TBD wording creates no keyword-based qualification blocker after explicit row acceptance");

        var initialFixture = await File.ReadAllBytesAsync(path);
        await AcceptSlides();
        await CheckBlocked("slide acceptance alone cannot submit Technical Review");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit("not-ready"), actor); }, "slide-only submission");
        await File.WriteAllBytesAsync(path, initialFixture);

        // Metadata-only decision in this disposable test; original bytes and actual classifications are untouched.
        var drawing = baseline.TechnicalReview.TechnicalPackage!.Documents.Single(d => d.DocumentId == originalDocumentId) with
        {
            DocumentType = "ASSEMBLY_DRAWING", Applicability = "PARENT_ASSEMBLY", EmbeddedBom = false,
            ProductionUse = "PRIMARY_DRAWING", BomUse = "NO_BOM_ROLE",
            IdentityReview = new("DRAWING", "SYNTHETIC TEST ONLY: eligible fixture drawing", "CORRECTED", actor.DisplayName, DateTimeOffset.UtcNow),
            PartNumberReview = new(null, true, actor.DisplayName, DateTimeOffset.UtcNow)
        };
        await Store().SaveUnifiedPackage(id, new(SimRfqIntakeStore.UnifiedPackageVersion, SimRfqIntakeStore.PackageReviewToken(await Record()), [drawing], null, false, AcceptDocumentId: drawing.DocumentId), actor);
        var current = await Record();
        var rendition = current.TechnicalReview!.TechnicalPackage!.Documents.Single(d => d.DocumentId == originalPresentation.RenditionDocumentId);
        Check(rendition.DocumentType == "UNKNOWN" && rendition.IdentityReview is null, "newly inventoried rendition remains explicitly unreviewed after accepting only the original");
        rendition = rendition with
        {
            DocumentType = "SUPPORTING_DOCUMENT", Applicability = "SUPPORTING_REFERENCE", Role = "UNRESOLVED",
            ProductionUse = "NOT_FOR_PRODUCTION", BomUse = "NO_BOM_ROLE",
            IdentityReview = new("OTHER", "SYNTHETIC TEST ONLY: viewing rendition of preserved Word original", "CORRECTED", actor.DisplayName, DateTimeOffset.UtcNow),
            PartNumberReview = new(null, false, actor.DisplayName, DateTimeOffset.UtcNow)
        };
        await Store().SaveUnifiedPackage(id, new(SimRfqIntakeStore.UnifiedPackageVersion, SimRfqIntakeStore.PackageReviewToken(current), [rendition], null, false, AcceptDocumentId: rendition.DocumentId), actor);
        current = await Record();
        Check(current.TechnicalReview!.TechnicalPackage!.GoverningBomDocumentId is null && current.TechnicalReview.CandidateBom!.Id == initialBom.Id, "package classification creates no fake received BOM and retains the same manual candidate");

        var bom = current.TechnicalReview.CandidateBom!;
        Check(Serialize(bom.Rows) == Serialize(initialBom.Rows), "package preparation leaves every original BOM row, acceptance and free-text description unchanged");
        info = await Store().ReadManualCompletionInfo(id);
        Check(info.RowBlockers.Length == 0 && info.Blockers.Length == 0, "original accepted rows are eligible for explicit final manual qualification without description rewriting");
        await Store().CompleteBomReview(id, await CompletionRequest(), actor);
        current = await Record();
        Check(current.TechnicalReview!.MaterialsReviewStatus == "QUALIFIED" && current.TechnicalReview.BomAcceptances!.Length == 1 && current.TechnicalReview.BomAcceptances[0].ManualSource is {Authority:"DLE_AUTHORED_REVIEWER",ReviewNotes:null,AcceptanceScope:"RFQ_PREPARATION",SourceReferenceBasis:"LINKED_REFERENCES_ONLY",Authorship:"DLE_AUTHORED"}, "compact confirmation without notes creates one immutable RFQ-scoped acceptance with linked-reference evidence");
        await CheckBlocked("BOM acceptance alone cannot submit Technical Review");
        await SavePackage(true);
        await CheckBlocked("accepted manual BOM and complete package still require slide acceptance");

        var view = Node(await Store().ReadPresentation(id));
        var draft = view["draft"]!.Deserialize<SimReviewPresentation>(json)!;
        var reference = view["reference"]!;
        var referenceId = reference["documentId"]!.GetValue<string>();
        var annotationId = Guid.NewGuid().ToString("D");
        var markId = Guid.NewGuid().ToString("D");
        var annotation = new SimReviewSlide(annotationId, "REFERENCE", reference["token"]!.GetValue<string>(), referenceId, 1,
            "Synthetic acceptance check", "SYNTHETIC TEST ONLY: retained annotation",
            new(Guid.NewGuid().ToString("D"), "Synthetic annotation", [new(markId, 1, "text", [new(.3, .4)], "Synthetic test mark")], new(1, .5, .5, .8, .8)));
        await SaveDraft(draft with { Slides = draft.Slides.Append(annotation).ToArray() });
        await AcceptSlides();
        current = await Record();
        var acceptedBomSnapshot = Serialize(current.TechnicalReview!.BomAcceptances);
        var acceptedDraft = current.TechnicalReview.PresentationDraft!;
        Check(acceptedDraft.ReferenceStatus == originalPresentation.ReferenceStatus && Serialize(acceptedDraft.ExcludedSlideKeys) == Serialize(originalPresentation.ExcludedSlideKeys), "slide acceptance preserves drawing status and excluded blank reference page");
        var readiness = await Readiness();
        Check(readiness["ready"]!.GetValue<bool>(), "current BOM, package and saved slide acceptances satisfy aggregate submission gate");
        var submissionToken = readiness["submissionToken"]!.GetValue<string>();
        Check(!string.IsNullOrWhiteSpace(submissionToken), "release readiness returns current explicit submission token");
        var readyBytes = await File.ReadAllBytesAsync(path);
        await Reject(async () => { await Store().WorkflowAsync(id, Submit(null), actor); }, "missing submission token", "SIM_SUBMISSION_STALE");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit("stale"), actor); }, "stale submission token", "SIM_SUBMISSION_STALE");

        // Each adversarial case restores only this isolated fixture's known-ready snapshot.
        await SavePackage(false, "SYNTHETIC TEST ONLY: missing package decision");
        await CheckBlocked("hold blocks otherwise accepted Technical Review");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit(submissionToken), actor); }, "held submission");
        await File.WriteAllBytesAsync(path, readyBytes);

        await Seed(dataset =>
        {
            var jobs = dataset["analysisJobs"]!.AsArray();
            var pending = jobs.First()!.DeepClone();
            pending["input"]!["intakeId"] = id; pending["input"]!["jobId"] = Guid.NewGuid().ToString("D"); pending["status"] = "QUEUED";
            jobs.Add(pending);
        });
        await CheckBlocked("pending analysis blocks otherwise accepted Technical Review");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit(submissionToken), actor); }, "pending-analysis submission");
        await File.WriteAllBytesAsync(path, readyBytes);

        await SaveDraft(acceptedDraft with { Slides = acceptedDraft.Slides.Select(s => s.Id == annotationId ? s with { Stage = s.Stage with { Marks = s.Stage.Marks.Select(m => m.Id == markId ? m with { Text = "Changed synthetic annotation" } : m).ToArray() } } : s).ToArray() });
        Check(!(await Store().ProductionSlidesState(await Record())).Ready, "saved annotation edit invalidates production-slide acceptance");
        await CheckBlocked("annotation edit invalidates aggregate submission readiness");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit(submissionToken), actor); }, "pre-edit submission token");
        Check(Serialize((await Record()).TechnicalReview!.BomAcceptances) == acceptedBomSnapshot, "slide annotation changes preserve immutable BOM acceptance");
        await File.WriteAllBytesAsync(path, readyBytes);

        await SaveDraft(acceptedDraft with { SlideOrder = ["TRAVELER:1", "BOM:1", "REFERENCE:" + referenceId + ":1"] });
        Check(!(await Store().ProductionSlidesState(await Record())).Ready, "saved slide ordering invalidates prior slide acceptance");
        await CheckBlocked("changed order blocks submission while traveler-BOM-reference order remains explicit");
        await File.WriteAllBytesAsync(path, readyBytes);

        var originalCopyPath = Path.Combine(fixtureDocuments, originalDocumentId + ".bin");
        try
        {
            await File.WriteAllBytesAsync(originalCopyPath, attachmentBytes[originalDocumentId + ".bin"].Concat(System.Text.Encoding.UTF8.GetBytes("SYNTHETIC TEST SOURCE CHANGE")).ToArray());
            current = await Record();
            Check(!(await Store().ProductionSlidesState(current)).Ready, "changed original source bytes invalidate accepted slide fingerprint");
            Check(!await Store().HasCurrentManualAcceptance(current, current.TechnicalReview!.BomAcceptances!.Single()), "changed original source bytes invalidate manual source acceptance");
        }
        finally { await File.WriteAllBytesAsync(originalCopyPath, attachmentBytes[originalDocumentId + ".bin"]); }
        await File.WriteAllBytesAsync(path, readyBytes);

        current = await Record(); bom = current.TechnicalReview!.CandidateBom!;
        await Store().StartManualBomRevision(id, new(bom.Id, bom.ManualDraft!.Revision, "SYNTHETIC TEST ONLY: verify revision invalidates both current decisions"), actor);
        current = await Record();
        Check(current.TechnicalReview!.CandidateBom!.Id != bom.Id && Serialize(current.TechnicalReview.BomAcceptances) == acceptedBomSnapshot && current.TechnicalReview.CandidateBomVersions!.Any(b => b.Id == bom.Id), "explicit revision preserves accepted BOM and creates one new working candidate");
        Check(!(await Store().ProductionSlidesState(current)).Ready, "new manual BOM revision invalidates accepted deck input fingerprint");
        await CheckBlocked("new manual revision requires renewed BOM and slide decisions");
        await File.WriteAllBytesAsync(path, readyBytes);

        await Store().WorkflowAsync(id, Submit(submissionToken), actor);
        current = await Record();
        var workflow = current.TechnicalReview!.Workflow!;
        Check(current.Status == "READY_FOR_RFQ_WORKING_QUEUE" && current.TechnicalReview.DownstreamHandoffTarget == "QUOTATION_INPUTS" && workflow.Outputs is { MaterialsTarget: "QUOTATION_MATERIALS", ManufacturingTarget: "QUOTATION_LABOR" }, "explicit COMPLETE creates quotation-only handoff");
        Check(workflow.Outputs!.ProductionSlides == acceptedDraft.ProductionAcceptances!.Last(), "quotation handoff references the exact existing accepted deck revision, fingerprint and reviewer without copying slides");
        Check((await Store().ReadRfqs()).Single(r => r.IntakeId == id).Inputs.ProductionSlides == workflow.Outputs.ProductionSlides, "RFQ inputs expose the same accepted-deck reference");
        Check(current.TechnicalReview.BomAcceptances!.Length == 1 && current.TechnicalReview.PresentationDraft!.ProductionAcceptances!.Length == 1 && current.TechnicalReview.CandidateBom!.Id == bom.Id, "submission does not duplicate BOM or slide acceptances");
        Check(Serialize(current.TechnicalReview.PresentationDraft!.Slides) == Serialize(acceptedDraft.Slides) && Serialize(current.TechnicalReview.PresentationDraft.ExcludedSlideKeys) == Serialize(originalPresentation.ExcludedSlideKeys), "submission preserves saved slides, annotations and page exclusion");
        Check(current.TechnicalReview.CandidateBom!.Rows.Length == 6 && current.TechnicalReview.CandidateBom.Rows.Select(r => r.RowId).SequenceEqual(initialBom.Rows.Select(r => r.RowId)), "submission preserves all six stable BOM row identities and order");
        Check(Serialize(current.TechnicalReview.CandidateBom.Rows) == Serialize(initialBom.Rows) && current.TechnicalReview.CandidateBom.Rows[5].Values["description"] == "TWISTED PAIR WIRE - AWG/TBD" && current.TechnicalReview.CandidateBom.Rows[5].Values["quantity"] == "30",
            "full BOM qualification, slide acceptance and quotation submission preserve original AWG/TBD, quantity 30 and all row histories byte-for-byte in serialized rows");
        await Reject(async () => { await Store().WorkflowAsync(id, Submit(submissionToken), actor); }, "duplicate explicit COMPLETE", "SIM_REVIEW_CLOSED");
        Check(Directory.GetFiles(Path.Combine(root, "data")).Select(Path.GetFileName).SequenceEqual(new[] { "rfq-intakes.json" }), "quotation handoff creates no production work orders, ERP data or second slide dataset");
        foreach (var file in attachmentBytes)
        {
            Check(file.Value.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(fixtureDocuments, file.Key))) && file.Value.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(sourceRoot, "intake-documents", correlation, file.Key))), "original and rendition bytes/metadata preserved: " + file.Key);
        }
        Check(liveBytes.SequenceEqual(await File.ReadAllBytesAsync(livePath)), "actual SIM dataset remains byte-for-byte unchanged through all isolated completion tests");
        await File.WriteAllTextAsync(Path.Combine(root, "result.json"), Node(current).ToJsonString());
        Console.WriteLine("Fixture: " + root);
    }
}
