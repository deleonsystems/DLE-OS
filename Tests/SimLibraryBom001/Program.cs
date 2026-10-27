using System.Text;
using System.Text.Json;
if(args.FirstOrDefault()=="--serve"){await LibraryBomTestServer.Run(args[1]);return;}
if(args.FirstOrDefault()=="--inspect-vpro-readonly"){
 var sourceBytes=await File.ReadAllBytesAsync(args[1]);var parsed=SimVproParser.Parse(sourceBytes,"read-only-inspection",args[2],args[3],"Read-only inspection",libraryOptionalNob:true);
 Console.WriteLine(JsonSerializer.Serialize(new{hash=SimLibraryBomStore.Hash(sourceBytes),rows=parsed.Rows.Length,nob=parsed.Rows.Where(r=>r.Values.GetValueOrDefault("lineNumber")=="NOB").Select(r=>new{r.RowId,quantity=r.Values.GetValueOrDefault("quantity"),unit=r.Values.GetValueOrDefault("unit"),rawQuantity=r.Extracted.GetValueOrDefault("sourceQuantityRaw"),rawDivisor=r.Extracted.GetValueOrDefault("sourceDivisorRaw")}),notes=parsed.VproImport!.SourceNotes!.Where(n=>n.Text.Contains("CUT"))}));return;
}
var path=Path.Combine(Path.GetTempPath(),"SimLibraryBom001-"+Guid.NewGuid().ToString("N"));
SimAssemblyHeader Header(string bill)=>new("01"+bill.PadRight(20),"hash","V1.2",bill.PadRight(20),"drawing","A","202020","A",false);
var headers=new[]{Header("PART"),Header(" PART"),Header("VPRO"),Header("PREP"),Header("TAMPER")};
var store=new SimLibraryBomStore(path,()=>headers);
SimPersona P(string id,params string[] rights)=>new(id,id,id,"ACTIVE",[],rights,false,"fixture");
SimPersona author=P("author","assembly_library.view","assembly_library.edit"),viewer=P("viewer","assembly_library.view"),reviewer=P("reviewer","technical_review.view","technical_review.disposition"),both=P("both","assembly_library.view","assembly_library.edit","technical_review.view","technical_review.disposition"),super=new SimPersona("super","super","Super","ACTIVE",[],[],true,"fixture");
void Check(bool b,string message){if(!b)throw new Exception(message);}
async Task Reject(Func<Task> f,string label){try{await f();}catch(Exception e)when(e is SimRfqIntakeProblem or LibraryBomPermissionException){return;}throw new Exception("Expected rejection: "+label);}
LibraryRowEdit Row(string id,string qty="1",string unit="EA")=>new(id,"1","CPN","Resistor",qty,unit,"R1","CUSTOMER","","",true,false,"Evidence confirmed",false);
var key=headers[0].SourceKeyRaw;
await Reject(async()=>await store.Get(key,reviewer),"TR-only has no Library view");
var v=await store.Get(key,author);await Reject(async()=>await store.Change(new(key,v.Token,"START"),viewer),"viewer cannot edit");
v=await store.Change(new(key,v.Token,"START"),author);var row=Row(Guid.NewGuid().ToString(),"","");
v=await store.Change(new(key,v.Token,"SAVE",BomRevision:"A",Rows:[row]),author);Check(v.Record.Draft!.Rows[0].Quantity=="","incomplete draft saved");
var reopened=new SimLibraryBomStore(path,()=>headers);Check((await reopened.Get(key,viewer)).Token==v.Token,"reopen persists");await Reject(async()=>await store.Change(new(key,v.Token,"SUBMIT"),author),"incomplete submission");
var oldToken=v.Token;row=row with{Quantity="1",Unit="EA"};
v=await store.Change(new(key,v.Token,"SAVE",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",PreparationAssessed:true,Rows:[row]),author);
await Reject(async()=>await store.Change(new(key,oldToken,"SAVE",Rows:[row]),author),"stale edit");
Check(v.Blockers.Length==0,"ordinary row ready");
v=await store.Change(new(key,v.Token,"ALTERNATE",RowId:row.Id,AlternateDecision:"ADD",PartNumber:"MPN-ALT"),author);var alt=v.Record.Draft!.Rows[0].Alternates.Single();
await Reject(async()=>await store.Change(new(key,v.Token,"SAVE",BomRevision:"A",Rows:[row with{SelectedAlternateId=alt.Id}]),author),"proposed alternative cannot be selected");
await Reject(async()=>await store.Change(new(key,v.Token,"ALTERNATE",RowId:row.Id,AlternateId:alt.Id,AlternateDecision:"APPROVED",Comments:"drawing evidence"),author),"Library edit not alternate approval");
v=await store.Change(new(key,v.Token,"ALTERNATE",RowId:row.Id,AlternateId:alt.Id,AlternateDecision:"APPROVED",Comments:"qualified evidence"),both);
Check(v.Record.Draft!.Rows[0].SelectedAlternateId==alt.Id,"explicit approval selects sole alternate for confirmed customer identity");row=row with{SelectedAlternateId=alt.Id};
v=await store.Change(new(key,v.Token,"SAVE",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",PreparationAssessed:true,Rows:[row]),author);Check(v.Blockers.Length==0,"approved selected PN ready without retyping");
v=await store.Change(new(key,v.Token,"SUBMIT"),author);var submitted=v.Record.Reviews.Single();var frozen=JsonSerializer.Serialize(submitted.Snapshot,SimLibraryBomStore.Json);
await Reject(async()=>await store.Change(new(key,v.Token,"SAVE",Rows:[row]),author),"submitted frozen");
await Reject(async()=>await store.Change(new(key,v.Token,"APPROVE",ReviewId:submitted.Id,Comments:"ok"),author,true),"editor cannot approve");
Check((await store.Queue(reviewer)).Length==1,"reviewer-only queue access");
v=await store.Change(new(key,v.Token,"CHANGES_REQUESTED",ReviewId:submitted.Id,Comments:"Clarify sourcing note"),reviewer,true);
Check(JsonSerializer.Serialize(v.Record.Reviews[0].Snapshot,SimLibraryBomStore.Json)==frozen,"requested changes retain exact submitted version");
v=await store.Change(new(key,v.Token,"REVISE",Comments:"Address sourcing note"),author);Check(v.Record.Draft!.Id!=submitted.Snapshot.Id,"new working identity");v=await store.Change(new(key,v.Token,"SUBMIT"),both);var resubmission=v.Record.Reviews.Last();
v=await store.Change(new(key,v.Token,"APPROVE",ReviewId:resubmission.Id,Comments:"Reviewed source and units"),both,true);
Check(v.Record.Reviews.Last().SubmittedBy.Id==v.Record.Reviews.Last().ReviewedBy!.Id,"same person permitted with separate attribution");Check(v.Record.Reviews[0].Status=="CHANGES_REQUESTED","history retained");
await Reject(async()=>await store.Change(new(key,v.Token,"SAVE",Rows:[row]),author),"approved immutable");
v=await store.Change(new(key,v.Token,"REVISE",Comments:"Next revision"),super);v=await store.Change(new(key,v.Token,"SUBMIT"),super);v=await store.Change(new(key,v.Token,"WITHDRAW",Comments:"Need further edits"),super);Check(v.Record.Draft is not null&&v.Record.Reviews.Last().Status=="WITHDRAWN","withdraw to new draft");
var second=await store.Get(headers[1].SourceKeyRaw,author);Check(second.Record.Draft is null&&second.Record.Reviews.Length==0,"leading-space raw keys independent");
string Export(string assembly,string note="(18.1) R1")=>string.Join('\t',SimVproParser.Headers)+"\tDRAW#="+assembly+" REV A\n"+
 string.Join('\t',new[]{"001","CPN","RESISTOR","ALIAS","1","1","EA","1","0","0","0","P",""})+"\n"+
 string.Join('\t',new[]{"002","MPN-A","RESISTOR","","10",".0001","EA","1","0","0","0","P",""})+"\n"+
 string.Join('\t',new[]{"003","",note,"","0","0","","0","0","0","0","",""})+"\n";
var vk=headers[2].SourceKeyRaw;var vv=await store.Get(vk,both);vv=await store.Change(new(vk,vv.Token,"START"),both);var bytes=Encoding.ASCII.GetBytes(Export("OTHER"));
await Reject(async()=>await store.Change(new(vk,vv.Token,"IMPORT",TextBase64:Convert.ToBase64String(bytes),FileName:"bom.txt"),both),"source mismatch blocks");
vv=await store.Change(new(vk,vv.Token,"IMPORT",TextBase64:Convert.ToBase64String(bytes),FileName:"bom.txt",ConfirmIdentity:true,IdentityReason:"Verified source applies to this assembly"),both);
Check(vv.Record.Draft!.Rows.Single().Find=="18.1"&&vv.Record.Draft!.Rows.Single().Alternates.Length==1,"qualified parser retains literal find and alternate");
Check(vv.Record.Draft!.Import!.VproImport!.IdentityConfirmation!.Sha256==DleAnalysisContract.Hash(bytes),"identity reconciliation pinned to source hash");
Check((await store.Evidence(vk,null,viewer)).SequenceEqual(bytes),"immutable evidence bytes");
await Reject(async()=>await store.Change(new(vk,vv.Token,"IMPORT",TextBase64:Convert.ToBase64String(bytes),FileName:"bom.txt"),both),"no silent replace");
var vr=vv.Record.Draft!.Rows.Single();var ve=new LibraryRowEdit(vr.Id,vr.Find,vr.SourcePartNumber,vr.Description,vr.Quantity,vr.Unit,vr.ReferenceDesignators,"CUSTOMER","","",true,false,"Reviewed",false);
vv=await store.Change(new(vk,vv.Token,"SAVE",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",PreparationAssessed:true,Rows:[ve]),both);Check(vv.Blockers.All(b=>b.Contains("alternate(s) need review")),"exact imported decimal accepted; proposed alternate requires review");
await Reject(async()=>await store.Change(new(vk,vv.Token,"SAVE",BomRevision:"B",Rows:[ve]),both),"revision change invalidates reconciliation");
var prep=vv.Record.Draft with{Rows=[vr with{PreparationRequired=true}]};Check(SimLibraryBomStore.Blockers(prep).Any(b=>b.Contains("Preparation details pending")),"preparation blocked");
Check(SimLibraryBomStore.Blockers(vv.Record.Draft with{Rows=[vr with{Quantity="0",Unit=""}]}).Length>0,"quantity/UOM blockers");
var current=vv.Token;var results=await Task.WhenAll(Enumerable.Range(0,2).Select(async _=>{try{await store.Change(new(vk,current,"SAVE",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",PreparationAssessed:true,Rows:[ve]),both);return true;}catch(SimRfqIntakeProblem){return false;}}));Check(results.Count(x=>x)==1,"concurrent stale write rejected");
vv=await store.Get(vk,both);await File.WriteAllTextAsync(Path.Combine(path,"assembly-library-v1","evidence",vv.Record.Draft!.EvidenceHash+".txt"),"tampered");await Reject(async()=>await store.Change(new(vk,vv.Token,"SUBMIT"),both),"tampered source cannot submit");
Console.WriteLine("PASS manual/VPRO draft persistence, incomplete save, quantity/UOM, exact find, source reconciliation/hash, no replacement, alternate approval vs selection, concurrency, frozen submissions, changes/resubmit, approval/withdraw history, same-person and superadmin, viewer/editor/reviewer separation, raw key collision, preparation and tamper guards.");
await LibraryFolderTests.Run();
await LibraryAlternateSourceTests.Run();
await LibraryRowAcceptanceTests.Run();
await LibraryQuantitySemanticsTests.Run();
await LibrarySourceVersionTests.Run();

await LibraryNobQuantityTests.Run();

await LibraryStockRowTests.Run();

await LibraryAcceptIdentityTests.Run();
