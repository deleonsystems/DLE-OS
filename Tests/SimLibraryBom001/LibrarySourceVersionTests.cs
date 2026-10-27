using System.Text;
using System.Text.Json;
internal static class LibrarySourceVersionTests
{
 internal static async Task Run(){
  var root=Path.Combine(Path.GetTempPath(),"LibrarySourceVersions-"+Guid.NewGuid().ToString("N"));
  var header=new SimAssemblyHeader("01PART                ","fixture","V1.2","PART                ","PART","A","202020","A",false);
  var store=new SimLibraryBomStore(root,()=>[header,header with{SourceKeyRaw="01 PART               "}]);var key=header.SourceKeyRaw;
  SimPersona Person(string id,params string[] rights)=>new(id,id,id,"ACTIVE",[],rights,false,"fixture");
  var both=Person("both","assembly_library.view","assembly_library.edit","technical_review.view","technical_review.disposition");var viewer=Person("viewer","assembly_library.view");var reviewer=Person("reviewer","technical_review.view","technical_review.disposition");
  void Check(bool b,string m){if(!b)throw new Exception(m);}
  async Task Reject(Func<Task> f){try{await f();}catch(Exception e)when(e is SimRfqIntakeProblem or LibraryBomPermissionException){return;}throw new Exception("Expected source-update rejection");}
  string Export(string value,string identity="PART",bool nob=false){var rows=new List<string>{string.Join('\t',SimVproParser.Headers)+"\tDRAW#="+identity+" REV A"};
   for(int i=0;i<(nob?2:1);i++){int s=i*3;rows.Add(string.Join('\t',new[]{(s+1).ToString("000"),"CPN"+i,value,"","1","1","EA","1","0","0","0","P",""}));rows.Add(string.Join('\t',new[]{(s+2).ToString("000"),"MPN"+i,value,"","10",".0001","EA","1","0","0","0","P",""}));rows.Add(string.Join('\t',new[]{(s+3).ToString("000"),"",nob?"(NOB) SUPPORT":"(1) R1","","0","0","","0","0","0","0","",""}));}return string.Join('\n',rows)+"\n";}
  string B64(string s)=>Convert.ToBase64String(Encoding.ASCII.GetBytes(s));
  var v=await store.Get(key,both);v=await store.Change(new(key,v.Token,"START"),both);var initial=Export("FIRST");v=await store.Change(new(key,v.Token,"IMPORT",FileName:"bom.txt",TextBase64:B64(initial)),both);
  var row=v.Record.Draft!.Rows[0];v=await store.Change(new(key,v.Token,"ALTERNATE",RowId:row.Id,AlternateId:row.Alternates[0].Id,AlternateDecision:"APPROVE_SOURCE"),both);
  var edit=new LibraryRowEdit(row.Id,row.Find,row.SourcePartNumber,row.Description,row.Quantity,row.Unit,row.ReferenceDesignators,"UNRESOLVED","","",false,false,"",false,row.Alternates[0].Id);
  v=await store.Change(new(key,v.Token,"ACCEPT_ROW",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",Rows:[edit],RowId:row.Id),both);
  var old=v.Record.Draft!;var frozen=JsonSerializer.Serialize(old,SimLibraryBomStore.Json);var token=v.Token;var next=Export("SECOND",nob:true);
  Check(old.Rows[0].Acceptance is not null,"fixture accepted row");
  foreach(var command in new[]{new LibraryBomCommand(key,token,"UPDATE_SOURCE",FileName:"bad.txt",TextBase64:B64("invalid")),new(key,token,"UPDATE_SOURCE",FileName:"same.txt",TextBase64:B64(initial)),new(key,token,"UPDATE_SOURCE",FileName:"wrong.txt",TextBase64:B64(Export("WRONG","OTHER"))),new(key,"stale","UPDATE_SOURCE",FileName:"next.txt",TextBase64:B64(next))})await Reject(async()=>await store.Change(command,both));
  await Reject(async()=>await store.Change(new(key,token,"UPDATE_SOURCE",FileName:"next.txt",TextBase64:B64(next)),viewer));
  Check((await store.Get(key,both)).Token==token,"failed/cancelled operations preserve saved draft");
  var attempts=await Task.WhenAll(Enumerable.Range(0,2).Select(async _=>{try{await store.Change(new(key,token,"UPDATE_SOURCE",FileName:"next.txt",TextBase64:B64(next)),both);return true;}catch(SimRfqIntakeProblem){return false;}}));Check(attempts.Count(x=>x)==1,"one concurrent update");
  v=await new SimLibraryBomStore(root,()=>[header]).Get(key,both);var d=v.Record.Draft!;var archived=v.Record.SourceVersions!.Single();
  Check(d.InternalVersion==2&&d.ImportedAtUtc is not null&&d.Id!=old.Id,"new internal version/date/identity");Check(d.BomRevision==old.BomRevision&&d.DrawingRevision==old.DrawingRevision,"customer revisions unchanged");
  Check(JsonSerializer.Serialize(archived.Snapshot,SimLibraryBomStore.Json)==frozen,"exact prior snapshot recoverable");Check((await store.Evidence(key,"source:"+archived.Id,viewer)).SequenceEqual(Encoding.ASCII.GetBytes(initial)),"old evidence viewable");
  await Reject(async()=>await store.Evidence(key,"source:"+archived.Id,reviewer,true));
  Check(d.Rows.Length==2&&d.Rows.All(r=>r.Find=="NOB")&&d.Rows.Select(r=>r.Id).Distinct().Count()==2,"duplicate NOB records distinct");
  Check(d.Rows.All(r=>r.Acceptance is null&&!r.IdentityConfirmed&&r.SelectedAlternateId is null&&r.Alternates.All(a=>a.Status=="PROPOSED"&&a.Decision is null)),"no old decisions inherited");
  await Reject(async()=>await store.Change(new(key,v.Token,"UPDATE_SOURCE",FileName:"same.txt",TextBase64:B64(next)),both));await Reject(async()=>await store.Change(new(key,v.Token,"UPDATE_SOURCE",FileName:"old.txt",TextBase64:B64(initial)),both));
  Check((await store.Get("01 PART               ",both)).Record.Draft is null,"other raw key untouched");
  // Submission remains immutable. Ordinary manual version demonstrates approved-version path.
  var secondKey="01 PART               ";var second=await store.Get(secondKey,both);second=await store.Change(new(secondKey,second.Token,"START"),both);second=await store.Change(new(secondKey,second.Token,"SAVE",DrawingRevision:"A",BomRevision:"A",QuantityBasis:"PER_ASSEMBLY",Rows:[edit with{Id=Guid.NewGuid().ToString(),SelectedAlternateId=null,IdentityBasis="CUSTOMER",IdentityConfirmed=true}]),both);second=await store.Change(new(secondKey,second.Token,"SUBMIT"),both);var review=second.Record.Reviews.Single();
  await Reject(async()=>await store.Change(new(secondKey,second.Token,"UPDATE_SOURCE",FileName:"next.txt",TextBase64:B64(next)),both));second=await store.Change(new(secondKey,second.Token,"APPROVE",ReviewId:review.Id,Comments:"fixture approval"),both,true);var approved=JsonSerializer.Serialize(second.Record.Reviews,SimLibraryBomStore.Json);second=await store.Change(new(secondKey,second.Token,"REVISE",Comments:"new source"),both);second=await store.Change(new(secondKey,second.Token,"UPDATE_SOURCE",FileName:"next.txt",TextBase64:B64(next)),both);Check(JsonSerializer.Serialize(second.Record.Reviews,SimLibraryBomStore.Json)==approved,"approved historical version unchanged");
  Console.WriteLine("PASS versioned source updates: atomic history/evidence, decisions reset, duplicate NOB, duplicate file rejection, permissions/concurrency, frozen review and unrelated identity.");
 }
}


