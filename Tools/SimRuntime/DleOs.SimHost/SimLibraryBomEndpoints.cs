internal static class SimLibraryBomEndpoints
{
    internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimLibraryBomStore store,SimLibraryPreparation? preparation=null)
    {
        SimExplorerEndpoints.Map(app,state,personas,store);
        async Task<IResult> Run(HttpContext c,Func<Task<object>> action){
            c.Response.Headers.CacheControl="private, no-store";
            if(!state.Current.IsHealthy)return Results.Json(new{message="SIM storage is not ready."},statusCode:503);
            try{return Results.Json(await action());}
            catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or System.Text.Json.JsonException){return Results.Json(new{message="Library storage could not be verified. Reopen to check saved state; no job data was changed."},statusCode:503);}
        }
        app.MapGet("/api/sim/assembly-library/folder",(string key,HttpContext c)=>Run(c,async()=>await store.Folder(key,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/revision-name",(string key,HttpContext c)=>Run(c,async()=>await store.RevisionName(key,personas.Resolve(c))));
        app.MapPost("/api/sim/assembly-library/revision-name",(LibraryRevisionNameCommand command,HttpContext c)=>Run(c,async()=>await store.SaveRevisionName(command,personas.Resolve(c))));
        app.MapPost("/api/sim/assembly-library/folder",(LibraryFolderCommand command,HttpContext c)=>Run(c,async()=>await store.LinkFolder(command,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/folder/contents",(string key,string rootId,string relativePath,HttpContext c)=>Run(c,async()=>await store.BrowseFolder(key,rootId,relativePath,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/folder/txt",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await store.DescribeFolderTxt(key,new(folderToken,relativePath,""),personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/documents",(string key,HttpContext c)=>Run(c,async()=>await store.Documents(key,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/documents/list",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await store.DocumentListing(key,folderToken,relativePath,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/documents/describe",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await store.DescribeDocument(key,folderToken,relativePath,personas.Resolve(c))));
        app.MapPost("/api/sim/assembly-library/documents",(LibraryDocumentCommand command,HttpContext c)=>Run(c,async()=>await store.SaveDocument(command,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/documents/evidence",(string key,string id,int version,HttpContext c)=>Run(c,async()=>{var file=await store.DocumentEvidence(key,id,version,personas.Resolve(c));return new{name=file.Name,base64=Convert.ToBase64String(file.Bytes)};}));
        app.MapGet("/api/sim/assembly-library/package",(string key,HttpContext c)=>Run(c,()=>store.Package(key,personas.Resolve(c))));
        app.MapGet("/api/sim/assembly-library/package/preview",(string key,string? preparationId,HttpContext c)=>Run(c,()=>store.ReviewPreview(key,preparationId,personas.Resolve(c),preparation)));
        app.MapPost("/api/sim/assembly-library/package",(LibraryPackageCommand command,HttpContext c)=>Run(c,()=>command.Action=="SUBMIT"?store.SubmitReviewedPackage(command,personas.Resolve(c),preparation):store.ChangePackage(command,personas.Resolve(c))));
        app.MapGet("/api/sim/technical-review/library-packages",async Task<IResult> (HttpContext c)=>await Run(c,()=>store.PackageQueue(personas.Resolve(c))));
        app.MapGet("/api/sim/technical-review/library-packages/review",(string key,string reviewId,HttpContext c)=>Run(c,()=>store.PackageReview(key,reviewId,personas.Resolve(c))));
        app.MapPost("/api/sim/technical-review/library-packages",(LibraryPackageCommand command,HttpContext c)=>Run(c,()=>store.ChangePackage(command,personas.Resolve(c),true)));
        app.MapGet("/api/sim/assembly-library/package/file",(string key,string reviewId,string documentId,HttpContext c)=>Run(c,()=>store.PackageFile(key,reviewId,documentId,personas.Resolve(c),false)));
        app.MapGet("/api/sim/technical-review/library-packages/file",(string key,string reviewId,string documentId,HttpContext c)=>Run(c,()=>store.PackageFile(key,reviewId,documentId,personas.Resolve(c),true)));
        app.MapGet("/api/sim/assembly-library/bom",(string key,HttpContext c)=>Run(c,async()=>await store.Get(key,personas.Resolve(c))));
        app.MapPost("/api/sim/assembly-library/bom",(LibraryBomCommand command,HttpContext c)=>Run(c,async()=>await store.Change(command,personas.Resolve(c))));
        app.MapGet("/api/sim/technical-review/library-boms",async Task<IResult> (HttpContext c)=>await Run(c,async()=>new{items=await store.Queue(personas.Resolve(c))}));
        app.MapPost("/api/sim/technical-review/library-boms",(LibraryBomCommand command,HttpContext c)=>Run(c,async()=>await store.Change(command,personas.Resolve(c),review:true)));
        app.MapGet("/api/sim/assembly-library/bom/evidence",(string key,string? reviewId,HttpContext c)=>Run(c,async()=>new{text=System.Text.Encoding.ASCII.GetString(await store.Evidence(key,reviewId,personas.Resolve(c)))}));
        app.MapGet("/api/sim/technical-review/library-boms/evidence",(string key,string reviewId,HttpContext c)=>Run(c,async()=>new{text=System.Text.Encoding.ASCII.GetString(await store.Evidence(key,reviewId,personas.Resolve(c),review:true))}));
    }
}
