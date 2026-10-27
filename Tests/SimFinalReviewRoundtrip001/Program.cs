using System.Text;
using System.Text.Json;
var temp=Path.Combine(Path.GetTempPath(),"FinalReviewRoundtrip-"+Guid.NewGuid().ToString("N"));var state=Path.Combine(temp,"state");var sourceRoot=Path.Combine(temp,"source");Directory.CreateDirectory(Path.Combine(sourceRoot,"A"));
var priorRoots=Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS");Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",JsonSerializer.Serialize(new[]{new SimDrawingRoot("fixture","Fixture",sourceRoot)}));
try{
 var count=0;void Check(bool yes,string label){if(!yes)throw new Exception(label);Console.WriteLine("PASS "+label);count++;}
 async Task Reject(Func<Task> run,string label){try{await run();}catch(Exception e)when(e is SimRfqIntakeProblem or LibraryBomPermissionException or IOException or UnauthorizedAccessException){Check(true,label);return;}throw new Exception("Expected rejection: "+label);}
 JsonElement J(object value)=>JsonSerializer.SerializeToElement(value,SimLibraryBomStore.Json);string Hash(object value)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(value,SimLibraryBomStore.Json));string Token(object value)=>J(value).GetProperty("token").GetString()!;
 LibraryPreparation R(object value)=>J(value).GetProperty("record").Deserialize<LibraryPreparation>(SimLibraryBomStore.Json)!;
 string StateHash()=>Hash(Directory.Exists(state)?Directory.EnumerateFiles(state,"*",SearchOption.AllDirectories).OrderBy(p=>p).Select(p=>new{path=Path.GetRelativePath(state,p),hash=SimLibraryBomStore.Hash(File.ReadAllBytes(p))}).ToArray():[]);
 SimPersona P(string name,params string[] rights)=>new(name,name,name,"ACTIVE",[],rights,false,"fixture");
 var editor=P("author","assembly_library.view","assembly_library.edit");var viewer=P("viewer","assembly_library.view");var reviewer=P("reviewer","technical_review.view","technical_review.disposition");var trView=P("tr-reader","technical_review.view");
 var key=" raw key ";var h=new SimAssemblyHeader(key,"fixture","V1.2","PART","","A ","","A ",false);var headers=new[]{h,h with{SourceKeyRaw="other",BillNumber="OTHER"}};
 var p1=Guid.NewGuid().ToString();var p2=Guid.NewGuid().ToString();
 var pdf=Encoding.UTF8.GetBytes("%PDF- synthetic drawing");var xls=Encoding.UTF8.GetBytes("synthetic workbook");var bytes=new Dictionary<string,byte[]>{{"pdf",pdf},{"xls",xls}};
 var files=new[]{new SimRfqIntakeDocument("drawing.pdf",pdf.Length,"application/pdf",0,"pdf","VERIFIED",SharedAcrossProjects:true),new SimRfqIntakeDocument("customer.xls",xls.Length,"application/vnd.ms-excel",0,"xls","VERIFIED",SharedAcrossProjects:true)};
 var source=new PreparationIntake("RFQI-TEST-0049","correlation",new("customer","001","Fixture","sim-canonical-customer-directory"),[new(1,"PART","A ECR 1",50,p1,"MATERIAL_AND_LABOR"),new(2,"PART","A ECR 2",20,p2,"MATERIAL_ONLY")],files,"TECHNICAL_REVIEW_PENDING");
 var intakeStore=new SimRfqIntakeStore(Path.Combine(state,"intake-fixture"));
 var metadata=new SimStateMetadata("SIM","fixture",1,1,1,DateTimeOffset.UtcNow,DateTimeOffset.UtcNow,1,DateTimeOffset.UtcNow,1,1,1);
 var created=J(await intakeStore.CreateAsync(new("NEW_QUOTE_REQUEST",source.Customer,2,source.Assemblies,"MATERIAL_AND_LABOR",false,[],["PRICE","LEAD_TIME"],"Fixture",Guid.NewGuid().ToString()),reviewer,metadata));
 source=source with{IntakeId=created.GetProperty("record").GetProperty("intakeId").GetString()!};
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

 prep.FinalReviewLookup=store.FinalReviewFor;
 intakeStore.PreparationLookup=prep.Find;intakeStore.PreparationFinalReviewLookup=store.FinalReviewFor;
 string PT(object v)=>J(v).GetProperty("packageToken").GetString()!;
 LibraryPackagesRecord PR(object v)=>J(v).GetProperty("record").Deserialize<LibraryPackagesRecord>(SimLibraryBomStore.Json)!;
 async Task<JsonElement> Item(string id)=>J(await prep.Queue(editor)).GetProperty("items").EnumerateArray().Single(v=>v.GetProperty("record").GetProperty("id").GetString()==id);
 async Task<object> SubmitFor(string id,string note){var v=await store.ReviewPreview(key,id,editor,prep);return await store.SubmitReviewedPackage(Submit(v,note),editor,prep);}
 async Task StartChanges(){var v=J(await store.Package(key,editor));await store.ChangePackage(new(key,v.GetProperty("packageToken").GetString()!,"START_CHANGES",v.GetProperty("bomToken").GetString()!),editor);}
 string PackageHash(LibraryPackageVersion v)=>(string)typeof(SimLibraryBomStore).GetMethod("PackageHash",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static)!.Invoke(null,[v])!;
 var prepBefore=Hash(R(await prep.Assessment(source.IntakeId,1,reviewer)));var siblingBefore=Hash(R(sibling));
 Check(await store.FinalReviewFor(R(request)) is null,"unsubmitted request has no inferred final review");
 var beforeRead=StateHash();var initial=await Item(requestId);await Item(requestId);
 Check(initial.GetProperty("displayStatus").GetString()=="IN_PREPARATION"&&StateHash()==beforeRead,"queue projection before submission is read-only");
 var submitted=await SubmitFor(requestId,"Review this exact request package.");var version1=PR(submitted).Versions.Single();
 var descriptor=await store.FinalReviewFor(R(request));
 Check(descriptor is {Status:"SUBMITTED",StatusLabel:"Awaiting review"}&&descriptor.PackageId==version1.Id&&descriptor.ProjectId==p1&&descriptor.PreparationId==requestId,"submitted status binds exact independent request and package");
 Check(descriptor!.ContentHash==version1.ContentHash&&descriptor.BomId==version1.Bom.Id&&descriptor.BomVersion==version1.Bom.InternalVersion,"descriptor exposes exact content and BOM version");
 Check(descriptor.RequestedQuantity==50&&descriptor.IncomingRevision=="A ECR 1"&&descriptor.DrawingRevision=="A","incoming and Library revisions remain distinct");
 Check(await store.FinalReviewFor(R(sibling)) is null,"same-assembly sibling does not inherit another request review");
 foreach(var changed in new[]{R(request) with{Id=new string('F',64)},R(request) with{ProjectId=p2},R(request) with{IntakeId="other"},R(request) with{LineNumber=2},R(request) with{SourceFingerprint="changed"},R(request) with{IncomingRevision="B"},R(request) with{DrawingRevision="B"},R(request) with{BomRevision="B"},R(request) with{RequestedQuantity=51},R(request) with{RequestedScope="LABOR_ONLY"},R(request) with{LibraryKey="other"}})
  Check(await store.FinalReviewFor(changed) is null,"mismatched request context never inherits final status");
 var queued=await Item(requestId);Check(queued.GetProperty("displayStatus").GetString()=="SUBMITTED"&&queued.GetProperty("record").GetProperty("status").GetString()=="IN_PREPARATION","derived queue status does not replace preparation status");
 Check(queued.GetProperty("token").GetString()==Token(request),"package submission leaves preparation concurrency token unchanged");
 var frozenHash=Hash(version1);var afterSubmit=StateHash();var opened=J(await store.PackageReview(key,version1.Id,trView));await store.PackageReview(key,version1.Id,reviewer);await prep.Queue(editor);
 Check(afterSubmit==StateHash()&&Hash(opened.GetProperty("version").Deserialize<LibraryPackageVersion>(SimLibraryBomStore.Json)!)==frozenHash,"review GET and queues retain exact frozen version without writes");
 Check(!opened.GetProperty("canReview").GetBoolean()&&J(await store.PackageReview(key,version1.Id,reviewer)).GetProperty("canReview").GetBoolean(),"review capability respects viewer and disposition roles");
 await Reject(()=>store.PackageReview(key,version1.Id,editor),"Library editor cannot open protected TR review route");
 await Reject(()=>store.PackageReview(key,"wrong",reviewer),"unknown review version does not fall back to latest");
 await Reject(()=>store.PackageReview("other",version1.Id,reviewer),"another Library key cannot open package");
 await Reject(()=>store.ChangePackage(new(key,PT(submitted),"APPROVE",ReviewId:version1.Id),editor,true),"Library editor cannot approve");
 await Reject(()=>store.ChangePackage(new(key,PT(submitted),"APPROVE",ReviewId:version1.Id),trView,true),"TR viewer cannot approve");
 foreach(var note in new string?[]{null,"","   ",new string('x',4001)})await Reject(()=>store.ChangePackage(new(key,PT(submitted),"CHANGES_REQUESTED",ReviewId:version1.Id,Comments:note),reviewer,true),"reject requires bounded nonblank notes");
 Check((await store.FinalReviewFor(R(request)))!.Status=="SUBMITTED","failed decisions leave awaiting-review state intact");
 await Reject(()=>store.ChangePackage(new(key,"stale","APPROVE",ReviewId:version1.Id),reviewer,true),"stale package token cannot approve");
 var packagePath=Path.Combine(state,"assembly-library-v1","packages",SimLibraryBomStore.Hash(Encoding.UTF8.GetBytes(key))+".json");var beforeFailure=await File.ReadAllBytesAsync(packagePath);
 using(var held=new FileStream(packagePath,FileMode.Open,FileAccess.Read,FileShare.Read))await Reject(()=>store.ChangePackage(new(key,PT(submitted),"CHANGES_REQUESTED",ReviewId:version1.Id,Comments:"Correct the notes."),reviewer,true),"failed review replacement reports failure");
 Check(beforeFailure.SequenceEqual(await File.ReadAllBytesAsync(packagePath)),"failed review save is atomic");
 var returned=await store.ChangePackage(new(key,PT(submitted),"CHANGES_REQUESTED",ReviewId:version1.Id,Comments:"Correct the drawing selection."),reviewer,true);
 var returnedItem=await Item(requestId);var rejected=await store.FinalReviewFor(R(request));
 Check(rejected is {Status:"CHANGES_REQUESTED",StatusLabel:"Returned to Library",Comments:"Correct the drawing selection."}&&rejected.ReviewedBy?.Id==reviewer.Id,"rejection notes and reviewer are durable actionable Library return");
 Check(returnedItem.GetProperty("finalReview").GetProperty("packageId").GetString()==version1.Id,"Library return identifies rejected package version");
 var closed=J(await store.PackageReview(key,version1.Id,reviewer));Check(!closed.GetProperty("canReview").GetBoolean(),"completed decision cannot be actioned again");
 var priorRejected=PR(returned).Versions.Single();Check(priorRejected.ContentHash==version1.ContentHash&&Hash(priorRejected.Handoff!)==Hash(version1.Handoff!)&&priorRejected.Handoff!.SubmissionNote=="Review this exact request package.","rejection does not alter submission evidence or note");
 var afterReject=StateHash();await Reject(()=>store.ChangePackage(new(key,PT(submitted),"CHANGES_REQUESTED",ReviewId:version1.Id,Comments:"Correct the drawing selection."),reviewer,true),"double-click rejects as stale without repeating action");Check(StateHash()==afterReject,"repeated decision has no write");
 await Reject(()=>store.ChangePackage(new(key,PT(returned),"APPROVE",ReviewId:version1.Id),reviewer,true),"fresh token cannot reverse closed rejection");
 var pkg=J(await store.Package(key,editor));Check(pkg.GetProperty("locked").GetBoolean()&&pkg.GetProperty("canStartChanges").GetBoolean(),"returned version stays fixed until explicit Start changes");
 await StartChanges();var working=J(await store.Package(key,editor));Check(!working.GetProperty("locked").GetBoolean()&&working.GetProperty("bom").GetProperty("id").GetString()!=version1.Bom.Id,"Start changes creates a separate editable version");
 Check((await store.FinalReviewFor(R(request)))!.PackageId==version1.Id,"working draft never changes prior frozen review identity");
 var resubmitted=await SubmitFor(requestId,"Updated package.");var version2=PR(resubmitted).Versions.Last();
 Check(version2.Version==2&&version2.Bom.InternalVersion>version1.Bom.InternalVersion&&(await store.FinalReviewFor(R(request)))!.PackageId==version2.Id,"resubmission advances only the same explicit request binding");
 Check(Hash(PR(resubmitted).Versions[0])==Hash(priorRejected),"resubmission preserves rejected version and notes exactly");
 await Reject(()=>store.ChangePackage(new(key,PT(resubmitted),"APPROVE",ReviewId:version1.Id),reviewer,true),"new package token cannot approve old rejected version");
 var approved=await store.ChangePackage(new(key,PT(resubmitted),"APPROVE",ReviewId:version2.Id),reviewer,true);var approvedVersion=PR(approved).Versions.Last();descriptor=await store.FinalReviewFor(R(request));
 Check(descriptor!.Status=="APPROVED"&&descriptor.PackageId==version2.Id&&descriptor.ContentHash==approvedVersion.ContentHash&&descriptor.ProjectId==p1&&descriptor.ReviewedBy?.Id==reviewer.Id,"approval binding pins exact approved version/project/hash and actor");
 Check(Hash(R(await prep.Assessment(source.IntakeId,1,reviewer)))==prepBefore&&Hash(R(await prep.Assessment(source.IntakeId,2,reviewer)))==siblingBefore,"review cycle never mutates original preparation or sibling record");
 var originalBytes=version2.Documents.ToDictionary(v=>v.Identification.Id,v=>v.Identification.Source.Sha256);
 await File.WriteAllTextAsync(Path.Combine(sourceRoot,"A","drawing.pdf"),"later source change");
 foreach(var doc in approvedVersion.Documents){var openedFile=J(await store.PackageFile(key,approvedVersion.Id,doc.Identification.Id,trView,true));Check(SimLibraryBomStore.Hash(Convert.FromBase64String(openedFile.GetProperty("base64").GetString()!))==originalBytes[doc.Identification.Id],"TR opens frozen approved bytes independent of later source");}
 await Reject(()=>store.PackageFile(key,approvedVersion.Id,approvedVersion.Documents[0].Identification.Id,editor,true),"Library-only role cannot borrow TR file permission");
 await Reject(()=>store.PackageFile(key,approvedVersion.Id,approvedVersion.Documents[0].Identification.Id,trView,false),"TR-only role cannot borrow Library file permission");
 Check(J(await store.PackageFile(key,approvedVersion.Id,approvedVersion.Documents[0].Identification.Id,viewer,false)).GetProperty("base64").GetString()!.Length>0,"Library viewer retains existing frozen-file route");
 await File.WriteAllBytesAsync(Path.Combine(sourceRoot,"A","drawing.pdf"),pdf);await StartChanges();await Identify("drawing.pdf","BOTH","CUSTOMER_ORIGINAL");
 var forSibling=await SubmitFor(R(sibling).Id,"Sibling package.");var siblingVersion=PR(forSibling).Versions.Last();
 Check((await store.FinalReviewFor(R(request)))!.PackageId==version2.Id&&(await store.FinalReviewFor(R(request)))!.Status=="APPROVED","same-key sibling submission never steals prior approved request");
 Check((await store.FinalReviewFor(R(sibling)))!.PackageId==siblingVersion.Id&&(await store.FinalReviewFor(R(sibling)))!.RequestedQuantity==20,"same-key sibling has independent exact version and quantity");
 await store.ChangePackage(new(key,PT(forSibling),"CHANGES_REQUESTED",ReviewId:siblingVersion.Id,Comments:"Check sibling dimensions."),reviewer,true);
 Check((await store.FinalReviewFor(R(request)))!.Status=="APPROVED"&&(await store.FinalReviewFor(R(sibling)))!.Status=="CHANGES_REQUESTED","sibling rejection does not return approved sibling");
 var trQueueBefore=StateHash();var trQueue=J(await intakeStore.ListTechnicalReviewsAsync());var trItems=trQueue.GetProperty("items").EnumerateArray().ToArray();
 Check(trQueue.GetProperty("finalReviewRoundtrip").GetBoolean()&&trItems.Length==2,"main TR queue advertises final-review capability and independent lines");
 Check(trItems.Single(i=>i.GetProperty("projectId").GetString()==p1).GetProperty("finalReview").GetProperty("packageId").GetString()==version2.Id&&trItems.Single(i=>i.GetProperty("projectId").GetString()==p1).GetProperty("status").GetString()=="APPROVED","main TR child A retains exact approved version");
 Check(trItems.Single(i=>i.GetProperty("projectId").GetString()==p2).GetProperty("status").GetString()=="CHANGES_REQUESTED"&&trItems.Single(i=>i.GetProperty("projectId").GetString()==p2).GetProperty("reviewStatusLabel").GetString()=="Returned to Library","main TR child B exposes its own return status");
 Check(StateHash()==trQueueBefore&&(await intakeStore.ReadRfqs()).Length==0,"queue projection writes nothing and does not enable RFQ bridge");
 var saved=await File.ReadAllBytesAsync(packagePath);var legacy=approvedVersion with{Preparation=approvedVersion.Preparation! with{ProjectId=null},Handoff=null};legacy=legacy with{ContentHash=PackageHash(legacy)};await File.WriteAllTextAsync(packagePath,JsonSerializer.Serialize(new LibraryPackagesRecord(key,1,[legacy]),SimLibraryBomStore.Json));
 Check(await store.FinalReviewFor(R(request)) is null&&(await store.FinalReviewFor(R(request) with{ProjectId=null}))?.PackageId==legacy.Id,"legacy null ProjectId binds only exact legacy preparation context");
 legacy=legacy with{Preparation=null};legacy=legacy with{ContentHash=PackageHash(legacy)};await File.WriteAllTextAsync(packagePath,JsonSerializer.Serialize(new LibraryPackagesRecord(key,1,[legacy]),SimLibraryBomStore.Json));
 Check(await store.FinalReviewFor(R(request)) is null&&J(await store.PackageReview(key,legacy.Id,reviewer)).GetProperty("version").GetProperty("status").GetString()=="APPROVED","unbound legacy package stays accessible without attaching to a request");
 await File.WriteAllBytesAsync(packagePath,saved);
 var beforeConcurrent=StateHash();await Task.WhenAll(prep.Queue(editor),store.PackageReview(key,version2.Id,reviewer),store.ReviewPreview(key,requestId,editor,prep)).WaitAsync(TimeSpan.FromSeconds(5));Check(StateHash()==beforeConcurrent,"concurrent queue/review/preview keep lock order and write nothing");
 Console.WriteLine($"TOTAL {count} isolated final-review roundtrip checks passed; fixture {temp}");
}finally{Environment.SetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS",priorRoots);}
