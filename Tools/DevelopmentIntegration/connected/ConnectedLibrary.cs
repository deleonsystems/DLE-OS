internal static class ConnectedLibrary { internal static void Map(WebApplication app,SimLibraryPreparation preparation,SimLibraryBomStore library,ConnectedActors personas) {
async Task<IResult> Run(HttpContext c,Func<Task<object>> action){return Results.Json(await action());}
  app.MapPost("/api/quoting/v1/assembly-library/preparation/file-disposition",(PreparationFileDispositionCommand command,HttpContext c)=>Run(c,()=>preparation.Disposition(command,personas.Resolve(c),library.ResolvePreparationDocument)));
  app.MapGet("/api/quoting/v1/technical-review/preparation",(string intakeId,int lineNumber,HttpContext c)=>Run(c,()=>preparation.Assessment(intakeId,lineNumber,personas.Resolve(c))));
  app.MapPost("/api/quoting/v1/technical-review/preparation",(PreparationCommand command,HttpContext c)=>Run(c,()=>preparation.Assess(command,personas.Resolve(c))));
  app.MapGet("/api/quoting/v1/technical-review/preparation/file",(string intakeId,string documentId,HttpContext c)=>Run(c,()=>preparation.IncomingEvidence(intakeId,documentId,personas.Resolve(c))));
  app.MapGet("/api/quoting/v1/assembly-library/preparation",async Task<IResult> (HttpContext c)=>await Run(c,()=>preparation.Queue(personas.Resolve(c))));
  app.MapPost("/api/quoting/v1/assembly-library/preparation",(PreparationWorkCommand command,HttpContext c)=>Run(c,()=>preparation.Work(command,personas.Resolve(c))));
  app.MapGet("/api/quoting/v1/assembly-library/preparation/file",(string id,string documentId,HttpContext c)=>Run(c,()=>preparation.Evidence(id,documentId,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/folder",(string key,HttpContext c)=>Run(c,async()=>await library.Folder(key,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/revision-name",(string key,HttpContext c)=>Run(c,async()=>await library.RevisionName(key,personas.Resolve(c))));
        app.MapPost("/api/quoting/v1/assembly-library/revision-name",(LibraryRevisionNameCommand command,HttpContext c)=>Run(c,async()=>await library.SaveRevisionName(command,personas.Resolve(c))));
        app.MapPost("/api/quoting/v1/assembly-library/folder",(LibraryFolderCommand command,HttpContext c)=>Run(c,async()=>await library.LinkFolder(command,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/folder/contents",(string key,string rootId,string relativePath,HttpContext c)=>Run(c,async()=>await library.BrowseFolder(key,rootId,relativePath,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/folder/txt",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await library.DescribeFolderTxt(key,new(folderToken,relativePath,""),personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/documents",(string key,HttpContext c)=>Run(c,async()=>await library.Documents(key,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/documents/list",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await library.DocumentListing(key,folderToken,relativePath,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/documents/describe",(string key,string folderToken,string relativePath,HttpContext c)=>Run(c,async()=>await library.DescribeDocument(key,folderToken,relativePath,personas.Resolve(c))));
        app.MapPost("/api/quoting/v1/assembly-library/documents",(LibraryDocumentCommand command,HttpContext c)=>Run(c,async()=>await library.SaveDocument(command,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/documents/evidence",(string key,string id,int version,HttpContext c)=>Run(c,async()=>{var file=await library.DocumentEvidence(key,id,version,personas.Resolve(c));return new{name=file.Name,base64=Convert.ToBase64String(file.Bytes)};}));
        app.MapGet("/api/quoting/v1/assembly-library/package",(string key,HttpContext c)=>Run(c,()=>library.Package(key,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/assembly-library/package/preview",(string key,string? preparationId,HttpContext c)=>Run(c,()=>library.ReviewPreview(key,preparationId,personas.Resolve(c),preparation)));
        app.MapPost("/api/quoting/v1/assembly-library/package",(LibraryPackageCommand command,HttpContext c)=>Run(c,()=>command.Action=="SUBMIT"?library.SubmitReviewedPackage(command,personas.Resolve(c),preparation):library.ChangePackage(command,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/technical-review/library-packages",async Task<IResult> (HttpContext c)=>await Run(c,()=>library.PackageQueue(personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/technical-review/library-packages/review",(string key,string reviewId,HttpContext c)=>Run(c,()=>library.PackageReview(key,reviewId,personas.Resolve(c))));
        app.MapPost("/api/quoting/v1/technical-review/library-packages",(LibraryPackageCommand command,HttpContext c)=>Run(c,()=>library.ChangePackage(command,personas.Resolve(c),true)));
        app.MapGet("/api/quoting/v1/assembly-library/package/file",(string key,string reviewId,string documentId,HttpContext c)=>Run(c,()=>library.PackageFile(key,reviewId,documentId,personas.Resolve(c),false)));
        app.MapGet("/api/quoting/v1/technical-review/library-packages/file",(string key,string reviewId,string documentId,HttpContext c)=>Run(c,()=>library.PackageFile(key,reviewId,documentId,personas.Resolve(c),true)));
        app.MapGet("/api/quoting/v1/assembly-library/bom",(string key,HttpContext c)=>Run(c,async()=>await library.Get(key,personas.Resolve(c))));
        app.MapPost("/api/quoting/v1/assembly-library/bom",(LibraryBomCommand command,HttpContext c)=>Run(c,async()=>await library.Change(command,personas.Resolve(c))));
        app.MapGet("/api/quoting/v1/technical-review/library-boms",async Task<IResult> (HttpContext c)=>await Run(c,async()=>new{items=await library.Queue(personas.Resolve(c))}));
        app.MapPost("/api/quoting/v1/technical-review/library-boms",(LibraryBomCommand command,HttpContext c)=>Run(c,async()=>await library.Change(command,personas.Resolve(c),review:true)));
        app.MapGet("/api/quoting/v1/assembly-library/bom/evidence",(string key,string? reviewId,HttpContext c)=>Run(c,async()=>new{text=System.Text.Encoding.ASCII.GetString(await library.Evidence(key,reviewId,personas.Resolve(c)))}));
        app.MapGet("/api/quoting/v1/technical-review/library-boms/evidence",(string key,string reviewId,HttpContext c)=>Run(c,async()=>new{text=System.Text.Encoding.ASCII.GetString(await library.Evidence(key,reviewId,personas.Resolve(c),review:true))}));
}}
