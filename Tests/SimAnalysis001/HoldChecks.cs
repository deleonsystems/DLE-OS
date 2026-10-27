using System.Text.Json;

// Completely synthetic RFQ: no copied customer job is accepted, priced, held, or submitted.
internal static class HoldChecks
{
    internal static async Task Run(string fixtureRoot)
    {
        var root = Path.GetFullPath(fixtureRoot);
        if (Directory.Exists(root)) throw new Exception("Use a new isolated fixture directory.");
        Directory.CreateDirectory(Path.Combine(root, "data"));
        var json = DleAnalysisContract.Json;
        var actor = SimPersonaCatalog.All.Single(p => p.Id == "operations-manager");
        var secondActor = actor with { Id = "second-reviewer", UserName = "fixture.second", DisplayName = "Second fixture reviewer" };
        const string id = "RFQI-SIM-9901";
        const string otherId = "RFQI-SIM-9902";
        var count = 0;
        void Check(bool condition, string label)
        {
            if (!condition) throw new Exception("FAIL: RFQ hold " + label);
            count++;
            Console.WriteLine("PASS: RFQ hold " + label);
        }
        string Encode<T>(T value) => JsonSerializer.Serialize(value, json);
        // Exercise the actual SIM renderer, including its injection into the shared shell.
        // The fixture HTML is sufficient for rendering and never touches the real runtime.
        const string shell = "<!doctype html><html><head><title>Fixture</title></head><body><select id=\"workspaceViewSelect\"><option value=\"rfqs\">RFQs</option></select></body></html>";
        await File.WriteAllTextAsync(Path.Combine(root, "DLE_Work_Center_v4.0.0.html"), shell);
        Dictionary<string, string?> WorkspacePermissions(string html)
        {
            var mapping = System.Text.RegularExpressions.Regex.Match(html, @"const workspaceRules=Object\.freeze\((\{.*?\})\);", System.Text.RegularExpressions.RegexOptions.Singleline);
            if (!mapping.Success) throw new Exception("Rendered workspace permission map is missing.");
            return System.Text.RegularExpressions.Regex.Matches(mapping.Groups[1].Value, @"(?:'(?<quoted>[^']+)'|(?<bare>[\w-]+))\s*:\s*(?:'(?<permission>[^']+)'|(?<none>null))")
                .ToDictionary(match => match.Groups["quoted"].Success ? match.Groups["quoted"].Value : match.Groups["bare"].Value,
                    match => match.Groups["permission"].Success ? match.Groups["permission"].Value : null);
        }
        var personasBeforeShell = Encode(SimPersonaCatalog.All);
        var sharedPermissions = WorkspacePermissions(DevelopmentIdentityUi.Inject(shell));
        var simPermissions = WorkspacePermissions(SimShellRenderer.Render(root, "http://127.0.0.1:5188", false, null));
        Check(simPermissions.GetValueOrDefault("rfqs") == "technical_review.view", "rendered RFQ selector uses existing Technical Review view permission");
        Check(simPermissions.GetValueOrDefault("technical-review") == "technical_review.view" && sharedPermissions.All(pair => simPermissions.GetValueOrDefault(pair.Key) == pair.Value) &&
            simPermissions.Keys.Except(sharedPermissions.Keys).Order().SequenceEqual(new[] { "rfqs", "technical-review" }), "SIM shell mapping preserves every other workspace rule without a broad grant");
        Check(!actor.IsSuperAdmin && actor.Can(simPermissions["rfqs"]!), "rendered RFQ selector permits existing nonadministrator Operations Manager");
        Check(new[] { "quality-reviewer", "no-access" }.All(personaId => !SimPersonaCatalog.All.Single(persona => persona.Id == personaId).Can(simPermissions["rfqs"]!)), "rendered RFQ permission still excludes unauthorized roles");
        var viewOnlyActor = actor with { Permissions = ["technical_review.view"] };
        Check(viewOnlyActor.Can(simPermissions["rfqs"]!) && !viewOnlyActor.Can("technical_review.disposition") && Encode(SimPersonaCatalog.All) == personasBeforeShell,
            "RFQ navigation mapping grants no mutation permission and does not change personas");
        var now = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero);
        var sourceId = Guid.NewGuid().ToString("D");
        var package = new SimTechnicalPackage([new(sourceId, "synthetic-reference.pdf", "ASSEMBLY_DRAWING", "GOVERNING", "PARENT_ASSEMBLY", null)], null, "SYNTHETIC_TEST", true, actor.DisplayName, now);
        var candidate = new SimCandidateBom(Guid.NewGuid().ToString("D"), "Synthetic hold test BOM", sourceId, "SYNTHETIC", 1, "SYNTHETIC_FIXTURE", true, now, actor.DisplayName, [], "NOT_COMPARED",
            Enumerable.Range(0, 2).Select(index => {
                var values = new Dictionary<string, string> { ["lineNumber"] = (index + 1).ToString(), ["partNumber"] = "FIXTURE-PN-" + (index + 1), ["quantity"] = "2", ["description"] = "Synthetic fixture part", ["designators"] = "" };
                return new SimCandidateRow(index, new(values), values, [], [], true, actor.DisplayName, now, []);
            }).ToArray());
        var accepted = new SimBomAcceptance(1, candidate, package, actor.DisplayName, now);
        var definition = new SimManufacturingDefinition(Guid.NewGuid().ToString("D"), sourceId, [], [], [sourceId], package, true, actor.DisplayName, now);
        var outputs = new SimQuotationInputs("READY", "QUOTATION_MATERIALS", accepted, "QUOTATION_LABOR", definition, actor.DisplayName, now);
        var review = new SimTechnicalReviewResult("RFQ_REVIEW", "CABLE_ASSEMBLY", "synthetic-reference.pdf", "", false, [], [], "DLE", [], true,
            "TECHNICAL_REVIEW_COMPLETE", "READY_FOR_RFQ_WORKING_QUEUE", "QUOTATION_INPUTS", "READY", actor.DisplayName, now, "Synthetic fixture only",
            TechnicalPackage: package, CandidateBom: candidate, BomAcceptances: [accepted], MaterialsReviewStatus: "QUALIFIED",
            Workflow: new(PackageConfirmed: true, Sufficient: true, HistoryReviewed: true, Manufacturing: definition, Outputs: outputs));
        var record = new SimRfqIntakeRecord(id, Guid.NewGuid().ToString("D"), "DLE_RFQ_INTAKE_V1", "Technical Review", "READY_FOR_RFQ_WORKING_QUEUE", "NEW_QUOTE_REQUEST",
            new("SYNTHETIC-HOLD-CUSTOMER", "FIXTURE", "Synthetic hold fixture", "TEST"), 1, [new(1, "HOLD-FIXTURE", "A", 4)], "MATERIAL_AND_LABOR", true, [], "SYNTHETIC", [], actor.DisplayName, now, "Synthetic fixture only", 1, "SIM", review);
        var dataPath = Path.Combine(root, "data", "rfq-intakes.json");
        var lanesPath = Path.Combine(root, "data", "rfq-lanes.json");
        await File.WriteAllTextAsync(dataPath, Encode(new { schema = "DLE_RFQ_INTAKE_DATASET_V1", counter = 9902, records = new[] { record, record with { IntakeId = otherId } } }));
        var sourceBytes = await File.ReadAllBytesAsync(dataPath);
        var attachmentPath = Path.Combine(root, "data", "synthetic-original.bin");
        await File.WriteAllBytesAsync(attachmentPath, [0, 1, 127, 128, 255]);
        var attachmentBytes = await File.ReadAllBytesAsync(attachmentPath);
        var store = new SimRfqIntakeStore(root);
        async Task<SimRfqWorkspace> Workspace() => (await store.ReadRfqs()).Single(r => r.IntakeId == id);
        SimRfqSectionHold Hold(SimRfqWorkspace workspace, string section) => (section == "materials" ? workspace.Lanes.MaterialsHold : workspace.Lanes.LaborHold) ?? new();
        async Task<SimRfqWorkspace> Change(string section, string action, string? reason = null, SimPersona? reviewer = null)
        {
            var current = await Workspace();
            return await store.TransitionRfqSectionHold(id, section, new(action, Hold(current, section).Revision, Guid.NewGuid().ToString("D"), reason), reviewer ?? actor);
        }
        async Task Block(Func<Task> action, string code, string label)
        {
            var before = await File.ReadAllBytesAsync(lanesPath);
            try { await action(); }
            catch (SimRfqIntakeProblem problem) when (problem.Code == code)
            {
                Check(before.SequenceEqual(await File.ReadAllBytesAsync(lanesPath)), label + " without writing saved work");
                return;
            }
            throw new Exception("Expected " + code + ": " + label);
        }
        SimMaterialRequest MaterialRequest(SimMaterialView view, bool complete, decimal? price = null) =>
            new(view.Plan.Revision, view.Plan.Rows.Select(row => price is null ? row : row with { UnitPrice = price }).ToArray(), complete, view.Plan.MarkupPercent, 2, 1);
        SimLaborRequest LaborRequest(SimLaborView view, bool complete, decimal? rate = null) =>
            new(view.Plan.Revision, view.Plan.DefinitionId, view.Plan.Quantity, view.Plan.Operations, rate ?? view.Plan.Rate, view.Plan.Markup, complete,
                view.Plan.CalculationVersion, 1, 1, view.Plan.Charges, 1, view.Plan.ManufacturingLead, 1, view.DrawingContentToken, 1, 8, view.Plan.CommissionPercent);

