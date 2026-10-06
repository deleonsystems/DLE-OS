using System.Security.Cryptography;
using System.Text.Json;

// Coordinates are normalized to the unrotated source page. Camera bounds describe
// the author's intended area, not a browser's pixels or its last navigation.
internal sealed record SimDrawingPoint(double X, double Y);
internal sealed record SimDrawingCamera(int Page, double X, double Y, double Width, double Height, int Rotation = 0);
internal sealed record SimDrawingMark(string Id, int Page, string Kind, SimDrawingPoint[] Points, string Text = "", [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Color = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] double? Thickness = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] double? FontSize = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] double? TextRotation = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] bool? CompactCallout = null);
internal sealed record SimDrawingSource(string DocumentId, string Sha256, string DefinitionId, string Assembly, string Revision, string Name);
internal sealed record SimDrawingLayer(string StepId, SimDrawingSource Source, int Revision, SimDrawingMark[] Marks,
    SimDrawingCamera SavedView, string Author, DateTimeOffset SavedAt, string Note = "", [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ReviewToken = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? LayerId = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Name = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? StepIds = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? ContentRevision = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? Page = null);
internal sealed record SimDrawingLayerStatus(SimDrawingLayer Layer, bool ReviewRequired);
internal sealed record SimDrawingNotesView(int ContractVersion, int LaborRevision, SimDrawingSource Source, bool CanEdit, SimDrawingLayerStatus[] Layers, bool CanSaveView = false, string DrawingContentToken = "", SimDrawingTarget[]? Targets = null, int RenderMaxDimension = 4096, bool TextTransforms = true, bool BasicShapes = true, bool ZoomSizedShapes = true, bool SinglePageLayers = true);
internal sealed record SimDrawingTarget(string Id, string Name, string? ParentId);
internal sealed record SimDrawingNotesRequest(int ExpectedRevision, int ExpectedLaborRevision, SimDrawingSource Source,
    SimDrawingMark[]? Marks, SimDrawingCamera? SavedView, string Action, string? Note = null, string? LayerId = null, string? Name = null, string[]? StepIds = null, int? Page = null);

internal sealed partial class SimRfqIntakeStore
{
    internal static string[] DrawingSteps(SimDrawingLayer layer) => layer.StepIds ?? [layer.StepId];
    private static bool SameDrawingLayer(SimDrawingLayer layer,string? layerId,string step,SimDrawingSource source) => layer.Source==source && (layerId is not null ? layer.LayerId==layerId : layer.LayerId is null && layer.StepId==step);
    private string DrawingNotesPath => Path.Combine(Path.GetDirectoryName(dataPath)!, "labor-drawing-notes.json");
    private async Task<Dictionary<string, SimDrawingLayer[]>> DrawingLayers() => !File.Exists(DrawingNotesPath) ? new() :
        JsonSerializer.Deserialize<Dictionary<string, SimDrawingLayer[]>>(await File.ReadAllTextAsync(DrawingNotesPath), jsonOptions)
        ?? throw new IOException("Drawing notes are unreadable.");
    private async Task<(SimRfqIntakeRecord Record, SimLaborView Labor, SimDrawingSource Source)> DrawingContext(string id)
    {
        var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == id && RfqEligible(r))
            ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY", "Qualified RFQ not found.");
        var rfq = RfqView(record, await ReadRfqLanes());
        // Historical layers remain reviewable even when the governing definition changed.
        var plan = rfq.Lanes.LaborQuote is { } saved ? NormalizeLaborHierarchy(saved) : LaborView(rfq).Plan;
        var labor = new SimLaborView(rfq, plan, CalculateLabor(plan.Operations, plan.Quantity, plan.Rate ?? 0, plan.Markup, plan.Charges));
        var drawing = await OpenDocument(id, labor.Rfq.Inputs.Manufacturing.GoverningDocumentId ?? "");
        if (drawing.Document.Type != "application/pdf") throw SimRfqIntakeProblem.BadRequest("DRAWING_SOURCE", "Choose the governing PDF drawing.");
        var a = record.Assemblies[0];
        return (record, labor, new(drawing.Document.DocumentId!, Convert.ToHexString(SHA256.HashData(drawing.Bytes)), labor.Rfq.Inputs.Manufacturing.Id, a.AssemblyNumber, a.Revision, drawing.Document.Name));
    }
    internal async Task<SimDrawingNotesView> ReadDrawingNotes(string id, SimPersona persona, int? version = null)
    {
        if (!persona.Can("technical_review.view")) throw SimRfqIntakeProblem.Conflict("DRAWING_DENIED", "Drawing-note viewing is not permitted.");
        await gate.WaitAsync();
        try {
            var c = await DrawingContext(id); var layers = (await DrawingLayers()).GetValueOrDefault(id) ?? [];
            var contentToken=DrawingContentToken(DrawingContent(layers,c.Labor.Plan.Operations));
            var targetOperations=c.Labor.Plan.Operations;
            var history=version is not null;var completed=c.Labor.Rfq.Lanes.Labor.Status=="COMPLETE";
            if(history||completed){
                var snapshot=history?c.Labor.Plan.Versions.SingleOrDefault(v=>v.Version==version):c.Labor.Plan.Versions.LastOrDefault();
                if(snapshot is null)throw SimRfqIntakeProblem.NotFound("LABOR_VERSION","Completed Labor version not found.");
                targetOperations=snapshot.Operations;
                // Legacy snapshots intentionally have no overlays. Never infer historical content from today's store.
                layers=(snapshot.DrawingNotes??[]).Select(n=>{var presentation=layers.SingleOrDefault(l=>SameDrawingLayer(l,n.LayerId,n.StepId,n.Source));return new SimDrawingLayer(n.StepId,n.Source,presentation?.Revision??0,n.Marks,presentation?.SavedView??new(1,.5,.5,1,1),snapshot.UpdatedBy,snapshot.AtUtc,n.Note,null,n.LayerId,n.Name,n.StepIds,n.ContentRevision,n.Page);}).ToArray();
            }
            var permitted=persona.Can("technical_review.disposition")&&c.Labor.Plan.DefinitionId==c.Source.DefinitionId;
            var commitment=LaborRevisionBlocker(c.Labor,(await ReadDatasetAsync()).Records);
            return new(2,c.Labor.Plan.Revision,c.Source,!history&&!completed&&permitted&&commitment is null,
                layers.Select(l=>new SimDrawingLayerStatus(l,l.Source!=c.Source)).ToArray(),!history&&permitted,contentToken,targetOperations.Select(o=>new SimDrawingTarget(o.Id,o.Name,o.ParentId)).ToArray());

        } finally { gate.Release(); }
    }
    internal static void ValidateDrawingNotes(SimDrawingMark[] marks, SimDrawingCamera camera)
    {
        bool Unit(double v) => double.IsFinite(v) && v >= 0 && v <= 1;
        if (camera.Page < 1 || !Unit(camera.X) || !Unit(camera.Y) ||
            !double.IsFinite(camera.Width) || !double.IsFinite(camera.Height) || camera.Width is < .01 or > 1 || camera.Height is < .01 or > 1 ||
            camera.Rotation is not (0 or 90 or 180 or 270) || marks.Length > 200 || marks.Select(m => m?.Id).Distinct().Count() != marks.Length ||
            marks.Any(m => m is null || !Guid.TryParseExact(m.Id, "D", out _) || m.Page < 1 || m.Kind is not ("arrow" or "box" or "highlight" or "freehand" or "marker" or "text" or "line" or "circle" or "callout" or "polygon" or "cloud" or "polyline") ||
                m.CompactCallout is not null && m.Kind != "callout" || m.Color is not null && !System.Text.RegularExpressions.Regex.IsMatch(m.Color,"^#[0-9a-fA-F]{6}$") || m.Thickness is {} thickness && (!double.IsFinite(thickness) || thickness < .00001 || thickness > .08) ||
                m.FontSize is {} fontSize && (!double.IsFinite(fontSize) || fontSize < .00001 || fontSize > .2) || m.TextRotation is {} textRotation && (!double.IsFinite(textRotation) || textRotation < -180 || textRotation > 180) || m.Kind is not ("text" or "callout") && (m.FontSize is not null || m.TextRotation is not null) ||
                m.Points is null || m.Points.Length is < 1 or > 256 || m.Points.Any(p => p is null || !Unit(p.X) || !Unit(p.Y)) ||
                m.Kind != "text" && m.Points.Length < 2 || m.Kind is "arrow" or "box" or "highlight" or "line" or "circle" or "cloud" or "callout" && m.Points.Length != 2 ||
                (m.Kind == "text" && m.Points.Length != 1) || (m.Kind is "text" or "callout" && string.IsNullOrWhiteSpace(m.Text)) || (m.Kind == "polygon" && m.Points.Length < 3) || m.Text is null || m.Text.Length > 500) ||
            marks.Select(m => m.Page).Append(camera.Page).Distinct().Count() > 200)
            throw SimRfqIntakeProblem.BadRequest("DRAWING_VALUES", "Use valid page coordinates, up to 200 marks on 200 pages, and text up to 500 characters.");
    }
    internal async Task<SimDrawingLayer> SaveDrawingNotes(string id, string step, SimDrawingNotesRequest request, SimPersona persona)
    {
        if (!persona.Can("technical_review.disposition")) throw SimRfqIntakeProblem.Conflict("DRAWING_DENIED", "Drawing-note authoring is not permitted.");
        await gate.WaitAsync();
        try {
            var c = await DrawingContext(id);
            if (c.Labor.Rfq.Lanes.Labor.Status == "COMPLETE" && request.Action!="view") throw SimRfqIntakeProblem.Conflict("DRAWING_COMPLETE", "Completed Labor is read-only for Drawing Notes.");
            if (c.Labor.Plan.Revision != request.ExpectedLaborRevision || c.Source != request.Source || c.Labor.Plan.DefinitionId != c.Source.DefinitionId)
                throw SimRfqIntakeProblem.Conflict("DRAWING_SOURCE_CHANGED", "Labor or the source drawing changed. Reopen and review before saving.");
            if (!c.Labor.Plan.Operations.Any(o => o.Id == step)) throw SimRfqIntakeProblem.Conflict("DRAWING_STEP", "Save the new Labor step before adding Drawing Notes.");
            if(request.Action!="view" && LaborRevisionBlocker(c.Labor,(await ReadDatasetAsync()).Records) is {} commitment)throw SimRfqIntakeProblem.Conflict("LABOR_COMMITTED",commitment);
            var data = await DrawingLayers(); var layers = (data.GetValueOrDefault(id) ?? []).ToList();
            var old = layers.SingleOrDefault(l => SameDrawingLayer(l,request.LayerId,step,c.Source));
            if(old is not null && !DrawingSteps(old).Contains(step))throw SimRfqIntakeProblem.Conflict("DRAWING_MEMBERSHIP","Reopen this layer from an operation that includes it.");
            if(request.LayerId is not null && !Guid.TryParseExact(request.LayerId,"D",out _))throw SimRfqIntakeProblem.BadRequest("DRAWING_LAYER","Use a valid layer identity.");
            if(old is null && request.LayerId is not null && request.Action=="view")throw SimRfqIntakeProblem.Conflict("DRAWING_LAYER","Save the instructional layer before its author view.");
            var members=request.Action=="marks" ? request.StepIds ?? old?.StepIds ?? [step] : old?.StepIds ?? [step];
            var name=request.Action=="marks" ? request.Name ?? old?.Name : old?.Name;
            if(members.Distinct().Count()!=members.Length || members.Any(m=>!c.Labor.Plan.Operations.Any(o=>o.Id==m)) ||
               (old is null && !members.Contains(step)) || (request.LayerId is not null && (string.IsNullOrWhiteSpace(name) || name.Length>100)))
                throw SimRfqIntakeProblem.BadRequest("DRAWING_LAYER","Name the layer (up to 100 characters) and choose saved operations or sub-operations.");
            if(c.Labor.Rfq.Lanes.Labor.Status=="COMPLETE"&&(old is null||!(c.Labor.Plan.Versions.LastOrDefault()?.DrawingNotes??[]).Any(n=>SameDrawingLayer(old,n.LayerId,n.StepId,n.Source))))throw SimRfqIntakeProblem.Conflict("DRAWING_COMPLETE","An existing completed drawing layer is required to save its view.");
            if ((old?.Revision ?? 0) != request.ExpectedRevision) throw SimRfqIntakeProblem.Conflict("DRAWING_STALE", "Drawing Notes changed. Reopen before saving; your edits remain here.");
            if (request.Action is not ("marks" or "view")) throw SimRfqIntakeProblem.BadRequest("DRAWING_ACTION", "Choose Save notes or Save view.");
            var marks = request.Action == "marks" ? request.Marks ?? throw SimRfqIntakeProblem.BadRequest("DRAWING_VALUES", "Notes are required.") : old?.Marks ?? [];
            var camera = request.Action == "view" ? request.SavedView ?? throw SimRfqIntakeProblem.BadRequest("DRAWING_VALUES", "A view is required.") : old?.SavedView ?? new(request.Page ?? 1, .5, .5, 1, 1);
            var existingPages=(old?.Marks??[]).Select(m=>m.Page).Distinct().ToArray();
            if(existingPages.Length>1)throw SimRfqIntakeProblem.Conflict("DRAWING_MULTIPAGE_LEGACY","This legacy layer spans pages. Review a split into separate layers before editing.");
            var layerPage=old?.Page ?? (existingPages.Length==1?existingPages[0]:old?.SavedView.Page) ?? request.Page ?? camera.Page;
            if((request.Page is {} requested && requested!=layerPage)||marks.Any(m=>m.Page!=layerPage)||camera.Page!=layerPage)
                throw SimRfqIntakeProblem.BadRequest("DRAWING_LAYER_PAGE","Each layer and its saved view must belong to one PDF page.");
            ValidateDrawingNotes(marks, camera);
            var note = request.Action == "marks" ? request.Note ?? old?.Note ?? "" : old?.Note ?? "";
            if (note.Length > 4000) throw SimRfqIntakeProblem.BadRequest("DRAWING_VALUES", "Use a drawing note up to 4000 characters.");
            // Reject non-existent pages without writing either the source or the layer.
            var document = await OpenDocument(id, c.Source.DocumentId);
            foreach (var page in marks.Select(m => m.Page).Append(camera.Page).Distinct()) await SimPdfPagePreview.Render(document.Bytes, page);
            var layer = new SimDrawingLayer(old?.StepId ?? step, c.Source, (old?.Revision ?? 0) + 1, marks, camera, persona.DisplayName, DateTimeOffset.UtcNow, note, null, request.LayerId ?? old?.LayerId, name, request.StepIds is not null || request.LayerId is not null || old?.StepIds is not null ? members.Order(StringComparer.Ordinal).ToArray() : null, request.LayerId is not null || old?.ContentRevision is not null ? (old?.ContentRevision ?? 0) + (request.Action=="marks" ? 1 : 0) : null, layerPage);
            if (old is not null) layers.Remove(old); layers.Add(layer); data[id] = layers.ToArray();
            Directory.CreateDirectory(Path.GetDirectoryName(DrawingNotesPath)!);
            var temporary = DrawingNotesPath + ".write-" + Guid.NewGuid().ToString("N");
            try { var text = JsonSerializer.Serialize(data, jsonOptions); await File.WriteAllTextAsync(temporary, text);
                if (await File.ReadAllTextAsync(temporary) != text) throw new IOException("Drawing Notes verification failed.");
                File.Move(temporary, DrawingNotesPath, true);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return layer with {ReviewToken=DrawingContentToken(DrawingContent(data[id],c.Labor.Plan.Operations))};
        } finally { gate.Release(); }
    }
    internal async Task<int> DrawingNotesPageCount(string id,string documentId,string sha256,SimPersona persona){
        if(!persona.Can("technical_review.view"))throw SimRfqIntakeProblem.Conflict("DRAWING_DENIED","Drawing-note viewing is not permitted.");
        var doc=await OpenDocument(id,documentId);
        if(doc.Document.Type!="application/pdf"||Convert.ToHexString(SHA256.HashData(doc.Bytes))!=sha256)throw SimRfqIntakeProblem.Conflict("DRAWING_SOURCE_CHANGED","Exact drawing unavailable.");
        return await SimPdfPagePreview.Count(doc.Bytes);
    }
    internal async Task<byte[]> DrawingNotesPage(string id, string documentId, string sha256, int page, SimPersona persona, int pixels = 2200)
    {
        if (!persona.Can("technical_review.view")) throw SimRfqIntakeProblem.Conflict("DRAWING_DENIED", "Drawing-note viewing is not permitted.");
        var doc = await OpenDocument(id, documentId);
        if (doc.Document.Type != "application/pdf" || Convert.ToHexString(SHA256.HashData(doc.Bytes)) != sha256)
            throw SimRfqIntakeProblem.Conflict("DRAWING_SOURCE_CHANGED", "This exact drawing revision is unavailable. Annotations were not applied to a different source.");
        return await SimPdfPagePreview.Render(doc.Bytes, page, pixels);
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapDrawingNotes(WebApplication app, SimStateStore state, SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/{id}/labor/drawing-notes", async Task<IResult>(string id, int? version, HttpContext context) => {
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            context.Response.Headers.CacheControl="private, no-store";
            try{return Results.Json(await store.ReadDrawingNotes(id,personas.Resolve(context),version));}
            catch(SimRfqIntakeProblem p){return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new {message="Drawing Notes could not be read."},statusCode:503);}
        });
        app.MapPut("/api/sim/rfqs/{id}/labor/drawing-notes/{step}", async Task<IResult>(string id,string step,SimDrawingNotesRequest request,HttpContext context) => {
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.SaveDrawingNotes(id,step,request,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new {message="Drawing Notes could not be saved. Your edits remain here; retry."},statusCode:503);}
        });
        app.MapGet("/api/sim/rfqs/{id}/labor/drawing-notes/pages/{documentId}/{sha256}/info",async Task<IResult>(string id,string documentId,string sha256,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{return Results.Json(new{pageCount=await store.DrawingNotesPageCount(id,documentId,sha256,personas.Resolve(context))});}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Page count unavailable."},statusCode:503);}
        });
        app.MapGet("/api/sim/rfqs/{id}/labor/drawing-notes/pages/{documentId}/{sha256}/{page:int}", async Task<IResult>(string id,string documentId,string sha256,int page,int? pixels,HttpContext context) => {
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            context.Response.Headers.CacheControl="private, no-store";
            try{return Results.File(await store.DrawingNotesPage(id,documentId,sha256,page,personas.Resolve(context),pixels??2200),"image/png");}
            catch(SimRfqIntakeProblem p){return Results.Json(new {message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new {message="Drawing page unavailable."},statusCode:503);}
        });
    }
}
