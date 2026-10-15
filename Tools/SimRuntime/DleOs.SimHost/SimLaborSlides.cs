using System.Security.Cryptography;
using System.Text.Json;

// Embedded in the operation: array order is durable, independent of drawing-stack preferences.
// Content is owned by this card/stage, never a mutable pointer to a shared drawing layer.
internal sealed record SimLaborSlidePhoto(string Id, string DocumentId, string Sha256, string Name, double X, double Y, double Width, double Height,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] double Rotation = 0);
internal sealed record SimLaborSlideStage(string Id, string Name, SimDrawingMark[] Marks, SimDrawingCamera SavedView,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimLaborSlidePhoto[]? Photos = null);
internal sealed record SimLaborSlide(string Id, string Kind, string Title, string Body, int Page,
    SimLaborSlideStage[] Stages, SimDrawingSource? Source = null, string? ImageDocumentId = null, string? ImageSha256 = null);

internal sealed partial class SimRfqIntakeStore
{
    private async Task ValidateLaborSlides(SimRfqIntakeRecord record, SimLaborPlan plan, SimLaborOperation[] operations, int contract)
    {
        var old = plan.Operations.SelectMany(o => o.Slides ?? []).ToArray();
        var incoming = operations.SelectMany(o => o.Slides ?? []).ToArray();
        if (contract is not (1 or 2 or 3 or 4 or 5 or 6 or 7 or 8) && (old.Length > 0 || incoming.Length > 0))
            throw SimRfqIntakeProblem.Conflict("LABOR_SLIDE_CONTRACT", "Refresh Labor before saving slides. Older clients cannot remove slide content.");
        if (contract < 7 && plan.Operations.Concat(operations).Any(o => o.FirstPiece is not null))
            throw SimRfqIntakeProblem.Conflict("LABOR_FIRST_PIECE_CONTRACT", "Refresh Labor before saving first-piece settings.");
        var inspections = new HashSet<string>();
        foreach (var operation in operations.Where(o => o.FirstPiece?.Enabled == true))
        {
            var settings = operation.FirstPiece!;
            if (operation.ParentId is not null || operation.Name.Trim().Equals("Kitting", StringComparison.OrdinalIgnoreCase))
                throw SimRfqIntakeProblem.BadRequest("LABOR_FIRST_PIECE_VALUES", "First-piece planning belongs to a production main operation.");
            if (settings.InspectionOperationId is string inspectionId)
            {
                var inspection = operations.SingleOrDefault(o => o.Id == inspectionId);
                if (inspection is null || inspection.Id == operation.Id || inspection.Name.Trim().Equals("Kitting", StringComparison.OrdinalIgnoreCase) || inspection.ParentId is not null || inspection.TimeBasis != "BATCH" || inspection.FirstPiece?.Enabled == true || operations.Any(o => o.ParentId == inspectionId) || !inspections.Add(inspectionId))
                    throw SimRfqIntakeProblem.BadRequest("LABOR_FIRST_PIECE_VALUES", "Choose a separate, once-per-lot inspection row used by only one first-piece plan.");
            }
            var setup = settings.SetupOperationIds ?? [];
            if (setup.Length != setup.Distinct().Count() || setup.Any(id => !operations.Any(o => o.Id == id && o.ParentId == operation.Id && o.TimeBasis == "BATCH")))
                throw SimRfqIntakeProblem.BadRequest("LABOR_FIRST_PIECE_VALUES", "One-time setup must reference this operation's Batch substeps.");
        }
        if (contract < 6 && plan.Operations.Concat(operations).Any(o => o.ExcludedSlideIds?.Length > 0))
            throw SimRfqIntakeProblem.Conflict("LABOR_SLIDE_EXCLUSION_CONTRACT", "Refresh Labor before saving slide exclusions. Older clients cannot restore excluded pages.");
        foreach (var operation in operations)
        {
            var excluded = operation.ExcludedSlideIds ?? [];
            if (excluded.Length > 500 || excluded.Distinct().Count() != excluded.Length || excluded.Any(id => id is null || (!Guid.TryParseExact(id, "D", out _) && id != "generated-" + operation.Id)))
                throw SimRfqIntakeProblem.BadRequest("LABOR_SLIDE_EXCLUSIONS", "Use up to 500 unique page identities for this operation.");
            if (operations.Where(other => other.Id != operation.Id).Any(other => (other.Slides ?? []).Any(card => excluded.Contains(card.Id))))
                throw SimRfqIntakeProblem.BadRequest("LABOR_SLIDE_EXCLUSIONS", "An excluded page must belong to its operation.");
        }
        if (contract < 2 && old.Concat(incoming).Any(c => c?.Stages?.Any(s => s?.Photos?.Length > 0) == true))
            throw SimRfqIntakeProblem.Conflict("LABOR_SLIDE_CONTRACT", "Reload Labor before saving image overlays. Older clients cannot remove them.");
        if (contract < 3 && old.Concat(incoming).Any(c => c?.Stages?.Any(s => s?.Photos?.Any(p => p is not null && p.Rotation != 0) == true) == true))
            throw SimRfqIntakeProblem.Conflict("LABOR_SLIDE_CONTRACT", "Reload Labor before saving rotated images. Older clients cannot remove image rotation.");
        if (contract < 4 && (plan.Operations.Any(o => o.SlidesOrganized == true) || operations.Any(o => o.SlidesOrganized == true)))
            throw SimRfqIntakeProblem.Conflict("LABOR_SLIDE_LAYOUT_CONTRACT", "Refresh Labor before saving organized slides. Older clients cannot replace their layout.");
        if (contract < 5 && old.Concat(incoming).Any(c => c.Kind == "BOM"))
            throw SimRfqIntakeProblem.Conflict("LABOR_BOM_SLIDE_CONTRACT", "Refresh Labor before saving BOM page overlays. Older clients cannot remove them.");
        if (operations.Any(o => o.ParentId is not null && (o.Slides ?? []).Any(c => c.Kind == "BOM")))
            throw SimRfqIntakeProblem.BadRequest("LABOR_SLIDE_VALUES", "BOM pages belong to main operations.");
        foreach (var op in operations.Where(o => o.SlidesOrganized == true))
        {
            if (op.ParentId is not null || (op.Slides ?? []).Count(c => c.Kind == "START") != 1 || (op.Slides ?? []).Count(c => c.Kind == "END") != 1 || op.Slides![0].Kind != "START" || op.Slides[^1].Kind != "END")
                throw SimRfqIntakeProblem.BadRequest("LABOR_SLIDE_LAYOUT", "Organized main operations need one Start and End boundary, kept first and last.");
        }
        var oldPhotos = old.SelectMany(c => c.Stages).SelectMany(s => s.Photos ?? []).ToArray();
        [System.Diagnostics.CodeAnalysis.DoesNotReturn]
        void Invalid(string message) => throw SimRfqIntakeProblem.BadRequest("LABOR_SLIDE_VALUES", message);
        if (incoming.Length > 500 || operations.Any(o => (o.Slides?.Length ?? 0) > 80) || incoming.Any(c => c is null))
            Invalid("Use up to 80 slides per operation and 500 per estimate.");
        if (operations.Any(o => (o.Slides ?? []).Count(c => c.Kind == "SUBSTEP") > 1)) Invalid("Use at most one explicit step divider per operation.");
        if (operations.Any(o => (o.Slides ?? []).Where(c => c.Kind == "BOM").GroupBy(c => (c.Source, c.Page)).Any(g => g.Count() > 1)))
            Invalid("Use one BOM page per operation and source. Each page owns its own overlay stages.");
        var ids = new HashSet<string>();
        var verified = new HashSet<string>();
        foreach (var card in incoming)
        {
            if (!Guid.TryParseExact(card.Id, "D", out _) || !ids.Add(card.Id) || card.Kind is not ("DRAWING" or "IMAGE" or "NOTE" or "BLANK" or "START" or "END" or "SUBSTEP" or "BOM") ||
                card.Title is null || card.Title.Length > 100 || card.Body is null || card.Body.Length > 4000 || card.Page < 1 || card.Stages is null || card.Stages.Length is < 1 or > 40)
                Invalid("Use unique slide identities, a supported type, title up to 100 characters, body up to 4000 and 1 to 40 stages.");
            foreach (var stage in card.Stages!)
            {
                if (stage is null || !Guid.TryParseExact(stage.Id, "D", out _) || !ids.Add(stage.Id) || string.IsNullOrWhiteSpace(stage.Name) || stage.Name.Length > 100 || stage.Marks is null || stage.SavedView is null)
                    Invalid("Each stage needs its own identity, name, marks and saved view.");
                ValidateDrawingNotes(stage!.Marks, stage.SavedView);
                if ((stage.Photos?.Length ?? 0) > 20) Invalid("Use up to 20 image overlays per stage.");
                foreach (var photo in stage.Photos ?? [])
                {
                    if (photo is null || !Guid.TryParseExact(photo.Id, "D", out _) || !ids.Add(photo.Id) ||
                        string.IsNullOrWhiteSpace(photo.DocumentId) || photo.DocumentId.Length > 100 || photo.Sha256 is null || photo.Sha256.Length != 64 ||
                        photo.Name is null || photo.Name.Length > 200 ||
                        !double.IsFinite(photo.X) || !double.IsFinite(photo.Y) || !double.IsFinite(photo.Width) || !double.IsFinite(photo.Height) || !double.IsFinite(photo.Rotation) || photo.Rotation is < -180 or > 180 ||
                        photo.X < 0 || photo.Y < 0 || photo.Width < .001 || photo.Height < .001 || photo.X + photo.Width > 1.000001 || photo.Y + photo.Height > 1.000001)
                        Invalid("Image overlays need unique identities, an exact image reference and bounds inside the slide.");
                    var previousPhoto = oldPhotos.SingleOrDefault(p => p.Id == photo!.Id);
                    if (previousPhoto is not null)
                    {
                        if (previousPhoto.DocumentId != photo!.DocumentId || previousPhoto.Sha256 != photo.Sha256)
                            Invalid("A saved image source is immutable. Remove it and add another image to replace it.");
                    }
                    else
                    {
                        var image = await VerifiedLaborVisual(record, photo!.DocumentId);
                        if (image.DefinitionId != plan.DefinitionId || image.Sha256 != photo.Sha256)
                            Invalid("Image overlays must use a verified image from this estimate and definition.");
                    }
                }
                if (stage.SavedView.Page != card.Page || stage.Marks.Any(m => m.Page != card.Page))
                    Invalid("Every stage and saved view must use the card's one source page. Add another card for another page.");
            }
            var previous = old.SingleOrDefault(c => c.Id == card.Id);
            if (previous is not null && (previous.Kind != card.Kind || previous.Page != card.Page || previous.Source != card.Source || previous.ImageDocumentId != card.ImageDocumentId || previous.ImageSha256 != card.ImageSha256))
                Invalid("The source of an existing slide is immutable. Create a new slide to change its source page.");
            if (card.Kind == "BOM")
            {
                if (card.Source is null || card.ImageDocumentId is not null || card.ImageSha256 is not null || card.Page > 10000)
                    Invalid("BOM pages require their exact View BOM source.");
                if (previous is not null) continue;
                var workspace = RfqView(record, new());
                var reference = SimRfqIntakeEndpoints.BomReference(workspace);
                if (card.Page > SimRfqIntakeEndpoints.BomReferencePageCount(workspace)) Invalid("That View BOM page does not exist.");
                var hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(reference)));
                var a = record.Assemblies[0];
                var v4Hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("bom-reference-v4\n" + hash + "\n" + plan.Quantity.ToString(System.Globalization.CultureInfo.InvariantCulture))));
                var v5Hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("bom-reference-v5\n" + hash + "\n" + plan.Quantity.ToString(System.Globalization.CultureInfo.InvariantCulture))));
                if (card.Source != new SimDrawingSource("bom-reference-v3", hash, plan.DefinitionId, a.AssemblyNumber, a.Revision, "View BOM") &&
                    card.Source != new SimDrawingSource("bom-reference-v4", v4Hash, plan.DefinitionId, a.AssemblyNumber, a.Revision, "View BOM") &&
                    card.Source != new SimDrawingSource("bom-reference-v5", v5Hash, plan.DefinitionId, a.AssemblyNumber, a.Revision, "View BOM"))
                    Invalid("BOM source changed. Reopen the current View BOM before adding page overlays.");
            }
            else if (card.Kind == "DRAWING")
            {
                if (card.Source is null || card.ImageDocumentId is not null || card.ImageSha256 is not null) Invalid("Drawing slides require an exact drawing reference only.");
                var source = card.Source!;
                var key = JsonSerializer.Serialize(source) + ":" + card.Page;
                // Existing unchanged references remain saveable if an asset goes missing; playback shows an explicit warning.
                if (previous is not null || !verified.Add(key)) continue;
                var doc = await OpenDocument(record.IntakeId, source.DocumentId);
                var a = record.Assemblies[0];
                if (doc.Document.Type != "application/pdf" || source.Sha256 != Convert.ToHexString(SHA256.HashData(doc.Bytes)) || source.DefinitionId != plan.DefinitionId || source.Assembly != a.AssemblyNumber || source.Revision != a.Revision || source.Name != doc.Document.Name)
                    Invalid("The drawing source must match the authorized immutable PDF and manufacturing definition.");
                if (card.Page > await SimPdfPagePreview.Count(doc.Bytes)) Invalid("The drawing page does not exist.");
            }
            else if (card.Kind == "IMAGE")
            {
                if (card.Source is not null || card.Page != 1 || string.IsNullOrEmpty(card.ImageDocumentId) || string.IsNullOrEmpty(card.ImageSha256)) Invalid("Image slides require an exact image reference.");
                if (previous is not null) continue;
                var image = await VerifiedLaborVisual(record, card.ImageDocumentId!);
                if (image.DefinitionId != plan.DefinitionId || image.Sha256 != card.ImageSha256) Invalid("The image must belong to this estimate and definition.");
            }
            else if (card.Source is not null || card.ImageDocumentId is not null || card.ImageSha256 is not null || card.Page != 1)
                Invalid("Note, blank and boundary cards do not reference external assets.");
        }
    }
}
