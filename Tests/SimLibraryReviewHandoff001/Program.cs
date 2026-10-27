using System.Text;
using System.Text.Json;
var temp=Path.Combine(Path.GetTempPath(),"ReviewHandoff-"+Guid.NewGuid().ToString("N"));var state=Path.Combine(temp,"state");var sourceRoot=Path.Combine(temp,"source");Directory.CreateDirectory(Path.Combine(sourceRoot,"A"));
var priorRoots=Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS");Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",JsonSerializer.Serialize(new[]{new SimDrawingRoot("fixture","Fixture",sourceRoot)}));
try{
 var count=0;void Check(bool yes,string label){if(!yes)throw new Exception(label);Console.WriteLine("PASS "+label);count++;}
 async Task Reject(Func<Task> run,string label){try{await run();}catch(Exception e)when(e is SimRfqIntakeProblem or LibraryBomPermissionException or IOException or UnauthorizedAccessException){Check(true,label);return;}throw new Exception("Expected rejection: "+label);}
 JsonElement J(object value)=>JsonSerializer.SerializeToElement(value,SimLibraryBomStore.Json);string Hash(object value)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(value,SimLibraryBomStore.Json));string Token(object value)=>J(value).GetProperty("token").GetString()!;
 LibraryPreparation R(object value)=>J(value).GetProperty("record").Deserialize<LibraryPreparation>(SimLibraryBomStore.Json)!;
 LibraryReadySummary Summary(object value)=>J(value).GetProperty("summary").Deserialize<LibraryReadySummary>(SimLibraryBomStore.Json)!;
 string StateHash()=>Hash(Directory.Exists(state)?Directory.EnumerateFiles(state,"*",SearchOption.AllDirectories).OrderBy(p=>p).Select(p=>new{path=Path.GetRelativePath(state,p),hash=SimLibraryBomStore.Hash(File.ReadAllBytes(p))}).ToArray():[]);
 var golden=Path.Combine(AppContext.BaseDirectory,"golden");var receipt=J(JsonSerializer.Deserialize<object>(await File.ReadAllTextAsync(Path.Combine(golden,"receipt.json")))!);
 Check(!receipt.GetProperty("legacyHasHandoffProperty").GetBoolean(),"goldens created before handoff field existed");
 foreach(var fixture in receipt.GetProperty("fixtures").EnumerateArray()){
  var old=JsonSerializer.Deserialize<LibraryPackagesRecord>(await File.ReadAllTextAsync(Path.Combine(golden,fixture.GetProperty("file").GetString()!)),SimLibraryBomStore.Json)!;var v=old.Versions.Single();
  Check(Hash(old)==fixture.GetProperty("packageToken").GetString(),"legacy package token unchanged "+fixture.GetProperty("linkedPreparation"));
  typeof(SimLibraryBomStore).GetMethod("VerifyPackage",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static)!.Invoke(null,[v]);Check(v.ContentHash==fixture.GetProperty("contentHash").GetString()&&v.Handoff is null,"legacy embedded origin content hash and missing-summary preserved");
  Check(v.Comments is {Length:>0},"legacy reviewer comments remain independent");
 }
 SimPersona P(string name,params string[] rights)=>new(name,name,name,"ACTIVE",[],rights,false,"fixture");
 var editor=P("author","assembly_library.view","assembly_library.edit");var viewer=P("viewer","assembly_library.view");var reviewer=P("reviewer","technical_review.view","technical_review.disposition");var trView=P("tr-reader","technical_review.view");
 var key=" raw key ";var h=new SimAssemblyHeader(key,"fixture","V1.2","PART","","A ","","A ",false);var headers=new[]{h,h with{SourceKeyRaw="other",BillNumber="OTHER"}};
 var p1=Guid.NewGuid().ToString();var p2=Guid.NewGuid().ToString();
 var pdf=Encoding.UTF8.GetBytes("%PDF- synthetic drawing");var xls=Encoding.UTF8.GetBytes("synthetic workbook");var bytes=new Dictionary<string,byte[]>{{"pdf",pdf},{"xls",xls}};
 var files=new[]{new SimRfqIntakeDocument("drawing.pdf",pdf.Length,"application/pdf",0,"pdf","VERIFIED",SharedAcrossProjects:true),new SimRfqIntakeDocument("customer.xls",xls.Length,"application/vnd.ms-excel",0,"xls","VERIFIED",SharedAcrossProjects:true)};
 var source=new PreparationIntake("RFQI-TEST-0049","correlation",new("customer","001","Fixture","fixture"),[new(1,"PART","A ECR 1",50,p1,"MATERIAL_AND_LABOR"),new(2,"PART","A ECR 2",20,p2,"MATERIAL_ONLY")],files,"TECHNICAL_REVIEW_PENDING");
 Task<PreparationIntake> Source(string id)=>Task.FromResult(source);Task<(SimRfqIntakeDocument Document,byte[] Bytes)> Open(string id,string doc)=>Task.FromResult((source.Files.Single(f=>f.DocumentId==doc),bytes[doc]));
 var prep=new SimLibraryPreparation(state,()=>headers,Source,Open);var store=new SimLibraryBomStore(state,prep.Headers);
 async Task<object> Route(int line){var v=await prep.Assessment(source.IntakeId,line,reviewer);v=await prep.Assess(new(source.IntakeId,line,Token(v),J(v).GetProperty("sourceFingerprint").GetString()!,"SEND",null,"","","Check customer files.",["pdf","xls"],["IDENTIFY_FILES","BUILD_BOM","COMPARE_FILES"]),reviewer);return await prep.Work(new(R(v).Id,Token(v),"START",Destination:"existing",LibraryKey:key,DrawingRevision:"A",BomRevision:"A"),editor);}
 var request=await Route(1);var sibling=await Route(2);var requestId=R(request).Id;
 var folder=await store.Folder(key,editor);folder=await store.LinkFolder(new(key,folder.Token,"fixture","A","A","A"),editor);
 foreach(var f in files)await File.WriteAllBytesAsync(Path.Combine(sourceRoot,"A",f.Name),bytes[f.DocumentId!]);
 var bom=await store.Get(key,editor);bom=await store.Change(new(key,bom.Token,"START"),editor);var row=new LibraryRowEdit(Guid.NewGuid().ToString(),"1","BOARD","Bare board","1","EA","","CUSTOMER","","",false,false,"",false);
 bom=await store.Change(new(key,bom.Token,"ACCEPT_ROW",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",Rows:[row],RowId:row.Id),editor);
 async Task Identify(string name,string use,string? origin=null){var d=await store.Documents(key,editor);var description=J(await store.DescribeDocument(key,folder.Token,"A/"+name,editor));await store.SaveDocument(new(key,Token(d),folder.Token,"A/"+name,description.GetProperty("source").GetProperty("sourceToken").GetString()!,name.EndsWith(".pdf")?["DRAWING"]:["BOM_SOURCE"],use,"","","UNKNOWN",origin),editor);}
 await Identify("drawing.pdf","BOTH","CUSTOMER_ORIGINAL");await Identify("customer.xls","MATERIALS");
 LibraryPackageCommand Submit(object preview,string? note=null){var v=J(preview);return new(key,v.GetProperty("packageToken").GetString()!,"SUBMIT",v.GetProperty("bomToken").GetString()!,v.GetProperty("documentsToken").GetString()!,PreparationId:v.GetProperty("preparationId").GetString(),ExpectedPreviewToken:v.GetProperty("previewToken").GetString(),SubmissionNote:note);}
 var preview=await store.ReviewPreview(key,requestId,editor,prep);var beforePreview=StateHash();var again=await store.ReviewPreview(key,requestId,editor,prep);
 Check(J(preview).GetProperty("previewToken").GetString()==J(again).GetProperty("previewToken").GetString()&&beforePreview==StateHash(),"preview repeated/back is stable and read-only");
 Check(J(preview).GetProperty("canSubmit").GetBoolean()&&Summary(preview).Counts.Unresolved==2,"unresolved comparison is visible without new global eligibility gate");
 Check(Summary(preview).RequestedWork.Single(w=>w.Code=="IDENTIFY_FILES").State=="UNRESOLVED","identify task does not claim done when incoming decisions unresolved");
 Check(Summary(preview).Counts.Documents==2&&Summary(preview).Counts.Materials==2&&Summary(preview).Counts.Production==1&&Summary(preview).Counts.Both==1,"BOTH summary counts unique documents and each intended use truthfully");
 Check(Summary(preview).Documents.Single(d=>d.Use=="BOTH").Origin=="CUSTOMER_ORIGINAL"&&Summary(preview).Documents.Single(d=>d.Use=="MATERIALS").Origin is null,"summary retains actual origin and unknown values");
 Check(Summary(preview).Request?.ProjectId==p1&&Summary(preview).Request?.DisplayId=="RFQI-TEST-0049.1"&&Summary(preview).RequestNotes=="Check customer files.","exact request identity and original notes shown");
 Check(Summary(await store.ReviewPreview(key,null,editor,prep)).Request is null,"generic assembly preview does not choose first matching request");
 await Reject(()=>store.ReviewPreview(key,requestId,reviewer,prep),"TR-only cannot preview live Library work");
 Check(!J(await store.ReviewPreview(key,requestId,viewer,prep)).GetProperty("canSubmit").GetBoolean(),"Library viewer sees summary without submit authority");
 await Reject(()=>store.SubmitReviewedPackage(Submit(preview),viewer,prep),"viewer cannot submit handoff");
 await Reject(()=>store.SubmitReviewedPackage(Submit(preview) with{ExpectedPreviewToken=null},editor,prep),"new submit path requires preview token");
 await Reject(()=>store.SubmitReviewedPackage(Submit(preview) with{PreparationId=R(sibling).Id},editor,prep),"sibling cannot reuse another line's preview token");
 await Reject(()=>store.ReviewPreview("other",requestId,editor,prep),"request cannot bind to another assembly key");
 var missingState=Path.Combine(temp,"missing");var emptyStore=new SimLibraryBomStore(missingState,()=>headers);var emptyPrep=new SimLibraryPreparation(missingState,()=>headers,Source,Open);var missing=await emptyStore.ReviewPreview(key,null,editor,emptyPrep);
 Check(!J(missing).GetProperty("canSubmit").GetBoolean()&&Summary(missing).Bom.Status=="NOT_BUILT"&&J(missing).GetProperty("blockers").GetArrayLength()>0,"missing saved BOM/documents remain actionable existing blockers");
 Check(!Directory.Exists(missingState),"missing-work preview writes no state");
 request=await prep.Work(new(requestId,Token(request),"PROMOTE","pdf"),editor);
 PreparationFileDispositionCommand Decision(object value,string document,string action)=>new(R(value).Id,Token(value),document,action,true,Guid.NewGuid().ToString());
 request=await prep.Disposition(Decision(request,"pdf","ALREADY_IN_RECORDS"),editor,store.ResolvePreparationDocument);
 request=await prep.Disposition(Decision(request,"xls","DO_NOT_USE"),editor,store.ResolvePreparationDocument);
 await Reject(()=>store.SubmitReviewedPackage(Submit(preview),editor,prep),"changed promotion/dispositions invalidate prior preview");
 var copyDir=Path.Combine(state,"assembly-library-v1","folder-copies");Directory.CreateDirectory(copyDir);var actor=new LibraryActor("author","Fixture author",DateTimeOffset.Parse("2026-10-23T13:40:44Z"));
 var copy=new LibraryFolderCopyAudit(new string('C',64),requestId,p1,source.IntakeId,"xls","customer.xls",R(request).Files.Single(f=>f.DocumentId=="xls").Sha256,xls.Length,R(request).SourceFingerprint,folder.Record.Current!,sourceRoot,"A/customer.xls","COPIED",actor,actor);
 var copyPath=Path.Combine(copyDir,copy.Id+".json");await File.WriteAllTextAsync(copyPath,JsonSerializer.Serialize(copy,SimLibraryBomStore.Json));
 preview=await store.ReviewPreview(key,requestId,editor,prep);var summary=Summary(preview);
 Check(summary.IncomingFiles.Single(f=>f.DocumentId=="pdf").OsCopyRecorded,"summary reports prior OS promotion separately");
 Check(summary.IncomingFiles.Single(f=>f.DocumentId=="xls").Decision=="DO_NOT_USE"&&summary.IncomingFiles.Single(f=>f.DocumentId=="xls").FolderCopies.Single().Status=="COPIED","later decision does not conceal earlier copied file");
 Check(summary.IncomingFiles.Single(f=>f.DocumentId=="xls").FolderCopies.Single().VerifiedAtUtc==actor.AtUtc,"copy fact includes historical verification time without live equality claim");
 Check(summary.Counts.Handled==2&&summary.RequestedWork.All(w=>w.State is "RECORDED" or "READY"),"saved decisions and BOM results reflected in requested work");
 var tokenBeforeSibling=J(preview).GetProperty("previewToken").GetString();sibling=await prep.Disposition(Decision(sibling,"pdf","DO_NOT_USE"),editor);
 var siblingCopy=copy with{Id=new string('D',64),PreparationId=R(sibling).Id,ProjectId=p2};await File.WriteAllTextAsync(Path.Combine(copyDir,siblingCopy.Id+".json"),JsonSerializer.Serialize(siblingCopy,SimLibraryBomStore.Json));
 Check(J(await store.ReviewPreview(key,requestId,editor,prep)).GetProperty("previewToken").GetString()==tokenBeforeSibling,"sibling decisions and receipts do not invalidate current preview");
 await File.WriteAllTextAsync(copyPath,JsonSerializer.Serialize(copy with{Status="CHECK_REQUIRED"},SimLibraryBomStore.Json));await Reject(()=>store.SubmitReviewedPackage(Submit(preview),editor,prep),"changed copy receipt invalidates preview");await File.WriteAllTextAsync(copyPath,JsonSerializer.Serialize(copy,SimLibraryBomStore.Json));
 var malformed=Path.Combine(copyDir,"unscoped-bad-fixture.json");await File.WriteAllTextAsync(malformed,"{");var incomplete=await store.ReviewPreview(key,requestId,editor,prep);Check(!Summary(incomplete).CopyHistoryComplete&&J(incomplete).GetProperty("canSubmit").GetBoolean(),"unreadable unrelated copy history is disclosed without global submit gate");File.Delete(malformed);
 preview=await store.ReviewPreview(key,requestId,editor,prep);
 await Reject(()=>store.SubmitReviewedPackage(Submit(preview,new string('x',2001)),editor,prep),"oversized optional note rejected before submission");
 var sourcePath=Path.Combine(sourceRoot,"A","drawing.pdf");await File.AppendAllTextAsync(sourcePath," changed");await Reject(()=>store.SubmitReviewedPackage(Submit(preview),editor,prep),"changed selected source bytes still block submit");await File.WriteAllBytesAsync(sourcePath,pdf);await Identify("drawing.pdf","BOTH","CUSTOMER_ORIGINAL");
 preview=await store.ReviewPreview(key,requestId,editor,prep);var submitted=J(await store.SubmitReviewedPackage(Submit(preview,"Please review the customer drawing."),editor,prep));var frozen=submitted.GetProperty("record").Deserialize<LibraryPackagesRecord>(SimLibraryBomStore.Json)!.Versions.Single();
 Check(frozen.Handoff?.SchemaVersion==1&&frozen.Handoff.SubmissionNote=="Please review the customer drawing."&&frozen.Comments is null,"submission note frozen separately from reviewer comments");
 Check(Hash(frozen.Handoff!.Summary)==Hash(Summary(preview)),"submitted summary exactly matches authoritative preview");
 Check(frozen.Preparation?.ProjectId==p1&&frozen.Handoff.Summary.Request?.ProjectId==p1,"frozen handoff binds exact independent request line");
 Check(frozen.Documents.Length==2&&frozen.Handoff.Summary.Documents.Length==2,"BOTH document included once in actual package and summary");
 Check(frozen.Handoff.PreparationToken is {Length:64}&&frozen.Handoff.CopyReceiptsToken.Length==64,"frozen handoff includes preparation/copy binding hashes");
 var fixedHandoffHash=Hash(frozen.Handoff);var fixedContent=frozen.ContentHash;var packagePath=Path.Combine(state,"assembly-library-v1","packages",SimLibraryBomStore.Hash(Encoding.UTF8.GetBytes(key))+".json");var packageBytes=await File.ReadAllBytesAsync(packagePath);
 foreach(var tamper in new[]{frozen with{Handoff=frozen.Handoff with{SubmissionNote="changed note"}},frozen with{Handoff=frozen.Handoff with{Summary=frozen.Handoff.Summary with{Counts=frozen.Handoff.Summary.Counts with{Handled=99}}}}}){
  var corrupted=new LibraryPackagesRecord(key,1,[tamper]);await File.WriteAllTextAsync(packagePath,JsonSerializer.Serialize(corrupted,SimLibraryBomStore.Json));await Reject(()=>store.PackageQueue(trView),"tampered frozen note/summary rejected by content hash");
 }
 await File.WriteAllBytesAsync(packagePath,packageBytes);
 request=await prep.Disposition(Decision(request,"xls","REOPEN"),editor);await File.WriteAllTextAsync(copyPath,JsonSerializer.Serialize(copy with{Status="CHECK_REQUIRED"},SimLibraryBomStore.Json));
 var queue=J(await store.PackageQueue(trView));var queued=queue.GetProperty("items")[0].GetProperty("version").Deserialize<LibraryPackageVersion>(SimLibraryBomStore.Json)!;
 Check(Hash(queued.Handoff!)==fixedHandoffHash&&queued.Handoff!.Summary.IncomingFiles.Single(f=>f.DocumentId=="xls").Decision=="DO_NOT_USE","TR reads frozen summary despite later live request/copy changes");
 await store.ChangePackage(new(key,submitted.GetProperty("packageToken").GetString()!,"CHANGES_REQUESTED",ReviewId:frozen.Id,Comments:"Revise the drawing selection."),reviewer,true);
 var pkg=J(await store.Package(key,editor));var changed=pkg.GetProperty("record").Deserialize<LibraryPackagesRecord>(SimLibraryBomStore.Json)!.Versions.Single();
 Check(changed.Comments=="Revise the drawing selection."&&changed.Handoff!.SubmissionNote=="Please review the customer drawing."&&changed.ContentHash==fixedContent,"review comments do not replace submission note or fixed content");
 await store.ChangePackage(new(key,pkg.GetProperty("packageToken").GetString()!,"START_CHANGES",pkg.GetProperty("bomToken").GetString()!),editor);
 var retained=await store.ReviewPreview(key,null,editor,prep);Check(Summary(retained).Request?.Id==requestId&&J(retained).GetProperty("preparationId").GetString()==requestId,"resubmission explicitly displays exact prior package request binding");
 Check(Summary(retained).Counts.Unresolved==1&&Summary(retained).IncomingFiles.Single(f=>f.DocumentId=="xls").FolderCopies.Single().Status=="CHECK_REQUIRED","new preview shows later live work separately from frozen prior version");
 var beforeFailure=await File.ReadAllBytesAsync(packagePath);using(var held=new FileStream(packagePath,FileMode.Open,FileAccess.Read,FileShare.Read))await Reject(()=>store.SubmitReviewedPackage(Submit(retained,"Second note"),editor,prep),"atomic package replace failure reports failure");
 Check(beforeFailure.SequenceEqual(await File.ReadAllBytesAsync(packagePath)),"failed submit preserves previous package history exactly");
 var second=J(await store.SubmitReviewedPackage(Submit(retained,"Second note"),editor,prep)).GetProperty("record").Deserialize<LibraryPackagesRecord>(SimLibraryBomStore.Json)!;
 Check(second.Versions.Length==2&&second.Versions[1].Handoff!.SubmissionNote=="Second note"&&Hash(second.Versions[0].Handoff!)==fixedHandoffHash,"subsequent package freezes new summary while preserving prior version");
 var sourceBefore=SimLibraryBomStore.Hash(await File.ReadAllBytesAsync(sourcePath));await store.PackageFile(key,second.Versions[1].Id,second.Versions[1].Documents[0].Identification.Id,reviewer,true);Check(sourceBefore==SimLibraryBomStore.Hash(await File.ReadAllBytesAsync(sourcePath)),"review file access never writes source");
 Check(R(await prep.Assessment(source.IntakeId,2,reviewer)).Status=="IN_PREPARATION","sibling workflow remains independent");
 request=await prep.Disposition(Decision(request,"pdf","REOPEN"),editor);
 var simultaneous=Task.WhenAll(store.ReviewPreview(key,requestId,editor,prep),prep.IncomingFolderCopy(requestId,Token(request),"pdf",editor,(r,f,b)=>store.PreviewIncomingCopy(r,f,editor)));
 await simultaneous.WaitAsync(TimeSpan.FromSeconds(5));Check(true,"concurrent preview and copy-preview complete with consistent preparation-to-Library lock order");
 var allCopies=Directory.EnumerateFiles(copyDir,"*.json").Count();Check(allCopies==2,"concurrent previews create no copy receipts or files");
 Console.WriteLine($"TOTAL {count} isolated Ready-for-review checks passed; fixture {temp}");
}finally{Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",priorRoots);}