        var material = await store.ReadMaterials(id);
        material = await store.SaveMaterials(id, new(material.Plan.Revision,
            material.Plan.Rows.Select(row => row with { Vendor = "Synthetic vendor", VendorSource = "MANUAL_QUOTE_ONLY", UnitPrice = 2, LeadTimeMode = "WEEKS", LeadTimeValue = 3, Notes = "Keep this saved quote" }).ToArray(), false, 25, 2, 1), actor);
        var labor = await store.ReadLabor(id);
        labor = await store.SaveLabor(id, LaborRequest(labor, false, 75) with {
            Operations = labor.Plan.Operations.Select((operation, index) => operation with { OperationQuantity = 1, RunSeconds = 30 + index, Instructions = "Preserve fixture instructions " + index }).ToArray()
        }, actor);
        var other = await store.ReadMaterials(otherId);
        await store.SaveMaterials(otherId, new(other.Plan.Revision, other.Plan.Rows, false), actor);
        var otherBefore = Encode((await store.ReadRfqs()).Single(r => r.IntakeId == otherId));
        Check(!actor.IsSuperAdmin && actor.Can("technical_review.disposition"), "uses existing nonadministrator reviewer permission");

        foreach (var reason in new string?[] { null, "", "  ", new('x', 501) })
            await Block(() => store.TransitionRfqSectionHold(id, "materials", new("PLACE", 0, Guid.NewGuid().ToString("D"), reason), actor), "RFQ_HOLD_REASON", "short nonblank placement reason required");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", new("PLACE", 0, "invalid", "Awaiting vendor"), actor), "RFQ_HOLD_REQUEST", "invalid request identifier rejected");
        foreach (var denied in new[] { SimPersonaCatalog.All.Single(p => p.Id == "no-access"), SimPersonaCatalog.All.Single(p => p.Id == "quality-reviewer"), actor with { AccountStatus = "INACTIVE" } })
            await Block(() => store.TransitionRfqSectionHold(id, "materials", new("PLACE", 0, Guid.NewGuid().ToString("D"), "Awaiting vendor"), denied), "RFQ_HOLD_DENIED", "unauthorized or inactive reviewer denied");

