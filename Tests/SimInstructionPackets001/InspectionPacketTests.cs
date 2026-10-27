using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

internal static class InspectionPacketTests
{
 internal static async Task Run(string repo,string source,string root,string? jobWo=null)
 {
  repo=Path.GetFullPath(repo);source=Path.GetFullPath(source);root=Path.GetFullPath(root);
  if(Directory.Exists(root)||root.StartsWith(repo+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||root.StartsWith(source+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Use a new fixture directory outside the source/repository.");
  foreach(var folder in new[]{"data","state","intake-documents","documents"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
   if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
   var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
  }
  var db=Path.Combine(root,"data/dle-os-sim.db");
  await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
  await using(var b=new SqliteConnection($"Data Source={db};Pooling=False")){await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
  var state=new SimStateStore(root);await state.InitializeAsync();var gen=state.Current.Metadata!.Generation;
  var data=new SimOperationsDataStore(repo,root);await data.InitializeAsync(state.Current.Metadata!);var intake=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intake,data);
  SimProductionService Service()=>new(state,data,new(root),provider,new(root));var service=Service();var store=new SimProductionStore(data.DatabasePath);var json=SimProductionService.Json;
  var actor=new SimPersona("inspection-fixture","fixture","Isolated inspection author","ACTIVE",[],[],true,"isolated");
  JsonElement E(object v)=>JsonSerializer.SerializeToElement(v,json);string J(object v)=>JsonSerializer.Serialize(v,json);string U()=>Guid.NewGuid().ToString();
  void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
  async Task<Dictionary<string,string>> Tables(){
   await using var c=store.Open(false);await c.OpenAsync();var tables=new List<string>();await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));}
   var result=new Dictionary<string,string>();foreach(var table in tables){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{table}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(J(values));}result[table]=SimProductionService.Hash(rows);}return result;
  }
  var draftTable=jobWo is null?"SimInstructionPacketDraft":"SimJobInstructionDraft";
  async Task<string[]> DraftHistory(){await using var c=store.Open(false);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=$"SELECT PayloadJson FROM {draftTable} ORDER BY WorkOrderNumber,Generation,Version";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync())rows.Add(r.GetString(0));return rows.ToArray();}
  string wo=jobWo??"";if(jobWo is null)await using(var c=store.Open(false)){await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText="SELECT WorkOrderNumber FROM SimQualityRelease WHERE Generation=@g ORDER BY WorkOrderNumber LIMIT 1";q.Parameters.AddWithValue("@g",gen);wo=(string?)await q.ExecuteScalarAsync()??throw new Exception("Fixture needs an existing released packet; this test never releases one.");}
  async Task<JsonElement> Draft(){if(jobWo is null)return E(await service.ReadPacketDraft(wo,actor));var value=System.Text.Json.Nodes.JsonNode.Parse(J(await service.ReadJobInstructions(wo,actor,jobWo is null)))!;value["draftVersion"]=value["version"]!.DeepClone();value["parentJobId"]=value["baselineToken"]!.DeepClone();value["parentMainId"]=value["mainPacketId"]?.DeepClone();value["stale"]=false;return E(value);}
  var initial=E(await service.ReadJobInstructions(wo,actor,jobWo is null));var draft=await Draft();
  Check(draft.GetProperty("canEdit").GetBoolean()&&!draft.GetProperty("stale").GetBoolean(),"copied existing packet draft is editable with unchanged source lineage");
  var beforeHistory=await DraftHistory();var beforeTables=await Tables();var beforeFiles=Directory.GetFiles(root,"*",SearchOption.AllDirectories).Where(p=>!p.EndsWith(".db")&&!p.EndsWith("-wal")&&!p.EndsWith("-shm")).ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
  var original=draft.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;var definition=draft.GetProperty("definitionId").GetString()!;
  var index=Array.FindIndex(original,o=>o.ParentId is null&&o.Name!="Kitting");var op=original[index];var camera=new SimDrawingCamera(1,.45,.55,.7,.7,90);
  SimLaborSlide Card()=>new(U(),"BLANK","Isolated linked symbol","",1,[new(U(),"Linked location",[],camera)]);
  var cards=new[]{Card(),Card(),Card()};
  SimInspectionAnchor Anchor(int i)=>new(definition,op.Id,cards[i].Id,cards[i].Stages[0].Id,cards[i].Kind,cards[i].Page);
  var parent=new SimDrawingMark(U(),1,"inspection-triangle-filled-parent",[new(.2,.2),new(.35,.35)],Color:"#1255cc",Thickness:.006);
  parent=parent with{Inspection=new(parent.Id,"parent",Anchor(0),2)};
  var child1=new SimDrawingMark(U(),1,"inspection-triangle-filled-child",[new(.4,.4),new(.48,.48)],Color:parent.Color,Thickness:.004,Inspection:new(parent.Id,"child",Anchor(1)));
  var child2=child1 with{Id=U(),Points=[new(.6,.6),new(.7,.7)],Inspection=new(parent.Id,"child",Anchor(2))};
  cards=cards.Select((c,i)=>c with{Stages=[c.Stages[0] with{Marks=[i==0?parent:i==1?child1:child2]}]}).ToArray();
  SimLaborOperation[] WithCards(SimLaborSlide[] added){var result=original.ToArray();var list=(op.Slides??[]).ToList();var at=list.FindIndex(c=>c.Kind=="END");list.InsertRange(at<0?list.Count:at,added);result[index]=op with{Slides=list.ToArray()};return result;}
  async Task Save(SimLaborOperation[] rows){var d=await Draft();if(jobWo is not null){await service.SaveJobInstructions(wo,new(d.GetProperty("version").GetInt32(),d.GetProperty("baselineToken").GetString()!,rows,d.GetProperty("mainPacketId").ValueKind==JsonValueKind.String?d.GetProperty("mainPacketId").GetString():null),actor);return;}await service.SavePacketDraft(wo,new(d.GetProperty("draftVersion").GetInt32(),d.GetProperty("parentJobId").GetString()!,d.GetProperty("parentMainId").ValueKind==JsonValueKind.String?d.GetProperty("parentMainId").GetString():null,rows),actor);}
  async Task<SimLaborOperation[]> Reopen(){service=Service();return (await Draft()).GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;}
  async Task Reject(SimLaborOperation[] rows,string label,string? code=null){var before=J(await Draft());bool rejected=false;try{await Save(rows);}catch(SimRfqIntakeProblem e){if(code is not null&&e.Code!=code)throw;rejected=true;}catch(KittingCaseProblem e){if(code is not null&&e.Code!=code)throw;rejected=true;}Check(rejected,label);Check(J(await Draft())==before,label+" retains exact prior durable draft");}
  var expected=WithCards(cards);await Save(expected);var reopened=await Reopen();Check(J(reopened)==J(expected),"actual draft service save/reopen retains parent, two separate-slide children, size, thickness, color and camera");
  var linked=reopened.SelectMany(o=>o.Slides??[]).SelectMany(c=>c.Stages).SelectMany(s=>s.Marks).Where(m=>m.Inspection?.GroupId==parent.Id).ToArray();
  Check(linked.Count(m=>m.Inspection!.Role=="child")==2&&linked.Single(m=>m.Inspection!.Role=="parent").Inspection!.Expected==2,"coverage recomputes as 2 placed / 2 expected");
  var legacyOnly=reopened.ToArray();legacyOnly[index]=legacyOnly[index] with{Slides=legacyOnly[index].Slides!.Where(c=>!cards.Any(a=>a.Id==c.Id)).ToArray()};Check(J(legacyOnly)==J(original),"all pre-existing legacy packet operations, slides and annotations preserved exactly");
  var edited=cards.ToArray();edited[0]=edited[0] with{Stages=[edited[0].Stages[0] with{Marks=[parent with{Points=[new(.2,.2),new(.4,.4)],Thickness=.009,Inspection=parent.Inspection! with{Expected=3}}]}]};
  await Save(WithCards(edited));Check(J(await Reopen())==J(WithCards(edited)),"edited size/thickness and expected-count values survive packet save/reopen");
  var deleted=edited.ToArray();deleted[2]=deleted[2] with{Stages=[deleted[2].Stages[0] with{Marks=[]}]};await Save(WithCards(deleted));Check(J(await Reopen())==J(WithCards(deleted)),"child deletion persists with one remaining child");
  // Submit the exact state produced by restoring the deleted child (UI undo is separately exercised in Edge).
  await Save(WithCards(edited));Check(J(await Reopen())==J(WithCards(edited)),"undo-restored child persists with its original ID, parent and location");
  var orphan=edited.ToArray();orphan[0]=orphan[0] with{Stages=[orphan[0].Stages[0] with{Marks=[]}]};await Reject(WithCards(orphan),"parent deletion with children rejected");
  var moved=edited.ToArray();moved[1]=moved[1] with{Id=U()};await Reject(WithCards(moved),"replacement destination slide identity rejected");
  var stale=edited.ToArray();stale[1]=stale[1] with{Kind="DRAWING",Source=new("replacement",new string('B',64),definition,"fixture","B","replacement")};await Reject(WithCards(stale),"stale/replacement drawing source rejected");
  var validDrawing=original.SelectMany(o=>o.Slides??[]).First(c=>c.Kind=="DRAWING");
  var replacement=edited.ToArray();replacement[1]=replacement[1] with{Kind="DRAWING",Source=validDrawing.Source,Page=validDrawing.Page,Stages=[replacement[1].Stages[0] with{SavedView=camera with{Page=validDrawing.Page},Marks=[child1 with{Page=validDrawing.Page}]}]};
  await Reject(WithCards(replacement),"otherwise-valid drawing replacement cannot silently relink the child","INSPECTION_LINK_VALUES");
  var missingMetadata=edited.ToArray();missingMetadata[1]=missingMetadata[1] with{Stages=[missingMetadata[1].Stages[0] with{Marks=[child1 with{Inspection=null}]}]};await Reject(WithCards(missingMetadata),"linked kind cannot silently lose relationship metadata");
  // Historical packet records use the exact same typed JSON serializer, without invoking release/publication.
  Check(J(E(await service.ReadJobInstructions(wo,actor,jobWo is null,jobWo is null?null:initial.GetProperty("version").GetInt32())).GetProperty("operations"))==J(initial.GetProperty("operations")),"released/historical viewer still exposes unchanged prior packet");
  var identity=new SimPacketIdentity("fixture","fixture","fixture","fixture","A");var envelope=new SimInstructionPacket(U(),wo,gen,1,U(),"fixture","WO_ONLY","serialization only","fixture",null,2,null,identity,WithCards(edited),[],actor.Id,actor.DisplayName,DateTimeOffset.UtcNow);
  Check(J(JsonSerializer.Deserialize<SimInstructionPacket>(J(envelope),json)!)==J(envelope),"historical/release packet envelope JSON retains complete linked fields without performing a release");
  var afterHistory=await DraftHistory();Check(beforeHistory.All(afterHistory.Contains),"all prior draft-history JSON payloads remain byte-identical");
  var afterTables=await Tables();Check(beforeTables.All(p=>p.Key==draftTable||afterTables.GetValueOrDefault(p.Key)==p.Value),"all non-draft fixture database tables unchanged, including releases, packet heads, history and business records");
  Check(beforeFiles.All(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"all fixture source documents and JSON business files unchanged");
  Console.WriteLine("Covered route: "+(jobWo is null?"SavePacketDraft / ReadPacketDraft":"SaveJobInstructions / ReadJobInstructions"));
  Console.WriteLine("Fixture only: "+root);
 }
}
