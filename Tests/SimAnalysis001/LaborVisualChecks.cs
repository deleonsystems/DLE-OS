using System.Text.Json;
internal static class LaborVisualChecks
{
    internal static async Task Run(string root, SimRfqIntakeRecord record, SimPersona persona)
    {
        void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS: Labor visuals " + message); }
        async Task Block(Func<Task> action, string message) { try { await action(); } catch (SimRfqIntakeProblem) { Check(true, message); return; } throw new Exception(message); }
        var store = new SimRfqIntakeStore(root); var id = record.IntakeId; var view = await store.ReadLabor(id);
        var material = JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote);
        var source = await File.ReadAllTextAsync(Path.Combine(root, "data", "rfq-intakes.json"));
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL0AAAAASUVORK5CYII=");
        SimLaborVisualUpload Upload(string row = "visual-parent", string? parent = null) => new(view.Plan.Revision, view.Plan.DefinitionId, row, parent is null ? "10" : "10.1", "Synthetic visual test", parent);
        SimLaborRequest Save(SimLaborOperation[] rows, bool complete = false) => new(view.Plan.Revision, view.Plan.DefinitionId, view.Plan.Quantity, rows, view.Plan.Rate, view.Plan.Markup, complete, view.Plan.CalculationVersion, 1);
        var parent = new SimLaborOperation("visual-parent", "Synthetic parent", OperationQuantity: 55, RunSeconds: 30);
        var child = new SimLaborOperation("visual-child", "Synthetic child", OperationQuantity: 25, RunSeconds: 90, ParentId: parent.Id);
        var first = await store.StageLaborVisual(id, Upload(), "Screenshot.png", new MemoryStream(png), persona);
        var second = await store.StageLaborVisual(id, Upload(), "Chosen.png", new MemoryStream(png), persona);
        var sub = await store.StageLaborVisual(id, Upload(child.Id, parent.Id), "Child.png", new MemoryStream(png), persona);
        Check(first.RowId == parent.Id && sub.RowId == child.Id && first.DocumentId != second.DocumentId && first.Sha256.Length == 64 && first.Reference.StartsWith("sim-document:") && first.AddedBy == persona.DisplayName, "unique IDs, row context, hash and reviewer metadata");
        Check(File.Exists(Path.Combine(root, "intake-documents", record.RequestCorrelationId, first.DocumentId + ".labor.json")), "staged draft has durable row ownership journal");
        Check((await new SimRfqIntakeStore(root).OpenLaborVisual(id, first.DocumentId)).Bytes.SequenceEqual(png), "verified binary retrieves after store restart");
        await Block(() => store.StageLaborVisual(id, Upload(), "bad.svg", new MemoryStream("<svg/>"u8.ToArray()), persona), "non-raster upload rejected");
        await Block(() => store.StageLaborVisual(id, Upload(), "../escape.png", new MemoryStream(png), persona), "source paths rejected");
        await Block(() => store.StageLaborVisual(id, Upload() with { ExpectedRevision = -1 }, "test.png", new MemoryStream(png), persona), "stale upload rejected");
        await Block(() => store.StageLaborVisual(id, Upload(), "large.png", new MemoryStream(new byte[8 * 1024 * 1024 + 1]), persona), "oversized upload rejected");
        await Block(() => store.SaveLabor(id, Save([parent with { Visuals = [sub] }]), persona), "cross-row reference rejected");
        await Block(() => store.SaveLabor(id, Save([parent with { Visuals = [first with { Caption = new string('a', 501) }] }]), persona), "oversized caption rejected");
        await Block(() => store.OpenLaborVisual(id, "../../elsewhere"), "unsafe document identity rejected");
        view = await store.SaveLabor(id, Save([parent with { Visuals = [first with { Caption = "Watch synthetic polarity", AddedBy = "FORGED", Sha256 = "FORGED" }, second] }, child with { Visuals = [sub] }], true), persona);
        var totals = view.Totals; var versions = JsonSerializer.Serialize(view.Plan.Versions);
        view = await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.Operations[0].Visuals!.Length == 2 && view.Plan.Operations[1].Visuals!.Length == 1 && view.Plan.Operations[0].Visuals![0].Caption == "Watch synthetic polarity", "parent multiple images and independent child caption survive restart");
        Check(view.Plan.Operations[0].Visuals![0].AddedBy == first.AddedBy && view.Plan.Operations[0].Visuals![0].Sha256 == first.Sha256, "server restores trusted provenance");
        await Block(() => store.SaveLabor(id, Save(view.Plan.Operations) with { VisualContractVersion = 0 }, persona), "old client cannot erase visual data");
        var rows = view.Plan.Operations.Select(o => o.Id == parent.Id ? o with { Visuals = o.Visuals!.Select(v => v.DocumentId == first.DocumentId ? v with { Removed = true } : v).ToArray() } : o).ToArray();
        view = await store.SaveLabor(id, Save(rows), persona);
        Check(view.Plan.Operations[0].Visuals!.Single(v => v.DocumentId == first.DocumentId) is { Removed: true, RemovedAt: not null } && view.Plan.Operations[0].Visuals!.Count(v => !v.Removed) == 1, "remove creates reviewer timestamp tombstone and correct active count");
        Check(JsonSerializer.Serialize(view.Plan.Versions) == versions && (await store.OpenLaborVisual(id, first.DocumentId)).Bytes.SequenceEqual(png), "completed version and removed binary remain readable");
        Check(view.Totals == totals && JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote) == material && await File.ReadAllTextAsync(Path.Combine(root, "data", "rfq-intakes.json")) == source, "calculations Materials and Technical Review unchanged");
        view = await store.SaveLabor(id, Save([]), persona);
        view = await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.RemovedVisuals!.Length == 3 && view.Plan.RemovedVisuals.All(v => v.Removed && v.RemovedAt is not null), "deleted operations retain attachment removal audit after restart");
        var path = Path.Combine(root, "intake-documents", record.RequestCorrelationId, first.DocumentId + ".bin");
        await File.WriteAllBytesAsync(path, [1,2,3]);
        await Block(() => store.OpenLaborVisual(id, first.DocumentId), "tampered binary blocked by hash verification");
        await File.WriteAllBytesAsync(path, png);
    }
}
