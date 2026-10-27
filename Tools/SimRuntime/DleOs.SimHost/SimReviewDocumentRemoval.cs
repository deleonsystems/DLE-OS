using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimReviewDocumentRemoval(string Id, SimRfqIntakeDocument File, SimPackageDocument? PackageDocument,
    int FileIndex, int PackageIndex, string RemovedBy, DateTimeOffset RemovedAtUtc,
    string? RestoredBy = null, DateTimeOffset? RestoredAtUtc = null);
internal sealed record SimReviewDocumentRemovalRequest(string ExpectedToken, string Action);
internal sealed partial class SimRfqIntakeStore
{
    private static bool CanChangeReviewFiles(SimRfqIntakeRecord r) => r.Environment == "SIM" && r.IntakeType == "NEW_QUOTE_REQUEST" &&
        r.Status is "TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD" && r.TechnicalReview is not null &&
        r.TechnicalReview.Workflow?.Outputs is null && string.IsNullOrEmpty(r.TechnicalReview.DownstreamHandoffState);
    private static bool ContainsDocument(object? value, string id)
    {
        if (value is null) return false;
        bool Visit(JsonElement node) => node.ValueKind switch {
            JsonValueKind.String => node.GetString()?.Contains(id, StringComparison.Ordinal) == true,
            JsonValueKind.Array => node.EnumerateArray().Any(Visit),
            JsonValueKind.Object => node.EnumerateObject().Any(p => Visit(p.Value)), _ => false };
        return Visit(JsonSerializer.SerializeToElement(value));
    }
    private static string RemovalToken(SimRfqIntakeDataset data, SimRfqIntakeRecord r) => Convert.ToHexString(SHA256.HashData(
        JsonSerializer.SerializeToUtf8Bytes(new { r, jobs = data.AnalysisJobs.Where(j => j.Input.IntakeId == r.IntakeId) })));
    private static string? RemovalBlock(SimRfqIntakeDataset data, SimRfqIntakeRecord r, string id)
    {
        if (!CanChangeReviewFiles(r)) return "This review is closed or released. Its document history must be retained.";
        var file = r.TechnicalFiles.SingleOrDefault(f => f.DocumentId == id);
        if (file is null) return "This file is no longer in the active review. Reopen the package.";
        var review = r.TechnicalReview!; var package = review.TechnicalPackage;
        var doc = package?.Documents.SingleOrDefault(d => d.DocumentId == id);
        if(review.PresentationDraft?.ProductionAcceptances?.Length > 0) return "Accepted production-slide history exists. Retain the source documents; removal is blocked to protect released references.";
        if (review.PresentationDraft?.TeamDocumentId == id || review.PresentationDraft?.RenditionDocumentId == id)
            return "This is the current drawing reference or its viewing rendition. Choose a replacement (or clear the drawing reference) and save that deliberate change first.";
        if (package?.GoverningBomDocumentId == id || doc?.Role is "GOVERNING" or "SUPPORTING" or "REFERENCED" ||
            doc?.ProductionUse is "PRIMARY_DRAWING" or "SUPPORTING_PRODUCTION" || doc?.BomUse is "GOVERNING_BOM" or "SUPPORTING_BOM")
            return "This file has a Production or Materials role. Clear or replace that role through package review first. Retained dependent history may still require keeping it.";
        if (data.AnalysisJobs.Any(j => ContainsDocument(j, id)))
            return "BOM extraction history references this file. Keep the source to preserve the extraction and its audit history; no automatic removal or cascade is allowed.";
        if (new[]{review.AssemblyDrawingFile, review.BomFile}.Concat(review.GerberFiles ?? []).Concat(review.SubAssemblyDocuments ?? []).Any(v => v == file.Name || v == id))
            return "Legacy drawing/BOM selections still name this file. Change those selections explicitly before removing it.";
        // Remove only the file's own active entries from the dependency projection. All other persisted evidence remains protected.
        var projection = r with { TechnicalFiles = r.TechnicalFiles.Where(f => f.DocumentId != id).ToArray(), ReviewDocumentRemovals = null,
            TechnicalReview = review with { TechnicalPackage = package is null ? null : package with { Documents = package.Documents.Where(d => d.DocumentId != id).ToArray() } } };
        if (ContainsDocument(projection, id) || data.Records.Any(other => other.IntakeId != r.IntakeId && ContainsDocument(other, id)))
            return "Saved BOM, slides, annotations or retained review history still reference this file. Keep it to preserve those artifacts; no dependent content will be erased.";
        return null;
    }
    internal async Task<object> ReadReviewDocumentRemoval(string intakeId, string documentId)
    {
        var data = await ReadDatasetAsync(); var r = data.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r)) ?? throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review not found.");
        var removed = r.ReviewDocumentRemovals?.LastOrDefault(x => x.File.DocumentId == documentId && x.RestoredAtUtc is null);
        var reason = removed is null ? RemovalBlock(data,r,documentId) : CanChangeReviewFiles(r) ? null : "This review is closed or released; restore is unavailable.";
        return new { token = RemovalToken(data,r), canRemove = removed is null && reason is null,
            canRestore = removed is not null && reason is null, reason };
    }
    internal async Task<object?> ChangeReviewDocumentRemoval(string intakeId, string documentId, SimReviewDocumentRemovalRequest request, SimPersona actor)
    {
        await gate.WaitAsync();
        try
        {
            var data = await ReadDatasetAsync(); var index = data.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if(index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review not found.");
            var r = data.Records[index];
            if(!CanChangeReviewFiles(r) || !actor.Can("technical_review.disposition")) throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_REMOVAL_READ_ONLY", "An editable Technical Review and disposition permission are required.");
            if(request.ExpectedToken != RemovalToken(data,r)) throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_REMOVAL_STALE", "The review or its dependencies changed. Reopen the package before retrying.");
            var now = DateTimeOffset.UtcNow; var history = (r.ReviewDocumentRemovals ?? []).ToList(); var review = r.TechnicalReview!;
            if(request.Action == "REMOVE")
            {
                var reason = RemovalBlock(data,r,documentId); if(reason is not null)throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_IN_USE", reason);
                var fileIndex = Array.FindIndex(r.TechnicalFiles, f => f.DocumentId == documentId); var file = r.TechnicalFiles[fileIndex];
                var package = review.TechnicalPackage;
                var packageIndex = package is null ? -1 : Array.FindIndex(package.Documents,d => d.DocumentId == documentId);
                history.Add(new(Guid.NewGuid().ToString("D"),file,packageIndex < 0 ? null : package!.Documents[packageIndex],fileIndex,packageIndex,actor.DisplayName,now));
                r = r with { TechnicalFiles = r.TechnicalFiles.Where(f=>f.DocumentId!=documentId).ToArray(),
                    TechnicalReview = review with { TechnicalPackage = package is null ? null : package with { Documents = package.Documents.Where(d=>d.DocumentId!=documentId).ToArray() } } };
            }
            else if(request.Action == "RESTORE")
            {
                var removal = history.LastOrDefault(x=>x.File.DocumentId==documentId&&x.RestoredAtUtc is null) ?? throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_NOT_REMOVED", "This file is not removed. Reopen the package.");
                if(r.TechnicalFiles.Any(f=>f.DocumentId==documentId) || review.TechnicalPackage?.Documents.Any(d=>d.DocumentId==documentId)==true) throw SimRfqIntakeProblem.Conflict("SIM_DOCUMENT_ALREADY_ACTIVE", "This document identity is already active.");
                if(removal.File.BinaryStatus == "VERIFIED")await documents.Bytes(r.RequestCorrelationId,documentId); // Restore only a verified preserved binary.
                var files=r.TechnicalFiles.ToList();files.Insert(Math.Clamp(removal.FileIndex,0,files.Count),removal.File);
                var package=review.TechnicalPackage;
                if(removal.PackageDocument is not null)
                {
                    package ??= SimTechnicalPackageProvider.Inventory(r);
                    var docs=package.Documents.ToList();docs.Insert(Math.Clamp(removal.PackageIndex,0,docs.Count),removal.PackageDocument);
                    package=package with{Documents=docs.ToArray()};
                }
                history[history.IndexOf(removal)]=removal with{RestoredBy=actor.DisplayName,RestoredAtUtc=now};
                r=r with{TechnicalFiles=files.ToArray(),TechnicalReview=review with{TechnicalPackage=package}};
            }
            else throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_REMOVAL_ACTION", "Choose Remove or Restore.");
            data.Records[index]=r with{ReviewDocumentRemovals=history.ToArray()};data.UpdatedAtUtc=now;
            await WriteVerifiedAsync(data); // Metadata only: never calls file removal or writes the original share.
        }
        finally {gate.Release();}
        return await ReadTechnicalReviewAsync(intakeId);
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapReviewDocumentRemoval(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Guard(HttpContext c,bool write,Func<Task<object?>> action){
            var denied=DeniedTechnicalReview(c,state,personas,write?"technical_review.disposition":"technical_review.view");if(denied is not null)return denied;
            c.Response.Headers["Cache-Control"]="private, no-store";
            try{return Results.Json(await action());}catch(SimRfqIntakeProblem p){return Results.Json(new{code=p.Code,message=p.Message},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Review storage is unavailable. Reopen the package to check the saved state before retrying."},statusCode:503);}
        }
        app.MapGet("/api/sim/technical-reviews/{id}/documents/{documentId}/removal",(string id,string documentId,HttpContext c)=>Guard(c,false,async()=>await store.ReadReviewDocumentRemoval(id,documentId)));
        app.MapPost("/api/sim/technical-reviews/{id}/documents/{documentId}/removal",(string id,string documentId,SimReviewDocumentRemovalRequest request,HttpContext c)=>Guard(c,true,()=>store.ChangeReviewDocumentRemoval(id,documentId,request,personas.Resolve(c))));
    }
}
