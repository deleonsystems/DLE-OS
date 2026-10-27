using System.Text.Json;

internal sealed record LibraryRevisionNameSource(string Kind,string AssemblyNumber,string DrawingRevision,string BomRevision,string SourceRecordHash,string ContractVersion,string DrawingNumber,string BomRevisionDate,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ImportedSourceSha256=null);
internal sealed record LibraryRevisionNameContext(string DrawingRevision,string BomRevision);
internal sealed record LibraryRevisionNameEvent(string? PreviousName,string DisplayName,LibraryRevisionNameSource Source,LibraryActor Actor);
internal sealed record LibraryRevisionNameRecord(string SourceKeyRaw,string DrawingRevision,string BomRevision,int Revision,string? DisplayName,LibraryRevisionNameSource? SavedSource,LibraryRevisionNameEvent[] History);
internal sealed record LibraryRevisionNameView(LibraryRevisionNameRecord Record,string Token,bool CanEdit,LibraryRevisionNameSource Source,LibraryRevisionNameContext Context,bool SourceChanged);
internal sealed record LibraryRevisionNameCommand(string Key,string Token,string DrawingRevision,string BomRevision,string DisplayName);

internal sealed partial class SimLibraryBomStore
{
 // Display metadata only. Never used to match imports, resolve destinations, or rewrite frozen evidence.
 private string RevisionNamePath(string key,string drawing,string bom)=>Path.Combine(root,"revision-names",Hash(JsonSerializer.SerializeToUtf8Bytes(new[]{key,drawing,bom}))+".json");
 private async Task<LibraryRevisionNameSource> RevisionNameSource(string key,LibraryRevisionNameContext context)
 {
  var h=Header(key);var record=await Read(key);var draft=record.Draft??record.Reviews.LastOrDefault()?.Snapshot;
  if(draft is not null&&(draft.DrawingRevision!=context.DrawingRevision||draft.BomRevision!=context.BomRevision))throw SimRfqIntakeProblem.Conflict("LIBRARY_REVISION_NAME","The assembly revision changed. Reopen the name before saving.");
  // Same short VPRO revision can conceal a different ECR. Pin the display-name audit to
  // the retained import fingerprint; never read a live share or change/import source bytes.
  return new(h.ContractVersion=="LIBRARY_MANAGED_V1"&&h.SourceKeyRaw.StartsWith("LIBRARY:",StringComparison.Ordinal)?"LIBRARY":"VPRO5",h.BillNumber,h.DrawingRevision,h.BomRevision,h.SourceRecordHash,h.ContractVersion,h.DrawingNumber,h.BomRevisionDate,draft?.EvidenceHash);
 }
 private static string RevisionNameToken(LibraryRevisionNameRecord r,LibraryRevisionNameSource source,LibraryRevisionNameContext context)=>Hash(JsonSerializer.SerializeToUtf8Bytes(new{record=r,source,context},Json));
 private async Task<LibraryRevisionNameRecord> ReadRevisionName(string key,LibraryRevisionNameContext context)
 {
  var path=RevisionNamePath(key,context.DrawingRevision,context.BomRevision);
  if(!File.Exists(path))return new(key,context.DrawingRevision,context.BomRevision,0,null,null,[]);
  var r=JsonSerializer.Deserialize<LibraryRevisionNameRecord>(await File.ReadAllTextAsync(path),Json)??throw new IOException("Revision name unavailable.");
  if(r.SourceKeyRaw!=key||r.DrawingRevision!=context.DrawingRevision||r.BomRevision!=context.BomRevision||r.History is null||r.Revision!=r.History.Length||r.Revision<1||r.History[^1].DisplayName!=r.DisplayName||r.History[^1].Source!=r.SavedSource)throw new IOException("Revision name context verification failed.");
  return r;
 }
 private static LibraryRevisionNameView RevisionNameView(LibraryRevisionNameRecord r,LibraryRevisionNameSource source,LibraryRevisionNameContext context,SimPersona p)=>new(r,RevisionNameToken(r,source,context),p.Can("assembly_library.edit"),source,context,r.SavedSource is not null&&r.SavedSource!=source);
 internal async Task<LibraryRevisionNameView> RevisionName(string key,SimPersona p)
 {
  Permission(p);await gate.WaitAsync();try{
   var c=await FolderContext(key);var context=new LibraryRevisionNameContext(c.Drawing,c.Bom);var source=await RevisionNameSource(key,context);
   return RevisionNameView(await ReadRevisionName(key,context),source,context,p);
  }finally{gate.Release();}
 }
 internal async Task<LibraryRevisionNameView> SaveRevisionName(LibraryRevisionNameCommand command,SimPersona p)
 {
  Permission(p,write:true);
  if(string.IsNullOrWhiteSpace(command.DisplayName)||command.DisplayName.Length>120||command.DisplayName.Any(char.IsControl))throw SimRfqIntakeProblem.BadRequest("LIBRARY_REVISION_NAME","Enter a revision name of 1 to 120 characters on one line.");
  var name=command.DisplayName.Trim();
  await gate.WaitAsync();try{
   var c=await FolderContext(command.Key);var context=new LibraryRevisionNameContext(c.Drawing,c.Bom);var source=await RevisionNameSource(command.Key,context);
   if(command.DrawingRevision!=context.DrawingRevision||command.BomRevision!=context.BomRevision)throw SimRfqIntakeProblem.Conflict("LIBRARY_REVISION_NAME","The assembly revision changed. Reopen the name before saving.");
   var r=await ReadRevisionName(command.Key,context);
   if(command.Token!=RevisionNameToken(r,source,context))throw SimRfqIntakeProblem.Conflict("LIBRARY_REVISION_NAME","The revision name or source changed. Reopen it before saving.");
   if(r.DisplayName==name&&r.SavedSource==source)return RevisionNameView(r,source,context,p);
   r=r with{Revision=r.Revision+1,DisplayName=name,SavedSource=source,History=[..r.History,new(r.DisplayName,name,source,Actor(p))]};
   var target=RevisionNamePath(command.Key,context.DrawingRevision,context.BomRevision);Directory.CreateDirectory(Path.GetDirectoryName(target)!);var pending=target+"."+Guid.NewGuid().ToString("N")+".tmp";
   try{
    await File.WriteAllTextAsync(pending,JsonSerializer.Serialize(r,Json));
    var check=JsonSerializer.Deserialize<LibraryRevisionNameRecord>(await File.ReadAllTextAsync(pending),Json)??throw new IOException("Revision name save verification failed.");
    if(RevisionNameToken(check,source,context)!=RevisionNameToken(r,source,context))throw new IOException("Revision name save verification failed.");
    // A changed catalog or retained import must not establish a name against unseen source.
    if(await RevisionNameSource(command.Key,context)!=source)throw SimRfqIntakeProblem.Conflict("LIBRARY_REVISION_NAME","The source changed. Reopen the name before saving.");
    File.Move(pending,target,true);
   }finally{if(File.Exists(pending))File.Delete(pending);}
   return RevisionNameView(r,source,context,p);
  }finally{gate.Release();}
 }
}