        var laneBefore = (await Workspace()).Lanes;
        var request = new SimRfqSectionHoldRequest("PLACE", 0, Guid.NewGuid().ToString("D"), "  Awaiting supplier confirmation  ");
        var held = await store.TransitionRfqSectionHold(id, "materials", request, actor);
        var placed = Hold(held, "materials");
        Check(placed.Active && placed.Revision == 1 && placed.Reason == "Awaiting supplier confirmation", "Materials hold records trimmed reason independently");
        Check(placed.ActorId == actor.Id && placed.Actor == actor.DisplayName && placed.AtUtc is not null && placed.History is [{ Action: "PLACE", Revision: 1 }], "placement records reviewer timestamp and audit");
        Check(Encode(held.Lanes with { MaterialsHold = null }) == Encode(laneBefore), "placement preserves lane progress pricing instructions and opposite lane exactly");
        var heldBytes = await File.ReadAllBytesAsync(lanesPath);
        await store.TransitionRfqSectionHold(id, "materials", request, actor);
        Check(heldBytes.SequenceEqual(await File.ReadAllBytesAsync(lanesPath)), "retrying identical hold request does not duplicate audit or write");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", request with { Reason = "Changed reason" }, actor), "RFQ_HOLD_REQUEST_REUSED", "request identifier cannot overwrite reason");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", request, secondActor), "RFQ_HOLD_REQUEST_REUSED", "request replay cannot impersonate original reviewer");
        await Block(() => store.TransitionRfqSectionHold(id, "labor", request, actor), "RFQ_HOLD_REQUEST_REUSED", "request identifier cannot be reused across sections");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", new("RELEASE", 0, Guid.NewGuid().ToString("D")), actor), "RFQ_HOLD_STALE", "stale release cannot clear newer hold");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", new("PLACE", 1, Guid.NewGuid().ToString("D"), "Other reason"), actor), "RFQ_HOLD_ACTIVE", "second placement requires explicit release first");
        store = new SimRfqIntakeStore(root);
        Check(Encode(Hold(await Workspace(), "materials")) == Encode(placed), "hold and audit survive fresh store instance");
        var queue = (await store.ReadRfqCommercialList()).Single(r => r.IntakeId == id);
        Check(queue.MaterialsHold is { Active: true, Reason: "Awaiting supplier confirmation" } && queue.LaborHold?.Active != true, "RFQ queue exposes independent section hold and reason");

        material = await store.ReadMaterials(id);
        var priorMaterialRevision = material.Plan.Revision;
        await Block(() => store.SaveMaterials(id, MaterialRequest(material, true), actor), "RFQ_SECTION_HELD", "server blocks held Materials completion");
        material = await store.SaveMaterials(id, MaterialRequest(material, false, 3.25m), actor);
        Check(material.Plan.Revision == priorMaterialRevision + 1 && material.Plan.Rows.All(row => row.UnitPrice == 3.25m) && Encode(material.Rfq.Lanes.MaterialsHold) == Encode(placed), "Materials can edit price and save while preserving hold exactly");
        labor = await store.ReadLabor(id);
        labor = await store.SaveLabor(id, LaborRequest(labor, true), actor);
        Check(labor.Rfq.Lanes.Labor.Status == "COMPLETE" && labor.Plan.Versions.Length == 1 && labor.Rfq.Lanes.MaterialsHold?.Active == true, "unheld Labor completes independently of Materials hold");
        var beforeLaborHold = (await Workspace()).Lanes;
        held = await Change("labor", "PLACE", "Awaiting process estimate", secondActor);
        Check(held.Lanes.MaterialsHold?.Active == true && held.Lanes.LaborHold?.Active == true, "both sections may be held independently");
        Check(Encode(held.Lanes with { LaborHold = null }) == Encode(beforeLaborHold), "placing Labor hold preserves completed version and progress exactly");
        var historicalLabor = Encode(labor.Plan.Versions);
        labor = await store.ReviseLabor(id, new(Guid.NewGuid().ToString("D"), labor.Plan.Revision, labor.Plan.Versions.Last().Version, "Adjust fixture estimate"), actor);
        Check(labor.Rfq.Lanes.LaborHold?.Active == true && labor.Rfq.Lanes.Labor.Status == "IN_PROGRESS" && Encode(labor.Plan.Versions) == historicalLabor, "existing Revise Labor works while held and preserves completed history");
        labor = await store.SaveLabor(id, LaborRequest(labor, false, 82.5m), actor);
        Check(labor.Plan.Rate == 82.5m && labor.Rfq.Lanes.LaborHold?.Active == true && labor.Rfq.Lanes.MaterialsHold?.Active == true, "Labor can price and save while both holds remain");
        await Block(() => store.SaveLabor(id, LaborRequest(labor, true), actor), "RFQ_SECTION_HELD", "server blocks held Labor completion");
        var final = await store.ReadFinalReview(id);
        var answers = new SimFinalAnswers("4 Weeks", null, null, null, "", "", "", null, "", 4, "WEEKS");
        Check(final.Blockers.Any(b => b.Contains("Materials", StringComparison.OrdinalIgnoreCase) && b.Contains("hold", StringComparison.OrdinalIgnoreCase)) && final.Blockers.Any(b => b.Contains("Labor", StringComparison.OrdinalIgnoreCase) && b.Contains("hold", StringComparison.OrdinalIgnoreCase)), "final review remains viewable with concise independent hold blockers");
        await Block(() => store.ApproveFinalReview(id, new(final.SourceToken, final.Approvals.Length, answers), actor), "FINAL_BLOCKED", "final approval blocked while either section held");

        var beforeRelease = (await Workspace()).Lanes;
        held = await Change("materials", "RELEASE", reviewer: secondActor);
        var released = Hold(held, "materials");
        Check(!released.Active && released.Reason is null && released.Revision == 2 && held.Lanes.LaborHold?.Active == true, "release clears only selected hold");
        Check(released.History is [{ Action: "PLACE" }, { Action: "RELEASE", Reason: "Awaiting supplier confirmation" }] && released.History.Last().ActorId == secondActor.Id && released.History.Last().AtUtc >= released.History.First().AtUtc, "release retains original reason and records releasing reviewer and timestamp");
        Check(Encode(held.Lanes with { MaterialsHold = beforeRelease.MaterialsHold }) == Encode(beforeRelease), "release preserves progress plans and other hold exactly without completion");
        await Block(() => store.TransitionRfqSectionHold(id, "materials", new("RELEASE", 2, Guid.NewGuid().ToString("D")), actor), "RFQ_HOLD_INACTIVE", "release of inactive hold rejected");
        material = await store.ReadMaterials(id);
        material = await store.SaveMaterials(id, MaterialRequest(material, true), actor);
        Check(material.Rfq.Lanes.Materials.Status == "COMPLETE" && material.Rfq.Lanes.LaborHold?.Active == true, "unheld Materials completes independently of Labor hold");
        var laborBeforeRelease = (await Workspace()).Lanes;
        held = await Change("labor", "RELEASE");
        Check(held.Lanes.Labor.Status == "IN_PROGRESS" && Encode(held.Lanes with { LaborHold = laborBeforeRelease.LaborHold }) == Encode(laborBeforeRelease), "releasing Labor does not complete draft or alter prices");
        labor = await store.ReadLabor(id);
        labor = await store.SaveLabor(id, LaborRequest(labor, true), actor);
        final = await store.ReadFinalReview(id);
        Check(final.Blockers.Length == 0 && labor.Plan.Versions.Length == 2 && Encode(labor.Plan.Versions.Take(1)) == historicalLabor, "explicit completion after release retains historical version and enables final review");
        final = await store.ApproveFinalReview(id, new(final.SourceToken, final.Approvals.Length, answers), actor);
        var approvalHistory = Encode(final.Approvals);
        var approvalToken = final.SourceToken;
        var approval = final.Approvals.Last();
        var approvedLanes = (await Workspace()).Lanes;

        await Task.WhenAll(Change("materials", "PLACE", "Supplier quote being clarified"), Change("labor", "PLACE", "Labor estimate being clarified", secondActor));
        final = await store.ReadFinalReview(id);
        Check(final.ApprovalCurrent && final.SourceToken == approvalToken && Encode(final.Approvals) == approvalHistory, "holds preserve current approved quotation and immutable approval history");
        Check(final.Blockers.Length == 2 && final.Summary.QuoteTotal is > 0, "approved final review remains readable with two hold explanations");
        Check(Encode((await Workspace()).Lanes with { MaterialsHold = approvedLanes.MaterialsHold, LaborHold = approvedLanes.LaborHold }) == Encode(approvedLanes), "holding accepted quotation does not alter saved work or completed status");
        await Block(() => store.ApproveFinalReview(id, new(final.SourceToken, final.Approvals.Length, answers), actor), "FINAL_BLOCKED", "server checks holds before accepted-source final action");
        var submit = new SimRfqCommercialRequest(Guid.NewGuid().ToString("D"), 0, "SUBMIT", approval.Id, approval.Version);
        await Block(() => store.TransitionRfqCommercial(id, submit, actor), "RFQ_SECTION_HELD", "commercial submission blocked with both holds despite current approval");
        await Change("materials", "RELEASE");
        await Block(() => store.TransitionRfqCommercial(id, submit, actor), "RFQ_SECTION_HELD", "Labor hold alone blocks commercial submission");
        await Change("materials", "PLACE", "Supplier still clarifying");
        await Change("labor", "RELEASE");
        await Block(() => store.TransitionRfqCommercial(id, submit, actor), "RFQ_SECTION_HELD", "Materials hold alone blocks commercial submission");
        await Change("materials", "RELEASE");
        store = new SimRfqIntakeStore(root);
        final = await store.ReadFinalReview(id);
        Check(final.ApprovalCurrent && final.Blockers.Length == 0 && Encode(final.Approvals) == approvalHistory, "release restores submission eligibility without reapproval or history changes");
        Check((await Workspace()).Lanes.Commercial is null, "releasing final hold does not submit automatically");
        var submitted = await store.TransitionRfqCommercial(id, submit, actor);
        Check(submitted.Commercial.Status == "SUBMITTED" && submitted.Commercial.History is [{ Action: "SUBMIT" }], "reviewer can explicitly submit only after both holds released");
        Check(Encode((await store.ReadRfqs()).Single(r => r.IntakeId == otherId)) == otherBefore, "unrelated RFQ saved state unchanged");
        Check(sourceBytes.SequenceEqual(await File.ReadAllBytesAsync(dataPath)), "intake accepted BOM reference and numbering data untouched");
        Check(attachmentBytes.SequenceEqual(await File.ReadAllBytesAsync(attachmentPath)), "original attachment bytes untouched");
        Console.WriteLine($"RFQ_HOLD_CHECKS={count}");
        Console.WriteLine("RFQ_HOLD_FIXTURE=" + root);
    }
}
